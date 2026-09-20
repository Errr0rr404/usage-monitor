const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, Notification, clipboard } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store.cjs');
const { fetchUsage } = require('../lib/fetch.cjs');
const { cleanSecret, extractCodexAuth, extractGrokAuth } = require('../lib/parse.cjs');
const { previewState } = require('../lib/preview.cjs');
const { trayPng } = require('../lib/tray-icon.cjs');
const { remainingLeft, trayDisplay, providerName } = require('../lib/tray.cjs');
const { signIn, cancelSignIn } = require('./browser-login.cjs');

const darwin = process.platform === 'darwin';
const windows = process.platform === 'win32';

const preview = process.argv.includes('--preview') || process.argv.includes('--shot');
const emptyPreview = process.argv.includes('--empty');
const formPreview = process.argv.includes('--form');
const PROVIDERS = new Set(['grok', 'minimax', 'codex', 'claude', 'cursor', 'copilot', 'gemini']);

app.setName('Usage Monitor');
if (windows) app.setAppUserModelId('app.usage.monitor');

let win = null;
let tray = null;
let normalBounds = null;
let compact = false;
let refreshing = null;
let lastResult = null;
const limitState = new Map();

function pruneLimitState(accountId) {
  for (const key of [...limitState.keys()]) {
    if (key.startsWith(`${accountId}:`)) limitState.delete(key);
  }
}

function trayNativeImage(left) {
  const icon = nativeImage.createEmpty();
  const base = darwin ? 22 : 16;
  for (const scaleFactor of [1, 2]) {
    const size = base * scaleFactor;
    icon.addRepresentation({
      scaleFactor,
      width: size,
      height: size,
      buffer: trayPng(size, { left }),
    });
  }
  icon.setTemplateImage(false);
  return icon;
}

function hideDock() {
  if (!darwin) return;
  if (typeof app.setActivationPolicy === 'function') app.setActivationPolicy('accessory');
  else if (app.dock) app.dock.hide();
}

function updateTray(result) {
  if (result) lastResult = result;
  if (!tray || !lastResult) return;
  const display = trayDisplay(lastResult);
  tray.setImage(trayNativeImage(display.left));
  tray.setToolTip(display.tooltip);
  if (darwin) tray.setTitle(display.percentText);
  if (!Notification.isSupported()) return;
  for (const account of lastResult.accounts || []) {
    const snapshot = lastResult.snapshots?.[account.id];
    if (!snapshot?.ok) continue;
    for (const window of snapshot.windows || []) {
      const left = remainingLeft(window);
      if (left == null) continue;
      const key = `${account.id}:${window.key}`;
      const low = left < 15;
      const previous = limitState.get(key);
      limitState.set(key, low ? 'low' : 'ok');
      if (previous === 'ok' && low) {
        new Notification({
          title: 'Usage Monitor is running low',
          body: `${providerName(account.provider)} ${window.label} has ${Math.round(left)}% left.`,
        }).show();
      }
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function persistBounds() {
  if (!win || preview) return;
  const bounds = normalBounds || win.getBounds();
  store.updateSettings({ bounds, pinned: win.isAlwaysOnTop() });
}

function showWindow() {
  if (!win) return;
  win.show();
  if (darwin && typeof app.focus === 'function') app.focus({ steal: true });
  win.focus();
  hideDock();
}

function hideWindow() {
  if (win) win.hide();
}

function pinWindow(target, pinned) {
  if (!target) return;
  if (darwin) {
    target.setAlwaysOnTop(pinned, 'floating');
    target.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: true });
    return;
  }
  target.setAlwaysOnTop(pinned);
}

function createTray() {
  tray = new Tray(trayNativeImage(null));
  tray.setToolTip('Usage Monitor');
  const menu = Menu.buildFromTemplate([
    { label: 'Show Usage Monitor', click: showWindow },
    { label: 'Refresh', click: () => { showWindow(); if (win) win.webContents.send('usage:refresh-request'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  const toggle = () => {
    if (!win) return;
    if (win.isVisible()) hideWindow();
    else showWindow();
  };
  // Windows left-click should open the board; the context menu stays on right-click.
  tray.on('click', windows ? showWindow : toggle);
  tray.on('double-click', showWindow);
}

function createWindow() {
  const settings = preview ? { pinned: true, bounds: null } : store.getSettings();
  const shot = process.argv.includes('--shot');
  const saved = settings.bounds || {};
  const width = saved.width || 304;
  const height = saved.height || 500;
  const bounds = { ...saved, width: shot ? 304 : width, height: shot ? 652 : height };
  win = new BrowserWindow({
    width: Math.max(280, bounds.width || 304),
    height: Math.max(360, bounds.height || 500),
    x: Number.isFinite(bounds.x) ? bounds.x : undefined,
    y: Number.isFinite(bounds.y) ? bounds.y : undefined,
    minWidth: 280,
    minHeight: 240,
    show: false,
    frame: false,
    transparent: !windows,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: darwin,
    alwaysOnTop: settings.pinned !== false,
    hasShadow: true,
    roundedCorners: true,
    title: 'Usage Monitor',
    icon: path.join(__dirname, '../build/icon.png'),
    backgroundColor: windows ? '#070b10' : '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (settings.pinned !== false) pinWindow(win, true);

  const query = {};
  if (process.argv.includes('--menu')) query.menu = '1';
  if (process.argv.includes('--compact')) query.compact = '1';
  win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    if (preview) return;
    event.preventDefault();
    hideWindow();
  });
  win.on('move', persistBounds);
  win.on('resize', () => {
    if (!compact) persistBounds();
  });

  if (process.argv.includes('--shot')) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, process.argv.includes('--compact') ? 1600 : 900));
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(os.tmpdir(), 'usage-preview.png'), image.toPNG());
      app.exit(0);
    });
  }
}

function accountsForRefresh() {
  if (!preview) return null;
  if (emptyPreview) return { accounts: [], snapshots: {} };
  return previewState();
}

async function refreshAll() {
  const canned = accountsForRefresh();
  if (canned) {
    updateTray(canned);
    return canned;
  }
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rows = store.eachSecret();
    const snapshots = {};
    await Promise.all(rows.map(async ({ account, secret }) => {
      if (!secret) {
        snapshots[account.id] = {
          ok: false,
          error: 'The saved login could not be unlocked. Remove it and add it again.',
          windows: [],
          plan: null,
          identity: null,
          fetchedAt: new Date().toISOString(),
        };
        return;
      }
      const snapshot = await fetchUsage(account, secret);
      if (snapshot.secret) {
        try {
          store.updateSecret(account.id, snapshot.secret);
        } catch {
          // The refreshed session still works for this pass even if it could not be locked.
        }
        delete snapshot.secret;
      }
      snapshots[account.id] = snapshot;
    }));
    const result = { accounts: store.listPublic(), snapshots };
    updateTray(result);
    return result;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function importPayload(provider, file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, error: 'That file could not be read as login data.' };
  }
  if (provider === 'codex') {
    const auth = extractCodexAuth(data);
    if (!auth) return { ok: false, error: 'That file has no Codex access token.' };
    const saved = store.addAccount({
      provider: 'codex',
      label: auth.email || 'Codex',
      secret: auth.accessToken,
      meta: auth.accountId ? { accountId: auth.accountId } : {},
    });
    return { ok: true, created: saved.created ? 1 : 0, skipped: saved.created ? 0 : 1 };
  }
  const entries = extractGrokAuth(data).filter((entry) => {
    if (!entry.expiresAt) return true;
    const time = new Date(entry.expiresAt).getTime();
    return Number.isNaN(time) || time > Date.now();
  });
  if (!entries.length) {
    return { ok: false, error: 'No current Grok login was in that file. Run grok login, then import again.' };
  }
  let created = 0;
  let skipped = 0;
  entries.forEach((entry, index) => {
    const saved = store.addAccount({
      provider: 'grok',
      label: entry.email || (entries.length > 1 ? `Grok ${index + 1}` : 'Grok'),
      secret: entry.token,
      meta: {},
    });
    if (saved.created) created += 1;
    else skipped += 1;
  });
  return { ok: true, created, skipped };
}

function defaultAuthFile(provider) {
  const home = app.getPath('home');
  if (provider === 'codex') return path.join(home, '.codex', 'auth.json');
  if (provider === 'grok') return path.join(home, '.grok', 'auth.json');
  return null;
}

ipcMain.handle('window:state', () => ({
  pinned: win ? win.isAlwaysOnTop() : true,
  preview,
  form: formPreview ? 'claude' : '',
  theme: store.getSettings().theme || 'ion',
  refreshMinutes: normalizeRefresh(store.getSettings().refreshMinutes),
  platform: process.platform,
}));

const REFRESH_MINUTES = new Set([0, 1, 5, 15, 30]);

function normalizeRefresh(value) {
  const next = Number(value);
  return REFRESH_MINUTES.has(next) ? next : 5;
}

ipcMain.handle('window:refresh', (_event, minutes) => {
  const next = normalizeRefresh(minutes);
  if (!preview) store.updateSettings({ refreshMinutes: next });
  return next;
});

ipcMain.handle('window:theme', (_event, theme) => {
  const next = ['ion', 'ember', 'void'].includes(theme) ? theme : 'ion';
  if (!preview) store.updateSettings({ theme: next });
  return next;
});

ipcMain.handle('window:pin', (_event, pinned) => {
  if (!win) return false;
  const next = Boolean(pinned);
  pinWindow(win, next);
  if (!preview) store.updateSettings({ pinned: next });
  return next;
});

ipcMain.handle('window:compact', (_event, payload) => {
  if (!win) return false;
  const next = Boolean(payload?.compact);
  const height = Math.max(88, Math.min(720, Math.round(Number(payload?.height) || 140)));
  if (next) {
    if (!compact) {
      normalBounds = win.getBounds();
      compact = true;
    }
    win.setMinimumSize(280, 88);
    win.setSize(normalBounds?.width || win.getBounds().width, height, false);
    return true;
  }
  if (compact) {
    compact = false;
    const restore = normalBounds;
    normalBounds = null;
    if (restore) win.setBounds(restore);
    win.setMinimumSize(280, 240);
  }
  return false;
});

ipcMain.handle('window:hide', () => {
  hideWindow();
  return true;
});

ipcMain.handle('usage:refresh', () => refreshAll());

ipcMain.handle('auth:signin', async (_event, payload) => {
  if (preview) return { ok: false, error: 'Preview mode does not sign in.' };
  const provider = payload?.provider;
  if (!PROVIDERS.has(provider)) return { ok: false, error: 'Choose a service first.' };
  const wasOnTop = win ? win.isAlwaysOnTop() : false;
  if (win) win.setAlwaysOnTop(false);
  try {
    const result = await signIn(provider, {
      region: payload?.region,
      onProgress: (hint) => {
        if (hint?.code) {
          clipboard.writeText(String(hint.code));
          showWindow();
        }
        if (win && !win.isDestroyed()) win.webContents.send('auth:hint', hint);
      },
    });
    if (result.canceled) return { ok: false, canceled: true };
    if (!result.ok || !result.secret) {
      return { ok: false, error: result.error || 'Sign-in did not finish.' };
    }
    const meta = {};
    if (provider === 'minimax') {
      meta.region = payload?.region === 'cn' ? 'cn' : 'global';
      meta.countsAre = 'remaining';
    }
    if (provider === 'codex' && result.accountId) meta.accountId = result.accountId;
    const saved = store.addAccount({
      provider,
      label: String(payload?.label || '').trim() || result.email || providerName(provider),
      secret: result.secret,
      meta,
    });
    return { ok: true, account: saved.account, created: saved.created };
  } catch (error) {
    return { ok: false, error: error.message || 'Sign-in could not finish.' };
  } finally {
    if (win && wasOnTop) pinWindow(win, true);
    showWindow();
  }
});

ipcMain.handle('auth:cancel', () => {
  cancelSignIn();
  return true;
});

ipcMain.handle('accounts:add', (_event, payload) => {
  if (preview) return { ok: false, error: 'Preview mode does not save accounts.' };
  const provider = payload?.provider;
  const secret = cleanSecret(payload?.secret);
  const label = String(payload?.label || '').trim();
  if (!PROVIDERS.has(provider)) return { ok: false, error: 'Choose a service first.' };
  if (!secret) return { ok: false, error: 'Paste a login first.' };
  try {
    const meta = {};
    if (provider === 'minimax') meta.region = payload?.region === 'cn' ? 'cn' : 'global';
    if (provider === 'minimax') meta.countsAre = 'remaining';
    const saved = store.addAccount({
      provider,
      label: label || providerName(provider),
      secret,
      meta,
    });
    return { ok: true, account: saved.account, created: saved.created };
  } catch (error) {
    return { ok: false, error: error.message || 'The login could not be saved.' };
  }
});

ipcMain.handle('accounts:update', (_event, id, patch) => {
  if (preview) return null;
  return store.updateAccount(id, patch || {});
});

ipcMain.handle('accounts:default', (_event, id) => {
  if (preview) {
    const canned = lastResult || previewState();
    canned.accounts = canned.accounts.map((account) => ({ ...account, isDefault: account.id === id }));
    updateTray(canned);
    return canned.accounts;
  }
  const accounts = store.setDefaultAccount(id);
  if (lastResult) {
    lastResult.accounts = accounts;
    updateTray(lastResult);
  }
  return accounts;
});

ipcMain.handle('accounts:remove', (_event, id) => {
  if (preview) return (lastResult || previewState()).accounts;
  const accounts = store.removeAccount(id);
  pruneLimitState(id);
  if (lastResult) {
    lastResult.accounts = accounts;
    delete lastResult.snapshots[id];
    updateTray(lastResult);
  }
  return accounts;
});

async function chooseFile() {
  const picked = await dialog.showOpenDialog(win, {
    title: 'Choose a login file',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  return picked.filePaths[0];
}

ipcMain.handle('auth:import', async (_event, provider) => {
  if (preview) return { ok: false, error: 'Preview mode does not import logins.' };
  if (provider !== 'codex' && provider !== 'grok') {
    return { ok: false, error: 'Only Codex and Grok can import a login file.' };
  }
  const file = defaultAuthFile(provider);
  if (!file || !fs.existsSync(file)) {
    return { ok: false, missing: true, error: provider === 'codex'
      ? 'No Codex login was found on this computer.'
      : 'No Grok login was found on this computer.' };
  }
  return importPayload(provider, file);
});

ipcMain.handle('auth:choose', async (_event, provider) => {
  if (preview) return { ok: false, error: 'Preview mode does not import logins.' };
  if (provider !== 'codex' && provider !== 'grok') {
    return { ok: false, error: 'Only Codex and Grok can import a login file.' };
  }
  const file = await chooseFile();
  if (!file) return { ok: false, canceled: true };
  return importPayload(provider, file);
});

app.whenReady().then(() => {
  hideDock();
  createTray();
  createWindow();
  app.on('activate', () => {
    if (!win) createWindow();
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  if (preview) app.quit();
});

app.on('before-quit', () => {
  if (win) win.removeAllListeners('close');
});
