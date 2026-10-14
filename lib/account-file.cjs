const path = require('path');

function emptyAccountState() {
  return {
    settings: { pinned: true, bounds: null, defaultAccountId: null },
    accounts: [],
    meters: {},
    resetMarks: {},
  };
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ok is false when the file is present but cannot be trusted. Callers must
// leave that file alone instead of writing a fresh empty store over it.
function parseAccountFile(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, state: emptyAccountState() };
    }
    return {
      ok: true,
      state: {
        settings: { pinned: true, bounds: null, defaultAccountId: null, ...(parsed.settings || {}) },
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        meters: objectOrEmpty(parsed.meters),
        resetMarks: objectOrEmpty(parsed.resetMarks),
      },
    };
  } catch {
    return { ok: false, state: emptyAccountState() };
  }
}

function legacyAccountFiles(home, platform, appData) {
  const names = ['usage-monitor', 'UsageMonitor'];
  const root = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support')
    : appData;
  return names.map((name) => path.join(root, name, 'accounts.json'));
}

module.exports = {
  emptyAccountState,
  parseAccountFile,
  legacyAccountFiles,
};
