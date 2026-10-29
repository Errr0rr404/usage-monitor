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
  museUsageAfterWindowReset,
  museUsageFromStream,
  museKeyProblem,
  parseOpenCodeGoUsage,
  parseDeepSeekBalance,
  parseOpenRouterCredits,
  parseOpenRouterKey,
  parseKimiCodeUsage,
  parseMoonshotBalance,
  parseZaiQuota,
  parseVercelCredits,
  parsePoeBalance,
  parseSiliconFlowInfo,
} = require('./parse.cjs');
const crypto = require('crypto');
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
  opencode: 'OpenCode',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  kimi: 'Kimi Code',
  moonshot: 'Kimi API',
  zai: 'Z.ai',
  vercel: 'Vercel AI',
  poe: 'Poe',
  siliconflow: 'SiliconFlow',
};

// These services are read with a pasted API key rather than a browser login.
const KEY_PROVIDERS = new Set(['opencode', 'deepseek', 'openrouter', 'kimi', 'moonshot', 'zai', 'vercel', 'poe', 'siliconflow']);

function providerName(id) {
  return NAMES[id] || 'The service';
}

function messageFor(provider, error, usesKey = KEY_PROVIDERS.has(provider)) {
  const name = providerName(provider);
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `${name} took too long to answer.`;
  }
  if (error instanceof ProviderError) {
    if (/no longer supported/i.test(error.message)) {
      return 'Google retired this Gemini login. Remove it and sign in again. The approval page now says Antigravity.';
    }
    if (error.status === 401 || error.status === 403 || error.status === 429) {
      return statusMessage(name, error.status, usesKey);
    }
    if (error.message && !/^The service\b/.test(error.message)) return error.message;
    if (error.status) return statusMessage(name, error.status, usesKey);
  }
  return `Couldn't reach ${name}. Check the connection.`;
}

function statusMessage(name, status, usesKey = false) {
  if (status === 401 || status === 403) {
    return usesKey
      ? `That ${name} key was rejected. Add it again with a current key.`
      : `That ${name} login was rejected. Add it again with a fresh token.`;
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

function claudePlanName(raw) {
  const value = String(raw || '').toLowerCase();
  if (!value) return null;
  if (value.includes('enterprise')) return 'Enterprise';
  if (value.includes('team')) return 'Team';
  if (value.includes('max')) return 'Max';
  if (value.includes('pro')) return 'Pro';
  if (value.includes('free')) return 'Free';
  return null;
}

function applyClaudeProfile(parsed, profile) {
  if (!profile || typeof profile !== 'object') return;
  const account = profile.account && typeof profile.account === 'object' ? profile.account : profile;
  const email = account.email || account.email_address || profile.email || profile.email_address;
  const name = account.full_name || account.display_name || profile.full_name || profile.display_name;
  const who = email || name;
  if (who) parsed.identity = String(who);
  if (!parsed.plan) {
    const org = profile.organization && typeof profile.organization === 'object' ? profile.organization : {};
    const plan = claudePlanName(org.organization_type || org.rate_limit_tier || profile.organization_type || profile.subscription_type);
    if (plan) parsed.plan = plan;
  }
}

async function fetchClaude(secret) {
  const { mode, headers } = claudeHeaders(secret);
  if (mode === 'oauth') {
    const json = await requestJson('https://api.anthropic.com/api/oauth/usage', { headers }, secret);
    const parsed = parseClaudeUsage(json);
    try {
      // Usage does not name the login. The profile call supplies the email.
      const profile = await requestJson('https://api.anthropic.com/api/oauth/profile', { headers }, secret);
      applyClaudeProfile(parsed, profile);
    } catch {
      // The usage call already succeeded. The name is optional.
    }
    return parsed;
  }
  const orgs = await requestJson('https://claude.ai/api/organizations', { headers }, secret);
  const org = pickOrg(orgs);
  const orgId = org?.uuid || org?.id;
  if (!orgId) throw new ProviderError('Claude did not return an account to measure.', 404);
  const usage = await requestJson(`https://claude.ai/api/organizations/${orgId}/usage`, { headers }, secret);
  const parsed = parseClaudeUsage(usage);
  parsed.identity = org?.name || null;
  const plan = claudePlanName(org?.organization_type || org?.rate_limit_tier);
  if (plan) parsed.plan = plan;
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
  const ask = (method) => requestJson(`https://cloudcode-pa.googleapis.com/v1internal:${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ project }),
  }, token);
  // The summary holds the shared weekly and 5-hour pools; the model catalog
  // holds a quota for every model, Gemini included. Either one alone still
  // makes a card, so one failing call does not blank the other.
  const [summary, catalog] = await Promise.allSettled([ask('retrieveUserQuotaSummary'), ask('fetchAvailableModels')]);
  for (const result of [summary, catalog]) {
    if (result.status === 'rejected' && isAuthFailure(result.reason)) throw result.reason;
  }
  const summaryJson = summary.status === 'fulfilled' ? summary.value : null;
  let catalogJson = catalog.status === 'fulfilled' ? catalog.value : null;
  let parsed = parseGeminiQuota(summaryJson, source, catalogJson);
  if (!parsed.modelCount) {
    try {
      // The older per-model reply, for accounts the catalog does not cover.
      catalogJson = await ask('retrieveUserQuota');
      parsed = parseGeminiQuota(summaryJson, source, catalogJson);
    } catch (error) {
      if (isAuthFailure(error)) throw error;
    }
  }
  if (!parsed.windows.length) {
    const failed = [summary, catalog].find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    throw new ProviderError('Gemini did not return a quota window.', 404);
  }
  return parsed;
}

// Meta's key call sometimes includes subs_usage and sometimes drops it entirely.
// The drop is what a 5-hour reset looks like: the plan comes back, the meters
// do not. Painting that hole as 0% used makes the week look reset too. The last
// real week is kept instead. The subscription frame on a streamed reply is the
// other source. Reading it spends one tiny call, so a still-open saved session
// is reused, and a fresh read happens only when that session has ended. The
// gauge forces a read on every refresh. Turning the gauge off never spends one.
const MUSE_NO_METER = 'Meta did not include Muse usage on this refresh. '
  + 'Turn on “Read the live meter” to spend one tiny request per refresh and see the real numbers.';
const MUSE_PROBE_MODEL = 'muse-spark-1.3';
const MUSE_PROBE_TOKENS = 16;

let museProbeModel = null;

function museKeyHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'x-api-version': '1.0.0' };
}

function museProbeChoice(models) {
  const visible = (models || []).filter((model) => model && model.id && !model.metadata?.['muse-code']?.is_hidden);
  const usable = visible.filter((model) => !/-contributor$/i.test(model.id));
  const pool = usable.length ? usable : visible;
  // Spark is the cheap gauge read. Wonder is a full prompt against the plan,
  // so it is only used when Spark is not in the catalog.
  return pool.find((model) => /^muse-spark-/i.test(model.id)) || pool[0] || null;
}

// Meta renames its models often, so resolve the cheapest current one once per
// run rather than pinning an id that will go stale. The "-contributor" variants
// feed the content to product improvement, which is not a call to make on
// someone's behalf just to read a gauge.
async function museModelId(apiKey, secret) {
  if (museProbeModel) return museProbeModel;
  let resolved = MUSE_PROBE_MODEL;
  try {
    const json = await requestJson('https://api.meta.ai/muse-code/models', {
      method: 'GET',
      headers: museKeyHeaders(apiKey),
    }, secret);
    const pick = museProbeChoice(json.data);
    if (pick) resolved = pick.id;
  } catch {
    // Fall back to the pinned id; a wrong guess costs one probe, not the account.
  }
  museProbeModel = resolved;
  return resolved;
}

function clearMuseModelCache() {
  museProbeModel = null;
}

async function readMuseMeter(apiKey, secret) {
  const model = await museModelId(apiKey, secret);
  const response = await fetch('https://api.meta.ai/v1/responses', {
    method: 'POST',
    headers: {
      ...museKeyHeaders(apiKey),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ model, input: 'hi', max_output_tokens: MUSE_PROBE_TOKENS, stream: true, store: false }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.parse(text)?.error?.message || '';
    } catch {
      detail = '';
    }
    throw new ProviderError(detail ? scrub(detail, secret) : statusMessage('Muse', response.status), response.status);
  }
  const frame = museUsageFromStream(text);
  if (!frame) throw new ProviderError('Muse streamed a reply without a usage frame.', 502);
  return parseMuseUsage(frame);
}

function museMeter(windows) {
  return { windows, savedAt: new Date().toISOString() };
}

function museReading(parsed, windows, meter) {
  const reading = {
    windows,
    plan: parsed.plan,
    identity: parsed.identity,
    note: null,
  };
  if (meter) reading.meter = meter;
  return reading;
}

function withRememberedWeek(session, remembered) {
  const weekly = remembered.find((window) => window.key === 'weekly');
  return session && weekly ? [session, weekly] : remembered;
}

function museSessionStillOpen(meter, now = Date.now()) {
  const windows = meter && Array.isArray(meter.windows) ? meter.windows : [];
  const session = windows.find((window) => window && window.key === 'window' && window.usedPercent != null && window.resetsAt);
  if (!session) return false;
  const at = Date.parse(session.resetsAt);
  return Number.isFinite(at) && at > now;
}

async function fetchMuse(account, token) {
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
  const weekly = parsed.windows.find((window) => window.key === 'weekly');
  if (weekly) return { ...parsed, meter: museMeter(parsed.windows) };

  const remembered = museUsageAfterWindowReset(account?.meta?.museMeter);
  const session = parsed.windows.find((window) => window.key === 'window');
  const live = account?.meta?.museLiveUsage;
  const kept = () => (remembered ? museReading(parsed, withRememberedWeek(session, remembered)) : null);
  if (live === false) return kept() || { ...parsed, note: parsed.windows.length ? null : MUSE_NO_METER };
  if (live !== true && remembered && museSessionStillOpen(account?.meta?.museMeter)) return kept();
  if (!json.api_key) throw new ProviderError('Muse did not return an API key to read usage with.', 502);
  try {
    const liveReading = await readMuseMeter(json.api_key, token);
    if (!liveReading.windows.length) {
      throw new ProviderError('Muse streamed a reply without a usage frame.', 502);
    }
    return museReading(
      { plan: parsed.plan || liveReading.plan, identity: parsed.identity || liveReading.identity },
      liveReading.windows,
      museMeter(liveReading.windows),
    );
  } catch (error) {
    if (remembered) return kept();
    return { ...parsed, note: `Could not read the live meter: ${scrub(error.message, token)}` };
  }
}

function keyHeaders(key) {
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

async function fetchOpenCode(key) {
  const json = await requestJson('https://opencode.ai/zen/go/v1/usage', { headers: keyHeaders(key) }, key);
  const parsed = parseOpenCodeGoUsage(json);
  if (!parsed.windows.length) {
    throw new ProviderError('OpenCode did not return Go usage. This key may not belong to an OpenCode Go workspace.', 404);
  }
  return parsed;
}

async function fetchDeepSeek(key) {
  const json = await requestJson('https://api.deepseek.com/user/balance', { headers: keyHeaders(key) }, key);
  const parsed = parseDeepSeekBalance(json);
  if (!parsed.windows.length) throw new ProviderError('DeepSeek did not return a balance.', 502);
  return parsed;
}

async function fetchOpenRouter(key) {
  const headers = keyHeaders(key);
  try {
    const parsed = parseOpenRouterCredits(await requestJson('https://openrouter.ai/api/v1/credits', { headers }, key));
    if (parsed.windows.length) return parsed;
  } catch (error) {
    // Only a management key may read the account's credits. A regular key gets
    // a 403 here and still describes its own limit below; a 401 is a bad key.
    if (!(error instanceof ProviderError) || error.status === 401 || error.status === 429 || !error.status) throw error;
  }
  return parseOpenRouterKey(await requestJson('https://openrouter.ai/api/v1/key', { headers }, key));
}

// Several services split one product across a global and a China host, and a
// key only works on the host that issued it. The hosts are tried in order and
// the one that answered is remembered for this key, so a China key costs one
// extra request per launch, not per refresh.
const hostMemo = new Map();

function keyStamp(provider, key) {
  return `${provider}:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

async function fromRegionalHosts(provider, key, hosts, read) {
  const stamp = keyStamp(provider, key);
  const remembered = hostMemo.get(stamp);
  const ordered = remembered != null && hosts[remembered] ? [remembered, ...hosts.keys()].filter((v, i, list) => list.indexOf(v) === i) : [...hosts.keys()];
  let firstError = null;
  for (const index of ordered) {
    try {
      const parsed = await read(hosts[index]);
      hostMemo.set(stamp, index);
      return parsed;
    } catch (error) {
      // A rejected key or a missing route on one host may be fine on the
      // other. Anything else (offline, rate limited) is the real answer.
      const tryNext = error instanceof ProviderError && [401, 403, 404].includes(error.status);
      if (!tryNext) throw error;
      if (!firstError || (firstError.status === 404 && error.status !== 404)) firstError = error;
    }
  }
  throw firstError || new ProviderError(`Couldn't reach ${providerName(provider)}. Check the connection.`, 0);
}

async function fetchKimiCode(key) {
  const hosts = ['https://api.kimi.com/coding/v1/usages', 'https://api.kimi.ai/coding/v1/usages'];
  return fromRegionalHosts('kimi', key, hosts, async (url) => {
    const parsed = parseKimiCodeUsage(await requestJson(url, { headers: keyHeaders(key) }, key));
    if (!parsed.windows.length) {
      throw new ProviderError('Kimi did not return Kimi Code usage. This key may not belong to a Kimi Code plan.', 404);
    }
    return parsed;
  });
}

async function fetchMoonshot(key) {
  const hosts = [
    { url: 'https://api.moonshot.ai/v1/users/me/balance', currency: 'USD' },
    { url: 'https://api.moonshot.cn/v1/users/me/balance', currency: 'CNY' },
  ];
  return fromRegionalHosts('moonshot', key, hosts, async ({ url, currency }) => {
    const json = await requestJson(url, { headers: keyHeaders(key) }, key);
    if (json?.status === false) {
      throw new ProviderError(scrub(json.message || json.error?.message || '', key) || 'Kimi could not read the balance.', 502);
    }
    const parsed = parseMoonshotBalance(json, currency);
    if (!parsed.windows.length) throw new ProviderError('Kimi did not return a balance.', 502);
    return parsed;
  });
}

async function fetchZai(key) {
  const hosts = [
    'https://api.z.ai/api/monitor/usage/quota/limit',
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
  ];
  // The official GLM usage plugin sends the key bare, without "Bearer".
  const headers = { Authorization: key, Accept: 'application/json' };
  return fromRegionalHosts('zai', key, hosts, async (url) => {
    const json = await requestJson(url, { headers }, key);
    if (json?.success === false || (json?.code != null && Number(json.code) !== 200)) {
      const code = Number(json?.code);
      const status = code === 401 || code === 403 || code === 1000 || code === 1001 ? 401 : 400;
      throw new ProviderError(scrub(json?.msg || json?.message || '', key) || 'Z.ai could not read the plan quota.', status);
    }
    const parsed = parseZaiQuota(json);
    if (!parsed.windows.length) {
      throw new ProviderError('Z.ai did not return a quota. This key may not belong to a GLM Coding Plan.', 404);
    }
    return parsed;
  });
}

async function fetchVercel(key) {
  const parsed = parseVercelCredits(await requestJson('https://ai-gateway.vercel.sh/v1/credits', { headers: keyHeaders(key) }, key));
  if (!parsed.windows.length) throw new ProviderError('Vercel did not return an AI Gateway balance.', 502);
  return parsed;
}

async function fetchPoe(key) {
  const parsed = parsePoeBalance(await requestJson('https://api.poe.com/usage/current_balance', { headers: keyHeaders(key) }, key));
  if (!parsed.windows.length) throw new ProviderError('Poe did not return a point balance.', 502);
  return parsed;
}

async function fetchSiliconFlow(key) {
  const hosts = [
    { url: 'https://api.siliconflow.com/v1/user/info', currency: 'USD' },
    { url: 'https://api.siliconflow.cn/v1/user/info', currency: 'CNY' },
  ];
  return fromRegionalHosts('siliconflow', key, hosts, async ({ url, currency }) => {
    const json = await requestJson(url, { headers: keyHeaders(key) }, key);
    if (json?.status === false) {
      throw new ProviderError(scrub(json.message || '', key) || 'SiliconFlow could not read the balance.', 502);
    }
    const parsed = parseSiliconFlowInfo(json, currency);
    if (!parsed.windows.length) throw new ProviderError('SiliconFlow did not return a balance.', 502);
    return parsed;
  });
}

function failUsage(account, error) {
  return {
    ok: false,
    error: messageFor(account.provider, error, KEY_PROVIDERS.has(account.provider) || account.meta?.keyAuth === true),
    plan: null,
    identity: null,
    windows: [],
    note: null,
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
  if (account.provider === 'muse') return fetchMuse(account, token);
  if (account.provider === 'opencode') return fetchOpenCode(token);
  if (account.provider === 'deepseek') return fetchDeepSeek(token);
  if (account.provider === 'openrouter') return fetchOpenRouter(token);
  if (account.provider === 'kimi') return fetchKimiCode(token);
  if (account.provider === 'moonshot') return fetchMoonshot(token);
  if (account.provider === 'zai') return fetchZai(token);
  if (account.provider === 'vercel') return fetchVercel(token);
  if (account.provider === 'poe') return fetchPoe(token);
  if (account.provider === 'siliconflow') return fetchSiliconFlow(token);
  throw new ProviderError('Unknown service.', 400);
}

function okUsage(parsed, extra = {}) {
  const usage = {
    ok: true,
    error: null,
    plan: parsed.plan || null,
    identity: parsed.identity || null,
    windows: parsed.windows || [],
    note: parsed.note || null,
    fetchedAt: new Date().toISOString(),
    ...extra,
  };
  if (parsed.meter) usage.meter = parsed.meter;
  return usage;
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
      // A provider may have already invalidated the old refresh token. Save
      // the new session even when its first usage request fails temporarily.
      return { ...failUsage(account, retryError), secret: nextSecret };
    }
  }
}

module.exports = {
  fetchUsage,
  ProviderError,
  NAMES,
  clearMuseModelCache,
  KEY_PROVIDERS,
};
