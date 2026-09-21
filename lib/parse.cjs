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

function dollarsFromMinor(value) {
  const number = asNumber(value);
  if (number == null) return null;
  return number / 100;
}

function parseClaudeUsage(json) {
  const source = json || {};
  const windows = [];
  const seen = new Set();

  function add(window) {
    if (!window || seen.has(window.label)) return;
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

  const limits = Array.isArray(source.limits) ? source.limits : [];
  for (const item of limits) {
    if (item && item.is_active === false) continue;
    const model = item?.scope?.model?.display_name;
    const kind = item?.kind || item?.group;
    let label = 'Usage';
    if (kind === 'session') label = '5 hours';
    else if (model) label = `${model} week`;
    else if (kind === 'weekly' || kind === 'seven_day') label = 'Week';
    else if (model) label = model;
    else label = kind ? String(kind) : 'Usage';
    add(windowFromUsedPercent(kind || label, label, pick(item, 'percent', 'utilization', 'used_percent'), pick(item, 'resets_at', 'resetsAt')));
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
  const label = labelFromSeconds(seconds) === 'Usage' && fallbackLabel ? fallbackLabel : labelFromSeconds(seconds);
  const used = pick(window, 'used_percent', 'usedPercent');
  const resets = pick(window, 'reset_at', 'resetAt', 'resets_at', 'resetsAt');
  return windowFromUsedPercent(key, label === 'Usage' ? fallbackLabel : label, used, resets);
}

function parseCodexUsage(json) {
  const source = json || {};
  const rate = source.rate_limit || source.rateLimit || source;
  const windows = [];
  const primary = parseCodexWindow('primary', '5 hours', rate.primary_window || rate.primaryWindow || rate.primary);
  const secondary = parseCodexWindow('secondary', 'Week', rate.secondary_window || rate.secondaryWindow || rate.secondary);
  if (primary) windows.push(primary);
  if (secondary) windows.push(secondary);

  const credits = source.credits || rate.credits;
  const balance = asNumber(pick(credits || {}, 'balance', 'remaining'));
  if (balance != null) {
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

function parseGrokBilling(json) {
  const source = json || {};
  const config = source.config && typeof source.config === 'object' ? source.config : source;
  const usage = source.usage && typeof source.usage === 'object' ? source.usage : config.usage;
  let usedPercent = normalizeUtilization(pick(config, 'creditUsagePercent', 'credit_usage_percent', 'usedPercent', 'usagePercent'));
  if (usedPercent == null && usage) {
    const used = asNumber(usage.totalUsed?.val ?? usage.total_used?.val ?? usage.totalUsed ?? usage.includedUsed?.val);
    const limit = asNumber(source.monthlyLimit?.val ?? source.monthly_limit?.val ?? config.monthlyLimit?.val ?? config.monthlyLimit);
    if (used != null && limit) usedPercent = (used / limit) * 100;
  }
  if (usedPercent == null && config.onDemandUsed && config.onDemandCap) {
    const used = asNumber(config.onDemandUsed.val ?? config.onDemandUsed);
    const limit = asNumber(config.onDemandCap.val ?? config.onDemandCap);
    if (used != null && limit) usedPercent = (used / limit) * 100;
  }

  const period = config.currentPeriod || config.current_period || source.billingCycle || source.billing_cycle || {};
  const start = pick(period, 'start', 'billingPeriodStart', 'billing_period_start');
  const end = pick(period, 'end', 'billingPeriodEnd', 'billing_period_end')
    || pick(config, 'billingPeriodEnd', 'billing_period_end');
  const label = periodLabel(start, end, 'Credits');
  const windows = [];
  if (usedPercent != null) {
    windows.push(makeWindow({
      key: 'credits',
      label,
      usedPercent,
      unit: 'percent',
      resetsAt: toIso(end),
    }));
  }

  const plan = pick(config, 'subscriptionTier', 'subscription_tier', 'subscription_tier_display')
    || pick(source, 'subscription_tier_display', 'subscriptionTier')
    || null;

  return {
    windows,
    plan: plan ? String(plan).replace(/_/g, ' ') : null,
    identity: null,
    hasUsage: usedPercent != null,
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

function parseMiniMax(json, options = {}) {
  const countsAre = options.countsAre === 'used' ? 'used' : 'remaining';
  const rows = json?.model_remains || json?.modelRemains || [];
  const row = pickMiniMaxRow(rows) || {};
  const windows = [];
  const plan = pick(json, 'current_subscribe_title', 'plan_name', 'plan')
    || pick(row, 'current_subscribe_title', 'plan_name', 'plan')
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

  return {
    windows,
    plan: plan ? String(plan) : null,
    identity: row.model_name && !/general/i.test(row.model_name) ? String(row.model_name) : null,
  };
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
        usedPercent: normalizeUtilization(plan.autoPercentUsed),
        resetsAt: end,
      }));
    }
    if (plan.apiPercentUsed != null) {
      windows.push(makeWindow({
        key: 'other-models',
        label: 'Other models',
        usedPercent: normalizeUtilization(plan.apiPercentUsed),
        resetsAt: end,
      }));
    }
    if (!windows.length && plan.totalPercentUsed != null) {
      windows.push(makeWindow({
        key: 'plan',
        label: period,
        usedPercent: normalizeUtilization(plan.totalPercentUsed),
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
  for (const [key, row] of Object.entries(snapshots)) {
    if (!row || typeof row !== 'object') continue;
    const label = labels[key] || prettyKey(key);
    if (row.unlimited === true) {
      windows.push(makeWindow({ key, label, usedPercent: 0, unit: 'unlimited' }));
      continue;
    }
    const remaining = normalizeUtilization(pick(row, 'percent_remaining', 'percentRemaining'));
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
    }));
  }
  const plan = pick(source, 'copilot_plan', 'copilotPlan');
  return {
    windows,
    plan: plan ? prettyKey(plan) : null,
    identity: null,
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

function parseGeminiQuota(json, loaded = {}) {
  const buckets = geminiBuckets(json);
  const windows = [];
  for (const bucket of buckets) {
    const nested = bucket.remaining && typeof bucket.remaining === 'object' ? bucket.remaining : {};
    const remaining = asNumber(
      pick(bucket, 'remainingFraction', 'remaining_fraction')
      ?? pick(nested, 'remainingFraction', 'remaining_fraction'),
    );
    if (remaining == null) continue;
    const fraction = remaining > 1 ? remaining / 100 : remaining;
    const label = geminiLabel(bucket);
    windows.push(makeWindow({
      key: String(pick(bucket, 'bucketId', 'bucket_id', 'modelId', 'model_id') || label),
      label,
      usedPercent: (1 - Math.min(1, Math.max(0, fraction))) * 100,
      resetsAt: toIso(pick(bucket, 'resetTime', 'reset_time')),
    }));
  }
  const tier = loaded.currentTier || loaded.paidTier || loaded.current_tier || {};
  const plan = tier.name || tier.id || null;
  return {
    windows,
    plan: plan ? prettyKey(plan) : null,
    identity: null,
  };
}

function geminiBuckets(json) {
  const groups = Array.isArray(json?.groups) ? json.groups : [];
  if (!groups.length) return Array.isArray(json?.buckets) ? json.buckets : [];
  const buckets = [];
  for (const group of groups) {
    const groupName = pick(group, 'displayName', 'display_name') || '';
    for (const bucket of group.buckets || []) buckets.push({ ...bucket, groupName });
  }
  return buckets;
}

function geminiLabel(bucket) {
  const model = String(pick(bucket, 'modelId', 'model_id') || '');
  if (model) {
    const name = model.split('/').pop().replace(/^gemini-?/i, '').replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    return name || 'Quota';
  }
  const id = String(pick(bucket, 'bucketId', 'bucket_id') || '');
  const windowKind = String(pick(bucket, 'window') || '');
  const weekly = windowKind === 'weekly' || /weekly/i.test(id);
  const five = windowKind === '5h' || /-5h\b/i.test(id);
  const span = weekly ? 'week' : five ? '5 hours' : String(pick(bucket, 'displayName', 'display_name') || 'Quota');
  const group = String(bucket.groupName || '').split(/\s+/)[0];
  if (group && (weekly || five)) return `${group} ${span}`;
  return span;
}

function musePercent(value) {
  const number = asNumber(value);
  if (number == null || number < 0) return null;
  return clampPercent(number);
}

function museResets(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return toIso(Number(value.trim()));
  return toIso(value);
}

function parseMuseUsage(json) {
  const source = json || {};
  const subs = source.subs_usage || source.subsUsage || source.subscription || {};
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
  const plan = pick(source, 'subs_tier_name', 'subsTierName', 'subs_tier_id', 'subsTierId', 'tier');
  const email = pick(source, 'user_email', 'userEmail', 'email');
  return {
    windows,
    plan: plan ? String(plan).replace(/^muse\s*code\s+/i, '') : null,
    identity: email ? String(email) : null,
  };
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
  museKeyProblem,
  decodeJwt,
  extractCodexAuth,
  extractGrokAuth,
  cleanSecret,
};
