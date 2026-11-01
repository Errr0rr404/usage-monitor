// Reads this computer and the added ones on a timer, and tells the window.
// Remote computers are read over SSH with the person's own keys and agent:
// nothing is installed there and nothing secret is kept here.
const { spawn, spawnSync, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PROBE_SCRIPT,
  PROBE_TIMEOUT_MS,
  parseProbe,
  readingFromNode,
  parseSshConfig,
  sshArgs,
  explainSshError,
  nextDelayMs,
} = require('../lib/computers.cjs');
const { LOCAL_ID } = require('../lib/computer-list.cjs');

const windows = process.platform === 'win32';
const children = new Set();

function sshBinary() {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/ssh')) return '/usr/bin/ssh';
  return 'ssh';
}

// Short, private folder for SSH connection sharing, so a 5-second refresh does
// not open a new login each time. It lives under /tmp, never ~/.ssh: a socket
// path has to stay under 104 characters, and the macOS temp folder is too deep.
let controlDir = null;
function controlPath() {
  if (windows) return null;
  try {
    if (!controlDir) {
      controlDir = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'umc-'));
      fs.chmodSync(controlDir, 0o700);
    }
    return path.join(controlDir, '%C');
  } catch {
    return null;
  }
}

function runProbe(command, args, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      resolve(result);
    };
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: error.message || 'Could not start.' , spawnError: true });
      return;
    }
    children.add(child);
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { if (stdout.length < 256 * 1024) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk; });
    child.on('error', (error) => finish({ code: -1, stdout, stderr: error.message, spawnError: true }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(PROBE_SCRIPT);
  });
}

function nvidiaSmi() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : String(stdout || ''));
    });
  });
}

async function readWindows() {
  const before = os.cpus();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const after = os.cpus();
  const mount = path.parse(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : os.homedir()).root;
  let statfs = null;
  try {
    statfs = fs.statfsSync(mount);
  } catch {
    statfs = null;
  }
  return readingFromNode({
    before,
    after,
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    statfs,
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    nvidia: await nvidiaSmi(),
    host: os.hostname(),
    model: after[0]?.model?.trim() || '',
    platform: process.platform,
    arch: os.arch(),
    mount,
  });
}

async function readLocal() {
  if (windows) return readWindows();
  const result = await runProbe('/bin/sh', ['-s']);
  if (result.timedOut) return { ok: false, error: 'This computer took too long to answer.' };
  const reading = parseProbe(result.stdout);
  return reading;
}

async function readRemote(computer) {
  const result = await runProbe(sshBinary(), sshArgs(computer, { controlPath: controlPath() }));
  if (result.spawnError) return { ok: false, error: 'SSH is not installed on this computer.' };
  if (result.timedOut) return { ok: false, error: `No reading within ${Math.round(PROBE_TIMEOUT_MS / 1000)} seconds.` };
  if (result.code !== 0 && !result.stdout.includes('@@end')) {
    return { ok: false, error: explainSshError(result.stderr, result.code, { target: computer.target }) };
  }
  return parseProbe(result.stdout);
}

// Host aliases the person already set up, read from ~/.ssh/config only.
function sshHosts() {
  const home = os.homedir();
  const sshDir = path.join(home, '.ssh');
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  const readInclude = (pattern) => {
    const expanded = pattern.replace(/^~(?=\/|\\|$)/, home);
    const full = path.isAbsolute(expanded) ? expanded : path.join(sshDir, expanded);
    const dir = path.dirname(full);
    const base = path.basename(full);
    if (!/[*?]/.test(base)) return [read(full)];
    const matcher = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    try {
      return fs.readdirSync(dir).filter((name) => matcher.test(name)).sort().map((name) => read(path.join(dir, name)));
    } catch {
      return [];
    }
  };
  return parseSshConfig(read(path.join(sshDir, 'config')), { readInclude });
}

function localComputer(name) {
  return { id: LOCAL_ID, name: name || os.hostname().replace(/\.local$/i, ''), target: '', port: null, local: true };
}

// One timer walks the list each second and starts whatever is due. A computer
// is never read twice at once, and an offline one backs off.
function createWatch({ list, send, readLocalFn = readLocal, readRemoteFn = readRemote, now = () => Date.now(), localName = '' }) {
  const status = new Map();
  let active = false;
  let timer = null;

  function computers() {
    return [localComputer(localName), ...list()];
  }

  function entry(id) {
    if (!status.has(id)) status.set(id, { reading: null, error: '', failures: 0, at: null, nextAt: 0, checking: false });
    return status.get(id);
  }

  function snapshot() {
    const out = {};
    for (const computer of computers()) {
      const item = entry(computer.id);
      out[computer.id] = {
        reading: item.reading,
        error: item.error,
        failures: item.failures,
        at: item.at,
        retryAt: item.failures ? item.nextAt : null,
        checking: item.checking,
      };
    }
    return out;
  }

  function publish() {
    send({ computers: computers(), readings: snapshot() });
  }

  async function read(computer) {
    const item = entry(computer.id);
    item.checking = true;
    let reading;
    try {
      reading = computer.local ? await readLocalFn() : await readRemoteFn(computer);
    } catch (error) {
      reading = { ok: false, error: error?.message || 'The reading failed.' };
    }
    // The computer may have been removed or edited while it was being read.
    const current = computers().find((candidate) => candidate.id === computer.id);
    if (!current || current.target !== computer.target || current.port !== computer.port) {
      if (current) Object.assign(item, { checking: false, nextAt: 0 });
      else status.delete(computer.id);
      return;
    }
    item.checking = false;
    item.at = now();
    if (reading?.ok) {
      item.reading = reading;
      item.error = '';
      item.failures = 0;
    } else {
      item.error = reading?.error || 'The reading failed.';
      item.failures += 1;
    }
    item.nextAt = now() + nextDelayMs({ failures: item.failures, active });
    publish();
  }

  function tick() {
    const ids = new Set();
    for (const computer of computers()) {
      ids.add(computer.id);
      const item = entry(computer.id);
      if (!item.checking && now() >= item.nextAt) read(computer);
    }
    for (const id of [...status.keys()]) if (!ids.has(id)) status.delete(id);
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, 1000);
    tick();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const child of children) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    children.clear();
  }

  // Going visible reads everything now; going hidden only slows the next one.
  function setActive(next) {
    const was = active;
    active = Boolean(next);
    if (active && !was) {
      for (const item of status.values()) {
        if (!item.checking && !item.failures) item.nextAt = 0;
      }
      tick();
    }
  }

  function refreshNow(id) {
    for (const [key, item] of status) {
      if (id && key !== id) continue;
      if (!item.checking) item.nextAt = 0;
    }
    tick();
  }

  function forget(id) {
    status.delete(id);
  }

  return { start, stop, setActive, refreshNow, forget, snapshot, computers, publish, tick };
}

// Checks a computer once before it is saved, so a typo shows straight away.
async function checkComputer(computer) {
  return readRemote(computer);
}

// Shared SSH connections outlive a read by two minutes. On quit, ask each one
// to close, then remove the folder.
function closeConnections(dir = controlDir) {
  if (!dir) return;
  try {
    for (const name of fs.readdirSync(dir)) {
      spawnSync(sshBinary(), ['-o', `ControlPath=${path.join(dir, name)}`, '-O', 'exit', 'usage-monitor'], { stdio: 'ignore', timeout: 2000, windowsHide: true });
    }
  } catch {
    // Nothing shared yet.
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // The temp folder is cleaned by the system anyway.
  }
  if (dir === controlDir) controlDir = null;
}

module.exports = {
  createWatch,
  checkComputer,
  sshHosts,
  localComputer,
  closeConnections,
};
