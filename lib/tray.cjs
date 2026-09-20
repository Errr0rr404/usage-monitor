const NAMES = {
  grok: 'Grok',
  minimax: 'MiniMax',
  codex: 'Codex',
  claude: 'Claude',
  cursor: 'Cursor',
  copilot: 'Copilot',
  gemini: 'Gemini',
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

function remainingLeft(window) {
  if (!window || window.unit === 'unlimited' || window.unit === 'credits' || window.usedPercent == null) return null;
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
  const window = tightestWindow(snapshot.windows);
  const left = remainingLeft(window);
  if (left == null) {
    const label = window?.label ? `${name} ${window.label}` : name;
    return { percentText: '', tooltip: label, left: null };
  }
  const rounded = Math.round(left);
  return {
    percentText: `${rounded}%`,
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
  resolveDefaultId,
  remainingLeft,
  tightestWindow,
  trayDisplay,
  markDefault,
};
