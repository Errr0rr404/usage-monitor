// Finds the logins that AI command-line tools already keep on this computer,
// and turns each into an account the board can read. Nothing here touches the
// disk, the keychain or the network: the caller reads each source and passes
// the text in, so every rule can be tested with fixtures.
const path = require('path');
const crypto = require('crypto');
const { decodeJwt, extractCodexAuth, extractGrokAuth, extractOpenCodeKey, cleanSecret } = require('./parse.cjs');

// Claude Code keeps its login in this keychain item on macOS. A Claude Code
// started with CLAUDE_CONFIG_DIR adds a suffix, so every match counts.
const CLAUDE_KEYCHAIN = /^Claude Code-credentials(?:-[0-9a-f]{6,64})?$/;
// cursor-agent keeps its access token in this keychain item on macOS.
const CURSOR_KEYCHAIN = 'cursor-access-token';

const PROVIDER_NAMES = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

function fileSource(provider, file, extra = {}) {
  return { kind: 'file', provider, path: file, ...extra };
}

function sourceId(source) {
  return `${source.provider}:${source.kind}:${source.kind === 'keychain' ? source.service : source.path}`;
}

// A chosen folder is either a home (it holds .codex, .gemini, …) or a folder
// of homes one level down, like one folder per account.
function homesIn(folder, listDir) {
  const names = listDir(folder) || [];
  const marks = ['.codex', '.grok', '.gemini', '.claude', '.cursor'];
  if (names.some((name) => marks.includes(name))) return [folder];
  return names
    .filter((name) => !name.startsWith('.'))
    .map((name) => path.join(folder, name))
    .filter((child) => (listDir(child) || []).some((name) => marks.includes(name)));
}

// Every place a supported CLI is known to keep a login.
// listDir(folder) returns the names in a folder, or [] when it is missing.
// keychainServices lists the macOS keychain item names (no values).
function localLoginSources({ home, platform, env = {}, extraFolders = [], listDir = () => [], keychainServices = [] }) {
  const sources = [];
  const homes = [home];
  for (const folder of extraFolders) {
    for (const found of homesIn(folder, listDir)) {
      if (!homes.includes(found)) homes.push(found);
    }
  }
  const darwin = platform === 'darwin';

  // Claude Code: the keychain on macOS, a file everywhere else (and on macOS
  // when the keychain was unavailable).
  if (darwin) {
    for (const service of keychainServices.filter((name) => CLAUDE_KEYCHAIN.test(name)).sort()) {
      sources.push({ kind: 'keychain', provider: 'claude', service });
    }
  }
  const claudeDirs = new Set();
  if (env.CLAUDE_CONFIG_DIR) claudeDirs.add(env.CLAUDE_CONFIG_DIR);
  for (const base of homes) {
    claudeDirs.add(path.join(base, '.claude'));
  }
  // Claude Code configs kept side by side, like ~/.claude-work.
  for (const name of listDir(home) || []) {
    if (/^\.claude-[A-Za-z0-9._-]+$/.test(name)) claudeDirs.add(path.join(home, name));
  }
  for (const dir of claudeDirs) sources.push(fileSource('claude', path.join(dir, '.credentials.json')));

  // Codex: ~/.codex (or CODEX_HOME), and every Multi Codex profile on macOS.
  const codexDirs = new Set();
  if (env.CODEX_HOME) codexDirs.add(env.CODEX_HOME);
  for (const base of homes) codexDirs.add(path.join(base, '.codex'));
  if (darwin) {
    const profiles = path.join(home, 'Library', 'Application Support', 'Multi Codex', 'profiles');
    for (const name of (listDir(profiles) || []).sort()) {
      if (!name.startsWith('.')) codexDirs.add(path.join(profiles, name, 'codex'));
    }
  }
  for (const dir of codexDirs) sources.push(fileSource('codex', path.join(dir, 'auth.json')));

  for (const base of homes) sources.push(fileSource('grok', path.join(base, '.grok', 'auth.json')));

  // cursor-agent: the keychain on macOS, its config folder elsewhere.
  const cursorProfile = path.join(home, '.cursor', 'cli-config.json');
  if (darwin) sources.push({ kind: 'keychain', provider: 'cursor', service: CURSOR_KEYCHAIN, profile: cursorProfile });
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
  sources.push(fileSource('cursor', path.join(config, 'cursor', 'auth.json'), { profile: cursorProfile }));

  // Antigravity (Gemini): one login per home.
  for (const base of homes) {
    sources.push(fileSource('gemini', path.join(base, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')));
  }

  const data = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  sources.push(fileSource('opencode', path.join(data, 'opencode', 'auth.json')));

  const seen = new Set();
  return sources.filter((source) => {
    const id = sourceId(source);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function jwtExpired(token, now) {
  const exp = Number(decodeJwt(token)?.exp);
  return Number.isFinite(exp) && exp > 0 && exp * 1000 <= now;
}

function hashKey(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

function lower(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
}

function problem(source, message) {
  return { problem: { provider: source.provider, where: source.kind === 'keychain' ? `keychain item ${source.service}` : source.path, message } };
}

function claudeLogins(source, raw, now) {
  const data = parseJson(raw);
  const auth = data?.claudeAiOauth;
  if (!auth || typeof auth.accessToken !== 'string' || !auth.accessToken) {
    return [problem(source, 'Claude Code has no saved login there.')];
  }
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : String(auth.scopes || '').split(/\s+/).filter(Boolean);
  if (scopes.length && !scopes.includes('user:profile')) {
    return [problem(source, 'This Claude login can only run models (no user:profile scope), so Anthropic will not show its usage. Sign in with the browser instead.')];
  }
  const expiresAt = Number(auth.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now) {
    return [problem(source, 'The Claude Code login there has expired. Run Claude Code once, then try again.')];
  }
  // Only the access token is kept. Using Claude Code's refresh token would
  // sign Claude Code itself out, because each refresh replaces the old one.
  return [{
    provider: 'claude',
    secret: auth.accessToken,
    label: '',
    // No email in the file; the usage check supplies it.
    loginKey: '',
  }];
}

function codexLogins(source, raw, now) {
  const data = parseJson(raw);
  const auth = data && extractCodexAuth(data);
  if (!auth) {
    if (data && typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY) {
      return [problem(source, 'Codex is signed in with an API key there, which has no ChatGPT plan usage to show.')];
    }
    return [problem(source, 'Codex has no ChatGPT login there.')];
  }
  if (jwtExpired(auth.accessToken, now)) {
    return [problem(source, 'The Codex login there has expired. Run codex once, then try again.')];
  }
  const who = lower(auth.accountId) || lower(auth.email);
  return [{
    provider: 'codex',
    secret: auth.accessToken,
    label: auth.email || '',
    loginKey: who ? `codex:${who}` : '',
    meta: auth.accountId ? { accountId: auth.accountId } : {},
  }];
}

function grokLogins(source, raw, now) {
  const data = parseJson(raw);
  const entries = data ? extractGrokAuth(data) : [];
  if (!entries.length) return [problem(source, 'Grok has no saved login there.')];
  return entries.map((entry) => {
    const time = entry.expiresAt ? new Date(entry.expiresAt).getTime() : NaN;
    if (Number.isFinite(time) && time <= now) {
      return problem(source, `The Grok login${entry.email ? ` for ${entry.email}` : ''} there has expired. Run grok once, then try again.`);
    }
    return {
      provider: 'grok',
      secret: entry.token,
      label: entry.email || '',
      loginKey: lower(entry.email) ? `grok:${lower(entry.email)}` : '',
    };
  });
}

function cursorEmail(profileRaw) {
  const profile = parseJson(profileRaw || '');
  const email = profile?.authInfo?.email;
  return typeof email === 'string' ? email : '';
}

function cursorLogins(source, raw, now, extra = {}) {
  const text = String(raw || '').trim();
  const data = text.startsWith('{') ? parseJson(text) : null;
  const token = cleanSecret(data ? data.accessToken || data.access_token : text);
  if (!token) return [problem(source, 'cursor-agent has no saved login there.')];
  if (jwtExpired(token, now)) {
    return [problem(source, 'The cursor-agent login there has expired. Run cursor-agent once, then try again.')];
  }
  const sub = String(decodeJwt(token)?.sub || '').split('|').filter(Boolean).pop() || '';
  return [{
    provider: 'cursor',
    secret: token,
    label: cursorEmail(extra.profileRaw),
    loginKey: sub ? `cursor:${lower(sub)}` : '',
  }];
}

function geminiLogins(source, raw) {
  const data = parseJson(raw);
  const token = data?.token && typeof data.token === 'object' ? data.token : data;
  const accessToken = token?.access_token || token?.accessToken;
  const refreshToken = token?.refresh_token || token?.refreshToken || '';
  if (typeof accessToken !== 'string' || !accessToken) {
    return [problem(source, 'Antigravity has no saved login there.')];
  }
  const email = typeof data.id_token_email === 'string' ? data.id_token_email : '';
  // Google keeps the same refresh token after a refresh, so the board can
  // renew this login without signing Antigravity out.
  return [{
    provider: 'gemini',
    secret: refreshToken ? JSON.stringify({ accessToken, refreshToken }) : accessToken,
    label: email,
    loginKey: lower(email) ? `gemini:${lower(email)}` : '',
  }];
}

// opencodeKeys: [{ provider, names, meta }] in the order to try.
function opencodeLogins(source, raw, opencodeKeys = []) {
  const data = parseJson(raw);
  if (!data || typeof data !== 'object') return [problem(source, 'The OpenCode login file could not be read.')];
  const found = [];
  for (const entry of opencodeKeys) {
    const key = extractOpenCodeKey(data, entry.names);
    if (!key) continue;
    found.push({
      provider: entry.provider,
      secret: key.key,
      label: '',
      loginKey: `${entry.provider}:key:${hashKey(key.key)}`,
      meta: entry.meta || {},
      checkKey: true,
      from: key.name,
    });
  }
  return found;
}

// Turns one source's text into logins and problems.
function loginsFromSource(source, raw, options = {}) {
  const now = options.now ?? Date.now();
  let found;
  if (source.provider === 'claude') found = claudeLogins(source, raw, now);
  else if (source.provider === 'codex') found = codexLogins(source, raw, now);
  else if (source.provider === 'grok') found = grokLogins(source, raw, now);
  else if (source.provider === 'cursor') found = cursorLogins(source, raw, now, options);
  else if (source.provider === 'gemini') found = geminiLogins(source, raw);
  else if (source.provider === 'opencode') found = opencodeLogins(source, raw, options.opencodeKeys);
  else found = [];
  return found.map((item) => (item.problem ? item : { ...item, source: publicSource(source) }));
}

// What the board keeps about where a login came from: the place, never the value.
function publicSource(source) {
  return source.kind === 'keychain'
    ? { kind: 'keychain', provider: source.provider, service: source.service, ...(source.profile ? { profile: source.profile } : {}) }
    : { kind: 'file', provider: source.provider, path: source.path, ...(source.profile ? { profile: source.profile } : {}) };
}

// Drops logins found twice (one Codex account in two profiles, say). The
// same secret or the same account counts as the same login.
function dedupeLogins(logins) {
  const seen = new Set();
  const kept = [];
  let dropped = 0;
  for (const login of logins) {
    const marks = [`${login.provider}#${hashKey(login.secret)}`];
    if (login.loginKey) marks.push(login.loginKey);
    if (marks.some((mark) => seen.has(mark))) {
      dropped += 1;
      continue;
    }
    marks.forEach((mark) => seen.add(mark));
    kept.push(login);
  }
  return { kept, dropped };
}

// The account already on the board for this login, if any. Accounts added
// from this computer before carry loginKey; older ones are matched by the
// email they show.
function findExisting(accounts, login, identity, identities = {}) {
  const key = login.loginKey;
  const who = lower(identity) || lower(login.label);
  return accounts.find((account) => {
    if (account.provider !== login.provider) return false;
    if (key && account.meta?.loginKey === key) return true;
    if (!who) return false;
    return lower(account.label) === who || lower(identities[account.id]) === who;
  }) || null;
}

// "Added 2, already there 3, not used 1." plus one line per problem.
function summarizeImport({ added = [], existing = [], problems = [], notFound = [] }) {
  const parts = [`Added ${added.length}`, `already there ${existing.length}`];
  const skipped = problems.length + notFound.length;
  if (skipped) parts.push(`not found or unusable ${skipped}`);
  return `${parts.join(', ')}.`;
}

function providerLabel(provider) {
  return PROVIDER_NAMES[provider] || provider;
}

const LOOKED_FOR = ['claude', 'codex', 'grok', 'cursor', 'gemini', 'opencode'];

const NOT_FOUND = {
  claude: 'No Claude Code login on this computer. (A token from claude setup-token cannot read usage; sign in with the browser for those.)',
  codex: 'No Codex login on this computer.',
  grok: 'No Grok login on this computer.',
  cursor: 'No cursor-agent login on this computer.',
  gemini: 'No Antigravity login on this computer.',
  opencode: 'No OpenCode keys on this computer.',
};

// Reads every source, checks each login once with the service, and saves the
// ones that work. All I/O comes in through the arguments:
//   read(source)          -> { text, profileText } | { missing: true } | { error }
//   check(login)          -> a fetchUsage snapshot ({ ok, error, identity, secret? })
//   save(account)         -> { account, created } (store.addAccount)
//   refresh(id, secret)   -> keeps a login added from here before up to date
async function runImport({ sources, read, check, save, refresh = () => {}, accounts = [], identities = {}, opencodeKeys = [], now = Date.now(), names = {} }) {
  const problems = [];
  const logins = [];
  const seenProviders = new Set();
  for (const source of sources) {
    let got;
    try {
      got = await read(source);
    } catch {
      got = { error: 'It could not be read.' };
    }
    if (!got || got.missing) continue;
    seenProviders.add(source.provider);
    if (got.error) {
      problems.push({ provider: source.provider, where: problem(source, '').problem.where, message: got.error });
      continue;
    }
    for (const item of loginsFromSource(source, got.text, { now, opencodeKeys, profileRaw: got.profileText })) {
      if (item.problem) problems.push(item.problem);
      else logins.push(item);
    }
  }
  const { kept } = dedupeLogins(logins);
  const board = accounts.slice();
  const added = [];
  const existing = [];

  // Logins added from this computer before are matched without a network call.
  const unknown = [];
  for (const login of kept) {
    const match = login.loginKey ? board.find((account) => account.provider === login.provider && account.meta?.loginKey === login.loginKey) : null;
    if (match) {
      try {
        await refresh(match.id, login.secret);
      } catch {
        // The saved login stays as it was.
      }
      existing.push({ provider: login.provider, label: match.label });
    } else {
      unknown.push(login);
    }
  }

  const checked = await Promise.all(unknown.map(async (login) => {
    try {
      return { login, snapshot: await check(login) };
    } catch {
      return { login, snapshot: { ok: false, error: 'The service could not be reached.' } };
    }
  }));

  // Saved one at a time, so two logins for one account become one card.
  for (const { login, snapshot } of checked) {
    const where = login.source.kind === 'keychain' ? `keychain item ${login.source.service}` : login.source.path;
    if (!snapshot?.ok) {
      problems.push({ provider: login.provider, where, message: snapshot?.error || 'The service did not accept it.' });
      continue;
    }
    const identity = snapshot.identity || '';
    const match = findExisting(board, login, identity, identities);
    if (match) {
      existing.push({ provider: login.provider, label: match.label });
      continue;
    }
    const loginKey = login.loginKey || (lower(identity) ? `${login.provider}:${lower(identity)}` : '');
    const label = login.label || identity || names[login.provider] || providerLabel(login.provider);
    let saved;
    try {
      saved = await save({
        provider: login.provider,
        label,
        secret: snapshot.secret || login.secret,
        meta: { ...(login.meta || {}), ...(loginKey ? { loginKey } : {}), source: login.source },
      });
    } catch (error) {
      problems.push({ provider: login.provider, where, message: error?.message || 'It could not be saved.' });
      continue;
    }
    if (saved.created) {
      added.push({ provider: login.provider, label: saved.account?.label || label });
      board.push(saved.account || { provider: login.provider, label, meta: { loginKey } });
    } else {
      existing.push({ provider: login.provider, label: saved.account?.label || label });
    }
  }

  const notFound = LOOKED_FOR.filter((provider) => !seenProviders.has(provider))
    .map((provider) => ({ provider, message: NOT_FOUND[provider] }));
  const report = { added, existing, problems, notFound };
  return { ok: true, ...report, summary: summarizeImport(report) };
}

// The login a source holds now for an account added from it, if that login
// differs from the one the board has. Used when a saved login stops working:
// the CLI has usually renewed its own by then.
function currentLogin(account, raw, options = {}) {
  const source = account?.meta?.source;
  if (!source) return null;
  const logins = loginsFromSource(source, raw, options).filter((item) => !item.problem && item.provider === account.provider);
  const key = account.meta.loginKey;
  const match = logins.find((item) => key && item.loginKey === key);
  if (match) return match;
  // A Claude Code file does not name its account; the caller checks the
  // email the service answers with (sameAccount) before using it.
  const unnamed = logins.filter((item) => !item.loginKey);
  return unnamed.length === 1 ? unnamed[0] : null;
}

// Whether a usage reading belongs to the account a card was added for.
function sameAccount(account, identity) {
  const key = account?.meta?.loginKey;
  if (!key || !key.startsWith(`${account.provider}:`) || key.includes(':key:')) return true;
  const who = lower(identity);
  if (!who) return false;
  return key === `${account.provider}:${who}` || !key.includes('@');
}

module.exports = {
  CLAUDE_KEYCHAIN,
  CURSOR_KEYCHAIN,
  localLoginSources,
  loginsFromSource,
  dedupeLogins,
  findExisting,
  summarizeImport,
  runImport,
  currentLogin,
  sameAccount,
  sourceId,
  publicSource,
  providerLabel,
  homesIn,
};
