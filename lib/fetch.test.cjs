const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchUsage, clearMuseModelCache } = require('./fetch.cjs');

const SECRET = JSON.stringify({ accessToken: 'muse-access-token' });

// A real /muse-code/key body from an account whose 5h window had just reset:
// the plan and identity come back, but Meta omits subs_usage entirely.
const KEY_WITHOUT_USAGE = {
  api_key: 'LLM|1820000000000000|FAKE-KEY-FOR-TESTS-ONLY',
  require_payment: false,
  is_subs_active: true,
  user_email: 'ada@example.com',
  subs_tier_name: 'Muse Code High Usage',
};

const KEY_WITH_USAGE = {
  ...KEY_WITHOUT_USAGE,
  subs_usage: {
    window: { used_percent: 0, window_duration_mins: 300, resets_at: 1791073456 },
    weekly: { used_percent: 90, resets_at: 1791158400 },
    tier: '27680000000000000',
  },
};

const STREAM = [
  'event: response.created',
  'data: {"type":"response.created","sequence_number":0}',
  '',
  'event: response.subscription_usage',
  'data: {"type":"response.subscription_usage","subscription":{"tier":"27680000000000000","weekly":{"used_percent":90,"resets_at":1791158400},"window":{"used_percent":0,"resets_at":1791073456,"window_duration_mins":300}}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

// Replaces global fetch for one call, and reports every URL that was touched.
async function withFetch(handler, run) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options || {}, calls);
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const account = (meta = {}) => ({ id: 'muse-1', provider: 'muse', label: 'Muse', meta });

test('muse with the live meter turned off never invents windows and never spends a call', async () => {
  const { result, calls } = await withFetch(
    (url) => {
      assert.equal(url, 'https://api.meta.ai/muse-code/key');
      return jsonResponse(KEY_WITHOUT_USAGE);
    },
    () => fetchUsage(account({ museLiveUsage: false }), SECRET),
  );
  assert.equal(result.ok, true);
  assert.equal(result.plan, 'High Usage');
  // The board renders percent *left*. Empty windows must stay empty: a
  // fabricated 0%-used pair would read as "100% left" while weekly is at 90%.
  assert.deepEqual(result.windows, []);
  assert.match(result.note, /did not include Muse usage/);
  assert.deepEqual(calls.map((call) => call.url), ['https://api.meta.ai/muse-code/key']);
});

test('muse keeps the last real week when a 5-hour reset drops the key meter', async () => {
  const { result, calls } = await withFetch(
    () => jsonResponse(KEY_WITHOUT_USAGE),
    () => fetchUsage(account({
      museMeter: {
        savedAt: '2026-10-04T18:00:00.000Z',
        windows: [
          { key: 'window', label: '5 hours', usedPercent: 80, resetsAt: '2026-10-04T18:30:00.000Z' },
          { key: 'weekly', label: 'Week', usedPercent: 99, resetsAt: '2099-01-01T00:00:00.000Z' },
        ],
      },
    }), SECRET),
  );
  assert.equal(result.windows[0].label, '5 hours');
  assert.equal(result.windows[0].usedPercent, 0);
  assert.equal(result.windows[1].label, 'Week');
  assert.equal(result.windows[1].usedPercent, 99);
  assert.equal(result.plan, 'High Usage');
  assert.equal(result.note, null);
  assert.equal(result.meter, undefined);
  assert.deepEqual(calls.map((call) => call.url), ['https://api.meta.ai/muse-code/key']);
});

test('muse reads the live meter once when a reset leaves no week to keep', async () => {
  const { result, calls } = await withFetch(
    (url) => {
      if (url === 'https://api.meta.ai/muse-code/key') return jsonResponse(KEY_WITHOUT_USAGE);
      if (url === 'https://api.meta.ai/v1/responses') return textResponse(STREAM);
      if (url === 'https://api.meta.ai/muse-code/models') {
        return jsonResponse({ data: [{ id: 'muse-x-contributor' }, { id: 'muse-x' }] });
      }
      throw new Error(`unexpected url ${url}`);
    },
    () => fetchUsage(account(), SECRET),
  );
  assert.equal(result.windows[0].usedPercent, 0);
  assert.equal(result.windows[1].usedPercent, 90);
  assert.equal(result.plan, 'High Usage');
  assert.equal(result.note, null);
  assert.equal(result.meter.windows[1].usedPercent, 90);
  assert.ok(calls.some((call) => call.url === 'https://api.meta.ai/v1/responses'));
});

test('muse reads the real meters from the stream once the account opts in', async () => {
  clearMuseModelCache();
  const { result, calls } = await withFetch(
    (url) => {
      if (url === 'https://api.meta.ai/muse-code/key') return jsonResponse(KEY_WITHOUT_USAGE);
      if (url === 'https://api.meta.ai/v1/responses') return textResponse(STREAM);
      if (url === 'https://api.meta.ai/muse-code/models') {
        return jsonResponse({ data: [{ id: 'muse-x-contributor' }, { id: 'muse-x' }] });
      }
      throw new Error(`unexpected url ${url}`);
    },
    () => fetchUsage(account({ museLiveUsage: true }), SECRET),
  );
  assert.equal(result.ok, true);
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].label, '5 hours');
  assert.equal(result.windows[0].usedPercent, 0);
  assert.equal(result.windows[1].label, 'Week');
  assert.equal(result.windows[1].usedPercent, 90);
  assert.equal(result.plan, 'High Usage');
  assert.equal(result.note, null);
  // It picks a real model, never a "-contributor" one.
  const probe = calls.find((call) => call.url === 'https://api.meta.ai/v1/responses');
  const body = JSON.parse(probe.options.body);
  assert.equal(body.model, 'muse-x');
  assert.equal(body.max_output_tokens, 16);
  assert.equal(body.stream, true);
});

test('muse prefers the key meter and skips the paid call when Meta sends one', async () => {
  const { result, calls } = await withFetch(
    (url) => jsonResponse(KEY_WITH_USAGE),
    () => fetchUsage(account({ museLiveUsage: true }), SECRET),
  );
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[1].usedPercent, 90);
  assert.equal(result.note, null);
  assert.equal(result.meter.windows[1].usedPercent, 90);
  assert.deepEqual(calls.map((call) => call.url), ['https://api.meta.ai/muse-code/key']);
});

test('a failed live read explains itself instead of breaking the card', async () => {
  const { result } = await withFetch(
    (url) => {
      if (url === 'https://api.meta.ai/muse-code/key') return jsonResponse(KEY_WITHOUT_USAGE);
      if (url === 'https://api.meta.ai/muse-code/models') return jsonResponse({ data: [] });
      return jsonResponse({ error: { message: 'model is overloaded' } }, 529);
    },
    () => fetchUsage(account({ museLiveUsage: true }), SECRET),
  );
  assert.equal(result.ok, true);
  assert.equal(result.plan, 'High Usage');
  assert.deepEqual(result.windows, []);
  assert.match(result.note, /Could not read the live meter: model is overloaded/);
});

test('claude oauth usage also reads the account email and plan', async () => {
  const secret = JSON.stringify({ accessToken: 'sk-ant-oat-test-token' });
  const { result, calls } = await withFetch(
    (url) => {
      if (url === 'https://api.anthropic.com/api/oauth/usage') {
        return jsonResponse({ five_hour: { utilization: 55, resets_at: '2026-10-13T20:00:00Z' } });
      }
      if (url === 'https://api.anthropic.com/api/oauth/profile') {
        return jsonResponse({
          account: { uuid: 'acct', email: 'ada@example.com', full_name: 'Ada Lovelace' },
          organization: { name: "Ada's Organization", organization_type: 'claude_max' },
        });
      }
      throw new Error(`unexpected url ${url}`);
    },
    () => fetchUsage({ id: 'claude-1', provider: 'claude', label: 'Claude', meta: {} }, secret),
  );
  assert.equal(result.ok, true);
  assert.equal(result.identity, 'ada@example.com');
  assert.equal(result.plan, 'Max');
  assert.equal(result.windows[0].label, '5 hours');
  assert.equal(result.windows[0].usedPercent, 55);
  assert.deepEqual(calls.map((call) => call.url), [
    'https://api.anthropic.com/api/oauth/usage',
    'https://api.anthropic.com/api/oauth/profile',
  ]);
  const profileCall = calls[1];
  assert.match(profileCall.options.headers.Authorization, /^Bearer sk-ant-oat/);
  assert.equal(profileCall.options.headers['anthropic-beta'], 'oauth-2025-04-20');
});

test('claude still shows usage when the profile call fails', async () => {
  const secret = JSON.stringify({ accessToken: 'sk-ant-oat-test-token' });
  const { result } = await withFetch(
    (url) => {
      if (url === 'https://api.anthropic.com/api/oauth/usage') {
        return jsonResponse({ five_hour: { utilization: 0.1, resets_at: '2026-10-13T20:00:00Z' } });
      }
      return jsonResponse({ error: { message: 'profile unavailable' } }, 500);
    },
    () => fetchUsage({ id: 'claude-1', provider: 'claude', label: 'Claude', meta: {} }, secret),
  );
  assert.equal(result.ok, true);
  assert.equal(result.identity, null);
  assert.equal(result.plan, null);
  assert.equal(result.windows[0].usedPercent, 10);
});

test('claude session login keeps the account email', async () => {
  const { result } = await withFetch(
    (url) => {
      if (url === 'https://claude.ai/api/organizations') {
        return jsonResponse([{
          uuid: 'org-1',
          name: "Ada's Organization",
          capabilities: ['chat'],
          rate_limit_tier: 'default_claude_max_5x',
        }]);
      }
      if (url === 'https://claude.ai/api/organizations/org-1/usage') {
        return jsonResponse({ five_hour: { utilization: 45, resets_at: '2026-10-13T20:00:00Z' } });
      }
      if (url === 'https://claude.ai/api/account') {
        return jsonResponse({ email_address: 'ada@example.com', display_name: 'Ada' });
      }
      throw new Error(`unexpected url ${url}`);
    },
    () => fetchUsage({ id: 'claude-web', provider: 'claude', label: 'Claude', meta: {} }, 'sessionKey=sk-ant-sid-test'),
  );
  assert.equal(result.ok, true);
  assert.equal(result.identity, 'ada@example.com');
  assert.equal(result.plan, 'Max');
  assert.equal(result.windows[0].usedPercent, 45);
});

test('a stream without a usage frame is reported, not silently drawn as empty', async () => {
  const { result } = await withFetch(
    (url) => {
      if (url === 'https://api.meta.ai/muse-code/key') return jsonResponse(KEY_WITHOUT_USAGE);
      if (url === 'https://api.meta.ai/muse-code/models') return jsonResponse({ data: [] });
      return textResponse('data: {"type":"response.completed"}\n\ndata: [DONE]\n');
    },
    () => fetchUsage(account({ museLiveUsage: true }), SECRET),
  );
  assert.deepEqual(result.windows, []);
  assert.match(result.note, /without a usage frame/);
});
