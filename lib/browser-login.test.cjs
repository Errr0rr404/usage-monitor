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
    setTimeout: overrides.setTimeout || ((callback) => setImmediate(callback)),
    clearTimeout: overrides.clearTimeout || clearImmediate,
    require: (name) => {
      if (name === 'electron') return { shell: { openExternal: async (url) => opened.push(url) } };
      if (name === '../lib/oauth.cjs') return { ...oauth, ...overrides.oauth };
      if (name === 'http') return overrides.http || { createServer: () => { throw new Error('Unexpected listener'); } };
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

// A loopback server that never touches the network: the test calls the
// handler the way a browser tab would.
function fakeHttp() {
  const servers = [];
  const listening = deferred();
  return {
    servers,
    listening: listening.promise,
    createServer(handler) {
      const server = {
        handler,
        closed: false,
        droppedSockets: false,
        once() {},
        on() {},
        removeAllListeners() {},
        listen(_port, _host, callback) {
          servers.push(server);
          callback();
          listening.resolve();
        },
        close() { server.closed = true; },
        closeAllConnections() { server.droppedSockets = true; },
      };
      return server;
    },
  };
}

function visit(server, url) {
  const answer = { status: 0, headers: {}, body: '', shouldKeepAlive: true };
  server.handler({ url }, {
    set shouldKeepAlive(value) { answer.shouldKeepAlive = value; },
    writeHead(status, headers) { answer.status = status; answer.headers = headers; },
    end(body) { answer.body = String(body || ''); },
  });
  return answer;
}

function loopbackLogin() {
  const http = fakeHttp();
  const exchanged = [];
  const login = loadLogin({
    http,
    setTimeout: () => 0,
    clearTimeout: () => {},
    oauth: { ensureGeminiClient: async () => ({}) },
    fetch: async (url, options) => {
      exchanged.push({ url, body: String(options.body) });
      return { ok: true, text: async () => JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh' }) };
    },
  });
  return { login, http, exchanged };
}

test('a tab from an earlier Gemini sign-in does not end the current one', async () => {
  const { login, http, exchanged } = loopbackLogin();
  const result = login.signIn('gemini');
  await http.listening;
  await new Promise((resolve) => setImmediate(resolve));
  const state = new URL(login.opened[0]).searchParams.get('state');
  const server = http.servers[0];

  const stale = visit(server, '/oauth-callback?state=from-an-earlier-flow&code=old-code');
  assert.equal(stale.status, 400);
  assert.match(stale.body, /earlier sign-in/);
  assert.equal(stale.shouldKeepAlive, false);
  const staleError = visit(server, '/oauth-callback?state=from-an-earlier-flow&error=access_denied');
  assert.match(staleError.body, /earlier sign-in/);
  assert.equal(server.closed, false, 'the current sign-in is still waiting');

  const fresh = visit(server, `/oauth-callback?state=${state}&code=new-code`);
  assert.equal(fresh.status, 200);
  const done = plain(await result);
  assert.equal(done.ok, true);
  assert.equal(JSON.parse(done.secret).accessToken, 'new-access');
  assert.equal(exchanged.length, 1);
  assert.match(exchanged[0].body, /code=new-code/);
  assert.ok(server.closed && server.droppedSockets, 'a finished flow also drops kept-alive sockets');
});

test('a denied approval for the current sign-in still ends it', async () => {
  const { login, http } = loopbackLogin();
  const result = login.signIn('gemini');
  await http.listening;
  await new Promise((resolve) => setImmediate(resolve));
  const state = new URL(login.opened[0]).searchParams.get('state');
  visit(http.servers[0], `/oauth-callback?state=${state}&error=access_denied`);
  assert.deepEqual(plain(await result), { ok: false, error: 'Sign-in was not approved.' });
});
