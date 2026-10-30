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
  extractOpenCodeKey,
} = require('./parse.cjs');

test('labelFromSeconds names the windows people actually have', () => {
  assert.equal(labelFromSeconds(18000), '5 hours');
  assert.equal(labelFromSeconds(604800), 'Week');
  assert.equal(labelFromSeconds(2592000), 'Month');
});

test('claude accepts both fractions and percents, plus extra usage in cents', () => {
  const parsed = parseClaudeUsage({
    five_hour: { utilization: 34, resets_at: '2026-09-19T00:00:00Z' },
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

test('claude reads utilization as a percent, so 1 is one percent used and not a full window', () => {
  const parsed = parseClaudeUsage({
    five_hour: { utilization: 1, resets_at: '2026-10-30T20:00:00Z' },
    seven_day: { utilization: 0.5, resets_at: '2026-11-05T00:00:00Z' },
    limits: [{ kind: 'weekly_scoped', utilization: 1, scope: { model: { display_name: 'Fable' } }, resets_at: '2026-11-05T00:00:00Z' }],
  });
  assert.equal(parsed.windows.find((window) => window.label === '5 hours').usedPercent, 1);
  assert.equal(parsed.windows.find((window) => window.label === 'Week').usedPercent, 0.5);
  assert.equal(parsed.windows.find((window) => window.label === 'Fable').usedPercent, 1);
});

test('claude shows the Fable weekly cap beside the 5-hour session', () => {
  const parsed = parseClaudeUsage({
    five_hour: { utilization: 20, resets_at: '2026-10-14T18:00:00Z' },
    seven_day: null,
    limits: [
      { kind: 'session', group: 'session', percent: 20, resets_at: '2026-10-14T18:00:00Z', scope: null, is_active: false },
      { kind: 'weekly_all', group: 'weekly', percent: 1, resets_at: '2026-10-18T22:00:00Z', scope: null, is_active: false },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 6,
        resets_at: '2026-10-18T22:00:00Z',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null },
        is_active: false,
      },
    ],
  });
  const session = parsed.windows.find((window) => window.label === '5 hours');
  const week = parsed.windows.find((window) => window.label === 'Week');
  const fable = parsed.windows.find((window) => window.label === 'Fable');
  assert.equal(parsed.windows.filter((window) => window.label === '5 hours').length, 1);
  assert.equal(session.usedPercent, 20);
  assert.equal(week.usedPercent, 1);
  assert.equal(fable.usedPercent, 6);
  assert.equal(fable.key, 'weekly_scoped:Fable');
  assert.equal(fable.resetsAt, '2026-10-18T22:00:00.000Z');
});

test('claude uses an active scoped limit when the same name appears twice', () => {
  const parsed = parseClaudeUsage({
    limits: [
      { kind: 'weekly_scoped', percent: 4, scope: { model: { display_name: 'Fable' } }, is_active: false, resets_at: '2026-10-18T22:00:00Z' },
      { kind: 'weekly_scoped', percent: 9, scope: { model: { display_name: 'Fable' } }, is_active: true, resets_at: '2026-10-18T22:00:00Z' },
    ],
  });
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.windows[0].label, 'Fable');
  assert.equal(parsed.windows[0].usedPercent, 9);
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

test('minimax names Max from a 3-a-day video allowance when no title is sent', () => {
  const parsed = parseMiniMax({
    model_remains: [
      {
        model_name: 'general',
        start_time: 1791144000000,
        end_time: 1791158400000,
        current_interval_total_count: 0,
        current_interval_usage_count: 0,
        current_interval_remaining_percent: 99,
        current_weekly_remaining_percent: 71,
        weekly_end_time: 1791158400000,
      },
      {
        model_name: 'video',
        start_time: 1791072000000,
        end_time: 1791158400000,
        current_interval_total_count: 3,
        current_interval_usage_count: 0,
        current_interval_status: 1,
      },
    ],
  });
  assert.equal(parsed.plan, 'Max');
  assert.equal(parsed.windows[0].usedPercent, 1);
  assert.equal(parsed.windows[1].usedPercent, 29);
});

test('minimax names Plus and Ultra from the video allowance, and keeps an explicit title', () => {
  const plus = parseMiniMax({
    model_remains: [
      { model_name: 'general', current_interval_remaining_percent: 80, current_weekly_remaining_percent: 40 },
      { model_name: 'video', current_interval_total_count: 0, current_interval_status: 3 },
    ],
  });
  assert.equal(plus.plan, 'Plus');
  const ultra = parseMiniMax({
    model_remains: [{
      model_name: 'video',
      start_time: 1791072000000,
      end_time: 1791158400000,
      current_interval_total_count: 5,
    }],
  });
  assert.equal(ultra.plan, 'Ultra');
  const named = parseMiniMax({
    current_subscribe_title: 'Token Plan Team',
    model_remains: [{
      model_name: 'video',
      start_time: 1791072000000,
      end_time: 1791158400000,
      current_interval_total_count: 5,
    }],
  });
  assert.equal(named.plan, 'Token Plan Team');
  const fiveHourBucket = parseMiniMax({
    model_remains: [{
      model_name: 'video',
      start_time: 1791144000000,
      end_time: 1791162000000,
      current_interval_total_count: 3,
    }],
  });
  assert.equal(fiveHourBucket.plan, null);
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

test('cursor percent fields keep small percentages on the 0–100 scale', () => {
  const parsed = parseCursorSummary({
    individualUsage: { plan: { autoPercentUsed: 1, apiPercentUsed: 0.5 } },
  });
  assert.deepEqual(parsed.windows.map((window) => window.usedPercent), [1, 0.5]);
  const total = parseCursorSummary({ individualUsage: { plan: { totalPercentUsed: 1 } } });
  assert.equal(total.windows[0].usedPercent, 1);
});

test('copilot one percent remaining is nearly exhausted', () => {
  const parsed = parseCopilotUsage({
    quota_snapshots: { premium_interactions: { percent_remaining: 1 } },
  });
  assert.equal(parsed.windows[0].usedPercent, 99);
});

test('gemini quota remaining fraction becomes used percent', () => {
  const parsed = parseGeminiQuota(
    { buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.25, resetTime: '2026-09-19T00:00:00.000Z' }] },
    { currentTier: { name: 'Free' } },
  );
  assert.equal(parsed.plan, 'Free');
  assert.equal(parsed.windows[0].label, 'Gemini 2.5 Pro');
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
          { bucketId: '3p-5h', window: '5h', remainingFraction: 0.008 },
        ],
      },
    ],
  });
  assert.deepEqual(parsed.windows.map((window) => window.label), ['Gemini week', 'Gemini 5 hours', 'Claude & GPT week', 'Claude & GPT 5 hours']);
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

test('muse keeps a real week when only the 5-hour window has reset', () => {
  const { museUsageAfterWindowReset } = require('./parse.cjs');
  const now = Date.parse('2026-10-04T22:00:00.000Z');
  const carried = museUsageAfterWindowReset({
    savedAt: '2026-10-04T18:00:00.000Z',
    windows: [
      { key: 'window', label: '5 hours', usedPercent: 80, resetsAt: '2026-10-04T20:00:00.000Z' },
      { key: 'weekly', label: 'Week', usedPercent: 99, resetsAt: '2026-10-05T00:00:00.000Z' },
    ],
  }, now);
  assert.equal(carried[0].usedPercent, 0);
  assert.equal(carried[0].label, '5 hours');
  assert.equal(carried[1].usedPercent, 99);
  const stillOpen = museUsageAfterWindowReset({
    windows: [
      { key: 'window', label: '5 hours', usedPercent: 12, resetsAt: '2026-10-04T23:00:00.000Z' },
      { key: 'weekly', label: 'Week', usedPercent: 99, resetsAt: '2026-10-05T00:00:00.000Z' },
    ],
  }, now);
  assert.equal(stillOpen[0].usedPercent, 12);
  assert.equal(museUsageAfterWindowReset({
    windows: [
      { key: 'window', label: '5 hours', usedPercent: 0, resetsAt: '2026-10-04T21:00:00.000Z' },
      { key: 'weekly', label: 'Week', usedPercent: 99, resetsAt: '2026-10-04T21:00:00.000Z' },
    ],
  }, now), null);
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

// A real /zen/go/v1/usage body. percent is the share already spent.
test('opencode go keeps the 5-hour, weekly, and monthly windows', () => {
  const parsed = parseOpenCodeGoUsage({
    usage: {
      rolling: { status: 'ok', percent: 1, resetsAt: '2026-10-29T05:39:42.000Z' },
      weekly: { status: 'ok', percent: 22, resetsAt: '2026-11-02T00:00:00.000Z' },
      monthly: { status: 'ok', percent: 11, resetsAt: '2026-11-28T07:22:04.000Z' },
    },
  });
  assert.deepEqual(parsed.windows.map((window) => window.label), ['5 hours', 'Week', 'Month']);
  // A bare 1 is one percent spent, not a full window.
  assert.equal(parsed.windows[0].usedPercent, 1);
  assert.equal(parsed.windows[1].usedPercent, 22);
  assert.equal(parsed.windows[2].resetsAt, '2026-11-28T07:22:04.000Z');
  assert.equal(parsed.plan, 'Go');
});

test('opencode without a usage block reports no windows', () => {
  const parsed = parseOpenCodeGoUsage({});
  assert.deepEqual(parsed.windows, []);
  assert.equal(parsed.plan, null);
});

test('deepseek balance is an amount, never a percent', () => {
  const parsed = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [{ currency: 'USD', total_balance: '9.88', granted_balance: '0.00', topped_up_balance: '9.88' }],
  });
  assert.equal(parsed.windows.length, 1);
  const [window] = parsed.windows;
  assert.equal(window.unit, 'balance');
  assert.equal(window.label, 'Balance');
  assert.equal(window.amount, 9.88);
  assert.equal(window.currency, 'USD');
  assert.equal(window.usedPercent, null);
});

test('deepseek with two currencies labels each balance', () => {
  const parsed = parseDeepSeekBalance({
    balance_infos: [
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
      { currency: 'USD', total_balance: '1.50', granted_balance: '0', topped_up_balance: '1.50' },
    ],
  });
  assert.deepEqual(parsed.windows.map((window) => window.label), ['Balance CNY', 'Balance USD']);
  assert.equal(parsed.windows[0].granted, 10);
});

test('openrouter credits measure what is left of everything bought', () => {
  const parsed = parseOpenRouterCredits({ data: { total_credits: 100.5, total_usage: 25.75 } });
  const [window] = parsed.windows;
  assert.equal(window.unit, 'dollars');
  assert.equal(window.limit, 100.5);
  assert.equal(window.used, 25.75);
  assert.equal(Math.round(window.usedPercent), 26);
});

test('openrouter with no credits bought shows an empty balance', () => {
  const parsed = parseOpenRouterCredits({ data: { total_credits: 0, total_usage: 0 } });
  assert.equal(parsed.windows[0].unit, 'balance');
  assert.equal(parsed.windows[0].amount, 0);
});

test('openrouter regular key shows its own monthly limit', () => {
  const parsed = parseOpenRouterKey({
    data: { label: 'sk-or-v1-abc...xyz', limit: 100, limit_remaining: 74.5, limit_reset: 'monthly', usage: 25.5, is_free_tier: false },
  });
  const [window] = parsed.windows;
  assert.equal(window.label, 'Month');
  assert.equal(window.limit, 100);
  assert.equal(window.used, 25.5);
  assert.equal(parsed.note, null);
});

test('openrouter key budget wins over the plain limit', () => {
  const parsed = parseOpenRouterKey({
    data: {
      limit: 100,
      limit_remaining: 74.5,
      effective_budget: { limit_usd: 20, spend_usd: 5, remaining_usd: 15, reset_interval: 'weekly', resets_at: '2026-11-02T00:00:00Z' },
    },
  });
  const [window] = parsed.windows;
  assert.equal(window.label, 'Week');
  assert.equal(window.limit, 20);
  assert.equal(window.used, 5);
  assert.equal(window.resetsAt, '2026-11-02T00:00:00.000Z');
});

test('openrouter key without a limit explains how to see credits', () => {
  const parsed = parseOpenRouterKey({ data: { limit: null, limit_remaining: null, usage: 3.2, is_free_tier: false } });
  assert.deepEqual(parsed.windows, []);
  assert.match(parsed.note, /\$3\.20/);
  assert.match(parsed.note, /management key/);
});

test('openrouter free tier counts the free requests left today', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const parsed = parseOpenRouterKey({
    data: { limit: null, usage: 0, is_free_tier: true, free_model_daily_requests: { used: 12, limit: 50, remaining: 38 } },
  }, now);
  const [window] = parsed.windows;
  assert.equal(window.label, 'Free today');
  assert.equal(window.unit, 'count');
  assert.equal(window.used, 12);
  assert.equal(window.resetsAt, '2026-10-29T00:00:00.000Z');
  assert.equal(parsed.plan, 'Free');
});

test('opencode auth file gives the first saved key by name', () => {
  const data = {
    deepseek: { type: 'api', key: 'sk-deep' },
    'opencode-go': { type: 'api', key: 'sk-go' },
    opencode: { type: 'api', key: 'sk-zen' },
    anthropic: { type: 'oauth', access: 'x' },
  };
  assert.deepEqual(extractOpenCodeKey(data, ['opencode-go', 'opencode']), { name: 'opencode-go', key: 'sk-go' });
  assert.deepEqual(extractOpenCodeKey(data, ['deepseek']), { name: 'deepseek', key: 'sk-deep' });
  assert.equal(extractOpenCodeKey(data, ['openrouter']), null);
  assert.equal(extractOpenCodeKey({ anthropic: { type: 'oauth', key: 'nope' } }, ['anthropic']), null);
});

// The live Antigravity shape (structure only): the summary knows just the
// Claude & GPT pool, the catalog carries a quota for every model.
const AG_WEEK_RESET = '2026-10-31T07:00:00Z';
const AG_GEMINI_RESET = '2026-10-28T12:00:00Z';
const AG_SUMMARY = {
  groups: [{
    displayName: 'Claude and GPT models',
    description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
    buckets: [
      { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0, resetTime: AG_WEEK_RESET },
      { bucketId: '3p-5h', window: '5h', remainingFraction: 1, disabled: true },
    ],
  }],
};
const AG_CATALOG = {
  tabModelIds: ['tab_flash_lite_preview'],
  models: {
    'claude-sonnet-5-5': { displayName: 'Claude Sonnet 5.5', modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { resetTime: AG_WEEK_RESET } },
    'claude-opus-5-5-thinking': { displayName: 'Claude Opus 5.5 (High)', modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { resetTime: AG_WEEK_RESET } },
    'claude-opus-5-5': { displayName: 'Claude Opus 5.5 (Low)', modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { resetTime: AG_WEEK_RESET } },
    'gpt-oss-120b': { displayName: 'GPT-OSS 120B', modelProvider: 'MODEL_PROVIDER_OPENAI', quotaInfo: { resetTime: AG_WEEK_RESET } },
    'gemini-3-flash': { displayName: 'Gemini 3 Flash', modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0.9993, resetTime: AG_GEMINI_RESET } },
    'gemini-3-5-flash': { displayName: 'Gemini 3.5 Flash', modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0.9993, resetTime: AG_GEMINI_RESET } },
    'gemini-2-5-pro': { displayName: 'Gemini 2.5 Pro', modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0.6, resetTime: '2026-10-28T10:00:00Z' } },
    tab_flash_lite_preview: { displayName: 'Tab', quotaInfo: { remainingFraction: 1 } },
    chat_20706: { displayName: 'Internal chat', quotaInfo: { remainingFraction: 1 } },
    'internal-x': { displayName: 'Internal', isInternal: true, quotaInfo: { remainingFraction: 1 } },
  },
};

test('gemini shows every Antigravity model: the summary pool plus per-model pools', () => {
  const parsed = parseGeminiQuota(AG_SUMMARY, { currentTier: { name: 'Antigravity' }, paidTier: { name: 'Google AI Pro' } }, AG_CATALOG);
  assert.equal(parsed.plan, 'Google AI Pro');
  assert.deepEqual(parsed.windows.map((window) => window.label), ['Claude & GPT week', 'Claude & GPT 5 hours', 'Gemini 2.5 Pro', 'Gemini models']);
  const [week, fiveHours, pro, flash] = parsed.windows;
  // A spent model omits remainingFraction; it is 0 left, so it joins the spent week.
  assert.equal(week.usedPercent, 100);
  assert.deepEqual(week.models, ['Claude Sonnet 5.5', 'Claude Opus 5.5', 'GPT-OSS 120B']);
  // The disabled 5-hour bucket is paused, not "100% left".
  assert.equal(fiveHours.paused, true);
  assert.equal(pro.usedPercent, 40);
  assert.equal(pro.models, undefined);
  assert.deepEqual(flash.models, ['Gemini 3.5 Flash', 'Gemini 3 Flash']);
  assert.ok(Math.abs(flash.usedPercent - 0.07) < 0.001);
  // Tab, internal and chat_ models are not quotas a person spends.
  assert.equal(parsed.modelCount, 7);
  assert.equal(parsed.windows.some((window) => /tab|internal/i.test(window.label)), false);
});

test('gemini keeps a model pool the summary does not cover as its own row', () => {
  const catalog = { models: { 'claude-sonnet-5-5': { displayName: 'Claude Sonnet 5.5', modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { remainingFraction: 0.5, resetTime: '2026-10-29T00:00:00Z' } } } };
  const parsed = parseGeminiQuota(AG_SUMMARY, {}, catalog);
  assert.deepEqual(parsed.windows.map((window) => window.label), ['Claude & GPT week', 'Claude & GPT 5 hours', 'Claude Sonnet 5.5']);
  // The week still lists the families its description names.
  assert.deepEqual(parsed.windows[0].models, ['Claude Opus', 'Claude Sonnet', 'GPT-OSS']);
  assert.equal(parsed.windows[2].usedPercent, 50);
});

test('gemini legacy per-model buckets still pool by fraction and reset', () => {
  const parsed = parseGeminiQuota(null, { currentTier: { name: 'Free' } }, {
    buckets: [
      { modelId: 'gemini-2.5-flash', remainingFraction: 0.5, resetTime: '2026-10-29T00:00:00Z' },
      { modelId: 'gemini-2.5-flash-lite', remainingFraction: 0.5, resetTime: '2026-10-29T00:00:00Z' },
      { modelId: 'gemini-2.5-pro', remainingFraction: 1, resetTime: '2026-10-29T00:00:00Z' },
    ],
  });
  assert.equal(parsed.plan, 'Free');
  assert.equal(parsed.modelCount, 3);
  assert.deepEqual(parsed.windows.map((window) => window.label), ['Gemini 2.5 Pro', 'Gemini models']);
  assert.deepEqual(parsed.windows[1].models, ['Gemini 2.5 Flash Lite', 'Gemini 2.5 Flash']);
});

test('codex shows the code review and per-model limits next to the main windows', () => {
  const parsed = parseCodexUsage({
    plan_type: 'pro',
    rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: 1780000000 } },
    code_review_rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 1780500000 } },
    additional_rate_limits: [{
      limit_name: 'GPT-5.5 Codex Spark',
      metered_feature: 'codex_spark',
      rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_at: 1780000000 },
        secondary_window: { used_percent: 5, limit_window_seconds: 604800, reset_at: 1780500000 },
      },
    }],
  });
  const labels = parsed.windows.map((window) => window.label);
  assert.ok(labels.includes('Code review week'), labels.join(', '));
  assert.ok(labels.includes('GPT-5.5 Codex Spark 5 hours'), labels.join(', '));
  assert.ok(labels.includes('GPT-5.5 Codex Spark week'), labels.join(', '));
  assert.equal(parsed.windows.find((window) => window.label === 'GPT-5.5 Codex Spark 5 hours').usedPercent, 40);
});

test('copilot reads the monthly reset date and the GitHub login', () => {
  const parsed = parseCopilotUsage({
    copilot_plan: 'individual',
    login: 'octocat',
    quota_reset_date: '2026-11-01',
    quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
    quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 90, percent_remaining: 30 } },
  });
  assert.equal(parsed.identity, 'octocat');
  assert.equal(parsed.windows[0].resetsAt, '2026-11-01T00:00:00.000Z');
});

test('minimax adds the video allowance as its own count windows', () => {
  const parsed = parseMiniMax({
    model_remains: [
      {
        model_name: 'general',
        current_interval_total_count: 1500,
        current_interval_usage_count: 1440,
        end_time: 1790000000000,
      },
      {
        model_name: 'video',
        start_time: 1789920000000,
        end_time: 1790006400000,
        current_interval_total_count: 3,
        current_interval_remaining_percent: 100,
        weekly_start_time: 1789488000000,
        weekly_end_time: 1790092800000,
        current_weekly_total_count: 21,
        current_weekly_remaining_percent: 100,
      },
    ],
  });
  const video = parsed.windows.filter((window) => /^Video/.test(window.label));
  assert.deepEqual(video.map((window) => window.label), ['Video day', 'Video week']);
  assert.equal(video[0].unit, 'count');
  assert.equal(video[0].limit, 3);
  assert.equal(video[0].used, 0);
});

test('kimi code reads the rolling limits and the weekly usage, strings and all', () => {
  const parsed = parseKimiCodeUsage({
    usage: { limit: '2000', used: '620', remaining: '1380', resetTime: '2026-11-01T00:00:00Z' },
    limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '18', remaining: '82', resetTime: '2026-10-28T08:00:00Z' } }],
  });
  assert.equal(parsed.plan, 'Kimi Code');
  assert.deepEqual(parsed.windows.map((window) => window.label), ['5 hours', 'Week']);
  assert.equal(parsed.windows[0].used, 18);
  assert.equal(parsed.windows[0].limit, 100);
  assert.equal(parsed.windows[1].usedPercent, 31);
  assert.equal(parseKimiCodeUsage({}).windows.length, 0);
});

test('moonshot balance counts the voucher as granted, in the host currency', () => {
  const body = { code: 0, data: { available_balance: 18.4, voucher_balance: 5, cash_balance: 13.4 }, scode: '0x0', status: true };
  const usd = parseMoonshotBalance(body);
  assert.equal(usd.windows[0].unit, 'balance');
  assert.equal(usd.windows[0].amount, 18.4);
  assert.equal(usd.windows[0].granted, 5);
  assert.equal(usd.windows[0].currency, 'USD');
  assert.equal(parseMoonshotBalance(body, 'CNY').windows[0].currency, 'CNY');
});

test('z.ai turns the token window and the MCP allowance into windows', () => {
  const parsed = parseZaiQuota({
    code: 200,
    success: true,
    data: {
      level: 'pro',
      limits: [
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 12, nextResetTime: 1790000000000 },
        { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 40, remaining: 960, percentage: 4, nextResetTime: 1791000000000 },
      ],
    },
  });
  assert.equal(parsed.plan, 'GLM Pro');
  assert.deepEqual(parsed.windows.map((window) => window.label), ['5 hours', 'MCP calls']);
  assert.equal(parsed.windows[0].usedPercent, 12);
  assert.equal(parsed.windows[1].used, 40);
  assert.equal(parsed.windows[1].limit, 1000);
});

test('vercel, poe and siliconflow balances', () => {
  const vercel = parseVercelCredits({ balance: '95.50', total_used: '4.50' });
  assert.equal(vercel.windows[0].amount, 95.5);
  assert.equal(vercel.plan, 'AI Gateway');
  const poe = parsePoeBalance({ current_point_balance: 812400 });
  assert.equal(poe.windows[0].amount, 812400);
  assert.equal(poe.windows[0].format, 'points');
  const silicon = parseSiliconFlowInfo({ code: 20000, status: true, data: { name: 'ada', email: 'ada@example.com', balance: '1.00', chargeBalance: '9.00', totalBalance: '10.00' } }, 'CNY');
  assert.equal(silicon.windows[0].amount, 10);
  assert.equal(silicon.windows[0].granted, 1);
  assert.equal(silicon.windows[0].currency, 'CNY');
  assert.equal(silicon.identity, 'ada@example.com');
  assert.equal(parseVercelCredits({}).windows.length, 0);
});

test('minimax reads remaining percent as 0-100, so 1 is one percent left', () => {
  const parsed = parseMiniMax({
    model_remains: [
      { model_name: 'general', current_interval_remaining_percent: 1, current_weekly_remaining_percent: 0, weekly_end_time: 1791158400000 },
    ],
  });
  assert.equal(parsed.windows[0].usedPercent, 99);
  assert.equal(parsed.windows[1].usedPercent, 100);
});
