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
      museLiveUsage: false,
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

test('muse with no saved meter reads the live meter once and prefers spark', async () => {
  clearMuseModelCache();
  const { result, calls } = await withFetch(
    (url) => {
      if (url === 'https://api.meta.ai/muse-code/key') return jsonResponse(KEY_WITHOUT_USAGE);
      if (url === 'https://api.meta.ai/v1/responses') return textResponse(STREAM);
      if (url === 'https://api.meta.ai/muse-code/models') {
        return jsonResponse({
          data: [
            { id: 'muse-wonder-1.0' },
            { id: 'muse-spark-1.3-contributor' },
            { id: 'muse-spark-1.3' },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    },
    () => fetchUsage(account(), SECRET),
  );
  assert.equal(result.ok, true);
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[1].usedPercent, 90);
  assert.equal(result.plan, 'High Usage');
  assert.equal(result.note, null);
  const probe = calls.find((call) => call.url === 'https://api.meta.ai/v1/responses');
  assert.equal(JSON.parse(probe.options.body).model, 'muse-spark-1.3');
});

test('muse reads again after the saved 5-hour window has reset', async () => {
  clearMuseModelCache();
  const { result, calls } = await withFetch(
    (url) => {
      if (url === 'https://api.meta.ai/muse-code/key') return jsonResponse(KEY_WITHOUT_USAGE);
      if (url === 'https://api.meta.ai/v1/responses') return textResponse(STREAM);
      if (url === 'https://api.meta.ai/muse-code/models') return jsonResponse({ data: [{ id: 'muse-spark-1.3' }] });
      throw new Error(`unexpected url ${url}`);
    },
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
  assert.equal(result.windows[0].usedPercent, 0);
  assert.equal(result.windows[1].usedPercent, 90);
  assert.equal(result.note, null);
  assert.equal(result.meter.windows[1].usedPercent, 90);
  assert.ok(calls.some((call) => call.url === 'https://api.meta.ai/v1/responses'));
});

test('muse reuses a still-open saved session without another call', async () => {
  const { result, calls } = await withFetch(
    () => jsonResponse(KEY_WITHOUT_USAGE),
    () => fetchUsage(account({
      museMeter: {
        savedAt: new Date().toISOString(),
        windows: [
          { key: 'window', label: '5 hours', usedPercent: 12, resetsAt: '2099-01-01T00:00:00.000Z' },
          { key: 'weekly', label: 'Week', usedPercent: 3, resetsAt: '2099-01-08T00:00:00.000Z' },
        ],
      },
    }), SECRET),
  );
  assert.equal(result.windows[0].usedPercent, 12);
  assert.equal(result.windows[1].usedPercent, 3);
  assert.equal(result.note, null);
  assert.equal(result.meter, undefined);
  assert.deepEqual(calls.map((call) => call.url), ['https://api.meta.ai/muse-code/key']);
});

test('a rotated login is preserved even if the next usage request fails', async () => {
  const original = JSON.stringify({ accessToken: 'old-access-token', refreshToken: 'old-refresh-token' });
  const { result, calls } = await withFetch(
    (url, options) => {
      if (url === 'https://auth.openai.com/oauth/token') {
        return jsonResponse({ access_token: 'new-access-token', refresh_token: 'new-refresh-token' });
      }
      const status = options.headers.Authorization === 'Bearer old-access-token' ? 401 : 503;
      return jsonResponse({ error: { message: 'Service unavailable' } }, status);
    },
    () => fetchUsage({ id: 'codex', provider: 'codex', meta: {} }, original),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(JSON.parse(result.secret), {
    accessToken: 'new-access-token', refreshToken: 'new-refresh-token', resourceUrl: '',
  });
  assert.equal(calls.length, 3);
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

test('opencode reads the go usage windows with the pasted key', async () => {
  const { result, calls } = await withFetch((url) => {
    assert.equal(url, 'https://opencode.ai/zen/go/v1/usage');
    return jsonResponse({ usage: { rolling: { percent: 40, resetsAt: '2026-10-29T05:39:42.000Z' }, weekly: { percent: 22 }, monthly: { percent: 11 } } });
  }, () => fetchUsage({ id: 'oc', provider: 'opencode', label: 'OpenCode', meta: {} }, 'sk-opencode-test-key'));
  assert.equal(result.ok, true);
  assert.equal(result.windows.length, 3);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-opencode-test-key');
});

test('a rejected key says key, not login', async () => {
  const { result } = await withFetch(() => jsonResponse({ error: { message: 'Invalid API key' } }, 401),
    () => fetchUsage({ id: 'ds', provider: 'deepseek', label: 'DeepSeek', meta: {} }, 'sk-deepseek-bad-key'));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'That DeepSeek key was rejected. Add it again with a current key.');
});

test('deepseek balance comes back as a balance window', async () => {
  const { result } = await withFetch(() => jsonResponse({
    is_available: true,
    balance_infos: [{ currency: 'USD', total_balance: '9.88', granted_balance: '0.00', topped_up_balance: '9.88' }],
  }), () => fetchUsage({ id: 'ds', provider: 'deepseek', label: 'DeepSeek', meta: {} }, 'sk-deepseek-test-key'));
  assert.equal(result.ok, true);
  assert.equal(result.windows[0].unit, 'balance');
  assert.equal(result.windows[0].amount, 9.88);
});

test('openrouter management key reads the account credits only', async () => {
  const { result, calls } = await withFetch(() => jsonResponse({ data: { total_credits: 50, total_usage: 10 } }),
    () => fetchUsage({ id: 'or', provider: 'openrouter', label: 'OpenRouter', meta: {} }, 'sk-or-v1-management'));
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.url), ['https://openrouter.ai/api/v1/credits']);
  assert.equal(result.windows[0].limit, 50);
});

test('openrouter regular key falls back to its own limit after a 403', async () => {
  const { result, calls } = await withFetch((url) => {
    if (url.endsWith('/credits')) return jsonResponse({ error: { code: 403, message: 'Only management keys can perform this operation' } }, 403);
    return jsonResponse({ data: { limit: 10, limit_remaining: 4, limit_reset: 'monthly', usage: 6, is_free_tier: false } });
  }, () => fetchUsage({ id: 'or', provider: 'openrouter', label: 'OpenRouter', meta: {} }, 'sk-or-v1-regular'));
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.url), ['https://openrouter.ai/api/v1/credits', 'https://openrouter.ai/api/v1/key']);
  assert.equal(result.windows[0].label, 'Month');
  assert.equal(result.windows[0].used, 6);
});

test('openrouter bad key stops at the first 401', async () => {
  const { result, calls } = await withFetch(() => jsonResponse({ error: { code: 401, message: 'No auth credentials found' } }, 401),
    () => fetchUsage({ id: 'or', provider: 'openrouter', label: 'OpenRouter', meta: {} }, 'sk-or-v1-bad'));
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.match(result.error, /OpenRouter key was rejected/);
});

test('gemini reads the summary and the model catalog, and skips the legacy call', async () => {
  const { result, calls } = await withFetch((url) => {
    if (url.endsWith(':loadCodeAssist')) return jsonResponse({ cloudaicompanionProject: 'proj-1', currentTier: { name: 'Antigravity' }, paidTier: { name: 'Google AI Pro' } });
    if (url.endsWith(':retrieveUserQuotaSummary')) {
      return jsonResponse({ groups: [{ displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.5 }] }] });
    }
    if (url.endsWith(':fetchAvailableModels')) {
      return jsonResponse({ models: { 'gemini-3-flash': { displayName: 'Gemini 3 Flash', modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0.75, resetTime: '2026-10-29T00:00:00Z' } } } });
    }
    throw new Error(`unexpected ${url}`);
  }, () => fetchUsage({ id: 'g', provider: 'gemini', label: 'Google', meta: {} }, 'gemini-test-token'));
  assert.equal(result.ok, true);
  assert.equal(result.plan, 'Google AI Pro');
  assert.deepEqual(result.windows.map((window) => window.label), ['Claude & GPT week', 'Gemini 3 Flash']);
  assert.equal(calls.some((call) => call.url.endsWith(':retrieveUserQuota')), false);
  assert.equal(JSON.parse(calls.find((call) => call.url.endsWith(':fetchAvailableModels')).options.body).project, 'proj-1');
});

test('gemini falls back to the per-model quota when the catalog fails', async () => {
  const { result, calls } = await withFetch((url) => {
    if (url.endsWith(':loadCodeAssist')) return jsonResponse({ cloudaicompanionProject: 'proj-1', currentTier: { name: 'Free' } });
    if (url.endsWith(':retrieveUserQuotaSummary')) return jsonResponse({}, 404);
    if (url.endsWith(':fetchAvailableModels')) return jsonResponse({ error: { message: 'boom' } }, 500);
    if (url.endsWith(':retrieveUserQuota')) return jsonResponse({ buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.25 }] });
    throw new Error(`unexpected ${url}`);
  }, () => fetchUsage({ id: 'g', provider: 'gemini', label: 'Google', meta: {} }, 'gemini-test-token'));
  assert.equal(result.ok, true);
  assert.ok(calls.some((call) => call.url.endsWith(':retrieveUserQuota')));
  assert.equal(result.windows[0].label, 'Gemini 2.5 Pro');
  assert.equal(result.windows[0].usedPercent, 75);
});

test('kimi code tries the global host after the first rejects the key, then remembers it', async () => {
  const handler = (url) => (url.startsWith('https://api.kimi.com/')
    ? jsonResponse({ error: 'unauthorized' }, 401)
    : jsonResponse({ usage: { limit: '100', used: '10', remaining: '90' } }));
  const kimi = { id: 'k', provider: 'kimi', label: 'Kimi', meta: {} };
  const first = await withFetch(handler, () => fetchUsage(kimi, 'sk-kimi-regional'));
  assert.equal(first.result.ok, true);
  assert.deepEqual(first.calls.map((call) => call.url), ['https://api.kimi.com/coding/v1/usages', 'https://api.kimi.ai/coding/v1/usages']);
  assert.equal(first.calls[0].options.headers.Authorization, 'Bearer sk-kimi-regional');
  const second = await withFetch(handler, () => fetchUsage(kimi, 'sk-kimi-regional'));
  assert.deepEqual(second.calls.map((call) => call.url), ['https://api.kimi.ai/coding/v1/usages']);
});

test('a key every host rejects says that key was rejected', async () => {
  const { result, calls } = await withFetch(() => jsonResponse({ error: 'unauthorized' }, 401),
    () => fetchUsage({ id: 'k', provider: 'kimi', label: 'Kimi', meta: {} }, 'sk-kimi-bad'));
  assert.equal(result.ok, false);
  assert.equal(calls.length, 2);
  assert.equal(result.error, 'That Kimi Code key was rejected. Add it again with a current key.');
});

test('z.ai sends the key bare and reads an error envelope as a rejected key', async () => {
  const good = await withFetch(() => jsonResponse({ code: 200, success: true, data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 20 }] } }),
    () => fetchUsage({ id: 'z', provider: 'zai', label: 'Z.ai', meta: {} }, 'zai-test-key'));
  assert.equal(good.result.ok, true);
  assert.equal(good.calls[0].options.headers.Authorization, 'zai-test-key');
  assert.equal(good.result.windows[0].usedPercent, 20);
  const bad = await withFetch(() => jsonResponse({ code: 1001, success: false, msg: 'Authorization failed' }),
    () => fetchUsage({ id: 'z', provider: 'zai', label: 'Z.ai', meta: {} }, 'zai-bad-key'));
  assert.equal(bad.result.ok, false);
  assert.equal(bad.calls.length, 2);
  assert.equal(bad.result.error, 'That Z.ai key was rejected. Add it again with a current key.');
});

test('moonshot reads the China host in yuan when the global host rejects the key', async () => {
  const { result } = await withFetch((url) => (url.includes('moonshot.ai')
    ? jsonResponse({ error: { message: 'Invalid Authentication' } }, 401)
    : jsonResponse({ code: 0, status: true, data: { available_balance: 42, voucher_balance: 0, cash_balance: 42 } })),
  () => fetchUsage({ id: 'm', provider: 'moonshot', label: 'Kimi API', meta: {} }, 'sk-moonshot-cn'));
  assert.equal(result.ok, true);
  assert.equal(result.windows[0].currency, 'CNY');
  assert.equal(result.windows[0].amount, 42);
});

test('vercel, poe and siliconflow read their balances with a bearer key', async () => {
  const cases = [
    ['vercel', 'https://ai-gateway.vercel.sh/v1/credits', { balance: '95.50', total_used: '4.50' }, 95.5],
    ['poe', 'https://api.poe.com/usage/current_balance', { current_point_balance: 5000 }, 5000],
    ['siliconflow', 'https://api.siliconflow.com/v1/user/info', { code: 20000, status: true, data: { totalBalance: '3.5', balance: '0' } }, 3.5],
  ];
  for (const [provider, endpoint, body, amount] of cases) {
    const { result, calls } = await withFetch(() => jsonResponse(body),
      () => fetchUsage({ id: provider, provider, label: provider, meta: {} }, `${provider}-test-key`));
    assert.equal(result.ok, true, provider);
    assert.equal(calls[0].url, endpoint);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${provider}-test-key`);
    assert.equal(result.windows[0].amount, amount);
  }
});

test('a pasted minimax key that is rejected says key, not login', async () => {
  const { result } = await withFetch(() => jsonResponse({ error: 'unauthorized' }, 401),
    () => fetchUsage({ id: 'mm', provider: 'minimax', label: 'MiniMax', meta: { region: 'global', keyAuth: true } }, 'sk-minimax-bad'));
  assert.equal(result.ok, false);
  assert.match(result.error, /That MiniMax key was rejected/);
});
