const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const { decodeJwt } = require('../lib/parse.cjs');
const {
  PROVIDERS,
  pkce,
  authorizeUrl,
  normalizeMinimaxUri,
  deadlineFrom,
  bundleSecret,
  ensureGeminiClient,
} = require('../lib/oauth.cjs');

let current = null;

function htmlPage(title, message) {
  const safe = String(message || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  return `<!DOCTYPE html><html lang="en"><meta charset="utf-8"><title>${safe}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#23272c;color:#f3f0e8;font-family:Avenir Next,Segoe UI,sans-serif"><p style="font-size:18px">${safe}</p></body></html>`;
}

function listen(port, host, handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeAllListeners('error');
      resolve(server);
    });
  });
}

async function openLoopback(spec, handler) {
  const servers = [];
  const hosts = spec.bind ? [spec.bind] : ['127.0.0.1', '::1'];
  let firstError = null;
  for (const host of hosts) {
    try {
      servers.push(await listen(spec.port, host, handler));
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  if (!servers.length) {
    const busy = firstError && firstError.code === 'EADDRINUSE';
    throw new Error(busy
      ? 'The login port is already in use. Quit any other sign-in, then try again.'
      : 'The login handshake could not start.');
  }
  return {
    close() {
      servers.forEach((server) => server.close());
    },
  };
}

function emailFromToken(token) {
  const payload = decodeJwt(token) || {};
  const profile = payload['https://api.openai.com/profile'] || {};
  const auth = payload['https://api.openai.com/auth'] || {};
  return {
    email: profile.email || payload.email || null,
    accountId: auth.chatgpt_account_id || null,
  };
}

async function exchange(spec, { code, verifier, state }) {
  const headers = { Accept: 'application/json' };
  let body;
  if (spec.tokenStyle === 'json') {
    headers['Content-Type'] = 'application/json';
    const payload = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: spec.redirect,
      client_id: spec.clientId,
      code_verifier: verifier,
      state,
    };
    if (spec.clientSecret) payload.client_secret = spec.clientSecret;
    body = JSON.stringify(payload);
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const fields = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: spec.redirect,
      client_id: spec.clientId,
      code_verifier: verifier,
    };
    if (spec.clientSecret) fields.client_secret = spec.clientSecret;
    body = new URLSearchParams(fields).toString();
  }
  const response = await fetch(spec.token, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error('The sign-in handshake was rejected. Try again.');
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The sign-in handshake returned something unexpected.');
  }
  if (!json.access_token) throw new Error('The sign-in handshake did not return a session.');
  return json;
}

function signInLoopback(provider, onProgress) {
  const spec = PROVIDERS[provider];
  const flow = pkce();
  const url = authorizeUrl(provider, flow);

  return new Promise((resolve) => {
    let settled = false;
    let gateway = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      current = null;
      if (gateway) gateway.close();
      resolve(result);
    };
    const timeout = setTimeout(() => {
      finish({ ok: false, error: 'Sign-in took too long. Try again.' });
    }, 6 * 60 * 1000);

    let received = false;
    const handler = (request, response) => {
      const requestUrl = new URL(request.url || '/', spec.redirect);
      if (requestUrl.pathname !== spec.path) {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Not found');
        return;
      }
      const error = requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error');
      if (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(htmlPage('Sign-in stopped', 'Sign-in was not approved. You can close this tab.'));
        finish({ ok: false, error: 'Sign-in was not approved.' });
        return;
      }
      if (requestUrl.searchParams.get('state') !== flow.state) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(htmlPage('Sign-in stopped', 'This sign-in did not match the one Usage Monitor started.'));
        finish({ ok: false, error: 'The sign-in handshake did not match. Try again.' });
        return;
      }
      if (received) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(htmlPage('Signed in', 'Signed in. You can close this tab and return to Usage Monitor.'));
        return;
      }
      received = true;
      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(htmlPage('Sign-in stopped', 'The browser did not return a login code.'));
        finish({ ok: false, error: 'The browser did not return a login code.' });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(htmlPage('Signed in', 'Signed in. You can close this tab and return to Usage Monitor.'));
      exchange(spec, { code, verifier: flow.verifier, state: flow.state })
        .then((tokens) => {
          const identity = emailFromToken(tokens.access_token);
          finish({
            ok: true,
            secret: bundleSecret(tokens),
            email: identity.email,
            accountId: identity.accountId,
          });
        })
        .catch((exchangeError) => {
          finish({ ok: false, error: exchangeError.message || 'The sign-in handshake was rejected. Try again.' });
        });
    };

    current = { finish };
    openLoopback(spec, handler)
      .then((opened) => {
        if (settled) {
          opened.close();
          return;
        }
        gateway = opened;
        if (onProgress) onProgress({ message: 'Your browser is open. Sign in, then it hands the session back here.' });
        return shell.openExternal(url);
      })
      .catch((error) => {
        finish({ ok: false, error: error.message || 'The browser could not be opened.' });
      });
  });
}

async function signInDevice(region, onProgress, session) {
  const spec = PROVIDERS.minimax;
  const host = spec.hosts[region === 'cn' ? 'cn' : 'global'];
  const flow = pkce();
  const codeResponse = await fetch(`${host}/oauth2/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: spec.clientId,
      scope: spec.scope,
      code_challenge: flow.challenge,
      code_challenge_method: 'S256',
      state: flow.state,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!codeResponse.ok) throw new Error('MiniMax could not start sign-in. Try again.');
  const data = await codeResponse.json();
  if (!data.verification_uri || !data.user_code) throw new Error('MiniMax did not return a sign-in page.');
  if (data.state && data.state !== flow.state) throw new Error('The sign-in handshake did not match. Try again.');
  if (session.canceled) return { ok: false, canceled: true };
  const page = normalizeMinimaxUri(data.verification_uri);
  if (onProgress) {
    onProgress({
      code: data.user_code,
      message: 'Enter this code on the MiniMax page. It is also copied, so you can paste it.',
    });
  }
  await waitFor(session, 700);
  if (session.canceled) return { ok: false, canceled: true };
  await shell.openExternal(page);
  const deadline = deadlineFrom(data.expired_in);
  let wait = Number(data.interval) || 3000;
  if (wait < 200) wait *= 1000;
  while (Date.now() < deadline) {
    if (session.canceled) return { ok: false, canceled: true };
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, wait);
      session.finish = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    if (session.canceled) return { ok: false, canceled: true };
    const tokenResponse = await fetch(`${host}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: spec.clientId,
        user_code: data.user_code,
        code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (token.status === 'pending' || token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') {
      wait = Math.min(wait + 2000, 15000);
      continue;
    }
    if (!tokenResponse.ok) throw new Error('MiniMax rejected the sign-in handshake.');
    if (token.access_token) {
      return {
        ok: true,
        secret: bundleSecret(token),
        email: null,
        accountId: null,
      };
    }
    if (token.status && token.status !== 'pending') {
      throw new Error('MiniMax did not finish sign-in.');
    }
  }
  throw new Error('Sign-in took too long. Try again.');
}

function waitFor(session, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    session.finish = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function signInCursor(onProgress, session) {
  const flow = pkce();
  const uuid = crypto.randomUUID();
  const url = `${PROVIDERS.cursor.login}?${new URLSearchParams({
    challenge: flow.challenge,
    uuid,
    mode: 'login',
    redirectTarget: 'cli',
  })}`;
  if (session.canceled) return { ok: false, canceled: true };
  await shell.openExternal(url);
  if (onProgress) onProgress({ message: 'Your browser is open. Sign in to Cursor and approve the login.' });
  const deadline = Date.now() + 6 * 60 * 1000;
  let useGet = false;
  while (Date.now() < deadline) {
    if (session.canceled) return { ok: false, canceled: true };
    await waitFor(session, 1200);
    if (session.canceled) return { ok: false, canceled: true };
    const response = useGet
      ? await fetch(`${PROVIDERS.cursor.poll}?uuid=${encodeURIComponent(uuid)}&verifier=${encodeURIComponent(flow.verifier)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
      : await fetch(PROVIDERS.cursor.poll, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, verifier: flow.verifier }),
        signal: AbortSignal.timeout(20000),
      });
    const text = await response.text();
    if (response.status === 404) {
      if (!useGet && /cannot post|<!doctype|<html/i.test(text)) useGet = true;
      continue;
    }
    let token = {};
    try {
      token = JSON.parse(text);
    } catch {
      token = {};
    }
    const access = token.accessToken || token.access_token;
    if (access) {
      const payload = decodeJwt(access) || {};
      return {
        ok: true,
        secret: bundleSecret({ access_token: access, refresh_token: token.refreshToken || token.refresh_token || '' }),
        email: payload.email || null,
        accountId: payload.sub || null,
      };
    }
    if (!response.ok && response.status !== 202) throw new Error('Cursor rejected the sign-in handshake.');
  }
  throw new Error('Sign-in took too long. Try again.');
}

async function signInCopilot(onProgress, session) {
  const spec = PROVIDERS.copilot;
  const codeResponse = await fetch(spec.device, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: spec.clientId, scope: spec.scope }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await codeResponse.json().catch(() => ({}));
  if (!codeResponse.ok || !data.device_code) throw new Error('GitHub could not start Copilot sign-in. Try again.');
  if (session.canceled) return { ok: false, canceled: true };
  if (onProgress) {
    onProgress({
      code: data.user_code,
      message: 'Enter this code on the GitHub page. It is also copied, so you can paste it.',
    });
  }
  await waitFor(session, 700);
  if (session.canceled) return { ok: false, canceled: true };
  await shell.openExternal(data.verification_uri_complete || data.verification_uri);
  const deadline = Date.now() + (Number(data.expires_in) || 600) * 1000;
  let wait = Math.max(2, Number(data.interval) || 5) * 1000;
  while (Date.now() < deadline) {
    if (session.canceled) return { ok: false, canceled: true };
    await waitFor(session, wait);
    if (session.canceled) return { ok: false, canceled: true };
    const tokenResponse = await fetch(spec.token, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: spec.clientId,
        device_code: data.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      signal: AbortSignal.timeout(20000),
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') {
      wait = Math.min(wait + 5000, 20000);
      continue;
    }
    if (token.error === 'access_denied') return { ok: false, canceled: true };
    if (token.error === 'expired_token') throw new Error('Sign-in took too long. Try again.');
    if (token.access_token) {
      return { ok: true, secret: bundleSecret(token), email: null, accountId: null };
    }
    if (!tokenResponse.ok) throw new Error('GitHub rejected the Copilot sign-in.');
  }
  throw new Error('Sign-in took too long. Try again.');
}

async function signInMuse(onProgress, session) {
  const spec = PROVIDERS.muse;
  const baseHeaders = { Accept: 'application/json', 'x-api-version': '1.0.0' };
  const codeResponse = await fetch(spec.device, {
    method: 'POST',
    headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: spec.clientId }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await codeResponse.json().catch(() => ({}));
  if (!codeResponse.ok || !data.device_code || !data.user_code) {
    throw new Error('Meta could not start Muse sign-in. Try again.');
  }
  const page = data.verification_uri_complete || data.verification_uri;
  if (!page || !/^https:\/\//i.test(page)) throw new Error('Meta did not return a sign-in page.');
  if (session.canceled) return { ok: false, canceled: true };
  if (onProgress) {
    onProgress({
      code: data.user_code,
      message: 'Enter this code on the Meta page. It is also copied, so you can paste it.',
    });
  }
  await waitFor(session, 700);
  if (session.canceled) return { ok: false, canceled: true };
  await shell.openExternal(page);
  const deadline = deadlineFrom(data.expires_in || 900);
  let wait = Math.max(5, Number(data.interval) || 5) * 1000;
  while (Date.now() < deadline) {
    if (session.canceled) return { ok: false, canceled: true };
    await waitFor(session, wait);
    if (session.canceled) return { ok: false, canceled: true };
    let tokenResponse;
    try {
      tokenResponse = await fetch(spec.token, {
        method: 'POST',
        headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: spec.clientId,
          device_code: data.device_code,
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      continue;
    }
    const token = await tokenResponse.json().catch(() => ({}));
    if (token.access_token) {
      return { ok: true, secret: bundleSecret(token), email: null, accountId: null };
    }
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') {
      wait = Math.min(wait + 5000, 30000);
      continue;
    }
    if (token.error === 'access_denied') return { ok: false, canceled: true };
    if (token.error === 'expired_token') throw new Error('Sign-in took too long. Try again.');
    if (!tokenResponse.ok && (tokenResponse.status === 408 || tokenResponse.status === 429 || tokenResponse.status >= 500)) continue;
    if (!tokenResponse.ok) throw new Error('Meta rejected the Muse sign-in.');
  }
  throw new Error('Sign-in took too long. Try again.');
}

function signIn(provider, options = {}) {
  const onProgress = options.onProgress;
  if (provider === 'minimax') {
    const session = { canceled: false, finish: null };
    current = session;
    return signInDevice(options.region, onProgress, session)
      .catch((error) => ({
        ok: false,
        error: error.message || 'Sign-in could not finish.',
      }))
      .finally(() => {
        if (current === session) current = null;
      });
  }
  if (provider === 'cursor' || provider === 'copilot' || provider === 'muse') {
    const session = { canceled: false, finish: null };
    current = session;
    const run = provider === 'cursor'
      ? signInCursor(onProgress, session)
      : provider === 'copilot'
        ? signInCopilot(onProgress, session)
        : signInMuse(onProgress, session);
    return run
      .catch((error) => ({
        ok: false,
        error: error.message || 'Sign-in could not finish.',
      }))
      .finally(() => {
        if (current === session) current = null;
      });
  }
  if (!PROVIDERS[provider] || PROVIDERS[provider].mode !== 'loopback') {
    return Promise.resolve({ ok: false, error: 'Choose a service first.' });
  }
  if (provider === 'gemini') {
    return ensureGeminiClient()
      .then(() => signInLoopback(provider, onProgress))
      .catch((error) => ({
        ok: false,
        error: error.message || 'Gemini sign-in could not start.',
      }));
  }
  return signInLoopback(provider, onProgress);
}

function cancelSignIn() {
  if (!current) return;
  current.canceled = true;
  if (current.finish) current.finish({ ok: false, canceled: true });
}

module.exports = { signIn, cancelSignIn };
