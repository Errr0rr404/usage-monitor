const PROVIDERS = [
  {
    id: 'grok',
    name: 'Grok',
    help: 'Your usual browser opens the Grok login. The approval page says Grok CLI, because that is the public login that can hand the session back to this computer. The session stays here.',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    help: 'Your usual browser opens the MiniMax login for the region you picked. The approval page says MiniMax CLI. If it asks for a code, Usage Monitor shows it here. The session stays on this computer.',
  },
  {
    id: 'codex',
    name: 'Codex',
    help: 'Your usual browser opens the ChatGPT login. The approval page says Codex, because that is the public login that can hand the session back to this computer. The session stays here.',
  },
  {
    id: 'claude',
    name: 'Claude',
    help: 'Your usual browser opens the Claude login. The approval page says Claude Code, because that is the public login that can hand the session back to this computer. The session stays here.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    help: 'Your usual browser opens the Cursor login. Approve it there and the session comes back to this computer. Usage Monitor does not read your browser cookies.',
  },
  {
    id: 'copilot',
    name: 'Copilot',
    help: 'Your usual browser opens the GitHub device login. The approval page says Visual Studio Code, because that is the public login that can hand a Copilot session back to this computer. GitHub asks for a code. Usage Monitor shows that code in this window and copies it.',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    help: 'Your usual browser opens the Google login. The approval page says Antigravity, because Google retired the Gemini CLI login for personal accounts. The session stays on this computer.',
  },
  {
    id: 'muse',
    name: 'Muse',
    help: 'Your usual browser opens the Meta login. Meta asks for a code. Usage Monitor shows that code in this window and copies it. Only Meta accounts with a Muse Code subscription report usage.',
  },
];

const ORDER = ['grok', 'minimax', 'codex', 'claude', 'cursor', 'copilot', 'gemini', 'muse'];

const state = {
  accounts: [],
  snapshots: {},
  pinned: true,
  compact: false,
  formOpen: false,
  provider: 'grok',
  region: 'global',
  refreshing: false,
  saving: false,
  pendingRemove: null,
  formError: '',
  boardError: '',
  hint: '',
  deviceCode: '',
  theme: 'ion',
  menuOpen: false,
  platform: 'darwin',
  refreshMinutes: 5,
};

const board = document.getElementById('board');
const form = document.getElementById('form');
const footerForm = document.getElementById('footer-form');
const menu = document.getElementById('menu');
const settingsButton = document.getElementById('settings');
const help = document.getElementById('help');
const deviceCode = document.getElementById('device-code');
const formError = document.getElementById('form-error');
const regionField = document.getElementById('region-field');
const pinButton = document.getElementById('pin');
const compactButton = document.getElementById('compact');
const refreshButton = document.getElementById('refresh');
const saveButton = document.getElementById('save');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function iconStar(filled) {
  const fill = filled ? 'currentColor' : 'none';
  return `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.9 9.7 5.4l3.8.6-2.8 2.7.7 3.8L8 10.7 4.6 12.5l.7-3.8L2.5 6l3.8-.6z" fill="${fill}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path></svg>`;
}

function iconClose() {
  return `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg>`;
}

function providerName(id) {
  return PROVIDERS.find((item) => item.id === id)?.name || 'Account';
}

function titlePlan(plan) {
  if (!plan) return '';
  if (/[A-Z]/.test(plan.slice(1))) return plan;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatMoney(value) {
  const digits = Math.abs(value % 1) < 0.001 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function phraseFromMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  if (ms <= 30000) return 'resets now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  if (hours < 48) return minutes ? `resets in ${hours}h ${minutes}m` : `resets in ${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `resets in ${days}d ${rest}h` : `resets in ${days}d`;
}

function resetPhrase(window) {
  if (window.resetsAt) {
    const ms = new Date(window.resetsAt).getTime() - Date.now();
    if (!Number.isNaN(ms)) return phraseFromMs(ms);
  }
  if (window.resetsInMs) return phraseFromMs(Number(window.resetsInMs));
  return '';
}

function presentWindow(window) {
  const reset = resetPhrase(window);
  if (window.unit === 'unlimited') {
    return { value: 'Unlimited', unit: '', note: reset, left: 100, tone: 'ok', bar: true };
  }
  if (window.unit === 'credits') {
    return {
      value: formatCount(window.limit || 0),
      unit: 'left',
      note: '',
      left: 100,
      tone: 'ok',
      bar: false,
    };
  }
  if (window.unit === 'dollars' && window.limit != null && window.used != null) {
    const leftAmount = Math.max(0, window.limit - window.used);
    const left = window.limit > 0 ? (leftAmount / window.limit) * 100 : 0;
    return {
      value: formatMoney(leftAmount),
      unit: 'left',
      note: `of ${formatMoney(window.limit)}`,
      left,
      tone: toneFor(left),
      bar: true,
    };
  }
  if (window.unit === 'count' && window.limit != null && window.used != null) {
    const leftAmount = Math.max(0, window.limit - window.used);
    const left = window.limit > 0 ? (leftAmount / window.limit) * 100 : 0;
    const note = [`of ${formatCount(window.limit)}`, reset].filter(Boolean).join(', ');
    return {
      value: formatCount(leftAmount),
      unit: 'left',
      note,
      left,
      tone: toneFor(left),
      bar: true,
    };
  }
  if (window.usedPercent == null) {
    return { value: 'Unknown', unit: '', note: reset, left: 0, tone: 'ok', bar: false };
  }
  const left = Math.max(0, 100 - window.usedPercent);
  const rounded = left >= 10 || left === 0 ? Math.round(left) : Math.round(left * 10) / 10;
  return {
    value: `${rounded}%`,
    unit: 'left',
    note: reset,
    left,
    tone: toneFor(left),
    bar: true,
  };
}

function toneFor(left) {
  if (left <= 0) return 'empty';
  if (left < 15) return 'low';
  return 'ok';
}

function tightest(windows) {
  const scored = (windows || []).filter((window) => window.usedPercent != null && window.unit !== 'unlimited' && window.unit !== 'credits');
  if (!scored.length) return (windows || [])[0] || null;
  return scored.reduce((best, window) => (window.usedPercent > best.usedPercent ? window : best));
}

function gaugeMarkup(left, tone) {
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, left));
  const drawn = (clamped / 100) * circumference;
  return `<svg class="gauge ${tone}" viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="${radius}"></circle><circle class="value" cx="18" cy="18" r="${radius}" stroke-dasharray="${drawn.toFixed(2)} ${circumference.toFixed(2)}"></circle></svg>`;
}

function renderMeter(window) {
  const view = presentWindow(window);
  if (!view.bar) {
    return `<p class="meter-fallback">${esc(window.label)} ${esc(view.value)}${view.unit ? ` ${esc(view.unit)}` : ''}</p>`;
  }
  const percent = String(view.value).includes('%');
  const noteText = percent ? view.note : [view.value, view.unit, view.note].filter(Boolean).join(' ');
  const note = noteText ? `<p class="meter-note">${esc(noteText)}</p>` : '';
  return `<div class="dial-item"><div class="dial" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(view.left)}" aria-label="${esc(window.label)}, ${esc(view.value)} ${esc(view.unit)}">${gaugeMarkup(view.left, view.tone)}<span class="dial-figure ${view.tone}">${Math.round(view.left)}</span></div><div class="dial-copy"><div class="meter-label">${esc(window.label)}</div>${note}</div></div>`;
}

function renderAccount(account) {
  const snapshot = state.snapshots[account.id];
  const plan = titlePlan(snapshot?.plan);
  const confirming = state.pendingRemove === account.id;
  const canChooseDefault = state.accounts.length > 1;
  const defaultLabel = account.isDefault ? 'Default' : 'Set default';
  const defaultAction = canChooseDefault
    ? `<button type="button" data-default="${esc(account.id)}" aria-pressed="${account.isDefault ? 'true' : 'false'}" aria-label="${defaultLabel}" title="${defaultLabel}">${iconStar(account.isDefault)}</button>`
    : '';
  const removeLabel = confirming ? 'Confirm remove' : 'Remove';
  const actions = `${defaultAction}<button type="button" class="${confirming ? 'danger' : ''}" data-remove="${esc(account.id)}" aria-label="${removeLabel}" title="${removeLabel}">${iconClose()}</button>`;
  let body = '<p class="meter-note">Checking…</p>';
  if (snapshot?.ok === false) body = `<p class="error">${esc(snapshot.error || 'Could not load usage.')}</p>`;
  else if (snapshot?.ok) {
    body = snapshot.windows.length
      ? `<div class="dials">${snapshot.windows.map(renderMeter).join('')}</div>`
      : '<p class="meter-note">No usage window came back.</p>';
  } else if (!state.refreshing) body = '<p class="meter-note">Not checked yet.</p>';

  return `<article class="account">
    <div class="account-head">
      <h3>${plan ? esc(plan) : ''}</h3>
      <div class="account-actions">${actions}</div>
    </div>
    ${body}
  </article>`;
}

function renderBoard() {
  if (state.formOpen) return;
  if (!state.accounts.length) {
    board.innerHTML = `<div class="empty">
      ${state.boardError ? `<p class="error">${esc(state.boardError)}</p>` : ''}
      <p>Add an account to see what is left. Each service can hold more than one login. Hide keeps Usage Monitor running in the background.</p>
      <div class="choice-grid">
        ${PROVIDERS.map((item) => `<button type="button" data-open="${item.id}">${item.name}</button>`).join('')}
      </div>
    </div>`;
    return;
  }

  if (state.compact) {
    board.innerHTML = state.accounts.map((account) => {
      const snapshot = state.snapshots[account.id];
      let reading = 'Checking…';
      if (snapshot?.ok === false) reading = 'Needs a new login';
      else if (snapshot?.ok) {
        const window = tightest(snapshot.windows);
        if (!window) reading = 'No window';
        else {
          const view = presentWindow(window);
          reading = `${window.label} ${view.value}${view.unit ? ` ${view.unit}` : ''}`;
        }
      }
      return `<div class="compact-row"><strong>${esc(providerName(account.provider))}</strong><span>${esc(reading)}</span></div>`;
    }).join('');
    return;
  }

  const groups = ORDER.map((id) => ({
    id,
    name: providerName(id),
    accounts: state.accounts.filter((account) => account.provider === id),
  })).filter((group) => group.accounts.length);

  const groupsHtml = groups.map((group) => `
    <section class="group">
      <h2>${esc(group.name)}</h2>
      ${group.accounts.map(renderAccount).join('')}
    </section>
  `).join('');
  const boardError = state.boardError ? `<p class="error">${esc(state.boardError)}</p>` : '';
  board.innerHTML = boardError + groupsHtml;
}

function renderChrome() {
  pinButton.setAttribute('aria-pressed', state.pinned ? 'true' : 'false');
  document.getElementById('pin-note').textContent = state.platform === 'darwin'
    ? 'Stays above other windows, on every desktop.'
    : 'Stays above other windows.';
  compactButton.textContent = state.compact ? 'Show gauges' : 'Compact';
  refreshButton.textContent = state.refreshing ? 'Refreshing' : 'Refresh';
  refreshButton.disabled = state.refreshing;
  saveButton.disabled = state.saving;
  saveButton.textContent = state.saving ? 'Waiting for sign-in' : 'Sign in';
  form.hidden = !state.formOpen;
  board.hidden = state.formOpen;
  footerForm.hidden = !state.formOpen;
  menu.hidden = !state.menuOpen || state.formOpen;
  settingsButton.setAttribute('aria-expanded', state.menuOpen && !state.formOpen ? 'true' : 'false');
  settingsButton.hidden = state.formOpen;
  const selected = PROVIDERS.find((item) => item.id === state.provider) || PROVIDERS[0];
  help.textContent = state.saving && state.hint ? state.hint : selected.help;
  deviceCode.hidden = !state.deviceCode;
  deviceCode.textContent = state.deviceCode;
  regionField.hidden = selected.id !== 'minimax';
  document.querySelectorAll('#provider-choices button').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.provider === state.provider ? 'true' : 'false');
  });
  document.querySelectorAll('[data-theme]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.theme === state.theme ? 'true' : 'false');
  });
  document.querySelectorAll('[data-refresh]').forEach((button) => {
    button.setAttribute('aria-pressed', Number(button.dataset.refresh) === state.refreshMinutes ? 'true' : 'false');
  });
  document.documentElement.dataset.theme = state.theme;
  document.querySelectorAll('[data-region]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.region === state.region ? 'true' : 'false');
  });
  formError.hidden = !state.formError;
  formError.textContent = state.formError;
}

function render() {
  renderChrome();
  renderBoard();
}

function openForm(provider) {
  state.formOpen = true;
  state.menuOpen = false;
  state.formError = '';
  state.provider = provider || state.provider || 'grok';
  state.pendingRemove = null;
  form.reset();
  render();
  document.getElementById('label').focus();
}

function closeForm() {
  state.formOpen = false;
  state.formError = '';
  state.saving = false;
  state.hint = '';
  state.deviceCode = '';
  render();
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  state.boardError = '';
  renderChrome();
  try {
    const result = await desk.refresh();
    state.accounts = result.accounts || [];
    state.snapshots = result.snapshots || {};
  } catch {
    state.boardError = 'Usage Monitor could not refresh.';
  } finally {
    state.refreshing = false;
    render();
    if (state.compact) syncCompactSize();
  }
}

function measureCompactHeight() {
  const panel = document.getElementById('panel');
  const boardEl = document.getElementById('board');
  const previous = {
    panelHeight: panel.style.height,
    boardFlex: boardEl.style.flex,
    boardOverflow: boardEl.style.overflow,
  };
  panel.style.height = 'auto';
  boardEl.style.flex = '0 0 auto';
  boardEl.style.overflow = 'visible';
  const bodyStyle = getComputedStyle(document.body);
  const extra = (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
  const height = Math.ceil(panel.getBoundingClientRect().height + extra + 2);
  panel.style.height = previous.panelHeight;
  boardEl.style.flex = previous.boardFlex;
  boardEl.style.overflow = previous.boardOverflow;
  return height;
}

async function syncCompactSize() {
  if (state.compact) {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  const height = state.compact ? measureCompactHeight() : 0;
  await desk.setCompact({ compact: state.compact, height });
}

menu.addEventListener('click', async (event) => {
  const theme = event.target.closest('[data-theme]');
  if (theme) {
    state.theme = await desk.setTheme(theme.dataset.theme);
    renderChrome();
    return;
  }
  const rate = event.target.closest('[data-refresh]');
  if (!rate) return;
  state.refreshMinutes = await desk.setRefresh(Number(rate.dataset.refresh));
  scheduleRefresh();
  renderChrome();
});

settingsButton.addEventListener('click', () => {
  state.menuOpen = !state.menuOpen;
  renderChrome();
});

document.addEventListener('click', (event) => {
  if (!state.menuOpen) return;
  if (menu.contains(event.target) || settingsButton.contains(event.target)) return;
  state.menuOpen = false;
  renderChrome();
});

document.getElementById('pin').addEventListener('click', async () => {
  state.pinned = !state.pinned;
  state.pinned = await desk.setPinned(state.pinned);
  renderChrome();
});

document.getElementById('hide').addEventListener('click', () => desk.hide());

document.getElementById('refresh').addEventListener('click', () => {
  state.menuOpen = false;
  refresh();
});

document.getElementById('compact').addEventListener('click', async () => {
  state.compact = !state.compact;
  state.menuOpen = false;
  render();
  await syncCompactSize();
});

document.getElementById('add').addEventListener('click', () => {
  state.menuOpen = false;
  openForm(state.provider);
});

document.getElementById('provider-choices').addEventListener('click', (event) => {
  const button = event.target.closest('[data-provider]');
  if (!button) return;
  state.provider = button.dataset.provider;
  state.formError = '';
  renderChrome();
});

regionField.addEventListener('click', (event) => {
  const button = event.target.closest('[data-region]');
  if (!button) return;
  state.region = button.dataset.region;
  renderChrome();
});

board.addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open]');
  if (open) {
    openForm(open.dataset.open);
    return;
  }
  const makeDefault = event.target.closest('[data-default]');
  if (makeDefault) {
    const id = makeDefault.dataset.default;
    state.pendingRemove = null;
    state.accounts = await desk.setDefaultAccount(id);
    render();
    return;
  }
  const remove = event.target.closest('[data-remove]');
  if (!remove) {
    if (state.pendingRemove) {
      state.pendingRemove = null;
      renderBoard();
    }
    return;
  }
  const id = remove.dataset.remove;
  if (state.pendingRemove !== id) {
    state.pendingRemove = id;
    renderBoard();
    return;
  }
  state.accounts = await desk.removeAccount(id);
  delete state.snapshots[id];
  state.pendingRemove = null;
  render();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  document.getElementById('save').click();
});

document.getElementById('cancel').addEventListener('click', () => {
  desk.cancelSignIn();
  closeForm();
});

document.getElementById('save').addEventListener('click', async () => {
  if (state.saving) return;
  const label = document.getElementById('label').value.trim();
  state.saving = true;
  state.formError = '';
  state.hint = 'Opening your browser…';
  state.deviceCode = '';
  renderChrome();
  const result = await desk.signIn({
    provider: state.provider,
    label,
    region: state.region,
  });
  state.saving = false;
  state.hint = '';
  state.deviceCode = '';
  if (result?.canceled) {
    renderChrome();
    return;
  }
  if (!result?.ok) {
    state.formError = result?.error || 'Sign-in could not finish.';
    renderChrome();
    return;
  }
  if (!result.created) {
    state.formError = 'That login is already on the board.';
    renderChrome();
    return;
  }
  closeForm();
  await refresh();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.menuOpen) {
    state.menuOpen = false;
    renderChrome();
    return;
  }
  if (event.key === 'Escape' && state.formOpen) closeForm();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    desk.hide();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    refresh();
  }
});

let refreshTimer = null;

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (!state.refreshMinutes) return;
  refreshTimer = setInterval(() => {
    if (!state.formOpen && !state.saving) refresh();
  }, state.refreshMinutes * 60 * 1000);
}

desk.onAuthHint((hint) => {
  if (!state.saving) return;
  state.hint = hint?.message || '';
  state.deviceCode = hint?.code || '';
  renderChrome();
});

desk.onRefreshRequest(() => refresh());

async function init() {
  const query = new URLSearchParams(location.search);
  if (query.get('menu') === '1') state.menuOpen = true;
  if (query.get('compact') === '1') state.compact = true;
  const windowState = await desk.getState();
  state.pinned = windowState.pinned !== false;
  state.theme = windowState.theme || 'ion';
  state.platform = windowState.platform || 'darwin';
  state.refreshMinutes = Number.isFinite(windowState.refreshMinutes) ? windowState.refreshMinutes : 5;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.platform = state.platform;
  render();
  await refresh();
  if (windowState.form) openForm(windowState.form);
  scheduleRefresh();
}

init();
