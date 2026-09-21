const {
  cleanSecret,
  decodeJwt,
  parseClaudeUsage,
  parseCodexUsage,
  parseGrokBilling,
  parseGrokRateLimits,
  parseMiniMax,
  parseCursorSummary,
  parseCopilotUsage,
  parseGeminiQuota,
  geminiProjectId,
  geminiSetupPlan,
  parseMuseUsage,
  museKeyProblem,
} = require('./parse.cjs');
const { sessionFromSecret, refreshTokens } = require('./oauth.cjs');

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProviderError';
    this.status = status || 0;
  }
}

const NAMES = {
  grok: 'Grok',
  minimax: 'MiniMax',
  codex: 'Codex',
  claude: 'Claude',
  cursor: 'Cursor',
  copilot: 'Copilot',
  gemini: 'Gemini',
  muse: 'Muse',
};

function providerName(id) {
  return NAMES[id] || 'The service';
}

function messageFor(provider, error) {
  const name = providerName(provider);
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `${name} took too long to answer.`;
  }
  if (error instanceof ProviderError) {
    if (/no longer supported/i.test(error.message)) {
      return 'Google retired this Gemini login. Remove it and sign in again. The approval page now says Antigravity.';
    }
    if (error.status === 401 || error.status === 403 || error.status === 429) {
      return statusMessage(name, error.status);
    }
    if (error.message && !/^The service\b/.test(error.message)) return error.message;
    if (error.status) return statusMessage(name, error.status);
  }
  return `Couldn't reach ${name}. Check the connection.`;
}

function statusMessage(name, status) {
  if (status === 401 || status === 403) {
    return `That ${name} login was rejected. Add it again with a fresh token.`;
  }
  if (status === 429) return `${name} asked us to wait. Refresh again in a minute.`;
  return `${name} returned an error (${status}). Refresh again in a minute.`;
}

function scrub(text, secret) {
  let value = String(text || '').replace(/\s+/g, ' ').trim();
  if (secret && secret.length > 8) value = value.split(secret).join('…');
  return value.slice(0, 160);
}

async function readBody(response, secret) {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('<')) {
    throw new ProviderError('The service blocked the request. Try again in a minute.', response.status);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new ProviderError(statusMessage(response.status ? 'The service' : 'The service', response.status || 502), response.status);
  }
}

async function requestJson(url, options, secret) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  const json = await readBody(response, secret);
  if (!response.ok) {
    const upstream = json?.error?.message || json?.message || json?.base_resp?.status_msg || json?.error;
    const detail = typeof upstream === 'string' ? scrub(upstream, secret) : '';
    if (detail && response.status !== 401 && response.status !== 403) {
      throw new ProviderError(detail, response.status);
    }
    throw new ProviderError(statusMessage('The service', response.status), response.status);
  }
  return json;
}

function claudeHeaders(secret) {
  const value = cleanSecret(secret);
  if (value.startsWith('sk-ant-oat')) {
    return {
      mode: 'oauth',
      headers: {
        Authorization: `Bearer ${value}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        Accept: 'application/json',
      },
    };
  }
  const cookie = /sessionKey=/i.test(value) ? value : `sessionKey=${value}`;
  return {
    mode: 'session',
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': BROWSER_UA,
      Referer: 'https://claude.ai/new',
      Origin: 'https://claude.ai',
      'anthropic-client-platform': 'web_claude_ai',
    },
  };
}

function pickOrg(payload) {
  const list = Array.isArray(payload) ? payload : payload?.organizations || payload?.data || [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const chat = list.find((org) => Array.isArray(org.capabilities) && org.capabilities.includes('chat'));
  return chat || list[0];
}

async function fetchClaude(secret) {
  const { mode, headers } = claudeHeaders(secret);
  if (mode === 'oauth') {
    const json = await requestJson('https://api.anthropic.com/api/oauth/usage', { headers }, secret);
    const parsed = parseClaudeUsage(json);
    return parsed;
  }
  const orgs = await requestJson('https://claude.ai/api/organizations', { headers }, secret);
  const org = pickOrg(orgs);
  const orgId = org?.uuid || org?.id;
  if (!orgId) throw new ProviderError('Claude did not return an account to measure.', 404);
  const usage = await requestJson(`https://claude.ai/api/organizations/${orgId}/usage`, { headers }, secret);
  const parsed = parseClaudeUsage(usage);
  parsed.identity = org?.name || null;
  try {
    const account = await requestJson('https://claude.ai/api/account', { headers }, secret);
    const email = account?.email_address || account?.email || account?.display_name;
    if (email) parsed.identity = email;
  } catch {
    // The usage call already succeeded. Identity is optional.
  }
  return parsed;
}

async function fetchCodex(account, secret) {
  const token = cleanSecret(secret);
  const payload = decodeJwt(token) || {};
  const auth = payload['https://api.openai.com/auth'] || {};
  const profile = payload['https://api.openai.com/profile'] || {};
  const accountId = account.meta?.accountId || auth.chatgpt_account_id || '';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': BROWSER_UA,
  };
  if (accountId) headers['ChatGPT-Account-Id'] = String(accountId);
  const json = await requestJson('https://chatgpt.com/backend-api/wham/usage', { headers }, secret);
  const parsed = parseCodexUsage(json);
  parsed.identity = profile.email || null;
  if (parsed.plan) parsed.plan = parsed.plan.replace(/_/g, ' ');
  return parsed;
}

function grokIsCookie(secret) {
  const value = cleanSecret(secret);
  if (/^cookie:/i.test(value)) return true;
  if (/(?:^|;)\s*sso(?:-rw)?=/.test(value)) return true;
  if (value.startsWith('eyJ') || value.startsWith('xai-')) return false;
  return value.includes(';') && value.includes('=');
}

async function fetchGrok(secret) {
  const value = cleanSecret(secret).replace(/^cookie:\s*/i, '');
  if (grokIsCookie(value)) {
    const headers = {
      Cookie: value,
      Accept: 'application/json',
      'User-Agent': BROWSER_UA,
      Referer: 'https://grok.com/',
    };
    let json;
    try {
      json = await requestJson('https://grok.com/rest/rate-limits', { headers }, secret);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 405) {
        json = await requestJson('https://grok.com/rest/rate-limits', { method: 'POST', headers, body: '{}' }, secret);
      } else {
        throw error;
      }
    }
    const parsed = parseGrokRateLimits(json);
    if (!parsed.windows.length) {
      throw new ProviderError('Grok did not return a usage window for that cookie.', 502);
    }
    return parsed;
  }
  if (value.startsWith('xai-')) {
    throw new ProviderError('That looks like an xAI API key. SuperGrok usage needs the login from grok login, not a management key.', 400);
  }
  const headers = {
    Authorization: `Bearer ${value}`,
    Accept: 'application/json',
    'x-xai-token-auth': 'xai-grok-cli',
  };
  const [billingResult, settingsResult] = await Promise.allSettled([
    requestJson('https://cli-chat-proxy.grok.com/v1/billing?format=credits', { headers }, secret),
    requestJson('https://cli-chat-proxy.grok.com/v1/settings', { headers }, secret),
  ]);
  if (billingResult.status === 'rejected') throw billingResult.reason;
  const parsed = parseGrokBilling(billingResult.value);
  if (settingsResult.status === 'fulfilled') {
    const tier = settingsResult.value?.subscription_tier_display || settingsResult.value?.subscriptionTier;
    if (tier) parsed.plan = String(tier);
  }
  if (!parsed.windows.length) {
    throw new ProviderError('Grok answered, but did not include a usage figure yet.', 502);
  }
  return parsed;
}

async function fetchMiniMax(account, secret) {
  const key = cleanSecret(secret);
  const region = account.meta?.region === 'cn' ? 'cn' : 'global';
  const preferred = account.meta?.resourceUrl
    ? `${String(account.meta.resourceUrl).replace(/\/$/, '')}/v1/token_plan/remains`
    : null;
  const hosts = (region === 'cn'
    ? ['https://api.minimaxi.com/v1/token_plan/remains', 'https://www.minimaxi.com/v1/token_plan/remains']
    : ['https://www.minimax.io/v1/token_plan/remains', 'https://api.minimax.io/v1/token_plan/remains'])
    .filter((url) => url !== preferred);
  if (preferred) hosts.unshift(preferred);
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  let lastError = null;
  for (const url of hosts) {
    try {
      const json = await requestJson(url, { headers }, secret);
      const status = json?.base_resp?.status_code;
      if (status && status !== 0) {
        const detail = json.base_resp.status_msg || 'MiniMax rejected that key.';
        throw new ProviderError(scrub(detail, secret) || 'MiniMax rejected that key.', 400);
      }
      const parsed = parseMiniMax(json, { countsAre: 'remaining' });
      if (!parsed.windows.length) {
        throw new ProviderError('MiniMax did not return a 5-hour or weekly window. Use a Token Plan subscription key.', 404);
      }
      return parsed;
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError && (error.status === 401 || error.status === 403 || error.status === 400)) {
        throw error;
      }
    }
  }
  throw lastError || new ProviderError("Couldn't reach MiniMax. Check the connection.", 0);
}

async function fetchCursor(token) {
  const payload = decodeJwt(token) || {};
  const userId = payload.sub || payload.userId || null;
  const headers = {
    Accept: 'application/json',
    Origin: 'https://cursor.com',
    Referer: 'https://cursor.com/dashboard',
  };
  if (userId) headers.Cookie = `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`;
  else headers.Authorization = `Bearer ${token}`;
  try {
    const summary = await requestJson('https://cursor.com/api/usage-summary', { headers }, token);
    const parsed = parseCursorSummary(summary);
    if (parsed.windows.length) return parsed;
  } catch (error) {
    if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) throw error;
  }
  const legacy = await requestJson('https://api2.cursor.sh/auth/usage', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  }, token);
  const windows = [];
  for (const [key, row] of Object.entries(legacy || {})) {
    if (!row || typeof row !== 'object') continue;
    const used = asNumber(row.numRequests ?? row.used);
    const limit = asNumber(row.maxRequestUsage ?? row.limit);
    if (used == null || !(limit > 0)) continue;
    windows.push({
      key,
      label: key,
      usedPercent: (used / limit) * 100,
      used,
      limit,
      unit: 'count',
      resetsAt: null,
      resetsInMs: null,
    });
  }
  if (!windows.length) throw new ProviderError('Cursor did not return a usage window.', 404);
  return { windows, plan: null, identity: null };
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchCopilot(token) {
  const json = await requestJson('https://api.github.com/copilot_internal/user', {
    headers: {
      Accept: 'application/json',
      Authorization: `token ${token}`,
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'X-Github-Api-Version': '2025-04-01',
    },
  }, token);
  const parsed = parseCopilotUsage(json);
  if (!parsed.windows.length) throw new ProviderError('Copilot did not return a usage window. This login may not include Copilot.', 404);
  return parsed;
}

function geminiPlatform() {
  const arch = process.arch === 'arm64' ? 'ARM64' : 'AMD64';
  if (process.platform === 'darwin') return `DARWIN_${arch}`;
  if (process.platform === 'linux') return `LINUX_${arch}`;
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'WINDOWS_ARM64' : 'WINDOWS_AMD64';
  return 'PLATFORM_UNSPECIFIED';
}

const GEMINI_METADATA = {
  ideType: 'IDE_UNSPECIFIED',
  platform: geminiPlatform(),
  pluginType: 'GEMINI',
};

function geminiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.18.3 Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify(GEMINI_METADATA),
  };
}

async function onboardGeminiProject(token, headers, tierId) {
  let operation = await requestJson('https://cloudcode-pa.googleapis.com/v1internal:onboardUser', {
    method: 'POST',
    headers,
    body: JSON.stringify({ tierId, metadata: GEMINI_METADATA }),
  }, token);
  const deadline = Date.now() + 50000;
  while (operation && !operation.done && operation.name && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const name = String(operation.name).replace(/^\/+/, '');
    operation = await requestJson(`https://cloudcode-pa.googleapis.com/v1internal/${name}`, { headers }, token);
  }
  const project = geminiProjectId(operation?.response?.cloudaicompanionProject || operation?.response?.cloudaicompanion_project);
  if (!project) throw new ProviderError('Gemini started setup but did not attach a project. Try again in a minute.', 404);
  return project;
}

async function fetchGemini(token) {
  const headers = geminiHeaders(token);
  const loaded = await requestJson('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
    method: 'POST',
    headers,
    body: JSON.stringify({ metadata: GEMINI_METADATA }),
  }, token);
  const plan = geminiSetupPlan(loaded);
  if (plan.action === 'fail') throw new ProviderError(plan.message, 404);
  const project = plan.action === 'onboard'
    ? await onboardGeminiProject(token, headers, plan.tierId)
    : plan.project;
  const source = plan.action === 'onboard'
    ? { ...loaded, currentTier: loaded.currentTier || { id: plan.tierId, name: 'Free' } }
    : loaded;
  const quota = await requestJson('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
    method: 'POST',
    headers,
    body: JSON.stringify({ project }),
  }, token);
  let parsed = parseGeminiQuota(quota, source);
  if (!parsed.windows.length) {
    const legacy = await requestJson('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', {
      method: 'POST',
      headers,
      body: JSON.stringify({ project }),
    }, token);
    parsed = parseGeminiQuota(legacy, source);
  }
  if (!parsed.windows.length) throw new ProviderError('Gemini did not return a quota window.', 404);
  return parsed;
}

async function fetchMuse(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-version': '1.0.0',
    'x-client-id': 'tbh:tui',
  };
  const json = await requestJson('https://api.meta.ai/muse-code/key', {
    method: 'POST',
    headers,
    body: '{}',
  }, token);
  const problem = museKeyProblem(json);
  if (problem) {
    throw new ProviderError(scrub(problem.message, token) || 'Muse could not load usage.', problem.status);
  }
  const parsed = parseMuseUsage(json);
  if (!parsed.windows.length) {
    throw new ProviderError('Muse answered, but did not include a usage figure yet.', 502);
  }
  return parsed;
}

function failUsage(account, error) {
  return {
    ok: false,
    error: messageFor(account.provider, error instanceof ProviderError ? error : error),
    plan: null,
    identity: null,
    windows: [],
    fetchedAt: new Date().toISOString(),
  };
}

function isAuthFailure(error) {
  return error instanceof ProviderError && (error.status === 401 || error.status === 403);
}

async function fetchParsed(account, secret) {
  if (!secret) throw new ProviderError('This account has no saved login.', 401);
  const session = sessionFromSecret(secret);
  const token = session.token;
  const scoped = session.resourceUrl
    ? { ...account, meta: { ...account.meta, resourceUrl: session.resourceUrl } }
    : account;
  if (account.provider === 'claude') return fetchClaude(token);
  if (account.provider === 'codex') return fetchCodex(scoped, token);
  if (account.provider === 'grok') return fetchGrok(token);
  if (account.provider === 'minimax') return fetchMiniMax(scoped, token);
  if (account.provider === 'cursor') return fetchCursor(token);
  if (account.provider === 'copilot') return fetchCopilot(token);
  if (account.provider === 'gemini') return fetchGemini(token);
  if (account.provider === 'muse') return fetchMuse(token);
  throw new ProviderError('Unknown service.', 400);
}

function okUsage(parsed, extra = {}) {
  return {
    ok: true,
    error: null,
    plan: parsed.plan || null,
    identity: parsed.identity || null,
    windows: parsed.windows || [],
    fetchedAt: new Date().toISOString(),
    ...extra,
  };
}

async function fetchUsage(account, secret) {
  try {
    return okUsage(await fetchParsed(account, secret));
  } catch (error) {
    const session = sessionFromSecret(secret);
    if (!isAuthFailure(error) || !session.refreshToken) return failUsage(account, error);
    let nextSecret = null;
    try {
      nextSecret = await refreshTokens(account.provider, session, account);
    } catch {
      nextSecret = null;
    }
    if (!nextSecret) return failUsage(account, error);
    try {
      return okUsage(await fetchParsed(account, nextSecret), { secret: nextSecret });
    } catch (retryError) {
      return failUsage(account, retryError);
    }
  }
}

module.exports = {
  fetchUsage,
  ProviderError,
};
