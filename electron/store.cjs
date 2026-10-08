const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { sessionFromSecret } = require('../lib/oauth.cjs');
const { resolveDefaultId } = require('../lib/tray.cjs');

function dataFile() {
  return path.join(app.getPath('userData'), 'accounts.json');
}

function emptyState() {
  return {
    settings: { pinned: true, bounds: null, defaultAccountId: null },
    accounts: [],
    meters: {},
    resetMarks: {},
  };
}

function readState() {
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      settings: { pinned: true, bounds: null, defaultAccountId: null, ...(parsed.settings || {}) },
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      meters: parsed.meters && typeof parsed.meters === 'object' ? parsed.meters : {},
      resetMarks: parsed.resetMarks && typeof parsed.resetMarks === 'object' ? parsed.resetMarks : {},
    };
  } catch {
    return emptyState();
  }
}

function writeState(state) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = `${JSON.stringify(state, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, next);
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Windows can leave the temp file if the destination was locked.
    }
  }
}

function seal(text) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('This computer cannot lock logins in its secure store.');
  }
  return safeStorage.encryptString(text).toString('base64');
}

function openSecret(sealed) {
  return safeStorage.decryptString(Buffer.from(sealed, 'base64'));
}

function publicAccount(account, defaultId) {
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    meta: account.meta || {},
    isDefault: Boolean(defaultId) && account.id === defaultId,
  };
}

function listPublic() {
  const state = readState();
  const defaultId = resolveDefaultId(state.accounts, state.settings.defaultAccountId);
  return state.accounts.map((account) => publicAccount(account, defaultId));
}

function getSettings() {
  return readState().settings;
}

function updateSettings(patch) {
  const state = readState();
  state.settings = { ...state.settings, ...patch };
  writeState(state);
  return state.settings;
}

function fingerprint(secret) {
  return crypto.createHash('sha256').update(sessionFromSecret(secret).token).digest('hex');
}

function addAccount({ provider, label, secret, meta }) {
  const state = readState();
  const hash = fingerprint(secret);
  const duplicate = state.accounts.find((account) => account.provider === provider && account.hash === hash);
  if (duplicate) {
    const defaultId = resolveDefaultId(state.accounts, state.settings.defaultAccountId);
    return { account: publicAccount(duplicate, defaultId), created: false };
  }
  const account = {
    id: crypto.randomUUID(),
    provider,
    label: label || provider,
    meta: meta || {},
    hash,
    secret: seal(secret),
  };
  state.accounts.push(account);
  if (state.accounts.length === 1) state.settings.defaultAccountId = account.id;
  writeState(state);
  return { account: publicAccount(account, resolveDefaultId(state.accounts, state.settings.defaultAccountId)), created: true };
}

function updateAccount(id, patch) {
  const state = readState();
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return null;
  if (typeof patch.label === 'string' && patch.label.trim()) account.label = patch.label.trim();
  if (patch.meta && typeof patch.meta === 'object') account.meta = { ...account.meta, ...patch.meta };
  writeState(state);
  const defaultId = resolveDefaultId(state.accounts, state.settings.defaultAccountId);
  return publicAccount(account, defaultId);
}

function setDefaultAccount(id) {
  const state = readState();
  if (!state.accounts.some((account) => account.id === id)) return listPublic();
  state.settings.defaultAccountId = id;
  writeState(state);
  return listPublic();
}

function updateSecret(id, secret) {
  const state = readState();
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return null;
  account.hash = fingerprint(secret);
  account.secret = seal(secret);
  writeState(state);
  const defaultId = resolveDefaultId(state.accounts, state.settings.defaultAccountId);
  return publicAccount(account, defaultId);
}

function removeAccount(id) {
  const state = readState();
  state.accounts = state.accounts.filter((account) => account.id !== id);
  if (state.meters) delete state.meters[id];
  if (state.resetMarks) delete state.resetMarks[id];
  state.settings.defaultAccountId = resolveDefaultId(state.accounts, state.settings.defaultAccountId === id ? null : state.settings.defaultAccountId);
  writeState(state);
  return listPublic();
}

function getResetMarks() {
  const marks = readState().resetMarks;
  return marks && typeof marks === 'object' ? marks : {};
}

function setResetMarks(marks) {
  const state = readState();
  const next = marks && typeof marks === 'object' ? marks : {};
  if (JSON.stringify(state.resetMarks || {}) === JSON.stringify(next)) return;
  state.resetMarks = next;
  writeState(state);
}

function getMeter(id) {
  const meter = readState().meters?.[id];
  return meter && typeof meter === 'object' ? meter : null;
}

function setMeter(id, meter) {
  if (!id || !meter || !Array.isArray(meter.windows) || !meter.windows.length) return;
  const state = readState();
  state.meters[id] = { windows: meter.windows, savedAt: meter.savedAt || new Date().toISOString() };
  writeState(state);
}

function eachSecret() {
  const state = readState();
  const defaultId = resolveDefaultId(state.accounts, state.settings.defaultAccountId);
  return state.accounts.map((account) => {
    let secret = '';
    try {
      secret = openSecret(account.secret);
    } catch {
      secret = '';
    }
    return {
      account: publicAccount(account, defaultId),
      secret,
    };
  });
}

module.exports = {
  listPublic,
  getSettings,
  updateSettings,
  addAccount,
  updateAccount,
  setDefaultAccount,
  updateSecret,
  removeAccount,
  eachSecret,
  getMeter,
  getResetMarks,
  setResetMarks,
  setMeter,
};
