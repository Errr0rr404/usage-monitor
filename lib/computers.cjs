// Reading a computer's CPU, memory, GPU and disk. Pure functions only: the
// main process runs the probe (locally or over SSH) and hands the text here.
const fs = require('fs');
const path = require('path');

// The probe is plain /bin/sh so it runs on any Mac or Linux box with nothing
// installed. It only reads: sysctl, vm_stat, iostat, /proc, df, ps.
const PROBE_SCRIPT = fs.readFileSync(path.join(__dirname, 'probe.sh'), 'utf8');

const SSH_CONNECT_TIMEOUT_S = 8;
const PROBE_TIMEOUT_MS = 25000;
const ACTIVE_INTERVAL_MS = 5000;
const IDLE_INTERVAL_MS = 60000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function sections(text) {
  const out = {};
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const marker = /^@@([a-z0-9]+)\s*$/.exec(line);
    if (marker) {
      current = marker[1];
      out[current] = [];
      continue;
    }
    if (current) out[current].push(line);
  }
  return out;
}

function firstLine(lines) {
  return (lines || []).map((line) => line.trim()).find(Boolean) || '';
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function processName(comm) {
  const trimmed = String(comm || '').trim();
  if (!trimmed) return '';
  // macOS ps prints the full path. Keep the program, not its folders.
  const base = trimmed.startsWith('/') ? trimmed.split('/').pop() : trimmed;
  return base;
}

// The probe's own helpers show up at the top of ps on Linux. They are not
// what the person wants to see.
const PROBE_PROCESSES = new Set(['ps', 'sh', 'head', 'iostat', 'sleep', 'df', 'grep', 'cut', 'tail', 'sysctl', 'ioreg', 'vm_stat']);

// "Intel(R) Core(TM) i5-6500 CPU @ 3.20GHz" reads better as "Intel Core i5-6500".
function cleanModel(model) {
  return String(model || '')
    .replace(/\((R|TM|tm|r)\)/g, '')
    .replace(/\s+CPU\b/g, '')
    .replace(/\s*@\s*[\d.]+\s*GHz/i, '')
    .replace(/\s+Processor\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTop(lines) {
  const out = [];
  for (const line of lines || []) {
    const match = /^\s*([\d.]+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const name = processName(match[2]);
    if (!name || PROBE_PROCESSES.has(name)) continue;
    out.push({ name, cpu: Number(match[1]) });
    if (out.length === 3) break;
  }
  return out;
}

function parseDf(lines) {
  const line = firstLine(lines);
  const match = /(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\S.*)$/.exec(line);
  if (!match) return null;
  const total = Number(match[1]) * 1024;
  const free = Number(match[3]) * 1024;
  if (!(total > 0)) return null;
  // APFS volumes share one container, so the used column undercounts. What is
  // left to write is the honest number.
  return {
    total,
    free,
    percent: clampPercent(((total - free) / total) * 100),
    mount: match[5].trim(),
  };
}

function parseLoad(text) {
  const values = String(text || '').replace(/[{}]/g, ' ').trim().split(/\s+/).slice(0, 3).map(Number);
  return values.length === 3 && values.every(Number.isFinite) ? values : null;
}

function vmStatPages(lines) {
  const pages = {};
  let pageSize = 4096;
  for (const line of lines || []) {
    const size = /page size of (\d+) bytes/.exec(line);
    if (size) {
      pageSize = Number(size[1]);
      continue;
    }
    const match = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim());
    if (match) pages[match[1].trim()] = Number(match[2]);
  }
  return { pages, pageSize };
}

const PRESSURE_LEVELS = { 1: 'normal', 2: 'warn', 4: 'critical' };

// Activity Monitor's Memory Used: app memory (anonymous minus purgeable),
// wired, and what the compressor holds.
function darwinMemory(parts) {
  const total = num(firstLine(parts.memsize));
  if (!(total > 0)) return null;
  const { pages, pageSize } = vmStatPages(parts.vmstat);
  const anonymous = pages['Anonymous pages'];
  const app = anonymous != null
    ? anonymous - (pages['Pages purgeable'] || 0)
    : (pages['Pages active'] || 0);
  const usedPages = app + (pages['Pages wired down'] || 0) + (pages['Pages occupied by compressor'] || 0);
  const used = Math.min(total, Math.max(0, usedPages * pageSize));
  const level = num(firstLine(parts.pressure));
  const free = num(firstLine(parts.memfree));
  return {
    total,
    used,
    percent: clampPercent((used / total) * 100),
    pressure: PRESSURE_LEVELS[level] || null,
    freePercent: free,
  };
}

// iostat prints a since-boot line, then the one-second sample. Use the last.
function darwinCpu(lines) {
  const rows = (lines || [])
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length >= 3 && row.slice(0, 3).every(Number.isFinite));
  const last = rows[rows.length - 1];
  if (!last) return null;
  return clampPercent(100 - last[2]);
}

function ioregValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&');
  const match = new RegExp(`"${escaped}"\\s*=\\s*(\\d+)`).exec(text);
  return match ? Number(match[1]) : null;
}

function darwinGpu(lines) {
  const text = (lines || []).join('\n');
  if (!text.trim()) return null;
  const model = /"model"\s*=\s*(?:"([^"]*)"|<"([^"]*)">)/.exec(text);
  const percent = ioregValue(text, 'Device Utilization %');
  let memUsed = ioregValue(text, 'In use system memory');
  let memTotal = null;
  const vramUsed = ioregValue(text, 'vramUsedBytes');
  const vramFree = ioregValue(text, 'vramFreeBytes');
  if (vramUsed != null) {
    memUsed = vramUsed;
    if (vramFree != null) memTotal = vramUsed + vramFree;
  }
  const totalMb = ioregValue(text, 'VRAM,totalMB');
  if (memTotal == null && totalMb != null) memTotal = totalMb * 1024 * 1024;
  if (percent == null && memUsed == null) return null;
  return {
    name: (model && (model[1] || model[2])) || 'GPU',
    percent: clampPercent(percent),
    memUsed,
    memTotal,
    shared: vramUsed == null && memUsed != null,
  };
}

function darwinUptime(parts) {
  const boot = /sec\s*=\s*(\d+)/.exec((parts.boottime || []).join(' '));
  const now = num(firstLine(parts.now));
  if (!boot || now == null) return null;
  return Math.max(0, now - Number(boot[1]));
}

function procStatTotals(line) {
  const values = String(line || '').trim().split(/\s+/).slice(1).map(Number).filter(Number.isFinite);
  if (values.length < 4) return null;
  const busyFields = values.slice(0, 8);
  const idle = values[3] + (values[4] || 0);
  const total = busyFields.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

function linuxCpu(parts) {
  const before = procStatTotals(firstLine(parts.stat1));
  const after = procStatTotals(firstLine(parts.stat2));
  if (!before || !after) return null;
  const total = after.total - before.total;
  if (!(total > 0)) return null;
  return clampPercent((1 - (after.idle - before.idle) / total) * 100);
}

function linuxMemory(lines) {
  const info = {};
  for (const line of lines || []) {
    const match = /^(\w+):\s+(\d+)\s*kB/.exec(line.trim());
    if (match) info[match[1]] = Number(match[2]) * 1024;
  }
  const total = info.MemTotal;
  if (!(total > 0)) return null;
  const available = info.MemAvailable != null
    ? info.MemAvailable
    : (info.MemFree || 0) + (info.Buffers || 0) + (info.Cached || 0);
  const used = Math.max(0, Math.min(total, total - available));
  return {
    total,
    used,
    percent: clampPercent((used / total) * 100),
    pressure: null,
    freePercent: clampPercent((available / total) * 100),
  };
}

function parseNvidia(lines) {
  const gpus = [];
  for (const line of lines || []) {
    const fields = line.split(',').map((field) => field.trim());
    if (fields.length < 4) continue;
    const [name, util, used, total] = fields;
    const percent = num(util);
    if (percent == null && num(used) == null) continue;
    gpus.push({
      name,
      percent,
      memUsed: num(used) == null ? null : num(used) * 1024 * 1024,
      memTotal: num(total) == null ? null : num(total) * 1024 * 1024,
    });
  }
  if (!gpus.length) return null;
  const known = gpus.filter((gpu) => gpu.percent != null);
  const sum = (key) => (gpus.every((gpu) => gpu[key] != null) ? gpus.reduce((total, gpu) => total + gpu[key], 0) : null);
  return {
    name: gpus.length > 1 ? `${gpus[0].name} ×${gpus.length}` : gpus[0].name,
    percent: known.length ? clampPercent(known.reduce((total, gpu) => total + gpu.percent, 0) / known.length) : null,
    memUsed: sum('memUsed'),
    memTotal: sum('memTotal'),
    shared: false,
  };
}

// Turns the probe's text into one reading. ok is false when the text is not a
// full probe, so a cut-off answer never shows as zeros.
function parseProbe(text) {
  const parts = sections(text);
  const system = (parts.os || []).map((line) => line.trim()).filter(Boolean);
  if (!parts.end || !system.length) {
    return { ok: false, error: 'The computer did not send back a full reading.' };
  }
  const kernel = system[0];
  const base = {
    ok: true,
    arch: system[1] || '',
    host: firstLine(parts.host),
    model: cleanModel(firstLine(parts.model)),
    cores: num(firstLine(parts.ncpu)),
    disk: parseDf(parts.df),
    top: parseTop(parts.top),
  };
  if (kernel === 'Darwin') {
    return {
      ...base,
      os: 'macOS',
      cpu: { percent: darwinCpu(parts.cpu), load: parseLoad(firstLine(parts.load)) },
      memory: darwinMemory(parts),
      gpu: darwinGpu(parts.gpu),
      uptime: darwinUptime(parts),
    };
  }
  if (kernel === 'Linux') {
    const load = parseLoad(firstLine(parts.loadavg));
    const uptime = num(firstLine(parts.uptime).split(/\s+/)[0]);
    return {
      ...base,
      os: 'Linux',
      cpu: { percent: linuxCpu(parts), load },
      memory: linuxMemory(parts.meminfo),
      gpu: parseNvidia(parts.nvidia),
      uptime: uptime == null ? null : Math.floor(uptime),
    };
  }
  return { ok: false, error: `Usage Monitor reads macOS and Linux computers. This one runs ${kernel}.` };
}

// Windows has no /bin/sh, so this computer is read through Node instead.
// before and after are os.cpus() taken a moment apart.
function cpuPercentFromSamples(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length || !after.length) return null;
  let idle = 0;
  let total = 0;
  after.forEach((cpu, index) => {
    const prev = before[index]?.times;
    const now = cpu?.times;
    if (!prev || !now) return;
    for (const key of Object.keys(now)) total += (now[key] || 0) - (prev[key] || 0);
    idle += (now.idle || 0) - (prev.idle || 0);
  });
  if (!(total > 0)) return null;
  return clampPercent((1 - idle / total) * 100);
}

function readingFromNode({ before, after, totalmem, freemem, statfs, uptime, loadavg, nvidia, host, model, platform, arch, mount }) {
  const memory = totalmem > 0
    ? {
      total: totalmem,
      used: Math.max(0, totalmem - freemem),
      percent: clampPercent(((totalmem - freemem) / totalmem) * 100),
      pressure: null,
      freePercent: clampPercent((freemem / totalmem) * 100),
    }
    : null;
  let disk = null;
  if (statfs && statfs.blocks > 0) {
    const total = statfs.blocks * statfs.bsize;
    const free = statfs.bavail * statfs.bsize;
    disk = { total, free, percent: clampPercent(((total - free) / total) * 100), mount: mount || '' };
  }
  const load = Array.isArray(loadavg) && loadavg.some((value) => value > 0) ? loadavg.slice(0, 3) : null;
  return {
    ok: true,
    os: platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux',
    arch: arch || '',
    host: host || '',
    model: cleanModel(model),
    cores: Array.isArray(after) ? after.length : null,
    cpu: { percent: cpuPercentFromSamples(before, after), load },
    memory,
    gpu: parseNvidia(String(nvidia || '').split(/\r?\n/)),
    disk,
    uptime: Number.isFinite(uptime) ? Math.floor(uptime) : null,
    top: [],
  };
}

// Host aliases from ~/.ssh/config, so the person picks one instead of typing.
// Wildcard patterns are rules, not computers, so they are left out.
function parseSshConfig(text, { readInclude, depth = 0 } = {}) {
  const hosts = [];
  let block = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = /^(\S+?)\s*(?:=\s*|\s+)(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'host') {
      const names = value.split(/\s+/).map((name) => name.replace(/^"|"$/g, ''));
      block = [];
      for (const name of names) {
        if (!name || /[*?!]/.test(name)) continue;
        const entry = { alias: name, hostName: '', user: '', port: null };
        block.push(entry);
        hosts.push(entry);
      }
      continue;
    }
    if (key === 'match') {
      block = null;
      continue;
    }
    if (key === 'include') {
      if (typeof readInclude !== 'function' || depth >= 4) continue;
      for (const pattern of value.split(/\s+/)) {
        for (const included of readInclude(pattern) || []) {
          hosts.push(...parseSshConfig(included, { readInclude, depth: depth + 1 }));
        }
      }
      continue;
    }
    if (!block) continue;
    for (const entry of block) {
      if (key === 'hostname' && !entry.hostName) entry.hostName = value;
      if (key === 'user' && !entry.user) entry.user = value;
      if (key === 'port' && entry.port == null) entry.port = num(value);
    }
  }
  const seen = new Set();
  return hosts.filter((entry) => {
    if (seen.has(entry.alias)) return false;
    seen.add(entry.alias);
    return true;
  });
}

// An SSH target is a Host alias or user@host. It is passed to ssh as one
// argument after --, and never through a shell, but a leading dash or a
// space would still read as an option, so those are refused.
const TARGET_PATTERN = /^(?:[A-Za-z0-9._][A-Za-z0-9._-]*@)?(?:[A-Za-z0-9._][A-Za-z0-9._%-]*|\[[0-9A-Fa-f:.%]+\])$/;

function cleanTarget(value) {
  const target = String(value || '').trim().replace(/^ssh:\/\//i, '');
  if (!target) return { ok: false, error: 'Pick an SSH host or type user@host.' };
  if (!TARGET_PATTERN.test(target)) return { ok: false, error: 'Use a Host alias from your SSH config, or user@host.' };
  return { ok: true, target };
}

function cleanPort(value) {
  if (value == null || value === '') return { ok: true, port: null };
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port is a number from 1 to 65535.' };
  return { ok: true, port: port === 22 ? null : port };
}

// Read-only and non-interactive: keys and the agent only (BatchMode), never a
// password prompt, never a new entry in known_hosts.
function sshArgs({ target, port }, { controlPath } = {}) {
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`,
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'UpdateHostKeys=no',
    '-o', 'LogLevel=ERROR',
  ];
  if (controlPath) {
    args.push('-o', 'ControlMaster=auto', '-o', `ControlPath=${controlPath}`, '-o', 'ControlPersist=120');
  }
  if (port) args.push('-p', String(port));
  args.push('--', target, '/bin/sh -s');
  return args;
}

function sshErrorLines(stderr) {
  return String(stderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('**') && !/^Warning: Permanently added/i.test(line));
}

function explainSshError(stderr, code) {
  const lines = sshErrorLines(stderr);
  const text = lines.join(' ');
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/i.test(text)) {
    return 'This host is not trusted yet. Connect once from Terminal to trust its key.';
  }
  if (/Permission denied/i.test(text)) return 'SSH refused the login. Check that your key or agent can sign in.';
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(text)) return 'That host name did not resolve.';
  if (/timed out/i.test(text)) return `No answer within ${SSH_CONNECT_TIMEOUT_S} seconds.`;
  if (/Connection refused/i.test(text)) return 'The computer refused the SSH connection.';
  if (/No route to host|Network is unreachable/i.test(text)) return 'No route to that computer.';
  if (/Connection (closed|reset)/i.test(text)) return 'The connection closed before a reading came back.';
  const last = lines[lines.length - 1];
  if (last) return last.length > 160 ? `${last.slice(0, 157)}…` : last;
  return code ? `SSH stopped with code ${code}.` : 'The computer could not be read.';
}

// Offline computers keep being retried, each time a little later.
function backoffMs(failures) {
  if (!(failures > 0)) return 0;
  return Math.min(MAX_BACKOFF_MS, ACTIVE_INTERVAL_MS * 2 ** (failures - 1));
}

function nextDelayMs({ failures = 0, active = false } = {}) {
  const interval = active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
  return failures > 0 ? Math.max(backoffMs(failures), active ? 0 : interval) : interval;
}

module.exports = {
  PROBE_SCRIPT,
  PROBE_TIMEOUT_MS,
  ACTIVE_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  MAX_BACKOFF_MS,
  parseProbe,
  cleanModel,
  readingFromNode,
  cpuPercentFromSamples,
  parseSshConfig,
  cleanTarget,
  cleanPort,
  sshArgs,
  explainSshError,
  backoffMs,
  nextDelayMs,
};
