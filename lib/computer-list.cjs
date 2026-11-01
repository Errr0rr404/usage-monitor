// The computers a person added, as saved in settings. Names and SSH targets
// only: the keys stay with ssh and its agent, and nothing secret is stored.
const { cleanTarget, cleanPort } = require('./computers.cjs');

const LOCAL_ID = 'local';
const MAX_NAME = 40;

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function sameTarget(a, b) {
  return a.target.toLowerCase() === b.target.toLowerCase() && (a.port || null) === (b.port || null);
}

// Anything in the saved list that is not a usable computer is dropped, so a
// hand-edited settings file cannot break the board.
function normalizeComputers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' && item.id && item.id !== LOCAL_ID ? item.id : null;
    const target = cleanTarget(item.target);
    const port = cleanPort(item.port);
    if (!id || !target.ok || !port.ok) continue;
    if (out.some((existing) => existing.id === id)) continue;
    out.push({ id, name: cleanName(item.name) || target.target, target: target.target, port: port.port });
  }
  return out;
}

function checkInput(input) {
  const target = cleanTarget(input?.target);
  if (!target.ok) return target;
  const port = cleanPort(input?.port);
  if (!port.ok) return port;
  return { ok: true, target: target.target, port: port.port, name: cleanName(input?.name) };
}

function addComputer(list, input, makeId) {
  const computers = normalizeComputers(list);
  const checked = checkInput(input);
  if (!checked.ok) return { ok: false, error: checked.error, computers };
  const candidate = { target: checked.target, port: checked.port };
  if (computers.some((computer) => sameTarget(computer, candidate))) {
    return { ok: false, error: 'That computer is already on the list.', computers };
  }
  const computer = { id: makeId(), name: checked.name || checked.target, target: checked.target, port: checked.port };
  return { ok: true, computer, computers: [...computers, computer] };
}

function updateComputer(list, id, patch) {
  const computers = normalizeComputers(list);
  const index = computers.findIndex((computer) => computer.id === id);
  if (index < 0) return { ok: false, error: 'That computer is no longer on the list.', computers };
  const current = computers[index];
  const merged = {
    name: patch && 'name' in patch ? patch.name : current.name,
    target: patch && 'target' in patch ? patch.target : current.target,
    port: patch && 'port' in patch ? patch.port : current.port,
  };
  const checked = checkInput(merged);
  if (!checked.ok) return { ok: false, error: checked.error, computers };
  const next = { id, name: checked.name || checked.target, target: checked.target, port: checked.port };
  if (computers.some((computer) => computer.id !== id && sameTarget(computer, next))) {
    return { ok: false, error: 'That computer is already on the list.', computers };
  }
  const out = computers.slice();
  out[index] = next;
  return { ok: true, computer: next, computers: out };
}

function removeComputer(list, id) {
  return normalizeComputers(list).filter((computer) => computer.id !== id);
}

// This computer always stays first, so only the added ones move.
function moveComputer(list, id, delta) {
  const computers = normalizeComputers(list);
  const from = computers.findIndex((computer) => computer.id === id);
  if (from < 0) return computers;
  const to = Math.max(0, Math.min(computers.length - 1, from + Math.sign(Number(delta) || 0)));
  if (to === from) return computers;
  const out = computers.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

module.exports = {
  LOCAL_ID,
  normalizeComputers,
  addComputer,
  updateComputer,
  removeComputer,
  moveComputer,
};
