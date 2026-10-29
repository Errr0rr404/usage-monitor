const PROVIDERS = [
  {
    id: 'grok',
    name: 'Grok',
    help: 'Your usual browser opens the Grok login. The approval page says Grok CLI, because that is the public login that can hand the session back to this computer. The session stays here.',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    optionalKey: true,
    placeholder: 'Token Plan key',
    help: 'Your usual browser opens the MiniMax login for the region you picked. The approval page says MiniMax CLI. If it asks for a code, Usage Monitor shows it here. Or paste a Token Plan API key, or use the one OpenCode saved, and skip the browser. Either way the login stays on this computer.',
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
    help: 'Your usual browser opens the Meta login. Meta asks for a code. Usage Monitor shows that code in this window and copies it. Meta often leaves the usage meters out of its reply, so the board says so instead of guessing; the gauge button on the card spends one tiny request per refresh to read the real meter.',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    usesKey: true,
    placeholder: 'sk-…',
    help: 'Paste an OpenCode API key from opencode.ai/auth, or use the key OpenCode already saved on this computer. Usage Monitor reads the OpenCode Go 5-hour, weekly, and monthly limits for that workspace. The key is checked once, then locked on this computer.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    usesKey: true,
    placeholder: 'sk-…',
    help: 'Paste a DeepSeek API key from platform.deepseek.com/api_keys, or use the key OpenCode already saved. Usage Monitor reads the account balance. Reading it does not spend anything. The key is checked once, then locked on this computer.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    usesKey: true,
    placeholder: 'sk-or-v1-…',
    help: 'Paste an OpenRouter management key from openrouter.ai/settings/management-keys to see the credits left on the account. A regular API key only shows its own spending limit. The key is checked once, then locked on this computer.',
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    usesKey: true,
    placeholder: 'sk-…',
    help: 'Paste the API key from your Kimi Code membership, or use the key OpenCode saved. Usage Monitor reads the weekly and rolling request limits. The key is checked once, then locked on this computer.',
  },
  {
    id: 'moonshot',
    name: 'Kimi API',
    usesKey: true,
    placeholder: 'sk-…',
    help: 'Paste a Moonshot AI platform key from platform.moonshot.ai (or platform.moonshot.cn), or use the key OpenCode saved. Usage Monitor reads the account balance. Reading it does not spend anything. The key is checked once, then locked on this computer.',
  },
  {
    id: 'zai',
    name: 'Z.ai',
    usesKey: true,
    placeholder: 'API key',
    help: 'Paste a Z.ai or Zhipu BigModel API key that belongs to a GLM Coding Plan, or use the key OpenCode saved. Usage Monitor reads the rolling token limits and the MCP call allowance. The key is checked once, then locked on this computer.',
  },
  {
    id: 'vercel',
    name: 'Vercel AI',
    usesKey: true,
    placeholder: 'API key',
    help: 'Paste a Vercel AI Gateway API key, or use the key OpenCode saved. Usage Monitor reads the gateway credits left on the team. Reading it does not spend anything. The key is checked once, then locked on this computer.',
  },
  {
    id: 'poe',
    name: 'Poe',
    usesKey: true,
    placeholder: 'API key',
    help: 'Paste a Poe API key from poe.com/api_key, or use the key OpenCode saved. Usage Monitor reads the compute points left. The key is checked once, then locked on this computer.',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    usesKey: true,
    placeholder: 'sk-…',
    help: 'Paste a SiliconFlow API key from cloud.siliconflow.com (or cloud.siliconflow.cn), or use the key OpenCode saved. Usage Monitor reads the account balance. The key is checked once, then locked on this computer.',
  },
];

const ORDER = ['grok', 'minimax', 'codex', 'claude', 'cursor', 'copilot', 'gemini', 'muse', 'opencode', 'deepseek', 'openrouter', 'kimi', 'moonshot', 'zai', 'vercel', 'poe', 'siliconflow'];

// The add form and the empty board list services in two groups: the ones that
// open a browser login, and the ones that take a pasted API key.
const CHOICE_GROUPS = [
  { kind: 'browser', title: 'Sign in with your browser', items: PROVIDERS.filter((item) => !item.usesKey) },
  { kind: 'key', title: 'Paste an API key', items: PROVIDERS.filter((item) => item.usesKey) },
];

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
  transparency: 0,
  menuOpen: false,
  platform: 'darwin',
  refreshMinutes: 5,
  alarmSound: true,
  layout: 'stacked',
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
const opacityInput = document.getElementById('opacity');
const compactButton = document.getElementById('compact');
const refreshButton = document.getElementById('refresh');
const saveButton = document.getElementById('save');
const alarm = document.getElementById('reset-alarm');
const alarmSoundButton = document.getElementById('alarm-sound');
const keyField = document.getElementById('key-field');
const secretInput = document.getElementById('secret');
const importKeyButton = document.getElementById('import-key');
const updatedButton = document.getElementById('updated');
const resetAccounts = new Map();
let signInRequest = 0;
let sizeRequest = 0;

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

function iconGauge() {
  return `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 12.2a6.2 6.2 0 1 1 10.8 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><path d="M8 10.4 10.6 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg>`;
}

function providerName(id) {
  return PROVIDERS.find((item) => item.id === id)?.name || 'Account';
}

function titlePlan(plan) {
  if (!plan) return '';
  if (/[A-Z]/.test(plan.slice(1))) return plan;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// The name a person gave a login is what tells two accounts of the same service
// apart, so it rides along after the plan. A label that only repeats the
// service is not a name: use the email the service reported. Drop a tag that
// only echoes the group heading or the plan.
function accountTag(account, plan, identity) {
  const label = String(account.label || '').trim();
  const who = String(identity || '').trim();
  const provider = providerName(account.provider).toLowerCase();
  const generic = !label
    || label.toLowerCase() === provider
    || label.toLowerCase() === String(account.provider || '').toLowerCase();
  const shown = generic && who ? who : label;
  if (!shown) return '';
  const lower = shown.toLowerCase();
  if (lower === provider || lower === String(account.provider || '').toLowerCase()) return '';
  if (plan && lower === String(plan).toLowerCase()) return '';
  return shown;
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatMoney(value, currency = 'USD') {
  const digits = Math.abs(value % 1) < 0.001 ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${Number(value).toFixed(digits)} ${currency}`;
  }
}

function phraseFromMs(ms) {
  if (!Number.isFinite(ms)) return '';
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

function resetDeadline(window, fetchedAt) {
  if (window.resetsAt) {
    const deadline = Date.parse(window.resetsAt);
    if (Number.isFinite(deadline)) return deadline;
  }
  if (window.resetsInMs == null) return null;
  const remaining = Number(window.resetsInMs);
  const observed = Date.parse(fetchedAt);
  return Number.isFinite(remaining) ? (Number.isFinite(observed) ? observed : Date.now()) + remaining : null;
}

function resetPhrase(window, fetchedAt) {
  const deadline = resetDeadline(window, fetchedAt);
  return deadline == null ? '' : phraseFromMs(deadline - Date.now());
}

function presentWindow(window, fetchedAt) {
  const reset = resetPhrase(window, fetchedAt);
  // Antigravity switches a window off (its 5 hours while the week is spent).
  // Its number means nothing then, so say paused instead of 100% left.
  if (window.paused) {
    return { value: 'Paused', unit: '', note: reset, left: 0, tone: 'paused', bar: true, paused: true };
  }
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
  if (window.unit === 'balance') {
    const amount = Math.max(0, Number(window.amount) || 0);
    const granted = Number(window.granted) || 0;
    if (window.format === 'points') {
      return {
        value: formatCount(amount),
        unit: 'points left',
        note: '',
        left: amount > 0 ? 100 : 0,
        tone: amount > 0 ? 'ok' : 'empty',
        bar: false,
        balance: true,
      };
    }
    return {
      value: formatMoney(amount, window.currency || 'USD'),
      unit: 'left',
      note: granted > 0 ? `includes ${formatMoney(granted, window.currency || 'USD')} granted` : '',
      left: amount > 0 ? 100 : 0,
      tone: amount > 0 ? 'ok' : 'empty',
      bar: false,
      balance: true,
    };
  }
  if (window.unit === 'dollars' && window.limit != null && window.used != null) {
    const leftAmount = Math.max(0, window.limit - window.used);
    const left = window.limit > 0 ? (leftAmount / window.limit) * 100 : 0;
    return {
      value: formatMoney(leftAmount),
      unit: 'left',
      note: [`of ${formatMoney(window.limit)}`, reset].filter(Boolean).join(', '),
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
  const scored = (windows || []).filter((window) => !window.paused && window.usedPercent != null && window.unit !== 'unlimited' && window.unit !== 'credits');
  if (!scored.length) return (windows || [])[0] || null;
  return scored.reduce((best, window) => (window.usedPercent > best.usedPercent ? window : best));
}

function gaugeMarkup(left, tone) {
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, left));
  const drawn = (clamped / 100) * circumference;
  // A round cap on a zero-length arc still paints a dot, so an empty gauge
  // draws only its track.
  const value = drawn > 0
    ? `<circle class="value" cx="18" cy="18" r="${radius}" stroke-dasharray="${drawn.toFixed(2)} ${circumference.toFixed(2)}"></circle>`
    : '';
  return `<svg class="gauge ${tone}" viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="${radius}"></circle>${value}</svg>`;
}

// A pooled window lists the models that share it. The family the label already
// names is dropped from each model so the line stays short: "Gemini models"
// reads "3 Flash · 2.5 Pro", the full names stay in the tooltip.
function modelsLine(window) {
  const models = Array.isArray(window.models) ? window.models.filter(Boolean).map(String) : [];
  if (!models.length) return '';
  const label = String(window.label || '').toLowerCase();
  const short = models.map((model) => {
    const [first, ...rest] = model.split(' ');
    return rest.length && new RegExp(`(^|[^a-z])${first.toLowerCase().replace(/[^a-z0-9]/g, '')}([^a-z]|$)`).test(label) ? rest.join(' ') : model;
  });
  const count = models.length === 1 ? '1 model' : `${models.length} models`;
  return `<p class="meter-models" title="${esc(models.join(', '))}"><span class="sr-only">${esc(count)}: </span>${esc(short.join(' · '))}</p>`;
}

function renderMeter(window, fetchedAt) {
  const view = presentWindow(window, fetchedAt);
  const models = modelsLine(window);
  const itemClass = `dial-item${models ? ' has-models' : ''}${view.paused ? ' paused' : ''}`;
  if (view.balance) {
    const note = view.note ? `<p class="meter-note">${esc(view.note)}</p>` : '';
    return `<div class="dial-item balance-item"><div class="dial-copy"><div class="meter-label">${esc(window.label)}</div><p class="balance-figure ${view.tone}">${esc(view.value)} <span class="balance-unit">${esc(view.unit)}</span></p>${note}</div></div>`;
  }
  if (!view.bar) {
    return `<p class="meter-fallback">${esc(window.label)} ${esc(view.value)}${view.unit ? ` ${esc(view.unit)}` : ''}</p>`;
  }
  const percent = String(view.value).includes('%');
  let noteText = percent ? view.note : [view.value, view.unit, view.note].filter(Boolean).join(' ');
  if (view.paused) noteText = [view.value, view.note].filter(Boolean).join(', ');
  const reset = resetPhrase(window, fetchedAt);
  const countdown = reset && noteText.endsWith(reset)
    ? ` data-countdown="${resetDeadline(window, fetchedAt)}" data-countdown-prefix="${esc(noteText.slice(0, -reset.length))}"`
    : '';
  const note = noteText ? `<p class="meter-note"${countdown}>${esc(noteText)}</p>` : '';
  const figure = view.paused ? '–' : percent ? view.value.replace('%', '') : Math.round(view.left);
  const spoken = [window.label, view.value, view.unit].filter(Boolean).join(', ').replace(/, (left)$/, ' $1');
  return `<div class="${itemClass}"><div class="dial" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${view.left}" aria-label="${esc(spoken)}">${gaugeMarkup(view.left, view.tone)}<span class="dial-figure ${view.tone}">${esc(figure)}</span></div><div class="dial-copy"><div class="meter-label">${esc(window.label)}</div>${note}${models}</div></div>`;
}

function updateCountdowns() {
  document.querySelectorAll('[data-countdown]').forEach((note) => {
    const text = note.dataset.countdownPrefix + phraseFromMs(Number(note.dataset.countdown) - Date.now());
    if (note.textContent !== text) note.textContent = text;
  });
  renderUpdated();
}

function agoPhrase(ms) {
  if (ms < 60000) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// The newest reading on the board. A failed account still counts: the board
// tried then, and its error says why there is no number.
function lastUpdated() {
  const times = Object.values(state.snapshots || {})
    .map((snapshot) => Date.parse(snapshot?.fetchedAt))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

function renderUpdated() {
  const last = lastUpdated();
  updatedButton.hidden = state.formOpen || (!state.refreshing && last == null);
  updatedButton.disabled = state.refreshing;
  const text = state.refreshing ? 'Updating…' : last == null ? '' : `Updated ${agoPhrase(Math.max(0, Date.now() - last))}`;
  if (updatedButton.textContent !== text) updatedButton.textContent = text;
  const stamp = last == null ? '' : new Date(last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  updatedButton.title = stamp ? `Read at ${stamp}. Refresh now (⌘R)` : 'Refresh now (⌘R)';
  updatedButton.setAttribute('aria-label', text ? `${text}. Refresh now` : 'Refresh now');
}

function choiceButtons(items, attribute) {
  return items.map((item) => `<button type="button" ${attribute}="${item.id}">${esc(item.name)}</button>`).join('');
}

function renderChoices() {
  document.querySelectorAll('#provider-choices [data-kind]').forEach((grid) => {
    const group = CHOICE_GROUPS.find((item) => item.kind === grid.dataset.kind);
    grid.innerHTML = group ? choiceButtons(group.items, 'data-provider') : '';
  });
}

function renderAccount(account) {
  const snapshot = state.snapshots[account.id];
  const plan = titlePlan(snapshot?.plan);
  const name = accountTag(account, plan, snapshot?.ok ? snapshot.identity : null);
  const confirming = state.pendingRemove === account.id;
  const canChooseDefault = state.accounts.length > 1;
  const defaultLabel = account.isDefault ? 'Default' : 'Set default';
  const defaultAction = canChooseDefault
    ? `<button type="button" data-default="${esc(account.id)}" aria-pressed="${account.isDefault ? 'true' : 'false'}" aria-label="${esc(defaultLabel)}" title="${esc(defaultLabel)}">${iconStar(account.isDefault)}</button>`
    : '';
  // Meta only publishes the Muse meters inside a streamed model reply, so asking
  // for them costs a real (tiny) call. That has to be a choice, per account.
  const liveOn = Boolean(account.meta && account.meta.museLiveUsage);
  const liveLabel = liveOn ? 'Stop reading the live meter' : 'Read the live meter';
  const liveAction = account.provider === 'muse'
    ? `<button type="button" class="${liveOn ? 'live-on' : ''}" data-muse-live="${esc(account.id)}" aria-pressed="${liveOn ? 'true' : 'false'}" aria-label="${esc(liveLabel)}" title="${esc(liveLabel)}">${iconGauge()}</button>`
    : '';
  const removeLabel = confirming ? 'Confirm remove' : 'Remove';
  const actions = `${defaultAction}${liveAction}<button type="button" class="${confirming ? 'danger' : ''}" data-remove="${esc(account.id)}" aria-label="${esc(removeLabel)}" title="${esc(removeLabel)}">${iconClose()}</button>`;
  let body = '<p class="meter-note">Checking…</p>';
  if (snapshot?.ok === false) body = `<p class="error">${esc(snapshot.error || 'Could not load usage.')}</p>`;
  else if (snapshot?.ok) {
    body = snapshot.windows.length
      ? `<div class="dials">${snapshot.windows.map((window) => renderMeter(window, snapshot.fetchedAt)).join('')}</div>`
      : `<p class="meter-note">${esc(snapshot.note || 'No usage window came back.')}</p>`;
  } else if (!state.refreshing) body = '<p class="meter-note">Not checked yet.</p>';

  const title = [plan, name].filter(Boolean).join(' · ');
  return `<article class="account">
    <div class="account-head">
      <div class="account-title">
        <p class="provider-kicker">${esc(providerName(account.provider))}</p>
        <h3${title ? ` title="${esc(title)}"` : ''}>${plan ? esc(plan) : ''}${name ? ` <span class="plan${plan ? '' : ' lead'}">[${esc(name)}]</span>` : ''}</h3>
      </div>
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
      ${CHOICE_GROUPS.map((group) => `<p class="choice-heading" id="empty-${group.kind}-label">${esc(group.title)}</p>
      <div class="choice-grid providers" role="group" aria-labelledby="empty-${group.kind}-label">${choiceButtons(group.items, 'data-open')}</div>`).join('')}
    </div>`;
    return;
  }

  const boardError = state.boardError ? `<p class="error" role="alert">${esc(state.boardError)}</p>` : '';
  if (state.compact) {
    board.innerHTML = boardError + state.accounts.map((account) => {
      const snapshot = state.snapshots[account.id];
      let reading = 'Checking…';
      if (snapshot?.ok === false) reading = 'Could not load usage';
      else if (snapshot?.ok) {
        const window = tightest(snapshot.windows);
        if (!window) reading = snapshot.note ? 'Not reported' : 'No window';
        else {
          const view = presentWindow(window);
          reading = `${window.label} ${view.value}${view.unit ? ` ${view.unit}` : ''}`;
        }
      }
      const name = accountTag(account, titlePlan(snapshot?.ok ? snapshot.plan : null), snapshot?.ok ? snapshot.identity : null);
      const full = [providerName(account.provider), name].filter(Boolean).join(' · ');
      return `<div class="compact-row"><strong title="${esc(full)}">${esc(providerName(account.provider))}${name ? ` <span class="plan">${esc(name)}</span>` : ''}</strong><span title="${esc(snapshot?.error || reading)}">${esc(reading)}</span></div>`;
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
  board.innerHTML = boardError + groupsHtml;
}

function renderChrome() {
  pinButton.setAttribute('aria-checked', state.pinned ? 'true' : 'false');
  alarmSoundButton.setAttribute('aria-checked', state.alarmSound ? 'true' : 'false');
  alarmSoundButton.querySelector('.menu-value').textContent = state.alarmSound ? 'On' : 'Off';
  document.getElementById('pin-note').textContent = state.platform === 'darwin'
    ? 'Stays above other windows, on every desktop.'
    : 'Stays above other windows.';
  compactButton.textContent = state.compact ? 'Show gauges' : 'Compact';
  document.querySelectorAll('#menu [data-layout]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.layout === state.layout ? 'true' : 'false');
  });
  document.getElementById('layout-note').textContent = state.layout === 'sideways'
    ? 'Accounts sit in a row. Scroll sideways for the rest.'
    : 'Accounts stack down the window.';
  document.documentElement.dataset.layout = state.layout;
  refreshButton.textContent = state.refreshing ? 'Refreshing' : 'Refresh';
  refreshButton.disabled = state.refreshing;
  const chosen = PROVIDERS.find((item) => item.id === state.provider) || PROVIDERS[0];
  const keyed = savesKey(chosen);
  saveButton.disabled = state.saving;
  if (keyed) saveButton.textContent = state.saving ? 'Checking key' : 'Save key';
  else saveButton.textContent = state.saving ? 'Waiting for sign-in' : 'Sign in';
  keyField.hidden = !chosen.usesKey && !chosen.optionalKey;
  document.getElementById('key-label').textContent = chosen.optionalKey ? 'API key (optional)' : 'API key';
  // An OpenRouter key in OpenCode is an inference key, not the management key
  // the credits need, so there is nothing useful to import for it.
  importKeyButton.hidden = !(chosen.usesKey || chosen.optionalKey) || chosen.id === 'openrouter';
  importKeyButton.disabled = state.saving;
  secretInput.disabled = state.saving;
  secretInput.placeholder = chosen.placeholder || '';
  renderUpdated();
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
    button.disabled = state.saving;
    button.setAttribute('aria-pressed', button.dataset.provider === state.provider ? 'true' : 'false');
  });
  document.querySelectorAll('#menu [data-theme]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.theme === state.theme ? 'true' : 'false');
  });
  document.querySelectorAll('#menu [data-refresh]').forEach((button) => {
    button.setAttribute('aria-pressed', Number(button.dataset.refresh) === state.refreshMinutes ? 'true' : 'false');
  });
  document.documentElement.dataset.theme = state.theme;
  paintTransparency(state.transparency);
  if (document.activeElement !== opacityInput) opacityInput.value = String(state.transparency);
  opacityInput.setAttribute('aria-valuetext', transparencyLabel(state.transparency));
  document.getElementById('opacity-note').textContent = transparencyNote(state.transparency);
  document.querySelectorAll('[data-region]').forEach((button) => {
    button.disabled = state.saving;
    button.setAttribute('aria-pressed', button.dataset.region === state.region ? 'true' : 'false');
  });
  document.getElementById('label').disabled = state.saving;
  formError.hidden = !state.formError;
  formError.textContent = state.formError;
}

function render() {
  renderChrome();
  renderBoard();
  syncCompactSize();
}

function savesKey(provider) {
  return Boolean(provider.usesKey || (provider.optionalKey && secretInput.value.trim()));
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
  settingsButton.focus();
}

function cancelForm() {
  signInRequest += 1;
  desk.cancelSignIn().catch(() => {});
  closeForm();
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
  const request = ++sizeRequest;
  // Settings, sign-in, and reset notices need the regular window height.
  // The compact board returns to its previous size when they close.
  const compact = state.compact && !state.formOpen && !state.menuOpen && alarm.hidden;
  if (compact) {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  if (request !== sizeRequest) return;
  const height = compact ? measureCompactHeight() : 0;
  try {
    await desk.setCompact({ compact, height });
  } catch {
    // A closing window may no longer accept size changes.
  }
}

async function chooseLayout(next) {
  if (next !== 'stacked' && next !== 'sideways') return;
  if (next === state.layout) return;
  // Drop a compact resize that is already in flight. The window changes
  // shape first, then compact measures the new row.
  sizeRequest += 1;
  state.layout = next;
  state.menuOpen = false;
  document.documentElement.dataset.layout = next;
  renderChrome();
  renderBoard();
  try {
    state.layout = await desk.setLayout(next);
  } catch {
    // A closing window may no longer accept size changes.
  }
  document.documentElement.dataset.layout = state.layout;
  renderChrome();
  await syncCompactSize();
}

menu.addEventListener('click', async (event) => {
  // html also has data-theme and data-layout so the CSS can see the choice.
  // closest() would walk up to that and treat every menu click as a theme change.
  const theme = event.target.closest('#menu [data-theme]');
  if (theme) {
    state.theme = await desk.setTheme(theme.dataset.theme);
    renderChrome();
    return;
  }
  const pickedLayout = event.target.closest('#menu [data-layout]');
  if (pickedLayout) {
    await chooseLayout(pickedLayout.dataset.layout);
    return;
  }
  const rate = event.target.closest('#menu [data-refresh]');
  if (!rate) return;
  state.refreshMinutes = await desk.setRefresh(Number(rate.dataset.refresh));
  scheduleRefresh();
  renderChrome();
});

settingsButton.addEventListener('click', () => {
  state.menuOpen = !state.menuOpen;
  renderChrome();
  syncCompactSize();
});

document.addEventListener('click', (event) => {
  if (!state.menuOpen) return;
  if (menu.contains(event.target) || settingsButton.contains(event.target)) return;
  state.menuOpen = false;
  renderChrome();
  syncCompactSize();
});

function transparencyLabel(percent) {
  return percent ? `${percent}% clear` : 'Solid';
}

function transparencyNote(percent) {
  return percent
    ? `${transparencyLabel(percent)}. Drag right to see through more of the window.`
    : 'Solid. Drag right to see through the window.';
}

function paintTransparency(percent) {
  const opacity = state.platform === 'win32' ? 1 : 1 - (Number(percent) || 0) / 200;
  document.documentElement.style.setProperty('--panel-alpha', String(opacity));
}

opacityInput.addEventListener('input', async () => {
  const requested = Number(opacityInput.value);
  paintTransparency(requested);
  opacityInput.setAttribute('aria-valuetext', transparencyLabel(requested));
  document.getElementById('opacity-note').textContent = transparencyNote(requested);
  state.transparency = await desk.setTransparency(requested);
  if (document.activeElement !== opacityInput) opacityInput.value = String(state.transparency);
  paintTransparency(state.transparency);
  opacityInput.setAttribute('aria-valuetext', transparencyLabel(state.transparency));
  document.getElementById('opacity-note').textContent = transparencyNote(state.transparency);
});

document.getElementById('pin').addEventListener('click', async () => {
  state.pinned = !state.pinned;
  state.pinned = await desk.setPinned(state.pinned);
  renderChrome();
});

alarmSoundButton.addEventListener('click', async () => {
  state.alarmSound = await desk.setAlarmSound(!state.alarmSound);
  renderChrome();
});

document.getElementById('test-alarm').addEventListener('click', () => {
  state.menuOpen = false;
  renderChrome();
  desk.testAlarm();
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

// MiniMax takes either a browser login or a key; the button says which.
secretInput.addEventListener('input', () => {
  if (selectedProvider().optionalKey) renderChrome();
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
  const live = event.target.closest('[data-muse-live]');
  if (live) {
    const id = live.dataset.museLive;
    const account = state.accounts.find((item) => item.id === id);
    if (!account) return;
    state.pendingRemove = null;
    const updated = await desk.updateAccount(id, { meta: { museLiveUsage: !account.meta?.museLiveUsage } });
    if (updated) state.accounts = state.accounts.map((item) => (item.id === id ? updated : item));
    await refresh();
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
    [...board.querySelectorAll('[data-remove]')].find((button) => button.dataset.remove === id)?.focus();
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

document.getElementById('cancel').addEventListener('click', cancelForm);

function selectedProvider() {
  return PROVIDERS.find((item) => item.id === state.provider) || PROVIDERS[0];
}

document.getElementById('save').addEventListener('click', async () => {
  if (state.saving) return;
  const request = ++signInRequest;
  const label = document.getElementById('label').value.trim();
  const usesKey = savesKey(selectedProvider());
  const secret = secretInput.value.trim();
  if (usesKey && !secret) {
    state.formError = 'Paste a key first.';
    renderChrome();
    secretInput.focus();
    return;
  }
  state.saving = true;
  state.formError = '';
  state.hint = usesKey ? 'Checking the key…' : 'Opening your browser…';
  state.deviceCode = '';
  renderChrome();
  let result;
  try {
    result = usesKey
      ? await desk.addAccount({ provider: state.provider, label, secret, region: state.region })
      : await desk.signIn({
        provider: state.provider,
        label,
        region: state.region,
      });
  } catch {
    result = { ok: false, error: usesKey ? 'The key could not be saved. Try again.' : 'Sign-in could not finish. Try again.' };
  }
  if (request !== signInRequest) return;
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

importKeyButton.addEventListener('click', async () => {
  if (state.saving) return;
  const request = ++signInRequest;
  state.saving = true;
  state.formError = '';
  state.hint = 'Checking the key OpenCode saved…';
  renderChrome();
  let result;
  try {
    result = await desk.importLogin(state.provider, {
      region: state.region,
      label: document.getElementById('label').value.trim(),
    });
  } catch {
    result = { ok: false, error: 'The saved key could not be read.' };
  }
  if (request !== signInRequest) return;
  state.saving = false;
  state.hint = '';
  if (!result?.ok) {
    state.formError = result?.error || 'The saved key could not be read.';
    renderChrome();
    return;
  }
  if (!result.created) {
    state.formError = 'That key is already on the board.';
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
    syncCompactSize();
    settingsButton.focus();
    return;
  }
  if (event.key === 'Escape' && state.formOpen) {
    cancelForm();
    return;
  }
  if (event.key === 'Escape' && !alarm.hidden) {
    dismissResetAlarm();
    return;
  }
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

updatedButton.addEventListener('click', () => refresh());

function showResetAlarm(payload) {
  for (const account of payload?.accounts || []) {
    const previous = resetAccounts.get(account.id);
    resetAccounts.set(account.id, {
      ...account,
      windows: [...new Set([...(previous?.windows || []), ...(account.windows || [])])],
    });
  }
  if (!resetAccounts.size) return;
  const accounts = document.getElementById('reset-alarm-accounts');
  accounts.replaceChildren();
  let count = 0;
  for (const account of resetAccounts.values()) {
    const row = document.createElement('div');
    row.className = 'alarm-account';
    const name = document.createElement('p');
    name.className = 'alarm-account-name';
    name.textContent = account.provider;
    if (account.label) {
      const label = document.createElement('span');
      label.textContent = account.label;
      name.appendChild(label);
    }
    const windows = document.createElement('p');
    windows.className = 'alarm-windows';
    windows.textContent = account.windows.join(' · ');
    row.append(name, windows);
    accounts.appendChild(row);
    count += account.windows.length;
  }
  document.getElementById('reset-alarm-summary').textContent = count === 1 ? '1 window refreshed.' : `${count} windows refreshed.`;
  alarm.hidden = false;
  syncCompactSize();
}

function dismissResetAlarm() {
  if (alarm.hidden) return;
  const hadFocus = alarm.contains(document.activeElement);
  alarm.hidden = true;
  resetAccounts.clear();
  syncCompactSize();
  if (hadFocus) (state.formOpen ? document.getElementById('cancel') : settingsButton).focus();
}

desk.onResetAlarm(showResetAlarm);
document.getElementById('reset-alarm-dismiss').addEventListener('click', dismissResetAlarm);

const launchQuery = new URLSearchParams(location.search);
if (launchQuery.get('layout') === 'sideways') state.layout = 'sideways';
document.documentElement.dataset.layout = state.layout;

async function init() {
  const query = new URLSearchParams(location.search);
  if (query.get('menu') === '1') state.menuOpen = true;
  if (query.get('compact') === '1') state.compact = true;
  const windowState = await desk.getState();
  state.pinned = windowState.pinned !== false;
  state.theme = windowState.theme || 'ion';
  state.platform = windowState.platform || 'darwin';
  state.transparency = Number.isFinite(windowState.transparency) ? windowState.transparency : 0;
  state.refreshMinutes = Number.isFinite(windowState.refreshMinutes) ? windowState.refreshMinutes : 5;
  state.alarmSound = windowState.alarmSound !== false;
  state.layout = windowState.layout === 'sideways' ? 'sideways' : 'stacked';
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.platform = state.platform;
  document.documentElement.dataset.layout = state.layout;
  renderChoices();
  render();
  await refresh();
  if (windowState.form) openForm(windowState.form);
  scheduleRefresh();
  setInterval(updateCountdowns, 30000);
}

init();
