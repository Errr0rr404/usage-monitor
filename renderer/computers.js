// The Computers tab: this computer first, then the ones added over SSH.
// Loaded before app.js, which owns state, render() and the shared helpers.
// Everything here runs only after app.js has loaded.

const computersBoard = document.getElementById('computers');
const computerForm = document.getElementById('computer-form');
const computerFooter = document.getElementById('footer-computer');
const computerSave = document.getElementById('computer-save');
const computerTarget = document.getElementById('computer-target');
const computerPort = document.getElementById('computer-port');
const computerName = document.getElementById('computer-name');
const computerError = document.getElementById('computer-error');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1000) return `${(gb / 1024).toFixed(gb >= 10240 ? 0 : 1)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1).replace(/\.0$/, '')} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// "27.5 of 32 GB" rather than repeating the unit.
function formatShare(part, whole) {
  const a = formatBytes(part);
  const b = formatBytes(whole);
  const unitA = a.split(' ')[1];
  const unitB = b.split(' ')[1];
  return unitA === unitB ? `${a.split(' ')[0]} of ${b}` : `${a} of ${b}`;
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

// The same colours as the AI rings: blue, orange under 15% headroom, red when
// critical (under 5% left).
function useTone(percent) {
  if (!Number.isFinite(percent)) return 'ok';
  const headroom = 100 - percent;
  if (headroom < 5) return 'empty';
  if (headroom < 15) return 'low';
  return 'ok';
}

// macOS keeps memory full on purpose. Its own pressure level says whether
// that hurts, so it decides the colour there.
function memoryTone(memory) {
  if (memory?.pressure === 'critical') return 'empty';
  if (memory?.pressure === 'warn') return 'low';
  if (memory?.pressure === 'normal') return 'ok';
  return useTone(memory?.percent);
}

function computerDial({ label, percent, tone, note, title }) {
  if (!Number.isFinite(percent)) {
    return `<div class="dial-item paused"${title ? ` title="${esc(title)}"` : ''}><div class="dial" role="img" aria-label="${esc(`${label}, not available`)}"><svg class="gauge paused" viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"></circle></svg><span class="dial-figure">–</span></div><div class="dial-copy"><div class="meter-label">${esc(label)}</div><p class="meter-note">${esc(note || 'n/a')}</p></div></div>`;
  }
  const figure = Math.round(percent);
  const spoken = `${label}, ${figure}% used${note ? `, ${note}` : ''}`;
  return `<div class="dial-item"${title ? ` title="${esc(title)}"` : ''}><div class="dial" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${figure}" aria-label="${esc(spoken)}">${gaugeMarkup(percent, tone)}<span class="dial-figure ${tone}">${esc(figure)}</span></div><div class="dial-copy"><div class="meter-label">${esc(label)}</div><p class="meter-note">${esc(note)}</p></div></div>`;
}

function computerDials(reading) {
  const cpu = reading.cpu || {};
  const memory = reading.memory;
  const gpu = reading.gpu;
  const disk = reading.disk;
  const cores = reading.cores ? `${reading.cores} cores` : '';
  const load = Array.isArray(cpu.load) ? `load ${cpu.load.map((value) => value.toFixed(value >= 100 ? 0 : 2)).join(' ')}` : '';
  const cpuNote = [Number.isFinite(cpu.percent) ? formatPercent(cpu.percent) : '', cores].filter(Boolean).join(' · ');
  const memoryNote = memory ? formatShare(memory.used, memory.total) : '';
  const pressure = memory?.pressure ? `Memory pressure: ${memory.pressure}` : '';
  let gpuNote = 'n/a';
  let gpuTitle = 'This computer does not report GPU use.';
  if (gpu) {
    const mem = gpu.memUsed != null
      ? (gpu.memTotal ? formatShare(gpu.memUsed, gpu.memTotal) : formatBytes(gpu.memUsed))
      : '';
    gpuNote = [Number.isFinite(gpu.percent) ? formatPercent(gpu.percent) : '', mem].filter(Boolean).join(' · ') || 'n/a';
    gpuTitle = [gpu.name, gpu.shared && gpu.memUsed != null ? `${formatBytes(gpu.memUsed)} of shared memory in use` : ''].filter(Boolean).join(': ');
  }
  return [
    computerDial({ label: 'CPU', percent: cpu.percent, tone: useTone(cpu.percent), note: cpuNote, title: [reading.model, load].filter(Boolean).join(' · ') }),
    computerDial({ label: 'RAM', percent: memory?.percent, tone: memoryTone(memory), note: memoryNote, title: pressure }),
    computerDial({ label: 'GPU', percent: gpu?.percent, tone: useTone(gpu?.percent), note: gpuNote, title: gpuTitle }),
    computerDial({ label: 'Disk', percent: disk?.percent, tone: useTone(disk?.percent), note: disk ? `${formatBytes(disk.free)} free` : '', title: disk ? `${formatBytes(disk.free)} free of ${formatBytes(disk.total)}${disk.mount ? ` on ${disk.mount}` : ''}` : '' }),
  ].join('');
}

function retryPhrase(retryAt) {
  if (!Number.isFinite(retryAt)) return 'retrying';
  const seconds = Math.max(0, Math.round((retryAt - Date.now()) / 1000));
  if (seconds <= 1) return 'retrying now';
  if (seconds < 90) return `retrying in ${seconds}s`;
  return `retrying in ${Math.round(seconds / 60)}m`;
}

function computerFacts(reading) {
  const facts = [];
  if (Number.isFinite(reading.uptime)) facts.push(`up ${formatUptime(reading.uptime)}`);
  if (Array.isArray(reading.cpu?.load)) facts.push(`load ${reading.cpu.load.map((value) => value.toFixed(value >= 100 ? 0 : 2)).join(' ')}`);
  if (reading.memory?.pressure) facts.push(`pressure ${reading.memory.pressure}`);
  return facts.join(' · ');
}

function topLine(reading) {
  if (!reading.top?.length) return '';
  return reading.top.map((item) => `${item.name} ${Math.round(item.cpu)}%`).join(', ');
}

function computerKicker(computer, reading) {
  const where = computer.local ? 'This computer' : computer.target + (computer.port ? `:${computer.port}` : '');
  return [where, reading?.os, reading?.arch].filter(Boolean).join(' · ');
}

function computerActions(computer, index, total) {
  if (computer.local) return '';
  const confirming = state.pendingComputerRemove === computer.id;
  const removeLabel = confirming ? 'Confirm remove' : 'Remove';
  const up = index > 1
    ? `<button type="button" data-computer-move="-1" data-id="${esc(computer.id)}" aria-label="Move up" title="Move up">${iconArrow('up')}</button>`
    : '';
  const down = index < total - 1
    ? `<button type="button" data-computer-move="1" data-id="${esc(computer.id)}" aria-label="Move down" title="Move down">${iconArrow('down')}</button>`
    : '';
  return `${up}${down}<button type="button" data-computer-edit data-id="${esc(computer.id)}" aria-label="Edit" title="Rename or edit">${iconPencil()}</button><button type="button" class="${confirming ? 'danger' : ''}" data-computer-remove data-id="${esc(computer.id)}" aria-label="${esc(removeLabel)}" title="${esc(removeLabel)}">${iconClose()}</button>`;
}

function iconArrow(direction) {
  const d = direction === 'up' ? 'M8 12.5V3.5M4.5 7 8 3.5 11.5 7' : 'M8 3.5v9M4.5 9 8 12.5 11.5 9';
  return `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}

function iconPencil() {
  return '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.9 13.1 5.4 6 12.5 3 13l.5-3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path></svg>';
}

function renderComputerCard(computer, index, total) {
  const status = state.readings[computer.id] || {};
  const reading = status.reading;
  const offline = Boolean(status.error) && status.failures > 0;
  let body = '<p class="meter-note">Checking…</p>';
  if (reading) {
    body = `<div class="dials computer-dials${offline ? ' stale' : ''}">${computerDials(reading)}</div>`;
    const facts = computerFacts(reading);
    const top = topLine(reading);
    if (facts) body += `<p class="computer-facts">${esc(facts)}</p>`;
    if (top) body += `<p class="computer-facts" title="Busiest processes by CPU">top ${esc(top)}</p>`;
  }
  if (offline) {
    const retry = Number.isFinite(status.retryAt) ? ` data-retry="${status.retryAt}"` : '';
    body = `<p class="error computer-offline"><strong>Offline.</strong> ${esc(status.error)} <span class="retry"${retry}>${esc(status.checking ? 'retrying now' : retryPhrase(status.retryAt))}</span></p>${reading ? body : ''}`;
  }
  const subtitle = reading?.model ? `<span class="plan">${esc(reading.model)}</span>` : '';
  return `<article class="account computer${computer.local ? ' local' : ''}${offline ? ' offline' : ''}" data-computer="${esc(computer.id)}">
    <div class="account-head">
      <div class="account-title">
        <p class="provider-kicker computer-kicker">${esc(computerKicker(computer, reading))}</p>
        <h3 title="${esc([computer.name, reading?.model].filter(Boolean).join(' · '))}">${esc(computer.name)}${subtitle ? ` ${subtitle}` : ''}</h3>
      </div>
      <div class="account-actions">${computerActions(computer, index, total)}</div>
    </div>
    ${body}
  </article>`;
}

function renderComputerCompact(computer) {
  const status = state.readings[computer.id] || {};
  const reading = status.reading;
  let text = 'Checking…';
  let detail = '';
  if (status.error && status.failures > 0) text = 'Offline';
  else if (reading) {
    // GPU stays out of the one-line view so every row fits the same three
    // values; it is still in the row's hover text and in the rings.
    const part = (label, value) => (Number.isFinite(value) ? `${label} ${Math.round(value)}` : '');
    text = [part('CPU', reading.cpu?.percent), part('RAM', reading.memory?.percent), part('Disk', reading.disk?.percent)]
      .filter(Boolean).join(' · ') || 'No reading';
    detail = [text, part('GPU', reading.gpu?.percent)].filter(Boolean).join(' · ');
  }
  const worst = reading && !(status.error && status.failures > 0)
    ? [useTone(reading.cpu?.percent), memoryTone(reading.memory), useTone(reading.disk?.percent)].find((tone) => tone !== 'ok')
    : (status.error && status.failures > 0 ? 'empty' : '');
  return `<div class="compact-row"><strong title="${esc(computer.local ? 'This computer' : computer.target)}">${esc(computer.name)}</strong><span class="${worst ? `tone-${worst}` : ''}" title="${esc(status.error || detail || text)}">${esc(text)}</span></div>`;
}

function renderComputers() {
  if (state.computerForm) return;
  const list = state.computers;
  if (!list.length) {
    computersBoard.innerHTML = '<p class="meter-note">Reading this computer…</p>';
    return;
  }
  const focusKey = focusedComputerControl();
  if (state.compact) {
    computersBoard.innerHTML = list.map(renderComputerCompact).join('');
  } else {
    const cards = list.map((computer, index) => renderComputerCard(computer, index, list.length)).join('');
    const addHint = list.length === 1 && state.layout !== 'sideways'
      ? '<button type="button" class="add-computer-hint" data-computer-add>Add a computer over SSH</button>'
      : '';
    computersBoard.innerHTML = `<section class="group"><h2>Computers</h2>${cards}</section>${addHint}`;
  }
  restoreComputerFocus(focusKey);
}

// Readings arrive every few seconds and redraw the cards. Keep keyboard focus
// on the same button.
function focusedComputerControl() {
  const active = document.activeElement;
  if (!active || !computersBoard.contains(active)) return null;
  const attrs = ['data-computer-move', 'data-computer-edit', 'data-computer-remove', 'data-computer-add'];
  const attr = attrs.find((name) => active.hasAttribute(name));
  return attr ? { attr, id: active.dataset.id || '', value: active.getAttribute(attr) } : null;
}

function restoreComputerFocus(key) {
  if (!key) return;
  const match = [...computersBoard.querySelectorAll(`[${key.attr}]`)]
    .find((button) => (button.dataset.id || '') === key.id && button.getAttribute(key.attr) === key.value);
  if (match) match.focus();
}

function updateRetryCountdowns() {
  computersBoard.querySelectorAll('[data-retry]').forEach((node) => {
    const text = retryPhrase(Number(node.dataset.retry));
    if (node.textContent !== text) node.textContent = text;
  });
}

function sshHostDetail(host) {
  const where = host.hostName ? `${host.user ? `${host.user}@` : ''}${host.hostName}${host.port ? `:${host.port}` : ''}` : '';
  return where;
}

function renderComputerForm() {
  const draft = state.computerForm;
  computerForm.hidden = !draft;
  computerFooter.hidden = !draft;
  if (!draft) return;
  document.getElementById('computer-form-title').textContent = draft.mode === 'edit' ? 'Edit computer' : 'Add a computer';
  const used = new Set(state.computers.filter((computer) => computer.id !== draft.id).map((computer) => computer.target.toLowerCase()));
  const hosts = state.sshHosts.filter((host) => !used.has(host.alias.toLowerCase()));
  document.getElementById('ssh-hosts-field').hidden = !hosts.length;
  const grid = document.getElementById('ssh-hosts');
  const selected = computerTarget.value.trim();
  grid.innerHTML = hosts.map((host) => {
    const detail = sshHostDetail(host);
    return `<button type="button" data-ssh-host="${esc(host.alias)}" aria-pressed="${host.alias === selected ? 'true' : 'false'}"${detail ? ` title="${esc(detail)}"` : ''}>${esc(host.alias)}</button>`;
  }).join('');
  document.getElementById('computer-target-label').textContent = hosts.length ? 'Or type an address' : 'SSH address';
  computerError.hidden = !draft.error;
  computerError.textContent = draft.error || '';
  computerSave.disabled = draft.saving;
  computerSave.textContent = draft.saving
    ? 'Connecting…'
    : draft.unreachable ? 'Save anyway' : draft.mode === 'edit' ? 'Save' : 'Add';
  for (const input of [computerTarget, computerPort, computerName]) input.disabled = draft.saving;
  grid.querySelectorAll('button').forEach((button) => { button.disabled = draft.saving; });
}

function openComputerForm(mode, id) {
  const computer = mode === 'edit' ? state.computers.find((item) => item.id === id) : null;
  if (mode === 'edit' && !computer) return;
  state.menuOpen = false;
  state.pendingComputerRemove = null;
  state.computerForm = { mode, id: computer?.id || null, error: '', saving: false, unreachable: false };
  computerForm.reset();
  computerTarget.value = computer?.target || '';
  computerPort.value = computer?.port ? String(computer.port) : '';
  computerName.value = computer?.name && computer.name !== computer.target ? computer.name : '';
  render();
  (mode === 'edit' ? computerName : (state.sshHosts.length ? document.querySelector('#ssh-hosts button') || computerTarget : computerTarget)).focus();
  // The list of SSH hosts is read fresh each time, in case the config changed.
  desk.computers().then((payload) => {
    if (!state.computerForm) return;
    state.sshHosts = payload?.sshHosts || [];
    renderComputerForm();
  }).catch(() => {});
}

function closeComputerForm() {
  state.computerForm = null;
  render();
  settingsButton.focus();
}

async function saveComputerForm() {
  const draft = state.computerForm;
  if (!draft || draft.saving) return;
  const payload = {
    target: computerTarget.value.trim(),
    port: computerPort.value.trim(),
    name: computerName.value.trim(),
    force: draft.unreachable,
  };
  if (!payload.target) {
    draft.error = 'Pick an SSH host or type user@host.';
    renderComputerForm();
    computerTarget.focus();
    return;
  }
  draft.saving = true;
  draft.error = '';
  renderComputerForm();
  let result;
  try {
    result = draft.mode === 'edit'
      ? await desk.updateComputer(draft.id, payload)
      : await desk.addComputer(payload);
  } catch {
    result = { ok: false, error: 'The computer could not be saved.' };
  }
  if (state.computerForm !== draft) return;
  draft.saving = false;
  if (!result?.ok) {
    draft.error = result?.error || 'The computer could not be saved.';
    draft.unreachable = Boolean(result?.unreachable);
    renderComputerForm();
    return;
  }
  closeComputerForm();
  await loadComputers();
}

function applyComputers(payload) {
  if (!payload) return;
  if (Array.isArray(payload.computers)) state.computers = payload.computers;
  if (payload.readings) state.readings = payload.readings;
  if (Array.isArray(payload.sshHosts)) state.sshHosts = payload.sshHosts;
  if (state.pendingComputerRemove && !state.computers.some((computer) => computer.id === state.pendingComputerRemove)) {
    state.pendingComputerRemove = null;
  }
  if (state.tab !== 'computers') return;
  renderComputers();
  syncCompactSize();
}

async function loadComputers() {
  try {
    applyComputers(await desk.computers());
  } catch {
    // The next reading redraws the board.
  }
}

function syncComputersLive() {
  const live = state.tab === 'computers' && document.visibilityState === 'visible';
  desk.setComputersLive(live).catch(() => {});
}

function initComputers() {
  computersBoard.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-computer-add]');
    if (add) {
      openComputerForm('add');
      return;
    }
    const edit = event.target.closest('[data-computer-edit]');
    if (edit) {
      openComputerForm('edit', edit.dataset.id);
      return;
    }
    const move = event.target.closest('[data-computer-move]');
    if (move) {
      state.pendingComputerRemove = null;
      await desk.moveComputer(move.dataset.id, Number(move.dataset.computerMove));
      return;
    }
    const remove = event.target.closest('[data-computer-remove]');
    if (!remove) {
      if (state.pendingComputerRemove) {
        state.pendingComputerRemove = null;
        renderComputers();
      }
      return;
    }
    const id = remove.dataset.id;
    if (state.pendingComputerRemove !== id) {
      state.pendingComputerRemove = id;
      renderComputers();
      [...computersBoard.querySelectorAll('[data-computer-remove]')].find((button) => button.dataset.id === id)?.focus();
      return;
    }
    state.pendingComputerRemove = null;
    await desk.removeComputer(id);
  });

  document.getElementById('ssh-hosts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ssh-host]');
    if (!button || !state.computerForm) return;
    computerTarget.value = button.dataset.sshHost;
    computerPort.value = '';
    state.computerForm.unreachable = false;
    state.computerForm.error = '';
    renderComputerForm();
  });

  for (const input of [computerTarget, computerPort]) {
    input.addEventListener('input', () => {
      if (!state.computerForm) return;
      const wasUnreachable = state.computerForm.unreachable;
      state.computerForm.unreachable = false;
      if (wasUnreachable) state.computerForm.error = '';
      renderComputerForm();
    });
  }

  computerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveComputerForm();
  });
  computerSave.addEventListener('click', saveComputerForm);
  document.getElementById('computer-cancel').addEventListener('click', closeComputerForm);
  document.getElementById('add-computer').addEventListener('click', () => openComputerForm('add'));
  document.addEventListener('visibilitychange', syncComputersLive);
  desk.onComputers(applyComputers);
  setInterval(() => {
    if (state.tab === 'computers') updateRetryCountdowns();
  }, 1000);
}
