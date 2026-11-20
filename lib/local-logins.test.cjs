const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  localLoginSources, loginsFromSource, dedupeLogins, findExisting, runImport, currentLogin, homesIn,
} = require('./local-logins.cjs');

const NOW = Date.parse('2026-11-02T04:00:00Z');
const HOUR = 3600 * 1000;

function jwt(payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(payload)}.sig`;
}

function codexFile({ email, accountId, exp = NOW / 1000 + 3600 }) {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: 'fake',
      access_token: jwt({ exp, 'https://api.openai.com/profile': { email }, 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
      refresh_token: 'fake-refresh',
      account_id: accountId,
    },
  });
}

function claudeFile({ scopes = ['user:inference', 'user:profile'], expiresAt = NOW + 5 * HOUR, token = 'sk-ant-oat01-FAKE-FOR-TESTS' } = {}) {
  return JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'sk-ant-ort01-FAKE', expiresAt, scopes } });
}

function fakeDirs(tree) {
  return (folder) => tree[folder] || [];
}

test('macOS sources include Claude Code keychain items, Multi Codex profiles and cursor-agent', () => {
  const home = '/Users/ada';
  const profiles = path.join(home, 'Library/Application Support/Multi Codex/profiles');
  const sources = localLoginSources({
    home,
    platform: 'darwin',
    env: {},
    listDir: fakeDirs({ [profiles]: ['work', 'personal', '.DS_Store'], [home]: ['.claude', '.claude-work', '.codex'] }),
    keychainServices: ['Claude Code-credentials', 'Claude Code-credentials-1a2b3c4d', 'fleet-cc-zan', 'cursor-access-token', 'Other'],
  });
  const keychain = sources.filter((source) => source.kind === 'keychain').map((source) => `${source.provider}:${source.service}`);
  assert.deepEqual(keychain, [
    'claude:Claude Code-credentials',
    'claude:Claude Code-credentials-1a2b3c4d',
    'cursor:cursor-access-token',
  ]);
  const files = sources.filter((source) => source.kind === 'file').map((source) => `${source.provider}:${source.path}`);
  assert.ok(files.includes(`codex:${profiles}/work/codex/auth.json`));
  assert.ok(files.includes(`codex:${profiles}/personal/codex/auth.json`));
  assert.ok(!files.some((file) => file.includes('.DS_Store')));
  assert.ok(files.includes(`claude:${home}/.claude-work/.credentials.json`));
  assert.ok(files.includes(`gemini:${home}/.gemini/antigravity-cli/antigravity-oauth-token`));
  // Setup tokens are never read: they cannot see usage.
  assert.ok(!sources.some((source) => source.service === 'fleet-cc-zan'));
});

test('Linux sources use files, CLAUDE_CONFIG_DIR, CODEX_HOME and XDG folders', () => {
  const sources = localLoginSources({
    home: '/home/ada',
    platform: 'linux',
    env: { CLAUDE_CONFIG_DIR: '/srv/claude', CODEX_HOME: '/srv/codex', XDG_CONFIG_HOME: '/cfg', XDG_DATA_HOME: '/data' },
  });
  const paths = sources.map((source) => `${source.provider}:${source.path}`);
  assert.ok(sources.every((source) => source.kind === 'file'));
  assert.ok(paths.includes('claude:/srv/claude/.credentials.json'));
  assert.ok(paths.includes('claude:/home/ada/.claude/.credentials.json'));
  assert.ok(paths.includes('codex:/srv/codex/auth.json'));
  assert.ok(paths.includes('cursor:/cfg/cursor/auth.json'));
  assert.ok(paths.includes('opencode:/data/opencode/auth.json'));
});

test('an extra folder can be one home or a folder of homes', () => {
  const tree = {
    '/fleet/agy-homes': ['acct2', 'acct3', 'notes.txt'],
    '/fleet/agy-homes/acct2': ['.gemini'],
    '/fleet/agy-homes/acct3': ['.gemini'],
    '/other': ['.codex'],
  };
  const listDir = fakeDirs(tree);
  assert.deepEqual(homesIn('/fleet/agy-homes', listDir), ['/fleet/agy-homes/acct2', '/fleet/agy-homes/acct3']);
  assert.deepEqual(homesIn('/other', listDir), ['/other']);
  const sources = localLoginSources({ home: '/h', platform: 'linux', extraFolders: ['/fleet/agy-homes', '/other'], listDir });
  const gemini = sources.filter((source) => source.provider === 'gemini').map((source) => source.path);
  assert.deepEqual(gemini, [
    '/h/.gemini/antigravity-cli/antigravity-oauth-token',
    '/fleet/agy-homes/acct2/.gemini/antigravity-cli/antigravity-oauth-token',
    '/fleet/agy-homes/acct3/.gemini/antigravity-cli/antigravity-oauth-token',
    '/other/.gemini/antigravity-cli/antigravity-oauth-token',
  ]);
});

test('a Claude Code login is used; a setup token or an expired login is not', () => {
  const source = { kind: 'file', provider: 'claude', path: '/h/.claude/.credentials.json' };
  const [good] = loginsFromSource(source, claudeFile(), { now: NOW });
  assert.equal(good.provider, 'claude');
  assert.equal(good.secret, 'sk-ant-oat01-FAKE-FOR-TESTS');
  assert.deepEqual(good.source, source);

  const [setup] = loginsFromSource(source, claudeFile({ scopes: ['user:inference'] }), { now: NOW });
  assert.match(setup.problem.message, /user:profile/);

  const [expired] = loginsFromSource(source, claudeFile({ expiresAt: NOW - 1 }), { now: NOW });
  assert.match(expired.problem.message, /expired/);
});

test('Codex logins carry the account id, and an expired one is skipped', () => {
  const source = { kind: 'file', provider: 'codex', path: '/h/.codex/auth.json' };
  const [login] = loginsFromSource(source, codexFile({ email: 'ada@example.com', accountId: 'acct-1' }), { now: NOW });
  assert.equal(login.label, 'ada@example.com');
  assert.equal(login.loginKey, 'codex:acct-1');
  assert.deepEqual(login.meta, { accountId: 'acct-1' });

  const [old] = loginsFromSource(source, codexFile({ email: 'ada@example.com', accountId: 'acct-1', exp: NOW / 1000 - 60 }), { now: NOW });
  assert.match(old.problem.message, /expired/);

  const [keyOnly] = loginsFromSource(source, JSON.stringify({ OPENAI_API_KEY: 'sk-fake' }), { now: NOW });
  assert.match(keyOnly.problem.message, /API key/);
});

test('Grok, cursor-agent and Antigravity logins are read from their own shapes', () => {
  const grok = loginsFromSource({ kind: 'file', provider: 'grok', path: '/h/.grok/auth.json' }, JSON.stringify({
    'https://auth.x.ai::client': { key: jwt({ sub: 'u1' }), email: 'ada@example.com', expires_at: new Date(NOW + HOUR).toISOString() },
    'https://auth.x.ai::other': { key: jwt({ sub: 'u2' }), email: 'old@example.com', expires_at: new Date(NOW - HOUR).toISOString() },
  }), { now: NOW });
  assert.equal(grok[0].loginKey, 'grok:ada@example.com');
  assert.match(grok[1].problem.message, /old@example.com.*expired/);

  const cursorToken = jwt({ sub: 'google-oauth2|user_01ABC', exp: NOW / 1000 + 86400 });
  const [cursorFile] = loginsFromSource({ kind: 'file', provider: 'cursor', path: '/h/.config/cursor/auth.json' },
    JSON.stringify({ accessToken: cursorToken, refreshToken: 'fake' }),
    { now: NOW, profileRaw: JSON.stringify({ authInfo: { email: 'ada@example.com' } }) });
  assert.equal(cursorFile.secret, cursorToken);
  assert.equal(cursorFile.label, 'ada@example.com');
  assert.equal(cursorFile.loginKey, 'cursor:user_01abc');
  const [cursorKeychain] = loginsFromSource({ kind: 'keychain', provider: 'cursor', service: 'cursor-access-token' }, `${cursorToken}\n`, { now: NOW });
  assert.equal(cursorKeychain.secret, cursorToken);

  const [gemini] = loginsFromSource({ kind: 'file', provider: 'gemini', path: '/h/.gemini/antigravity-cli/antigravity-oauth-token' }, JSON.stringify({
    token: { access_token: 'ya29.fake', refresh_token: '1//fake', expiry: '2026-11-02T03:00:00Z' },
    auth_method: 'consumer',
    id_token_email: 'Ada@Example.com',
  }));
  assert.deepEqual(JSON.parse(gemini.secret), { accessToken: 'ya29.fake', refreshToken: '1//fake' });
  assert.equal(gemini.loginKey, 'gemini:ada@example.com');
});

test('OpenCode keys are read for each service asked for', () => {
  const logins = loginsFromSource({ kind: 'file', provider: 'opencode', path: '/d/opencode/auth.json' }, JSON.stringify({
    'opencode-go': { type: 'api', key: 'oc-fake' },
    deepseek: { type: 'api', key: 'sk-deep-fake' },
    minimax: { type: 'api', key: 'mm-fake' },
    'minimax-coding-plan': { type: 'api', key: 'mm-fake' },
    github: { type: 'oauth', access: 'x' },
  }), {
    opencodeKeys: [
      { provider: 'opencode', names: ['opencode-go', 'opencode'] },
      { provider: 'deepseek', names: ['deepseek'] },
      { provider: 'minimax', names: ['minimax-coding-plan', 'minimax'], meta: { region: 'global', keyAuth: true } },
      { provider: 'kimi', names: ['kimi-for-coding'] },
    ],
  });
  assert.deepEqual(logins.map((login) => login.provider), ['opencode', 'deepseek', 'minimax']);
  assert.deepEqual(logins[2].meta, { region: 'global', keyAuth: true });
});

test('one login found twice is kept once', () => {
  const source = { kind: 'file', provider: 'codex', path: '/a' };
  const one = loginsFromSource(source, codexFile({ email: 'a@example.com', accountId: 'acct-1' }), { now: NOW })[0];
  const again = loginsFromSource({ ...source, path: '/b' }, codexFile({ email: 'a@example.com', accountId: 'acct-1', exp: NOW / 1000 + 7200 }), { now: NOW })[0];
  const other = loginsFromSource({ ...source, path: '/c' }, codexFile({ email: 'b@example.com', accountId: 'acct-2' }), { now: NOW })[0];
  const { kept, dropped } = dedupeLogins([one, again, other]);
  assert.deepEqual(kept.map((login) => login.loginKey), ['codex:acct-1', 'codex:acct-2']);
  assert.equal(dropped, 1);
});

test('an account on the board is matched by login key, label or shown email', () => {
  const accounts = [
    { id: '1', provider: 'codex', label: 'Work', meta: { loginKey: 'codex:acct-1' } },
    { id: '2', provider: 'claude', label: 'Ada@Example.com', meta: {} },
    { id: '3', provider: 'gemini', label: 'Personal', meta: {} },
  ];
  assert.equal(findExisting(accounts, { provider: 'codex', loginKey: 'codex:acct-1' }, '')?.id, '1');
  assert.equal(findExisting(accounts, { provider: 'claude', loginKey: '' }, 'ada@example.com')?.id, '2');
  assert.equal(findExisting(accounts, { provider: 'gemini', loginKey: '' }, 'g@example.com', { 3: 'G@example.com' })?.id, '3');
  assert.equal(findExisting(accounts, { provider: 'claude', loginKey: '' }, 'someone@example.com'), null);
});

test('runImport adds working logins, skips known ones and explains the rest, without any secret in the report', async () => {
  const files = {
    '/h/.claude/.credentials.json': claudeFile({ token: 'sk-ant-oat01-SECRET-A' }),
    '/h/.claude-work/.credentials.json': claudeFile({ token: 'sk-ant-oat01-SECRET-B' }),
    '/h/.claude-old/.credentials.json': claudeFile({ token: 'sk-ant-oat01-SECRET-C', scopes: ['user:inference'] }),
    '/h/.codex/auth.json': codexFile({ email: 'known@example.com', accountId: 'acct-known' }),
    '/h/.gemini/antigravity-cli/antigravity-oauth-token': JSON.stringify({ token: { access_token: 'ya29.SECRET-D', refresh_token: '1//SECRET-E' }, id_token_email: 'g@example.com' }),
  };
  const sources = localLoginSources({ home: '/h', platform: 'linux', listDir: fakeDirs({ '/h': ['.claude-work', '.claude-old'] }) });
  const checked = [];
  const saved = [];
  const refreshed = [];
  const identities = { 'sk-ant-oat01-SECRET-A': 'ada@example.com', 'sk-ant-oat01-SECRET-B': 'ada@example.com' };
  const result = await runImport({
    sources,
    now: NOW,
    read: async (source) => (files[source.path] ? { text: files[source.path] } : { missing: true }),
    check: async (login) => {
      checked.push(login.provider);
      if (login.provider === 'gemini') return { ok: false, error: 'That Gemini login was rejected.' };
      return { ok: true, identity: identities[login.secret] || null };
    },
    save: async (account) => {
      saved.push(account);
      return { created: true, account: { id: `new-${saved.length}`, provider: account.provider, label: account.label, meta: account.meta } };
    },
    refresh: (id, secret) => refreshed.push([id, secret]),
    accounts: [{ id: 'old', provider: 'codex', label: 'Codex', meta: { loginKey: 'codex:acct-known' } }],
  });

  // Two Claude Code configs signed in to one account make one card.
  assert.deepEqual(result.added, [{ provider: 'claude', label: 'ada@example.com' }]);
  assert.equal(saved[0].secret, 'sk-ant-oat01-SECRET-A');
  assert.equal(saved[0].meta.loginKey, 'claude:ada@example.com');
  assert.deepEqual(saved[0].meta.source, { kind: 'file', provider: 'claude', path: '/h/.claude/.credentials.json' });
  assert.deepEqual(result.existing.map((item) => item.provider), ['codex', 'claude']);
  // The known Codex login was kept fresh without a usage call.
  assert.deepEqual(refreshed.map(([id]) => id), ['old']);
  assert.ok(!checked.includes('codex'));
  assert.deepEqual(result.problems.map((item) => item.provider).sort(), ['claude', 'gemini']);
  assert.deepEqual(result.notFound.map((item) => item.provider), ['grok', 'cursor', 'opencode']);
  assert.equal(result.summary, 'Added 1, already there 2, not found or unusable 5.');
  const text = JSON.stringify({ ...result });
  assert.ok(!/SECRET/.test(text), 'the report must not carry a login value');
});

test('runImport reports a source it could not read', async () => {
  const result = await runImport({
    sources: [{ kind: 'keychain', provider: 'cursor', service: 'cursor-access-token' }],
    read: async () => ({ error: 'macOS did not allow reading it.' }),
    check: async () => assert.fail('nothing to check'),
    save: async () => assert.fail('nothing to save'),
  });
  assert.deepEqual(result.problems, [{ provider: 'cursor', where: 'keychain item cursor-access-token', message: 'macOS did not allow reading it.' }]);
});

test('currentLogin finds the renewed login for an account added from a source', () => {
  const source = { kind: 'file', provider: 'codex', path: '/h/.codex/auth.json' };
  const account = { provider: 'codex', meta: { loginKey: 'codex:acct-1', source } };
  const login = currentLogin(account, codexFile({ email: 'a@example.com', accountId: 'acct-1', exp: NOW / 1000 + 9000 }), { now: NOW });
  assert.equal(login.loginKey, 'codex:acct-1');
  assert.equal(currentLogin(account, codexFile({ email: 'b@example.com', accountId: 'acct-2' }), { now: NOW }), null);
  assert.equal(currentLogin({ provider: 'codex', meta: {} }, codexFile({ email: 'a@example.com', accountId: 'acct-1' })), null);
  const claude = { provider: 'claude', meta: { loginKey: 'claude:ada@example.com', source: { kind: 'file', provider: 'claude', path: '/x' } } };
  assert.equal(currentLogin(claude, claudeFile({ token: 'sk-ant-oat01-NEW' }), { now: NOW }).secret, 'sk-ant-oat01-NEW');
});

test('sameAccount only accepts the email the card was added for', () => {
  const { sameAccount } = require('./local-logins.cjs');
  const claude = { provider: 'claude', meta: { loginKey: 'claude:ada@example.com' } };
  assert.equal(sameAccount(claude, 'Ada@Example.com'), true);
  assert.equal(sameAccount(claude, 'bob@example.com'), false);
  assert.equal(sameAccount(claude, ''), false);
  assert.equal(sameAccount({ provider: 'claude', meta: {} }, 'bob@example.com'), true);
});
