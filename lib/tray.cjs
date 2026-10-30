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

function providerName(id) {
  return NAMES[id] || 'Account';
}

function resolveDefaultId(accounts, defaultAccountId) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) return null;
  if (list.length === 1) return list[0].id;
  if (defaultAccountId && list.some((account) => account.id === defaultAccountId)) return defaultAccountId;
  return list[0].id;
}

function formatAmount(amount, currency = 'USD', format = 'money') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  if (format === 'points') {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} points`;
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function remainingLeft(window) {
  // A paused window (Antigravity's 5 hours while the week is spent) binds nothing.
  if (!window || window.paused || window.unit === 'unlimited' || window.unit === 'credits' || window.usedPercent == null) return null;
  return Math.max(0, 100 - window.usedPercent);
}

function tightestWindow(windows) {
  let best = null;
  let bestLeft = null;
  for (const window of windows || []) {
    const left = remainingLeft(window);
    if (left == null) continue;
    if (bestLeft == null || left < bestLeft) {
      best = window;
      bestLeft = left;
    }
  }
  return best || (windows || [])[0] || null;
}

// The menu bar number is the account's headline window, not its tightest one:
// Claude's 5 hours, SuperGrok's week, Cursor's own models. Any other provider
// leads with its first window that has a meter.
const PRIMARY_LABEL = {
  claude: '5 hours',
  grok: 'Week',
  cursor: 'Cursor models',
};

function primaryWindow(provider, windows) {
  const list = windows || [];
  const label = PRIMARY_LABEL[provider];
  const named = label && list.find((window) => window.label === label && remainingLeft(window) != null);
  return named || list.find((window) => remainingLeft(window) != null) || list[0] || null;
}

function trayDisplay(result) {
  const accounts = result?.accounts || [];
  const defaultId = resolveDefaultId(accounts, accounts.find((account) => account.isDefault)?.id);
  const account = accounts.find((item) => item.id === defaultId) || null;
  if (!account) {
    return { percentText: '', tooltip: 'Usage Monitor', left: null };
  }
  const name = providerName(account.provider);
  const snapshot = result.snapshots?.[account.id];
  if (!snapshot) {
    return { percentText: '', tooltip: `${name} has not been checked yet.`, left: null };
  }
  if (snapshot.ok === false) {
    return { percentText: '', tooltip: snapshot.error || `${name} needs a new login.`, left: null };
  }
  const window = primaryWindow(account.provider, snapshot.windows);
  const left = remainingLeft(window);
  if (left == null && window?.unit === 'balance') {
    const amount = formatAmount(window.amount, window.currency, window.format);
    return { percentText: amount, tooltip: `${name} · ${window.label} · ${amount} left`, left: null };
  }
  if (left == null) {
    // No meter to draw: say why, rather than showing a bare provider name.
    if (snapshot.note) return { percentText: '', tooltip: `${name} · ${snapshot.note}`, left: null };
    const label = window?.label ? `${name} ${window.label}` : name;
    return { percentText: '', tooltip: label, left: null };
  }
  const rounded = Math.round(left);
  return {
    percentText: `${rounded}% left`,
    tooltip: `${name} · ${window.label} · ${rounded}% left`,
    left: rounded,
  };
}

function markDefault(accounts, defaultAccountId) {
  const defaultId = resolveDefaultId(accounts, defaultAccountId);
  return (accounts || []).map((account) => ({
    ...account,
    isDefault: account.id === defaultId,
  }));
}

module.exports = {
  providerName,
  formatAmount,
  resolveDefaultId,
  remainingLeft,
  tightestWindow,
  primaryWindow,
  trayDisplay,
  markDefault,
};
