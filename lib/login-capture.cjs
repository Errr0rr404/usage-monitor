function pickClaude(cookies) {
  const hit = (cookies || []).find((cookie) => cookie.name === 'sessionKey' && typeof cookie.value === 'string' && cookie.value.startsWith('sk-ant'));
  if (!hit) return null;
  return { secret: hit.value };
}

function pickGrok(cookies) {
  const list = (cookies || []).filter((cookie) => cookie && cookie.name && cookie.value);
  const sso = list.filter((cookie) => cookie.name === 'sso' || cookie.name === 'sso-rw');
  if (!sso.length) return null;
  const names = new Set(sso.map((cookie) => cookie.name));
  const extras = list.filter((cookie) => !names.has(cookie.name) && cookie.name !== 'cf_clearance');
  const chosen = sso.concat(extras);
  return { secret: chosen.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') };
}

function pickCodex(session) {
  const token = session && typeof session.accessToken === 'string' ? session.accessToken : '';
  if (token.length < 20) return null;
  const email = session.user?.email || null;
  const accountId = session.account?.id || session.user?.id || null;
  return {
    secret: token,
    email: email || null,
    accountId: accountId ? String(accountId) : null,
  };
}

function pickBearer(header) {
  if (!header) return null;
  const value = String(header).replace(/^Bearer\s+/i, '').trim();
  if (value.length < 20 || value.length > 4000) return null;
  if (/^(null|undefined)$/i.test(value)) return null;
  return value;
}

function pickStoredSecret(entries) {
  const preferred = [/api[_-]?key/i, /access[_-]?token/i, /auth[_-]?token/i, /^token$/i, /subscription[_-]?key/i];
  const rows = Array.isArray(entries) ? entries : [];
  for (const pattern of preferred) {
    for (const row of rows) {
      const key = row && row[0];
      const value = row && row[1];
      if (typeof key !== 'string' || typeof value !== 'string') continue;
      if (!pattern.test(key)) continue;
      const secret = secretFromStoredValue(value);
      if (secret) return secret;
    }
  }
  for (const row of rows) {
    const value = row && row[1];
    if (typeof value !== 'string' || !value.startsWith('{')) continue;
    const secret = secretFromStoredValue(value);
    if (secret) return secret;
  }
  return null;
}

function secretFromStoredValue(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 8000) return null;
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      const nested = json.token || json.access_token || json.accessToken || json.apiKey || json.api_key || json.key;
      if (typeof nested === 'string') return pickBearer(nested.startsWith('Bearer ') ? nested : `Bearer ${nested}`);
    } catch {
      return null;
    }
    // A stored object with no token field is not itself a token.
    return null;
  }
  return pickBearer(text.startsWith('Bearer ') ? text : `Bearer ${text}`);
}

function loginUrl(provider, region) {
  if (provider === 'claude') return 'https://claude.ai/login';
  if (provider === 'codex') return 'https://chatgpt.com/';
  if (provider === 'grok') return 'https://grok.com/';
  if (provider === 'minimax') {
    return region === 'cn' ? 'https://platform.minimaxi.com/' : 'https://platform.minimax.io/';
  }
  return null;
}

module.exports = {
  pickClaude,
  pickGrok,
  pickCodex,
  pickBearer,
  pickStoredSecret,
  loginUrl,
};
