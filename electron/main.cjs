const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, Notification, clipboard } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store.cjs');
const { fetchUsage, KEY_PROVIDERS } = require('../lib/fetch.cjs');
const { cleanSecret, extractCodexAuth, extractGrokAuth, extractOpenCodeKey } = require('../lib/parse.cjs');
const { previewState } = require('../lib/preview.cjs');
const { collectResets, describeResets, resetChimeWav } = require('../lib/reset-alarm.cjs');
const { trayPng } = require('../lib/tray-icon.cjs');
const { remainingLeft, trayDisplay, providerName } = require('../lib/tray.cjs');
const { normalizeLayout, finiteBox, openingSize, placeLayout } = require('../lib/layout.cjs');
const { signIn, cancelSignIn } = require('./browser-login.cjs');

const darwin = process.platform === 'darwin';
const windows = process.platform === 'win32';

const preview = process.argv.includes('--preview') || process.argv.includes('--shot');
const emptyPreview = process.argv.includes('--empty');
const formPreview = process.argv.includes('--form');
const PROVIDERS = new Set([
  'grok', 'minimax', 'codex', 'claude', 'cursor', 'copilot', 'gemini', 'muse',
  'opencode', 'deepseek', 'openrouter', 'kimi', 'moonshot', 'zai', 'vercel', 'poe', 'siliconflow',
]);
// Where OpenCode saves each service's key in its auth file, best name first.
// OpenCode names providers after their models.dev ids.
const OPENCODE_KEY_NAMES = {
  opencode: ['opencode-go', 'opencode'],
  deepseek: ['deepseek'],
  openrouter: ['openrouter'],
  kimi: ['kimi-for-coding', 'kimi-code-plan-global', 'kimi-code-plan-cn'],
  moonshot: ['moonshotai', 'moonshotai-cn'],
  zai: ['zai-coding-plan', 'zhipuai-coding-plan', 'zai', 'zhipuai'],
  vercel: ['vercel'],
  poe: ['poe'],
  siliconflow: ['siliconflow', 'siliconflow-cn'],
};
// MiniMax signs in with a browser, but a Token Plan key reads the same meter.
const MINIMAX_KEY_NAMES = {
  global: ['minimax-coding-plan', 'minimax'],
  cn: ['minimax-cn-coding-plan', 'minimax-cn'],
};

function opencodeKeyNames(provider, region) {
  if (provider === 'minimax') return MINIMAX_KEY_NAMES[region === 'cn' ? 'cn' : 'global'];
  return OPENCODE_KEY_NAMES[provider] || [];
}

function minimaxMeta(region, extra = {}) {
  return { region: region === 'cn' ? 'cn' : 'global', countsAre: 'remaining', ...extra };
}

app.setName('Usage Monitor');
if (windows) app.setAppUserModelId('app.usage.monitor');
if (preview) app.setPath('userData', path.join(os.tmpdir(), 'usage-monitor-preview'));

let win = null;
let tray = null;
let normalBounds = null;
let compact = false;
let layout = 'stacked';
let stackedBounds = null;
let sidewaysBounds = null;
let refreshing = null;
let lastResult = null;
let signInAttempt = 0;
let alarmSound = true;
let pinned = true;
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

function rememberLiveBounds(bounds) {
  const live = finiteBox(bounds);
  if (!live) return;
  if (layout === 'sideways') sidewaysBounds = live;
  else stackedBounds = live;
}

function persistBounds() {
  if (!win || preview) return;
  if (compact && normalBounds) {
    const { x, y } = win.getBounds();
    normalBounds = { ...normalBounds, x, y };
  }
  rememberLiveBounds(compact && normalBounds ? normalBounds : win.getBounds());
  const patch = { layout, pinned };
  // Never write a null box over a size the other orientation still needs.
  if (stackedBounds) patch.bounds = stackedBounds;
  if (sidewaysBounds) patch.sidewaysBounds = sidewaysBounds;
  try {
    store.updateSettings(patch);
  } catch {
    // A bad read must not replace the saved accounts.
  }
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
  alarmSound = settings.alarmSound !== false;
  pinned = settings.pinned !== false;
  const shot = process.argv.includes('--shot');
  layout = normalizeLayout(process.argv.includes('--sideways') ? 'sideways' : settings.layout);
  stackedBounds = finiteBox(settings.bounds);
  sidewaysBounds = finiteBox(settings.sidewaysBounds);
  const opening = openingSize(layout, { bounds: stackedBounds, sidewaysBounds });
  // The first sideways open has no saved corner yet. Keep the stacked window's place.
  if (!Number.isFinite(opening.x) && stackedBounds && Number.isFinite(stackedBounds.x)) {
    opening.x = Math.round(stackedBounds.x);
    opening.y = Math.round(stackedBounds.y);
  }
  const width = shot ? (layout === 'sideways' ? 860 : 304) : opening.width;
  const height = shot ? (layout === 'sideways' ? 168 : 652) : opening.height;
  win = new BrowserWindow({
    width,
    height,
    x: Number.isFinite(opening.x) ? opening.x : undefined,
    y: Number.isFinite(opening.y) ? opening.y : undefined,
    minWidth: opening.minWidth,
    minHeight: opening.minHeight,
    show: false,
    frame: false,
    transparent: !windows,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: darwin,
    alwaysOnTop: pinned,
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

  if (pinned) pinWindow(win, true);
  applyTransparency(settings.transparency);

  const query = {};
  if (process.argv.includes('--menu')) query.menu = '1';
  if (process.argv.includes('--compact')) query.compact = '1';
  if (layout === 'sideways') query.layout = 'sideways';
  const demoAlarm = preview && process.argv.includes('--alarm');
  const showDemoAlarm = () => {
    setTimeout(() => {
      presentResetAlarm([
        { provider: 'codex', accountLabel: 'Work', windowLabel: '5 hours' },
        { provider: 'claude', accountLabel: 'Claude', windowLabel: 'Week' },
        { provider: 'grok', accountLabel: 'Personal', windowLabel: 'Month' },
      ]);
    }, 400);
  };
  win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  win.once('ready-to-show', () => {
    win.show();
    if (demoAlarm) showDemoAlarm();
  });
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
      const snapshot = await fetchUsage({
        ...account,
        meta: { ...(account.meta || {}), museMeter: store.getMeter(account.id) },
      }, secret);
      if (snapshot.secret) {
        try {
          store.updateSecret(account.id, snapshot.secret);
        } catch {
          // The refreshed session still works for this pass even if it could not be locked.
        }
        delete snapshot.secret;
      }
      if (snapshot.meter) {
        try {
          store.setMeter(account.id, snapshot.meter);
        } catch {
          // This pass still shows the reading if the last real week could not be saved.
        }
        delete snapshot.meter;
      }
      snapshots[account.id] = snapshot;
    }));
    const result = { accounts: store.listPublic(), snapshots };
    updateTray(result);
    const found = collectResets({
      marks: store.getResetMarks(),
      accounts: result.accounts,
      snapshots,
    });
    try {
      store.setResetMarks(found.marks);
    } catch {
      // Leave the saved deadlines alone when the account file could not be read.
    }
    if (found.events.length) presentResetAlarm(found.events);
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
  if (KEY_PROVIDERS.has(provider) || provider === 'minimax') {
    const data = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return path.join(data, 'opencode', 'auth.json');
  }
  return null;
}

// A key is read once before it is saved, so a typo or a key for the wrong
// service never lands on the board as a permanent error card.
async function saveKey(provider, secret, label, meta = {}) {
  const key = cleanSecret(secret).replace(/^bearer\s+/i, '');
  if (!key) return { ok: false, error: 'Paste a key first.' };
  const check = await fetchUsage({ id: 'new', provider, label, meta }, key);
  if (!check.ok) return { ok: false, error: check.error };
  try {
    const saved = store.addAccount({ provider, label: label || providerName(provider), secret: key, meta });
    return { ok: true, account: saved.account, created: saved.created };
  } catch (error) {
    return { ok: false, error: error.message || 'The key could not be saved.' };
  }
}

async function importOpenCodeKey(provider, file, options = {}) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, error: 'That file could not be read as OpenCode login data.' };
  }
  const found = extractOpenCodeKey(data, opencodeKeyNames(provider, options.region));
  if (!found) {
    return { ok: false, missing: true, error: `OpenCode has no saved ${providerName(provider)} key on this computer.` };
  }
  const meta = provider === 'minimax' ? minimaxMeta(options.region, { keyAuth: true }) : {};
  const saved = await saveKey(provider, found.key, String(options.label || '').trim(), meta);
  if (!saved.ok) return saved;
  return { ok: true, created: saved.created ? 1 : 0, skipped: saved.created ? 0 : 1 };
}

function normalizeTransparency(value) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return 0;
  return Math.min(100, Math.max(0, Math.round(next / 5) * 5));
}

function opacityForTransparency(percent) {
  return 1 - (normalizeTransparency(percent) / 100) * 0.5;
}

function applyTransparency(percent) {
  const transparency = normalizeTransparency(percent);
  if (win && process.platform === 'win32') win.setOpacity(opacityForTransparency(transparency));
  return transparency;
}

ipcMain.handle('window:state', () => ({
  pinned,
  preview,
  form: formPreview ? 'claude' : '',
  theme: store.getSettings().theme || 'ion',
  refreshMinutes: normalizeRefresh(store.getSettings().refreshMinutes),
  alarmSound,
  transparency: normalizeTransparency(store.getSettings().transparency),
  platform: process.platform,
  layout,
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

ipcMain.handle('window:alarm-sound', (_event, enabled) => {
  const next = Boolean(enabled);
  if (!preview) store.updateSettings({ alarmSound: next });
  alarmSound = next;
  return next;
});

ipcMain.handle('window:test-alarm', () => {
  presentResetAlarm([
    { accountId: 'example', provider: 'codex', accountLabel: 'Example', windowLabel: '5 hours' },
  ]);
  return true;
});

ipcMain.handle('window:theme', (_event, theme) => {
  const next = ['ion', 'ember', 'void'].includes(theme) ? theme : 'ion';
  if (!preview) store.updateSettings({ theme: next });
  return next;
});

ipcMain.handle('window:transparency', (_event, percent) => {
  const next = normalizeTransparency(percent);
  if (!preview) store.updateSettings({ transparency: next });
  return applyTransparency(next);
});

ipcMain.handle('window:pin', (_event, enabled) => {
  if (!win) return false;
  const next = Boolean(enabled);
  pinWindow(win, next);
  pinned = next;
  if (!preview) store.updateSettings({ pinned: next });
  return next;
});

function applyLayoutSize(nextLayout, remembered) {
  const current = compact && normalBounds ? normalBounds : win.getBounds();
  const placed = placeLayout(nextLayout, remembered, current);
  layout = placed.layout;
  compact = false;
  normalBounds = null;
  win.setMinimumSize(placed.box.minWidth, placed.box.minHeight);
  const next = {
    width: placed.box.width,
    height: placed.box.height,
  };
  if (Number.isFinite(placed.box.x)) next.x = placed.box.x;
  if (Number.isFinite(placed.box.y)) next.y = placed.box.y;
  win.setBounds(next);
}

ipcMain.handle('window:layout', (_event, value) => {
  if (!win) return layout;
  const next = normalizeLayout(value);
  if (next === layout) return layout;
  rememberLiveBounds(compact && normalBounds ? normalBounds : win.getBounds());
  applyLayoutSize(next, { bounds: stackedBounds, sidewaysBounds });
  persistBounds();
  return layout;
});

ipcMain.handle('window:compact', (_event, payload) => {
  if (!win) return false;
  const next = Boolean(payload?.compact);
  const height = Math.max(88, Math.min(720, Math.round(Number(payload?.height) || 140)));
  const mins = openingSize(layout, { bounds: stackedBounds, sidewaysBounds });
  if (next) {
    if (!compact) {
      normalBounds = win.getBounds();
      compact = true;
    }
    win.setMinimumSize(mins.minWidth, 88);
    win.setSize(normalBounds?.width || win.getBounds().width, height, false);
    return true;
  }
  if (compact) {
    compact = false;
    const restore = normalBounds;
    normalBounds = null;
    win.setMinimumSize(mins.minWidth, mins.minHeight);
    if (restore) win.setBounds(restore);
  }
  return false;
});

ipcMain.handle('window:hide', () => {
  hideWindow();
  return true;
});

function playResetChime() {
  try {
    const file = path.join(os.tmpdir(), 'usage-monitor-reset-chime.wav');
    fs.writeFileSync(file, resetChimeWav());
    let player;
    if (darwin) {
      player = spawn('afplay', [file], { detached: true, stdio: 'ignore' });
    } else if (windows) {
      const safe = file.replace(/'/g, "''");
      player = spawn('powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${safe}').PlaySync()`], {
        detached: true,
        stdio: 'ignore',
      });
    }
    if (player) {
      player.on('error', () => {});
      player.unref();
    }
  } catch {
    // The notice still appears if sound is unavailable.
  }
}

function presentResetAlarm(events) {
  if (!events.length || !win || win.isDestroyed()) return;
  const described = describeResets(events);
  if (!win.isVisible()) win.showInactive();
  if (alarmSound) playResetChime();
  win.webContents.send('usage:reset-alarm', described);
}

ipcMain.handle('usage:refresh', () => refreshAll());

ipcMain.handle('auth:signin', async (_event, payload) => {
  if (preview) return { ok: false, error: 'Preview mode does not sign in.' };
  const provider = payload?.provider;
  if (!PROVIDERS.has(provider)) return { ok: false, error: 'Choose a service first.' };
  if (KEY_PROVIDERS.has(provider)) return { ok: false, error: `${providerName(provider)} uses an API key. Paste it instead.` };
  const attempt = ++signInAttempt;
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
    if (result.canceled || attempt !== signInAttempt) return { ok: false, canceled: true };
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
    if (attempt === signInAttempt) {
      pinWindow(win, pinned);
      showWindow();
    }
  }
});

ipcMain.handle('auth:cancel', () => {
  signInAttempt += 1;
  cancelSignIn();
  pinWindow(win, pinned);
  return true;
});

ipcMain.handle('accounts:add', async (_event, payload) => {
  if (preview) return { ok: false, error: 'Preview mode does not save accounts.' };
  const provider = payload?.provider;
  const secret = cleanSecret(payload?.secret);
  const label = String(payload?.label || '').trim();
  if (!PROVIDERS.has(provider)) return { ok: false, error: 'Choose a service first.' };
  if (!secret) return { ok: false, error: KEY_PROVIDERS.has(provider) ? 'Paste a key first.' : 'Paste a login first.' };
  try {
    if (KEY_PROVIDERS.has(provider)) return await saveKey(provider, secret, label);
    // A pasted MiniMax Token Plan key is checked like any other key.
    if (provider === 'minimax') return await saveKey(provider, secret, label, minimaxMeta(payload?.region, { keyAuth: true }));
    const meta = {};
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

function canImport(provider) {
  return provider === 'codex' || provider === 'grok' || provider === 'minimax' || KEY_PROVIDERS.has(provider);
}

function readsOpenCode(provider) {
  return KEY_PROVIDERS.has(provider) || provider === 'minimax';
}

ipcMain.handle('auth:import', async (_event, provider, options) => {
  if (preview) return { ok: false, error: 'Preview mode does not import logins.' };
  if (!canImport(provider)) {
    return { ok: false, error: 'This service cannot import a login file.' };
  }
  const file = defaultAuthFile(provider);
  if (!file || !fs.existsSync(file)) {
    if (readsOpenCode(provider)) {
      return { ok: false, missing: true, error: 'No OpenCode login file was found on this computer.' };
    }
    return { ok: false, missing: true, error: provider === 'codex'
      ? 'No Codex login was found on this computer.'
      : 'No Grok login was found on this computer.' };
  }
  if (readsOpenCode(provider)) return importOpenCodeKey(provider, file, options || {});
  return importPayload(provider, file);
});

ipcMain.handle('auth:choose', async (_event, provider, options) => {
  if (preview) return { ok: false, error: 'Preview mode does not import logins.' };
  if (!canImport(provider)) {
    return { ok: false, error: 'This service cannot import a login file.' };
  }
  const file = await chooseFile();
  if (!file) return { ok: false, canceled: true };
  if (readsOpenCode(provider)) return importOpenCodeKey(provider, file, options || {});
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
