const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseClaudeUsage,
  parseCodexUsage,
  parseGrokBilling,
  parseGrokRateLimits,
  parseMiniMax,
  parseCursorSummary,
  parseCopilotUsage,
  parseGeminiQuota,
  parseMuseUsage,
  museUsageFromStream,
  extractCodexAuth,
  extractGrokAuth,
  labelFromSeconds,
} = require('./parse.cjs');

test('labelFromSeconds names the windows people actually have', () => {
  assert.equal(labelFromSeconds(18000), '5 hours');
  assert.equal(labelFromSeconds(604800), 'Week');
  assert.equal(labelFromSeconds(2592000), 'Month');
});

test('claude accepts both fractions and percents, plus extra usage in cents', () => {
  const parsed = parseClaudeUsage({
    five_hour: { utilization: 0.34, resets_at: '2026-09-19T00:00:00Z' },
    seven_day: { utilization: 18, resets_at: '2026-09-25T00:00:00Z' },
    seven_day_opus: { utilization: 0, resets_at: null },
    extra_usage: {
      is_enabled: true,
      monthly_limit: 5000,
      used_credits: 1856,
      utilization: 37.12,
      currency: 'USD',
    },
  });
  assert.equal(parsed.windows[0].label, '5 hours');
  assert.equal(parsed.windows[0].usedPercent, 34);
  assert.equal(parsed.windows[1].usedPercent, 18);
  assert.equal(parsed.windows.some((window) => window.label === 'Opus week'), false);
  const extra = parsed.windows.find((window) => window.key === 'extra');
  assert.equal(extra.used, 18.56);
  assert.equal(extra.limit, 50);
});

test('codex maps the 5-hour and weekly windows', () => {
  const parsed = parseCodexUsage({
    plan_type: 'plus',
    rate_limit: {
      primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1780000000 },
      secondary_window: { used_percent: 10, limit_window_seconds: 604800, reset_at: 1780500000 },
    },
  });
  assert.equal(parsed.plan, 'plus');
  assert.equal(parsed.windows[0].label, '5 hours');
  assert.equal(parsed.windows[0].usedPercent, 25);
  assert.equal(parsed.windows[1].label, 'Week');
  assert.equal(parsed.windows[1].usedPercent, 10);
  assert.ok(parsed.windows[0].resetsAt);
});

test('codex keeps one-percent windows as one percent, not a full window', () => {
  const parsed = parseCodexUsage({
    plan_type: 'plus',
    rate_limit: {
      primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_at: 1780000000 },
      secondary_window: { used_percent: 1, limit_window_seconds: 604800, reset_at: 1780500000 },
    },
  });
  assert.equal(parsed.windows[0].usedPercent, 5);
  assert.equal(parsed.windows[1].usedPercent, 1);
});

test('codex hides the credits line when the plan has no credits', () => {
  const parsed = parseCodexUsage({
    plan_type: 'plus',
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1780000000 },
    },
    credits: { has_credits: false, unlimited: false, balance: '0' },
  });
  assert.equal(parsed.windows.some((window) => window.key === 'credits'), false);
});

test('codex still shows a real credit balance', () => {
  const parsed = parseCodexUsage({
    plan_type: 'pro',
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1780000000 },
    },
    credits: { has_credits: true, balance: '42.5' },
  });
  const credits = parsed.windows.find((window) => window.key === 'credits');
  assert.equal(credits.limit, 42.5);
});

test('grok billing reads credit percent and a weekly period', () => {
  const parsed = parseGrokBilling({
    config: {
      creditUsagePercent: 40,
      currentPeriod: { start: '2026-09-18T00:00:00Z', end: '2026-09-25T00:00:00Z' },
      subscriptionTier: 'SuperGrok',
    },
  });
  assert.equal(parsed.windows[0].label, 'Week');
  assert.equal(parsed.windows[0].usedPercent, 40);
  assert.equal(parsed.plan, 'SuperGrok');
});

test('grok billing keeps one-percent credits as one percent', () => {
  const parsed = parseGrokBilling({
    config: {
      creditUsagePercent: 1,
      currentPeriod: { start: '2026-09-18T00:00:00Z', end: '2026-09-25T00:00:00Z' },
    },
  });
  assert.equal(parsed.windows[0].usedPercent, 1);
});

test('grok unified billing with no percent yet still shows the weekly meter at zero', () => {
  const parsed = parseGrokBilling({
    config: {
      currentPeriod: {
        type: 'USAGE_PERIOD_TYPE_WEEKLY',
        start: '2026-09-21T21:39:17.636616+00:00',
        end: '2026-09-28T21:39:17.636616+00:00',
      },
      isUnifiedBillingUser: true,
    },
  });
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].label, 'Week');
  assert.equal(parsed.windows[0].usedPercent, 0);
  assert.ok(parsed.windows[0].resetsAt);
});

test('grok product usage rows become their own meters', () => {
  const parsed = parseGrokBilling({
    config: {
      creditUsagePercent: 45,
      productUsage: [
        { product: 'GrokBuild', usagePercent: 30 },
        { product: 'Api', usagePercent: 15 },
      ],
      currentPeriod: { start: '2026-09-18T00:00:00Z', end: '2026-09-25T00:00:00Z' },
    },
  });
  assert.equal(parsed.windows[0].key, 'credits');
  assert.equal(parsed.windows[0].usedPercent, 45);
  assert.equal(parsed.windows[1].label, 'Grok Build');
  assert.equal(parsed.windows[1].usedPercent, 30);
  assert.equal(parsed.windows[2].label, 'Api');
  assert.equal(parsed.windows[2].usedPercent, 15);
});

test('grok unified plans collapse product rows into the one shared pool', () => {
  const parsed = parseGrokBilling({
    config: {
      creditUsagePercent: 92,
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-28T21:39:17Z', end: '2026-10-05T21:39:17Z' },
      productUsage: [
        { product: 'GrokBuild', usagePercent: 90 },
        { product: 'GrokImagine', usagePercent: 1 },
        { product: 'GrokVoice', usagePercent: 1 },
        { product: 'GrokAppBuilder' },
        { product: 'GrokChat' },
      ],
      isUnifiedBillingUser: true,
    },
  });
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].label, 'Week');
  assert.equal(parsed.windows[0].usedPercent, 92);
});

test('grok unified plans still show rows that do not add up to the pool', () => {
  const parsed = parseGrokBilling({
    config: {
      creditUsagePercent: 90,
      currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-09-28T21:39:17Z', end: '2026-10-05T21:39:17Z' },
      productUsage: [
        { product: 'GrokBuild', usagePercent: 30 },
        { product: 'Api', usagePercent: 15 },
      ],
      isUnifiedBillingUser: true,
    },
  });
  assert.equal(parsed.windows.length, 3);
  assert.equal(parsed.windows[0].usedPercent, 90);
  assert.equal(parsed.windows[1].label, 'Grok Build');
});

test('grok rate limits turn remaining counts into used percent', () => {
  const parsed = parseGrokRateLimits({
    models: [{ model: 'grok-4', remaining: 8, limit: 20 }],
  });
  assert.equal(parsed.windows[0].label, 'grok-4');
  assert.equal(parsed.windows[0].used, 12);
  assert.equal(parsed.windows[0].usedPercent, 60);
});

test('minimax treats usage_count as remaining unless inverted', () => {
  const body = {
    model_remains: [{
      model_name: 'general',
      current_interval_total_count: 1500,
      current_interval_usage_count: 1417,
      end_time: 1790000000000,
      current_weekly_total_count: 10000,
      current_weekly_usage_count: 8000,
      weekly_end_time: 1790500000000,
    }],
  };
  const remaining = parseMiniMax(body);
  assert.equal(remaining.windows[0].label, '5 hours');
  assert.equal(remaining.windows[0].used, 83);
  assert.equal(remaining.windows[1].used, 2000);
  const used = parseMiniMax(body, { countsAre: 'used' });
  assert.equal(used.windows[0].used, 1417);
});

test('minimax weekly status 3 is unlimited', () => {
  const parsed = parseMiniMax({
    model_remains: [{ model_name: 'general', current_weekly_status: 3, current_interval_total_count: 100, current_interval_usage_count: 90 }],
  });
  assert.equal(parsed.windows.find((window) => window.key === 'week').unit, 'unlimited');
});

test('cursor summary keeps the two monthly pools', () => {
  const parsed = parseCursorSummary({
    billingCycleStart: '2026-09-01T00:00:00.000Z',
    billingCycleEnd: '2026-10-01T00:00:00.000Z',
    membershipType: 'pro',
    individualUsage: {
      plan: { autoPercentUsed: 20, apiPercentUsed: 40 },
      onDemand: { enabled: true, used: 250, limit: 1000 },
    },
  });
  assert.equal(parsed.plan, 'Pro');
  assert.equal(parsed.windows[0].label, 'Cursor models');
  assert.equal(parsed.windows[0].usedPercent, 20);
  assert.equal(parsed.windows[1].label, 'Other models');
  assert.equal(parsed.windows[2].unit, 'dollars');
  assert.equal(parsed.windows[2].used, 2.5);
});

test('copilot turns percent remaining into used', () => {
  const parsed = parseCopilotUsage({
    copilot_plan: 'individual',
    quota_snapshots: {
      premium_interactions: { entitlement: 300, remaining: 90, percent_remaining: 30 },
      chat: { unlimited: true },
    },
  });
  assert.equal(parsed.plan, 'Individual');
  assert.equal(parsed.windows[0].label, 'Premium');
  assert.equal(parsed.windows[0].usedPercent, 70);
  assert.equal(parsed.windows[0].used, 210);
  assert.equal(parsed.windows[1].unit, 'unlimited');
});

test('gemini quota remaining fraction becomes used percent', () => {
  const parsed = parseGeminiQuota(
    { buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.25, resetTime: '2026-09-19T00:00:00.000Z' }] },
    { currentTier: { name: 'Free' } },
  );
  assert.equal(parsed.plan, 'Free');
  assert.equal(parsed.windows[0].label, '2.5 Pro');
  assert.equal(parsed.windows[0].usedPercent, 75);
});

test('gemini summary keeps the weekly and five-hour windows', () => {
  const parsed = parseGeminiQuota({
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.5, resetTime: '2026-09-25T00:00:00Z' },
          { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.8 },
        ],
      },
      {
        displayName: 'Claude and GPT models',
        buckets: [
          { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 },
        ],
      },
    ],
  });
  assert.deepEqual(parsed.windows.map((window) => window.label), ['Gemini week', 'Gemini 5 hours', 'Claude week']);
  assert.equal(parsed.windows[0].usedPercent, 50);
  assert.equal(Math.round(parsed.windows[1].usedPercent), 20);
});

test('gemini uses an attached project and otherwise starts free setup', () => {
  const { geminiSetupPlan, geminiProjectId } = require('./parse.cjs');
  assert.equal(geminiProjectId({ id: 'proj-1' }), 'proj-1');
  assert.deepEqual(geminiSetupPlan({ cloudaicompanionProject: 'proj-1' }), { action: 'use', project: 'proj-1' });
  assert.deepEqual(
    geminiSetupPlan({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
    { action: 'onboard', tierId: 'free-tier' },
  );
  const blocked = geminiSetupPlan({
    currentTier: { id: 'standard-tier' },
    ineligibleTiers: [{ reasonMessage: 'Verify this account.', validationUrl: 'https://accounts.google.com/verify' }],
  });
  assert.equal(blocked.action, 'fail');
  assert.match(blocked.message, /Verify this account/);
  assert.match(blocked.message, /accounts\.google\.com/);
});

test('muse reads the five-hour and weekly subscription meters', () => {
  const parsed = parseMuseUsage({
    user_email: 'ada@example.com',
    subs_tier_name: 'Muse Code Everyday Usage',
    is_subs_active: true,
    subs_usage: {
      window: { used_percent: 42, resets_at: '2026-09-21T18:00:00Z', window_duration_mins: 300 },
      weekly: { used_percent: 17, resets_at: 1787972193 },
    },
  });
  assert.equal(parsed.plan, 'Everyday Usage');
  assert.equal(parsed.identity, 'ada@example.com');
  assert.equal(parsed.windows[0].label, '5 hours');
  assert.equal(parsed.windows[0].usedPercent, 42);
  assert.equal(parsed.windows[1].label, 'Week');
  assert.equal(parsed.windows[1].usedPercent, 17);
  assert.ok(parsed.windows[0].resetsAt);
  assert.ok(parsed.windows[1].resetsAt);
});

test('muse keeps small percents as percents and drops bad windows', () => {
  const parsed = parseMuseUsage({
    subs_tier_id: 'power',
    subs_usage: {
      window: { used_percent: 1, window_duration_mins: 300 },
      weekly: { used_percent: -1 },
    },
  });
  assert.equal(parsed.plan, 'power');
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].usedPercent, 1);
});

test('muse without a duration still names the rolling window', () => {
  const parsed = parseMuseUsage({ subs_usage: { window: { used_percent: 25, window_duration_mins: 0 } } });
  assert.equal(parsed.windows[0].label, 'Rolling window');
});

test('muse key problems name the fix', () => {
  const { museKeyProblem } = require('./parse.cjs');
  const inactive = museKeyProblem({ is_subs_active: false });
  assert.equal(inactive.status, 404);
  assert.match(inactive.message, /no active Muse Code subscription/);
  assert.equal(museKeyProblem({ require_payment: true }).status, 404);
  const envelope = museKeyProblem({ title: 'Too Many Requests', detail: 'Slow down.', status: 429 });
  assert.equal(envelope.status, 429);
  assert.equal(envelope.message, 'Slow down.');
  assert.equal(museKeyProblem({ subs_usage: { window: { used_percent: 1 } } }), null);
});

test('muse reports no usage rather than inventing empty meters', () => {
  // This is the real /muse-code/key body: plan and identity, no usage anywhere.
  const parsed = parseMuseUsage({
    api_key: 'LLM|1820000000000000|FAKE-KEY-FOR-TESTS-ONLY',
    require_payment: false,
    is_subs_active: true,
    has_payment_method: false,
    user_email: 'ada@example.com',
    subs_tier_id: '27680000000000000',
    subs_tier_name: 'Muse Code High Usage',
  });
  assert.equal(parsed.plan, 'High Usage');
  assert.equal(parsed.identity, 'ada@example.com');
  // The board renders percent *left*, so a made-up 0%-used window would read as
  // "100% left" while the weekly meter is actually nearly spent.
  assert.deepEqual(parsed.windows, []);
});

test('muse reads the meters out of a response.subscription_usage frame', () => {
  const stream = [
    'event: response.created',
    'data: {"type":"response.created","sequence_number":0}',
    '',
    'event: response.incomplete',
    'data: {"type":"response.incomplete","response":{"usage":{"total_tokens":24}}}',
    '',
    'event: response.subscription_usage',
    'data: {"type":"response.subscription_usage","subscription":{"tier":"27680000000000000","weekly":{"used_percent":90,"resets_at":1791158400},"window":{"used_percent":0,"resets_at":1791073456,"window_duration_mins":300}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const frame = museUsageFromStream(stream);
  assert.ok(frame, 'the frame should be found in the stream');
  const parsed = parseMuseUsage(frame);
  assert.equal(parsed.windows.length, 2);
  assert.equal(parsed.windows[0].label, '5 hours');
  assert.equal(parsed.windows[0].usedPercent, 0);
  assert.equal(parsed.windows[1].label, 'Week');
  assert.equal(parsed.windows[1].usedPercent, 90);
  assert.equal(parsed.windows[1].resetsAt, new Date(1791158400 * 1000).toISOString());
  // The frame carries a tier id, never a plan name.
  assert.equal(parsed.plan, null);
});

test('muse ignores stream frames that carry no usage', () => {
  assert.equal(museUsageFromStream(''), null);
  assert.equal(museUsageFromStream('data: [DONE]\n'), null);
  assert.equal(museUsageFromStream('data: not json\n'), null);
  assert.equal(museUsageFromStream('data: {"type":"response.completed"}\n'), null);
});

test('muse without an active subscription still reports no usage windows', () => {
  const parsed = parseMuseUsage({
    is_subs_active: false,
    subs_tier_name: 'Muse Code High Usage',
  });
  assert.equal(parsed.windows.length, 0);
});

test('auth files yield tokens without keeping the rest', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    email: 'ada@example.com',
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' },
  })).toString('base64url');
  const token = `${header}.${payload}.sig`;
  const codex = extractCodexAuth({ tokens: { access_token: token, account_id: 'acct_1' } });
  assert.equal(codex.accessToken, token);
  assert.equal(codex.accountId, 'acct_1');

  const grok = extractGrokAuth({
    'https://auth.x.ai': { key: 'g' + 'rok'.repeat(10), email: 'ada@x.ai', expires_at: '2026-12-01T00:00:00Z' },
  });
  assert.equal(grok.length, 1);
  assert.equal(grok[0].email, 'ada@x.ai');
});
