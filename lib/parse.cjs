function asNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pick(object, ...keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (object[key] != null) return object[key];
  }
  return undefined;
}

function clampPercent(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.min(100, Math.max(0, value));
}

// Values at or below 1 are fractions (0.34 = 34%). Larger values are already percents.
function normalizeUtilization(value) {
  const number = asNumber(value);
  if (number == null) return null;
  if (number < 0) return 0;
  if (number <= 1) return clampPercent(number * 100);
  return clampPercent(number);
}

function toIso(value) {
  if (value == null || value === '' || value === 0) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const number = asNumber(value);
  if (number == null || number <= 0) return null;
  const milliseconds = number < 1e12 ? number * 1000 : number;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function labelFromSeconds(seconds) {
  const value = asNumber(seconds);
  if (value == null) return 'Usage';
  if (value >= 4.5 * 3600 && value <= 5.5 * 3600) return '5 hours';
  if (value >= 6 * 24 * 3600 && value <= 8 * 24 * 3600) return 'Week';
  if (value >= 27 * 24 * 3600 && value <= 32 * 24 * 3600) return 'Month';
  const hours = Math.round(value / 3600);
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

function labelFromPeriod(start, end) {
  const startMs = start ? new Date(start).getTime() : NaN;
  const endMs = end ? new Date(end).getTime() : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return labelFromSeconds((endMs - startMs) / 1000);
}

function makeWindow({ key, label, usedPercent, used = null, limit = null, unit = 'percent', resetsAt = null, resetsInMs = null }) {
  return {
    key,
    label,
    usedPercent: usedPercent == null ? null : clampPercent(usedPercent),
    used,
    limit,
    unit,
    resetsAt,
    resetsInMs: asNumber(resetsInMs),
  };
}

function windowFromUsedPercent(key, label, usedPercent, resetsAt) {
  const used = normalizeUtilization(usedPercent);
  if (used == null) return null;
  return makeWindow({ key, label, usedPercent: used, resetsAt: toIso(resetsAt) });
}

// For providers that publish 0-100 on the wire. Never run these through
// normalizeUtilization: it reads a bare 1 as a fraction, which would turn
// "one percent used" into "the window is empty".
function windowFromPercent(key, label, usedPercent, resetsAt) {
  const used = asNumber(usedPercent);
  if (used == null) return null;
  return makeWindow({ key, label, usedPercent: clampPercent(used), resetsAt: toIso(resetsAt) });
}

function dollarsFromMinor(value) {
  const number = asNumber(value);
  if (number == null) return null;
  return number / 100;
}

function claudeLimits(source) {
  if (Array.isArray(source.limits)) return source.limits;
  const nested = source.rate_limits || source.rateLimits;
  if (Array.isArray(nested?.limits)) return nested.limits;
  return [];
}

function claudeLimitLabel(item) {
  const model = String(item?.scope?.model?.display_name || '').trim();
  const kind = String(item?.kind || item?.group || '').toLowerCase();
  if (kind === 'session' || kind === 'five_hour') return '5 hours';
  if (model) return model;
  if (kind === 'weekly' || kind === 'weekly_all' || kind === 'seven_day' || kind === 'weekly_scoped') return 'Week';
  if (!kind) return 'Usage';
  return kind.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function windowFromClaudeLimit(item) {
  if (!item || typeof item !== 'object') return null;
  const label = claudeLimitLabel(item);
  const model = String(item?.scope?.model?.display_name || '').trim();
  const kind = String(item?.kind || item?.group || label);
  const key = model ? `${kind}:${model}` : kind;
  const resets = pick(item, 'resets_at', 'resetsAt');
  if (item.percent != null || item.used_percent != null || item.usedPercent != null) {
    return windowFromPercent(key, label, pick(item, 'percent', 'used_percent', 'usedPercent'), resets);
  }
  return windowFromUsedPercent(key, label, pick(item, 'utilization', 'used_percentage'), resets);
}

function parseClaudeUsage(json) {
  const source = json || {};
  const windows = [];
  const seen = new Set();

  function add(window, options = {}) {
    if (!window) return;
    if (seen.has(window.label)) {
      if (!options.replace) return;
      const index = windows.findIndex((item) => item.label === window.label && item.key === window.key);
      if (index >= 0) windows[index] = window;
      return;
    }
    seen.add(window.label);
    windows.push(window);
  }

  const fiveHour = source.five_hour || source.fiveHour;
  if (fiveHour) {
    add(windowFromUsedPercent('five_hour', '5 hours', pick(fiveHour, 'utilization', 'used_percent', 'usedPercent'), pick(fiveHour, 'resets_at', 'resetsAt')));
  }
  const week = source.seven_day || source.sevenDay;
  if (week) {
    add(windowFromUsedPercent('seven_day', 'Week', pick(week, 'utilization', 'used_percent', 'usedPercent'), pick(week, 'resets_at', 'resetsAt')));
  }

  const named = [
    ['seven_day_sonnet', 'Sonnet week'],
    ['seven_day_opus', 'Opus week'],
    ['seven_day_oauth_apps', 'Apps week'],
    ['seven_day_cowork', 'Cowork week'],
  ];
  for (const [key, label] of named) {
    const bucket = source[key];
    if (!bucket || bucket.utilization == null) continue;
    if (bucket.utilization === 0 && !bucket.resets_at) continue;
    add(windowFromUsedPercent(key, label, bucket.utilization, bucket.resets_at));
  }

  // `is_active` marks the limit that is binding right now. Claude still returns
  // the other caps, including a weekly Fable row, with is_active false.
  const limits = claudeLimits(source);
  for (const item of limits) {
    const window = windowFromClaudeLimit(item);
    add(window, { replace: item?.is_active === true });
  }

  const extra = source.extra_usage || source.extraUsage;
  if (extra && (extra.is_enabled || extra.used_credits != null || extra.monthly_limit != null)) {
    const used = dollarsFromMinor(extra.used_credits);
    const limit = dollarsFromMinor(extra.monthly_limit);
    let usedPercent = normalizeUtilization(extra.utilization);
    if (usedPercent == null && used != null && limit) usedPercent = (used / limit) * 100;
    if (usedPercent != null || (used != null && limit != null)) {
      windows.push(makeWindow({
        key: 'extra',
        label: 'Extra',
        usedPercent,
        used,
        limit,
        unit: 'dollars',
        resetsAt: null,
      }));
    }
  }

  return { windows, plan: null, identity: null };
}

function parseCodexWindow(key, fallbackLabel, window) {
  if (!window || typeof window !== 'object') return null;
  const seconds = pick(window, 'limit_window_seconds', 'limitWindowSeconds', 'window_seconds');
  const derived = labelFromSeconds(seconds);
  const label = derived === 'Usage' ? fallbackLabel : derived;
  const used = pick(window, 'used_percent', 'usedPercent');
  const resets = pick(window, 'reset_at', 'resetAt', 'resets_at', 'resetsAt');
  return windowFromPercent(key, label, used, resets);
}

function parseCodexUsage(json) {
  const source = json || {};
  const rate = source.rate_limit || source.rateLimit || source;
  const windows = [];
  const primary = parseCodexWindow('primary', '5 hours', rate.primary_window || rate.primaryWindow || rate.primary);
  const secondary = parseCodexWindow('secondary', 'Week', rate.secondary_window || rate.secondaryWindow || rate.secondary);
  if (primary) windows.push(primary);
  if (secondary) windows.push(secondary);

  // Code review and some models (additional_rate_limits, one entry per
  // limit_name) carry their own 5-hour and weekly windows next to the main one.
  const extra = [];
  const review = source.code_review_rate_limit || source.codeReviewRateLimit;
  if (review && typeof review === 'object') extra.push({ name: 'Code review', id: 'code-review', rate: review });
  const additional = source.additional_rate_limits || source.additionalRateLimits;
  if (Array.isArray(additional)) {
    for (const item of additional) {
      if (!item || typeof item !== 'object') continue;
      const name = String(pick(item, 'limit_name', 'limitName', 'metered_feature', 'meteredFeature') || '').trim();
      const rate = item.rate_limit || item.rateLimit;
      if (name && rate && typeof rate === 'object') extra.push({ name, id: name, rate });
    }
  }
  for (const { name, id, rate } of extra) {
    for (const [slot, fallback] of [['primary', '5 hours'], ['secondary', 'Week']]) {
      const window = parseCodexWindow(`${id}:${slot}`, fallback, rate[`${slot}_window`] || rate[`${slot}Window`] || rate[slot]);
      if (!window) continue;
      window.label = `${name} ${window.label === 'Week' ? 'week' : window.label}`;
      windows.push(window);
    }
  }

  // Only surface credits when the account actually has some. Every plan without a
  // credit purchase reports balance "0" with has_credits false, and an always-zero
  // "Credits 0 left" line is noise, not usage.
  const credits = source.credits || rate.credits;
  const hasCredits = pick(credits || {}, 'has_credits', 'hasCredits', 'enabled');
  const balance = asNumber(pick(credits || {}, 'balance', 'remaining'));
  if (balance != null && balance > 0 && hasCredits !== false) {
    windows.push(makeWindow({
      key: 'credits',
      label: 'Credits',
      usedPercent: null,
      used: null,
      limit: balance,
      unit: 'credits',
      resetsAt: null,
    }));
  }

  const plan = pick(source, 'plan_type', 'planType') || pick(rate, 'plan_type', 'planType') || null;
  return {
    windows,
    plan: plan ? String(plan) : null,
    identity: null,
  };
}

function periodLabel(start, end, fallback) {
  return labelFromPeriod(toIso(start), toIso(end)) || fallback;
}

function grokPercent(value) {
  const number = asNumber(value);
  if (number == null || number < 0) return null;
  // Grok publishes 0–100 on the wire. Do not treat 1% as a fraction.
  return clampPercent(number);
}

function grokProductLabel(name) {
  const text = String(name || '').trim();
  if (!text) return 'Credits';
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGrokBilling(json) {
  const source = json || {};
  const config = source.config && typeof source.config === 'object' ? source.config : source;
  const usage = source.usage && typeof source.usage === 'object' ? source.usage : config.usage;
  let usedPercent = grokPercent(pick(config, 'creditUsagePercent', 'credit_usage_percent', 'usedPercent', 'usagePercent'));
  if (usedPercent == null && usage) {
    const used = asNumber(usage.totalUsed?.val ?? usage.total_used?.val ?? usage.totalUsed ?? usage.includedUsed?.val);
    const limit = asNumber(source.monthlyLimit?.val ?? source.monthly_limit?.val ?? config.monthlyLimit?.val ?? config.monthlyLimit);
    if (used != null && limit) usedPercent = (used / limit) * 100;
  }
  if (usedPercent == null && config.onDemandUsed && config.onDemandCap) {
    const used = asNumber(config.onDemandUsed.val ?? config.onDemandUsed);
    const limit = asNumber(config.onDemandCap.val ?? config.onDemandCap);
    if (used != null && limit > 0) usedPercent = (used / limit) * 100;
  }

  const period = config.currentPeriod || config.current_period || source.billingCycle || source.billing_cycle || {};
  const start = pick(period, 'start', 'billingPeriodStart', 'billing_period_start')
    || pick(config, 'billingPeriodStart', 'billing_period_start');
  const end = pick(period, 'end', 'billingPeriodEnd', 'billing_period_end')
    || pick(config, 'billingPeriodEnd', 'billing_period_end');
  const label = periodLabel(start, end, 'Credits');
  const resetsAt = toIso(end);
  const windows = [];

  function addCredits(percent) {
    windows.push(makeWindow({
      key: 'credits',
      label,
      usedPercent: percent,
      unit: 'percent',
      resetsAt,
    }));
  }

  if (usedPercent != null) addCredits(usedPercent);

  const products = config.productUsage || config.product_usage || source.productUsage || source.product_usage;
  const productWindows = [];
  if (Array.isArray(products)) {
    const seen = new Set();
    for (const product of products) {
      if (!product || typeof product !== 'object') continue;
      const percent = grokPercent(pick(product, 'usagePercent', 'usage_percent', 'creditUsagePercent', 'credit_usage_percent'));
      if (percent == null) continue;
      const name = pick(product, 'product', 'name', 'label') || 'Credits';
      const key = `product:${String(name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      productWindows.push(makeWindow({
        key,
        label: grokProductLabel(name),
        usedPercent: percent,
        unit: 'percent',
        resetsAt,
      }));
    }
  }

  // Unified plans meter a single shared credit pool. productUsage is only a
  // breakdown of that pool, so the rows add back up to creditUsagePercent and
  // each one is a slice of the same budget. Drawing them as separate meters
  // shows four bars for one pool and implies four independent allowances.
  // Keep the rows only when they are genuinely separate quotas.
  const unified = config.isUnifiedBillingUser === true || config.is_unified_billing_user === true;
  const breakdownOfSamePool = unified && (
    usedPercent == null
    || Math.abs(productWindows.reduce((sum, window) => sum + window.usedPercent, 0) - usedPercent) <= 1
  );
  if (!breakdownOfSamePool) windows.push(...productWindows);

  // Unified SuperGrok periods often omit creditUsagePercent when usage is still
  // zero (proto3 default). A dated current period means the meter is active.
  if (!windows.length) {
    const periodType = String(pick(period, 'type') || '');
    const dated = Boolean(toIso(start) && resetsAt);
    if (dated && (unified || /USAGE_PERIOD_TYPE_(WEEKLY|MONTHLY)/i.test(periodType))) {
      addCredits(0);
    }
  }

  const plan = pick(config, 'subscriptionTier', 'subscription_tier', 'subscription_tier_display')
    || pick(source, 'subscription_tier_display', 'subscriptionTier')
    || null;

  return {
    windows,
    plan: plan ? String(plan).replace(/_/g, ' ') : null,
    identity: null,
    hasUsage: windows.length > 0,
  };
}

function collectRateRows(node, label, into, depth) {
  if (!node || typeof node !== 'object' || depth > 5) return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRateRows(item, item?.model || item?.modelName || item?.name || label || `Model ${index + 1}`, into, depth + 1));
    return;
  }
  const remaining = asNumber(pick(node, 'remaining', 'remainingQueries', 'remaining_queries', 'requests_remaining', 'queriesRemaining'));
  const limit = asNumber(pick(node, 'limit', 'total', 'totalQueries', 'total_queries', 'requests_limit', 'queriesLimit'));
  if (remaining != null && limit != null && limit > 0) {
    const seconds = pick(node, 'windowSizeSeconds', 'window_size_seconds', 'limit_window_seconds');
    const name = pick(node, 'model', 'modelName', 'name', 'queryType') || label || labelFromSeconds(seconds);
    into.push(makeWindow({
      key: String(name),
      label: String(name),
      usedPercent: ((limit - remaining) / limit) * 100,
      used: Math.max(0, limit - remaining),
      limit,
      unit: 'count',
      resetsAt: toIso(pick(node, 'resetAt', 'reset_at', 'resets_at')),
    }));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') collectRateRows(value, key, into, depth + 1);
  }
}

function parseGrokRateLimits(json) {
  const windows = [];
  collectRateRows(json, null, windows, 0);
  const unique = [];
  const seen = new Set();
  for (const window of windows) {
    const stamp = `${window.label}:${window.limit}:${window.used}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    unique.push(window);
  }
  return { windows: unique, plan: null, identity: null };
}

function miniMaxCounts(total, usageCount, remainingPercent, countsAre) {
  const limit = asNumber(total);
  const raw = asNumber(usageCount);
  const percent = asNumber(remainingPercent);
  if (limit != null && limit > 0 && raw != null) {
    const remaining = countsAre === 'used' ? Math.max(0, limit - raw) : raw;
    const used = countsAre === 'used' ? raw : Math.max(0, limit - raw);
    return {
      used,
      limit,
      usedPercent: (used / limit) * 100,
    };
  }
  if (percent != null) {
    const remainingPct = percent <= 1 ? percent * 100 : percent;
    return {
      used: null,
      limit: null,
      usedPercent: 100 - remainingPct,
    };
  }
  return null;
}

function pickMiniMaxRow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const text = rows.filter((row) => /general|chat|text|minimax-m/i.test(row.model_name || row.modelName || ''));
  const pool = text.length ? text : rows.filter((row) => !/video|image|speech|tts|music/i.test(row.model_name || ''));
  return (pool.length ? pool : rows)[0];
}

function spanMs(start, end) {
  if (start == null || end == null || end <= start) return null;
  const delta = end - start;
  return delta >= 1e6 ? delta : delta * 1000;
}

// Token Plan remains replies name the buckets, not the subscription. The public
// tiers are separated by the video allowance: Plus has none, Max is 3 a day,
// Ultra is 5 a day. An explicit title always wins when MiniMax sends one.
function inferMiniMaxPlan(rows) {
  const video = (rows || []).find((row) => /video/i.test(row?.model_name || row?.modelName || ''));
  if (!video) return null;
  const daily = asNumber(pick(video, 'current_interval_total_count', 'currentIntervalTotalCount'));
  const status = asNumber(pick(video, 'current_interval_status', 'currentIntervalStatus'));
  const span = spanMs(
    asNumber(pick(video, 'start_time', 'startTime')),
    asNumber(pick(video, 'end_time', 'endTime')),
  );
  const day = span != null && span >= 20 * 3600 * 1000 && span <= 28 * 3600 * 1000;
  if (day && daily === 3) return 'Max';
  if (day && daily === 5) return 'Ultra';
  if ((daily === 0 || daily == null) && status === 3) return 'Plus';
  return null;
}

function parseMiniMax(json, options = {}) {
  const countsAre = options.countsAre === 'used' ? 'used' : 'remaining';
  const rows = json?.model_remains || json?.modelRemains || [];
  const row = pickMiniMaxRow(rows) || {};
  const windows = [];
  const plan = pick(json, 'current_subscribe_title', 'current_plan_title', 'plan_name', 'combo_title', 'plan')
    || pick(json?.current_combo_card || json?.currentComboCard, 'title')
    || pick(row, 'current_subscribe_title', 'current_plan_title', 'plan_name', 'combo_title', 'plan')
    || inferMiniMaxPlan(rows)
    || null;

  if (row.current_weekly_status === 3 || row.currentWeeklyStatus === 3) {
    windows.push(makeWindow({
      key: 'week',
      label: 'Week',
      usedPercent: 0,
      unit: 'unlimited',
      resetsAt: toIso(pick(row, 'weekly_end_time', 'weeklyEndTime')),
    }));
  } else {
    const week = miniMaxCounts(
      pick(row, 'current_weekly_total_count', 'currentWeeklyTotalCount'),
      pick(row, 'current_weekly_usage_count', 'currentWeeklyUsageCount'),
      pick(row, 'current_weekly_remaining_percent', 'currentWeeklyRemainingPercent'),
      countsAre,
    );
    if (week && (week.limit || week.usedPercent != null)) {
      windows.push(makeWindow({
        key: 'week',
        label: 'Week',
        usedPercent: week.usedPercent,
        used: week.used,
        limit: week.limit,
        unit: week.limit ? 'count' : 'percent',
        resetsAt: toIso(pick(row, 'weekly_end_time', 'weeklyEndTime')),
        resetsInMs: pick(row, 'weekly_remains_time', 'weeklyRemainsTime'),
      }));
    }
  }

  const session = miniMaxCounts(
    pick(row, 'current_interval_total_count', 'currentIntervalTotalCount'),
    pick(row, 'current_interval_usage_count', 'currentIntervalUsageCount'),
    pick(row, 'current_interval_remaining_percent', 'currentIntervalRemainingPercent'),
    countsAre,
  );
  if (session && (session.limit || session.usedPercent != null)) {
    windows.unshift(makeWindow({
      key: 'five_hour',
      label: '5 hours',
      usedPercent: session.usedPercent,
      used: session.used,
      limit: session.limit,
      unit: session.limit ? 'count' : 'percent',
      resetsAt: toIso(pick(row, 'end_time', 'endTime')),
      resetsInMs: pick(row, 'remains_time', 'remainsTime'),
    }));
  }

  for (const extra of rows) {
    if (extra && extra !== row) windows.push(...miniMaxExtraWindows(extra));
  }

  return {
    windows,
    plan: plan ? String(plan) : null,
    identity: row.model_name && !/general/i.test(row.model_name) ? String(row.model_name) : null,
  };
}

function miniMaxSpanLabel(start, end) {
  const span = spanMs(asNumber(start), asNumber(end));
  if (span == null) return null;
  if (span >= 20 * 3600 * 1000 && span <= 28 * 3600 * 1000) return 'day';
  const label = labelFromSeconds(span / 1000);
  return label === 'Week' ? 'week' : label;
}

// Higher Token Plan tiers add a daily and weekly allowance for video (and on
// some plans image, speech or music). The text row stays the headline; these
// follow it. Their usage counts disagree between keys on one account, so the
// remaining percent, which always agrees, sets the figure.
function miniMaxExtraWindows(row) {
  const name = prettyKey(row.model_name || row.modelName || '');
  if (!name || name === 'Usage') return [];
  const windows = [];
  const slots = [
    ['interval', 'current_interval', 'start_time', 'end_time', 'remains_time'],
    ['weekly', 'current_weekly', 'weekly_start_time', 'weekly_end_time', 'weekly_remains_time'],
  ];
  for (const [slot, prefix, startKey, endKey, remainsKey] of slots) {
    if (asNumber(row[`${prefix}_status`]) === 3) continue;
    const total = asNumber(row[`${prefix}_total_count`]);
    const percent = asNumber(row[`${prefix}_remaining_percent`]);
    if (!(total > 0) && percent == null) continue;
    const span = miniMaxSpanLabel(row[startKey], row[endKey]) || (slot === 'weekly' ? 'week' : 'window');
    let used = null;
    let usedPercent = null;
    if (percent != null) {
      // Published 0-100 here, like the text row's percent.
      usedPercent = 100 - clampPercent(percent);
      if (total > 0) used = Math.round((total * usedPercent) / 100);
    } else {
      const raw = asNumber(row[`${prefix}_usage_count`]);
      if (raw == null) continue;
      used = Math.max(0, total - raw);
      usedPercent = (used / total) * 100;
    }
    windows.push(makeWindow({
      key: `${String(row.model_name || name).toLowerCase()}:${slot}`,
      label: `${name} ${span}`,
      usedPercent,
      used: total > 0 ? used : null,
      limit: total > 0 ? total : null,
      unit: total > 0 ? 'count' : 'percent',
      resetsAt: toIso(row[endKey]),
      resetsInMs: row[remainsKey],
    }));
  }
  return windows;
}

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function extractCodexAuth(data) {
  if (!data || typeof data !== 'object') return null;
  const tokens = data.tokens && typeof data.tokens === 'object' ? data.tokens : data;
  const accessToken = tokens.access_token || data.access_token;
  if (!accessToken || typeof accessToken !== 'string') return null;
  const payload = decodeJwt(accessToken) || {};
  const profile = payload['https://api.openai.com/profile'] || {};
  const auth = payload['https://api.openai.com/auth'] || {};
  return {
    accessToken,
    accountId: tokens.account_id || data.account_id || auth.chatgpt_account_id || null,
    email: profile.email || payload.email || null,
  };
}

function extractGrokAuth(data) {
  const found = [];
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (typeof node.key === 'string' && node.key.length > 20) {
      found.push({
        token: node.key,
        email: typeof node.email === 'string' ? node.email : '',
        expiresAt: node.expires_at || node.expiresAt || null,
      });
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  }
  walk(data, 0);
  const seen = new Set();
  const unique = [];
  for (const item of found) {
    if (seen.has(item.token)) continue;
    seen.add(item.token);
    unique.push(item);
  }
  const named = unique.filter((item) => item.email || item.expiresAt);
  return named.length ? named : unique;
}

function prettyKey(value) {
  return String(value || 'Usage')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseCursorSummary(json) {
  const source = json || {};
  const end = toIso(source.billingCycleEnd);
  const period = labelFromPeriod(toIso(source.billingCycleStart), end) || 'Month';
  const windows = [];
  const individual = source.individualUsage || source.individual_usage || {};
  const plan = individual.plan || {};
  if (source.isUnlimited === true) {
    windows.push(makeWindow({ key: 'plan', label: period, usedPercent: 0, unit: 'unlimited', resetsAt: end }));
  } else {
    if (plan.autoPercentUsed != null) {
      windows.push(makeWindow({
        key: 'cursor-models',
        label: 'Cursor models',
        usedPercent: clampPercent(asNumber(plan.autoPercentUsed)),
        resetsAt: end,
      }));
    }
    if (plan.apiPercentUsed != null) {
      windows.push(makeWindow({
        key: 'other-models',
        label: 'Other models',
        usedPercent: clampPercent(asNumber(plan.apiPercentUsed)),
        resetsAt: end,
      }));
    }
    if (!windows.length && plan.totalPercentUsed != null) {
      windows.push(makeWindow({
        key: 'plan',
        label: period,
        usedPercent: clampPercent(asNumber(plan.totalPercentUsed)),
        resetsAt: end,
      }));
    }
    if (!windows.length && asNumber(plan.limit) > 0 && asNumber(plan.used) != null) {
      windows.push(makeWindow({
        key: 'plan',
        label: period,
        usedPercent: (asNumber(plan.used) / asNumber(plan.limit)) * 100,
        used: asNumber(plan.used) / 100,
        limit: asNumber(plan.limit) / 100,
        unit: 'dollars',
        resetsAt: end,
      }));
    }
  }
  const onDemand = individual.onDemand || individual.on_demand;
  if (onDemand && onDemand.enabled !== false && asNumber(onDemand.limit) > 0 && asNumber(onDemand.used) != null) {
    windows.push(makeWindow({
      key: 'on-demand',
      label: 'On-demand',
      usedPercent: (asNumber(onDemand.used) / asNumber(onDemand.limit)) * 100,
      used: asNumber(onDemand.used) / 100,
      limit: asNumber(onDemand.limit) / 100,
      unit: 'dollars',
      resetsAt: end,
    }));
  }
  return {
    windows: windows.filter((window) => window.usedPercent != null || window.unit === 'unlimited'),
    plan: source.membershipType ? prettyKey(source.membershipType) : null,
    identity: null,
  };
}

function parseCopilotUsage(json) {
  const source = json || {};
  const snapshots = source.quota_snapshots || source.quotaSnapshots || {};
  const labels = {
    premium_interactions: 'Premium',
    chat: 'Chat',
    completions: 'Completions',
  };
  const windows = [];
  // The monthly allowance resets on the date GitHub sends with the snapshots.
  const resetsAt = toIso(pick(source, 'quota_reset_date_utc', 'quotaResetDateUtc', 'quota_reset_date', 'quotaResetDate'));
  for (const [key, row] of Object.entries(snapshots)) {
    if (!row || typeof row !== 'object') continue;
    const label = labels[key] || prettyKey(key);
    if (row.unlimited === true) {
      windows.push(makeWindow({ key, label, usedPercent: 0, unit: 'unlimited' }));
      continue;
    }
    const remaining = clampPercent(asNumber(pick(row, 'percent_remaining', 'percentRemaining')));
    const entitlement = asNumber(pick(row, 'entitlement', 'limit'));
    const left = asNumber(pick(row, 'remaining', 'remaining_count'));
    let usedPercent = remaining == null ? null : 100 - remaining;
    if (usedPercent == null && entitlement > 0 && left != null) usedPercent = ((entitlement - left) / entitlement) * 100;
    if (usedPercent == null) continue;
    const counted = entitlement > 0 && left != null;
    windows.push(makeWindow({
      key,
      label,
      usedPercent,
      used: counted ? Math.max(0, entitlement - left) : null,
      limit: counted ? entitlement : null,
      unit: counted ? 'count' : 'percent',
      resetsAt: toIso(pick(row, 'quota_reset_at', 'quotaResetAt')) || resetsAt,
    }));
  }
  const plan = pick(source, 'copilot_plan', 'copilotPlan');
  const login = pick(source, 'login');
  return {
    windows,
    plan: plan ? prettyKey(plan) : null,
    identity: typeof login === 'string' && login ? login : null,
  };
}

function geminiProjectId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim()) return value.id.trim();
  return '';
}

function geminiBlockReason(source) {
  const tiers = source.ineligibleTiers || source.ineligible_tiers || [];
  const validation = tiers.find((tier) => tier && (tier.validationUrl || tier.validation_url));
  if (validation) {
    const url = validation.validationUrl || validation.validation_url;
    const why = validation.reasonMessage || validation.reason_message || 'Google asked this account to verify before Gemini can load.';
    return `${why} ${url}`.trim();
  }
  return tiers.map((tier) => tier && (tier.reasonMessage || tier.reason_message)).filter(Boolean).join(' ');
}

function geminiSetupPlan(loaded) {
  const source = loaded && typeof loaded === 'object' ? loaded : {};
  const project = geminiProjectId(source.cloudaicompanionProject || source.cloudaicompanion_project);
  if (project) return { action: 'use', project };
  const blocked = geminiBlockReason(source);
  const current = source.currentTier || source.current_tier;
  const tiers = Array.isArray(source.allowedTiers) ? source.allowedTiers : (Array.isArray(source.allowed_tiers) ? source.allowed_tiers : []);
  const free = tiers.find((item) => item && (item.id === 'free-tier' || item.id === 'FREE'));
  if (!current && free) return { action: 'onboard', tierId: 'free-tier' };
  if (!current && !tiers.length && !blocked) return { action: 'onboard', tierId: 'free-tier' };
  return {
    action: 'fail',
    message: blocked || 'Gemini did not attach a project to this login. This Google account needs Gemini Code Assist set up before the quota can load.',
  };
}

function geminiFraction(source) {
  const nested = source.remaining && typeof source.remaining === 'object' ? source.remaining : {};
  const remaining = asNumber(
    pick(source, 'remainingFraction', 'remaining_fraction')
    ?? pick(nested, 'remainingFraction', 'remaining_fraction'),
  );
  if (remaining == null) return null;
  const fraction = remaining > 1 ? remaining / 100 : remaining;
  return Math.min(1, Math.max(0, fraction));
}

function geminiUsed(fraction) {
  return (1 - fraction) * 100;
}

// "Claude and GPT models" reads as "Claude & GPT" in front of a window name.
function geminiGroupName(name) {
  return String(name || '')
    .replace(/\s+models?$/i, '')
    .replace(/\s+and\s+/gi, ' & ')
    .trim();
}

// Group descriptions name their models: "Models within this group: Claude
// Opus, Claude Sonnet, GPT-OSS".
function geminiGroupModels(description) {
  const match = String(description || '').match(/models within this group:\s*(.+)$/i);
  if (!match) return [];
  return match[1].replace(/\.\s*$/, '').split(',').map((name) => name.trim()).filter(Boolean);
}

function geminiSpan(bucket) {
  const id = String(pick(bucket, 'bucketId', 'bucket_id') || '');
  const windowKind = String(pick(bucket, 'window') || '');
  if (windowKind === 'weekly' || /weekly/i.test(id)) return 'week';
  if (windowKind === '5h' || /-5h\b/i.test(id)) return '5 hours';
  return null;
}

// retrieveUserQuotaSummary: one group per shared pool, each with a weekly and a
// 5-hour bucket. Google stops counting the 5-hour bucket once the week is
// spent and marks it disabled; that is shown as paused, not as 100% left.
function geminiSummaryWindows(json) {
  let groups = Array.isArray(json?.groups) ? json.groups : [];
  if (!groups.length && Array.isArray(json?.buckets)) {
    // An ungrouped summary still names its windows; per-model buckets are
    // read by geminiModelEntries instead.
    const pooled = json.buckets.filter((bucket) => bucket && !pick(bucket, 'modelId', 'model_id'));
    if (pooled.length) groups = [{ buckets: pooled }];
  }
  const out = [];
  for (const group of groups) {
    const name = geminiGroupName(pick(group, 'displayName', 'display_name'));
    const text = `${pick(group, 'displayName', 'display_name') || ''} ${pick(group, 'description') || ''}`;
    const listed = geminiGroupModels(pick(group, 'description'));
    const rows = [];
    for (const bucket of group.buckets || []) {
      const fraction = geminiFraction(bucket);
      if (fraction == null) continue;
      const span = geminiSpan(bucket);
      const label = span
        ? (name ? `${name} ${span}` : (span === 'week' ? 'Week' : '5 hours'))
        : String(pick(bucket, 'displayName', 'display_name') || name || 'Quota');
      const window = makeWindow({
        key: String(pick(bucket, 'bucketId', 'bucket_id') || label),
        label,
        usedPercent: geminiUsed(fraction),
        resetsAt: toIso(pick(bucket, 'resetTime', 'reset_time')),
      });
      if (bucket.disabled === true) window.paused = true;
      rows.push({ window, fraction, text });
    }
    if (rows.length && listed.length) rows[0].window.models = listed;
    out.push(...rows);
  }
  return out;
}

function geminiFamily(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (/^gpt/i.test(first)) return 'GPT';
  return first;
}

// "Claude Opus 5.5 (High)" and "(Low)" are one model at two effort levels.
function geminiModelName(name) {
  return String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function geminiNameFromId(id) {
  return String(id || '')
    .split('/').pop()
    .replace(/-/g, ' ')
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\boss\b/gi, 'OSS')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Tab completion and the internal chat models are not quotas a person spends.
function geminiInternalModel(id, model, tabIds) {
  if (tabIds.has(id)) return true;
  if (/^(tab_|chat_)/i.test(id)) return true;
  if (model && (model.isInternal === true || model.apiProvider === 'API_PROVIDER_INTERNAL')) return true;
  return false;
}

// fetchAvailableModels lists every model with its own quotaInfo. A model whose
// quota is spent comes back with a resetTime and no remainingFraction (the
// proto default of 0 is omitted on the wire). retrieveUserQuota is the older
// shape: one bucket per model id, without display names.
function geminiModelEntries(catalog) {
  const entries = [];
  if (!catalog || typeof catalog !== 'object') return entries;
  const tabIds = new Set(Array.isArray(catalog.tabModelIds) ? catalog.tabModelIds : []);
  if (catalog.models && typeof catalog.models === 'object' && !Array.isArray(catalog.models)) {
    for (const [id, model] of Object.entries(catalog.models)) {
      if (!model || typeof model !== 'object' || geminiInternalModel(id, model, tabIds)) continue;
      const quota = model.quotaInfo || model.quota_info;
      if (!quota || typeof quota !== 'object') continue;
      const resetsAt = toIso(pick(quota, 'resetTime', 'reset_time'));
      let fraction = geminiFraction(quota);
      if (fraction == null && resetsAt) fraction = 0;
      if (fraction == null) continue;
      const name = geminiModelName(pick(model, 'displayName', 'display_name')) || geminiNameFromId(id);
      const google = model.modelProvider ? model.modelProvider === 'MODEL_PROVIDER_GOOGLE' : /^gemini/i.test(id);
      entries.push({ id, name, party: google ? 'google' : 'other', fraction, resetsAt });
    }
    return entries;
  }
  for (const bucket of Array.isArray(catalog.buckets) ? catalog.buckets : []) {
    const id = String(pick(bucket, 'modelId', 'model_id') || '');
    if (!id || geminiInternalModel(id, null, tabIds)) continue;
    const fraction = geminiFraction(bucket);
    if (fraction == null) continue;
    entries.push({
      id,
      name: geminiNameFromId(id),
      party: /^gemini/i.test(id) ? 'google' : 'other',
      fraction,
      resetsAt: toIso(pick(bucket, 'resetTime', 'reset_time')),
    });
  }
  return entries;
}

// Families in name order, newest version first inside each family.
function compareModelNames(a, b) {
  const family = geminiFamily(a).localeCompare(geminiFamily(b), 'en');
  return family || b.localeCompare(a, 'en', { numeric: true });
}

function geminiPoolLabel(names) {
  if (names.length === 1) return names[0];
  const families = [...new Set(names.map(geminiFamily).filter(Boolean))].sort();
  return families.length ? `${families.join(' & ')} models` : 'Models';
}

function sameMoment(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(Date.parse(a) - Date.parse(b)) <= 60 * 1000;
}

// Models that share one pool report the same fraction and reset, so they
// collapse into a single row that lists them. A pool the summary already
// shows (same numbers, a family the group names) adds its model names to that
// row instead of repeating it.
function geminiModelWindows(entries, summary) {
  const pools = new Map();
  for (const entry of entries) {
    const stamp = `${entry.party}|${entry.fraction.toFixed(6)}|${entry.resetsAt || ''}`;
    if (!pools.has(stamp)) pools.set(stamp, []);
    pools.get(stamp).push(entry);
  }
  const windows = [];
  for (const members of pools.values()) {
    const names = [...new Set(members.map((entry) => entry.name))].sort(compareModelNames);
    const { fraction, resetsAt, party } = members[0];
    const families = [...new Set(names.map(geminiFamily))];
    const covered = summary.find((row) => Math.abs(row.fraction - fraction) < 0.0005
      && sameMoment(row.window.resetsAt, resetsAt)
      && families.some((family) => family && row.text.toLowerCase().includes(family.toLowerCase())));
    if (covered) {
      const owner = summary.find((row) => row.text === covered.text) || covered;
      owner.window.models = names;
      continue;
    }
    const ids = members.map((entry) => entry.id).sort();
    const window = makeWindow({
      key: `models:${party}:${ids[0]}`,
      label: geminiPoolLabel(names),
      usedPercent: geminiUsed(fraction),
      resetsAt,
    });
    if (names.length > 1) window.models = names;
    windows.push(window);
  }
  return windows.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
}

// Antigravity meters two ways: the summary's shared weekly and 5-hour pools,
// and a quota per model. Both are read; the summary leads and each model pool
// follows, so no model is left off the card.
function parseGeminiQuota(json, loaded = {}, catalog = null) {
  const summary = geminiSummaryWindows(json);
  const entries = [...geminiModelEntries(json), ...geminiModelEntries(catalog)];
  const seen = new Set();
  const unique = entries.filter((entry) => (seen.has(entry.id) ? false : seen.add(entry.id)));
  const windows = [...summary.map((row) => row.window), ...geminiModelWindows(unique, summary)];
  const tier = loaded.paidTier || loaded.paid_tier || loaded.currentTier || loaded.current_tier || {};
  const plan = tier.name || tier.id || null;
  return {
    windows,
    plan: plan ? prettyKey(plan) : null,
    identity: null,
    modelCount: unique.length,
  };
}

// Meta publishes the window and weekly meters as 0-100 on the wire. Never run
// these through normalizeUtilization: it reads a bare 1 as a fraction, which
// would turn "one percent used" into "the window is empty".
function musePercent(value) {
  const number = asNumber(value);
  if (number == null || number < 0) return null;
  return clampPercent(number);
}

function museResets(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return toIso(Number(value.trim()));
  return toIso(value);
}

function museWindows(subs) {
  const windows = [];
  const windowBlock = subs.window || {};
  const weeklyBlock = subs.weekly || {};
  const minutes = asNumber(pick(windowBlock, 'window_duration_mins', 'windowDurationMins', 'window_duration_minutes'));
  const windowLabel = minutes != null && minutes > 0 ? labelFromSeconds(minutes * 60) : 'Rolling window';
  const windowUsed = musePercent(pick(windowBlock, 'used_percent', 'usedPercent'));
  if (windowUsed != null) {
    windows.push(makeWindow({
      key: 'window',
      label: windowLabel,
      usedPercent: windowUsed,
      resetsAt: museResets(pick(windowBlock, 'resets_at', 'resetsAt')),
    }));
  }
  const weeklyUsed = musePercent(pick(weeklyBlock, 'used_percent', 'usedPercent'));
  if (weeklyUsed != null) {
    windows.push(makeWindow({
      key: 'weekly',
      label: 'Week',
      usedPercent: weeklyUsed,
      resetsAt: museResets(pick(weeklyBlock, 'resets_at', 'resetsAt')),
    }));
  }
  return windows;
}

// Meta sometimes includes a usage meter on the /muse-code/key response and
// sometimes omits it -- a 5h window that has just reset comes back with the
// plan but no subs_usage. The one place it always appears is a
// `response.subscription_usage` frame inside a streamed model reply, so that is
// what museUsageFromStream pulls out. When no meter turns up anywhere, the
// honest answer is no windows: the board renders percent *left*, so a made-up
// 0%-used pair reads as "you have everything" exactly when the weekly meter is
// nearly gone.
function museUsageFromStream(text) {
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let frame;
    try {
      frame = JSON.parse(payload);
    } catch {
      continue;
    }
    if (frame && frame.type === 'response.subscription_usage' && frame.subscription) return frame;
  }
  return null;
}

function parseMuseUsage(json) {
  const source = json || {};
  const subs = source.subs_usage || source.subsUsage || source.subscription || {};
  const plan = pick(source, 'subs_tier_name', 'subsTierName', 'subs_tier_id', 'subsTierId', 'tier');
  const email = pick(source, 'user_email', 'userEmail', 'email');
  return {
    windows: museWindows(subs),
    plan: plan ? String(plan).replace(/^muse\s*code\s+/i, '') : null,
    identity: email ? String(email) : null,
  };
}

function museResetStillOpen(window, now) {
  if (!window?.resetsAt) return false;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) && at > now;
}

// The key call drops subs_usage when the 5-hour window resets. The last real
// week is still the week: only a window whose own reset has passed goes back
// to empty. A week that has itself reset is not reusable.
function museUsageAfterWindowReset(meter, now = Date.now()) {
  const windows = meter && Array.isArray(meter.windows) ? meter.windows : [];
  const weekly = windows.find((window) => window && window.key === 'weekly' && window.usedPercent != null);
  if (!weekly) return null;
  const saved = Date.parse(meter.savedAt || '');
  const fresh = Number.isFinite(saved) && now - saved <= 6 * 60 * 60 * 1000;
  const weekOpen = museResetStillOpen(weekly, now) || (!weekly.resetsAt && fresh);
  if (!weekOpen) return null;
  const session = windows.find((window) => window && window.key === 'window' && window.usedPercent != null);
  const sessionOpen = session && (museResetStillOpen(session, now) || (!session.resetsAt && fresh));
  if (sessionOpen) {
    return [session, weekly].map((window) => ({ ...window }));
  }
  return [
    makeWindow({ key: 'window', label: '5 hours', usedPercent: 0 }),
    { ...weekly },
  ];
}

function museKeyProblem(json) {
  const source = json && typeof json === 'object' ? json : {};
  const status = asNumber(source.status);
  const hasUsage = source.subs_usage || source.subsUsage || source.subscription;
  if (!hasUsage && status && (source.title || source.detail)) {
    const detail = typeof source.detail === 'string' && source.detail.trim()
      ? source.detail.trim()
      : String(source.title).trim();
    return { message: detail, status };
  }
  if (source.is_subs_active === false || source.isSubsActive === false) {
    return {
      message: 'This Meta login has no active Muse Code subscription. Subscribe in Accounts Center, then refresh.',
      status: 404,
    };
  }
  if (source.require_payment === true || source.requirePayment === true) {
    return {
      message: 'This Meta account needs a Muse Code plan before usage can load. Subscribe in Accounts Center, then refresh.',
      status: 404,
    };
  }
  return null;
}

// OpenCode Go publishes each window as the share already spent, 0-100.
function parseOpenCodeGoUsage(json) {
  const usage = json?.usage && typeof json.usage === 'object' ? json.usage : {};
  const rows = [['rolling', '5 hours'], ['weekly', 'Week'], ['monthly', 'Month']];
  const windows = rows
    .map(([key, label]) => {
      const row = usage[key];
      if (!row || typeof row !== 'object') return null;
      return windowFromPercent(key, label, pick(row, 'percent', 'usedPercent', 'used_percent'), pick(row, 'resetsAt', 'resets_at'));
    })
    .filter(Boolean);
  return { windows, plan: windows.length ? 'Go' : null, identity: null };
}

// A balance has no ceiling to measure against, so it is shown as an amount,
// never as a ring.
function balanceWindow(key, label, amount, currency, extra = {}) {
  return {
    ...makeWindow({ key, label, usedPercent: null, unit: 'balance' }),
    amount,
    currency: String(currency || 'USD').toUpperCase(),
    ...extra,
  };
}

// DeepSeek returns amounts as decimal strings, one row per currency.
function parseDeepSeekBalance(json) {
  const rows = Array.isArray(json?.balance_infos) ? json.balance_infos : [];
  const windows = rows
    .map((row) => {
      const amount = asNumber(row?.total_balance);
      if (amount == null) return null;
      const currency = String(row.currency || 'USD').toUpperCase();
      const label = rows.length > 1 ? `Balance ${currency}` : 'Balance';
      return balanceWindow(`balance-${currency.toLowerCase()}`, label, amount, currency, {
        granted: asNumber(row.granted_balance),
      });
    })
    .filter(Boolean);
  return { windows, plan: windows.length ? 'Pay as you go' : null, identity: null };
}

// /credits is the whole account: everything bought, and everything spent.
function parseOpenRouterCredits(json) {
  const data = json?.data || {};
  const total = asNumber(data.total_credits);
  const used = asNumber(data.total_usage);
  if (total == null || used == null) return { windows: [], plan: null, identity: null };
  if (!(total > 0)) {
    return { windows: [balanceWindow('credits', 'Credits', Math.max(0, total - used), 'USD')], plan: 'Pay as you go', identity: null };
  }
  return {
    windows: [makeWindow({ key: 'credits', label: 'Credits', usedPercent: (used / total) * 100, used, limit: total, unit: 'dollars' })],
    plan: 'Pay as you go',
    identity: null,
  };
}

function openRouterResetLabel(interval) {
  const value = String(interval || '').toLowerCase();
  if (value === 'daily') return 'Day';
  if (value === 'weekly') return 'Week';
  if (value === 'monthly') return 'Month';
  return 'Key limit';
}

function nextUtcMidnight(now = Date.now()) {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

// /key describes one regular key. It can only show a key's own spending
// limit; the account's credit balance needs a management key.
function parseOpenRouterKey(json, now = Date.now()) {
  const data = json?.data || {};
  const windows = [];
  const budget = data.effective_budget && typeof data.effective_budget === 'object' ? data.effective_budget : null;
  const budgetLimit = asNumber(budget?.limit_usd);
  const keyLimit = asNumber(data.limit);
  if (budgetLimit > 0) {
    const used = asNumber(budget.spend_usd) ?? Math.max(0, budgetLimit - (asNumber(budget.remaining_usd) ?? budgetLimit));
    windows.push(makeWindow({
      key: 'key-limit',
      label: openRouterResetLabel(budget.reset_interval),
      usedPercent: (used / budgetLimit) * 100,
      used,
      limit: budgetLimit,
      unit: 'dollars',
      resetsAt: toIso(budget.resets_at),
    }));
  } else if (keyLimit > 0) {
    const remaining = asNumber(data.limit_remaining);
    const used = remaining == null ? (asNumber(data.usage) ?? 0) : Math.max(0, keyLimit - remaining);
    windows.push(makeWindow({
      key: 'key-limit',
      label: openRouterResetLabel(data.limit_reset),
      usedPercent: (used / keyLimit) * 100,
      used,
      limit: keyLimit,
      unit: 'dollars',
    }));
  }
  const free = data.free_model_daily_requests;
  const freeLimit = asNumber(free?.limit);
  if (data.is_free_tier && freeLimit > 0) {
    const used = asNumber(free.used) ?? Math.max(0, freeLimit - (asNumber(free.remaining) ?? freeLimit));
    windows.push(makeWindow({
      key: 'free-requests',
      label: 'Free today',
      usedPercent: (used / freeLimit) * 100,
      used,
      limit: freeLimit,
      unit: 'count',
      resetsAt: nextUtcMidnight(now),
    }));
  }
  const spent = asNumber(data.usage);
  const note = windows.length
    ? null
    : `This key has no spending limit${spent != null ? ` and has spent $${spent.toFixed(2)}` : ''}. Add a management key to see the account's credits.`;
  return { windows, plan: data.is_free_tier ? 'Free' : 'API key', identity: null, note };
}

const TIME_UNIT_SECONDS = { SECOND: 1, MINUTE: 60, HOUR: 3600, DAY: 86400, WEEK: 604800 };

function kimiResets(source) {
  const at = pick(source, 'reset_at', 'resetAt', 'reset_time', 'resetTime');
  if (at != null) return { resetsAt: toIso(at), resetsInMs: null };
  const seconds = asNumber(pick(source, 'reset_in', 'resetIn', 'ttl'));
  return { resetsAt: null, resetsInMs: seconds == null ? null : seconds * 1000 };
}

function kimiWindow(key, label, source) {
  if (!source || typeof source !== 'object') return null;
  const limit = asNumber(source.limit);
  if (!(limit > 0)) return null;
  const remaining = asNumber(source.remaining);
  const used = asNumber(source.used) ?? (remaining == null ? null : Math.max(0, limit - remaining));
  if (used == null) return null;
  return makeWindow({ key, label, usedPercent: (used / limit) * 100, used, limit, unit: 'count', ...kimiResets(source) });
}

// Kimi Code (kimi-cli /usage): `usage` is the weekly allowance and `limits`
// holds the shorter windows, each sized by window.duration in timeUnit.
// Counts may arrive as strings.
function parseKimiCodeUsage(json) {
  const windows = [];
  const limits = Array.isArray(json?.limits) ? json.limits : [];
  limits.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const span = item.window || {};
    const unit = String(span.timeUnit || span.time_unit || '').toUpperCase();
    const per = Object.entries(TIME_UNIT_SECONDS).find(([name]) => unit.includes(name))?.[1];
    const duration = asNumber(span.duration);
    const label = per && duration ? labelFromSeconds(duration * per) : 'Limit';
    const window = kimiWindow(`limit-${index}`, label, item.detail || item);
    if (window) windows.push(window);
  });
  const weekly = kimiWindow('weekly', 'Week', json?.usage);
  if (weekly) windows.push(weekly);
  return { windows, plan: windows.length ? 'Kimi Code' : null, identity: null };
}

// Kimi API platform (Moonshot): available = cash + voucher, in USD on
// api.moonshot.ai and CNY on api.moonshot.cn.
function parseMoonshotBalance(json, currency = 'USD') {
  const data = json?.data || {};
  const amount = asNumber(data.available_balance);
  if (amount == null) return { windows: [], plan: null, identity: null };
  return {
    windows: [balanceWindow('balance', 'Balance', amount, currency, { granted: asNumber(data.voucher_balance) })],
    plan: 'Pay as you go',
    identity: null,
  };
}

const ZAI_UNIT_SECONDS = { 1: 86400, 3: 3600, 5: 60, 6: 604800 };

// Z.ai / BigModel GLM Coding Plan. TOKENS_LIMIT is the prompt window
// (unit x number, e.g. 3 x 5 = 5 hours) with percentage already 0-100 used;
// TIME_LIMIT is the monthly allowance of MCP tool calls (search, reader).
function parseZaiQuota(json) {
  const data = json?.data || {};
  const limits = Array.isArray(data.limits) ? data.limits : [];
  const windows = [];
  limits.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const type = String(item.type || '').toUpperCase();
    const resetsAt = toIso(pick(item, 'nextResetTime', 'next_reset_time'));
    const total = asNumber(item.usage);
    const current = asNumber(pick(item, 'currentValue', 'current_value'));
    const remaining = asNumber(item.remaining);
    const percent = asNumber(item.percentage);
    if (type === 'TOKENS_LIMIT') {
      const seconds = (ZAI_UNIT_SECONDS[asNumber(item.unit)] || 0) * (asNumber(item.number) || 0);
      const window = windowFromPercent(`tokens-${index}`, seconds ? labelFromSeconds(seconds) : 'Prompts', percent, resetsAt);
      if (window) windows.push(window);
      return;
    }
    if (type === 'TIME_LIMIT') {
      const used = current ?? (total != null && remaining != null ? Math.max(0, total - remaining) : null);
      if (total > 0 && used != null) {
        windows.push(makeWindow({ key: `tools-${index}`, label: 'MCP calls', usedPercent: (used / total) * 100, used, limit: total, unit: 'count', resetsAt }));
      } else {
        const window = windowFromPercent(`tools-${index}`, 'MCP calls', percent, resetsAt);
        if (window) windows.push(window);
      }
    }
  });
  const level = pick(data, 'planName', 'plan_name', 'packageName', 'level', 'plan', 'plan_type');
  return {
    windows,
    plan: typeof level === 'string' && level ? `GLM ${prettyKey(level.replace(/^glm[\s_-]*/i, ''))}` : (windows.length ? 'GLM Coding Plan' : null),
    identity: null,
  };
}

// Vercel AI Gateway: team-wide credit, decimal strings in USD.
function parseVercelCredits(json) {
  const amount = asNumber(json?.balance);
  if (amount == null) return { windows: [], plan: null, identity: null };
  return { windows: [balanceWindow('credits', 'Credits', amount, 'USD')], plan: 'AI Gateway', identity: null };
}

// Poe meters API use in points, not money.
function parsePoeBalance(json) {
  const amount = asNumber(json?.current_point_balance);
  if (amount == null) return { windows: [], plan: null, identity: null };
  return { windows: [balanceWindow('points', 'Points', amount, 'USD', { format: 'points' })], plan: 'API points', identity: null };
}

// SiliconFlow: totalBalance = chargeBalance (bought) + balance (gifted), all
// decimal strings. USD on siliconflow.com, CNY on siliconflow.cn.
function parseSiliconFlowInfo(json, currency = 'USD') {
  const data = json?.data || {};
  const amount = asNumber(data.totalBalance);
  if (amount == null) return { windows: [], plan: null, identity: null };
  const who = pick(data, 'email', 'name');
  return {
    windows: [balanceWindow('balance', 'Balance', amount, currency, { granted: asNumber(data.balance) })],
    plan: 'Pay as you go',
    identity: typeof who === 'string' && who ? who : null,
  };
}

// OpenCode keeps provider keys in its own auth file; this picks the first API
// key saved under any of the given names.
function extractOpenCodeKey(data, names) {
  if (!data || typeof data !== 'object') return null;
  for (const name of names) {
    const entry = data[name];
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type && entry.type !== 'api') continue;
    const key = cleanSecret(entry.key);
    if (key) return { name, key };
  }
  return null;
}

function cleanSecret(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '').trim();
}

module.exports = {
  asNumber,
  normalizeUtilization,
  toIso,
  labelFromSeconds,
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
  extractOpenCodeKey,
  decodeJwt,
  extractCodexAuth,
  extractGrokAuth,
  cleanSecret,
};
