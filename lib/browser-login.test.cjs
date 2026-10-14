const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const oauth = require('./oauth.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function loadLogin(overrides = {}) {
  const opened = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/browser-login.cjs'), 'utf8'), {
    module,
    URL,
    URLSearchParams,
    AbortSignal,
    fetch: overrides.fetch,
    setTimeout: (callback) => setImmediate(callback),
    clearTimeout: clearImmediate,
    require: (name) => {
      if (name === 'electron') return { shell: { openExternal: async (url) => opened.push(url) } };
      if (name === '../lib/oauth.cjs') return { ...oauth, ...overrides.oauth };
      if (name === 'http') return { createServer: () => { throw new Error('Unexpected listener'); } };
      return require(name);
    },
  });
  return { ...module.exports, opened };
}

function response(body) {
  return { ok: true, json: async () => body };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('cancel during Gemini setup prevents opening the browser', async () => {
  const setup = deferred();
  const login = loadLogin({ oauth: { ensureGeminiClient: () => setup.promise } });
  const result = login.signIn('gemini');
  login.cancelSignIn();
  setup.resolve();
  assert.deepEqual(plain(await result), { ok: false, canceled: true });
  assert.deepEqual(login.opened, []);
});

test('a device token arriving after Cancel cannot complete sign-in', async () => {
  const token = deferred();
  const polling = deferred();
  const login = loadLogin({
    fetch: async (url) => {
      if (url === oauth.PROVIDERS.copilot.device) {
        return response({ device_code: 'device-1', verification_uri: 'https://github.com/login/device' });
      }
      polling.resolve();
      return token.promise;
    },
  });
  const result = login.signIn('copilot');
  await polling.promise;
  login.cancelSignIn();
  token.resolve(response({ access_token: 'test-token' }));
  assert.deepEqual(plain(await result), { ok: false, canceled: true });
});

test('finishing an old request does not clear the newer sign-in', async () => {
  const tokens = [deferred(), deferred()];
  const polling = [deferred(), deferred()];
  let device = 0;
  const login = loadLogin({
    fetch: async (url, options) => {
      if (url === oauth.PROVIDERS.copilot.device) {
        return response({ device_code: String(device++), verification_uri: 'https://github.com/login/device' });
      }
      const index = Number(options.body.get('device_code'));
      polling[index].resolve();
      return tokens[index].promise;
    },
  });
  const first = login.signIn('copilot');
  await polling[0].promise;
  const second = login.signIn('copilot');
  await polling[1].promise;
  tokens[0].resolve(response({ access_token: 'old-token' }));
  assert.deepEqual(plain(await first), { ok: false, canceled: true });
  login.cancelSignIn();
  tokens[1].resolve(response({ access_token: 'new-token' }));
  assert.deepEqual(plain(await second), { ok: false, canceled: true });
});
