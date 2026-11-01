const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  PROBE_SCRIPT,
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
  MAX_BACKOFF_MS,
} = require('./computers.cjs');

// Real probe output from a MacBook Pro, a Mac mini, an Intel iMac on Linux,
// a netcup VPS and an Oracle ARM box. Host names and home paths are generic.
function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

const GB = 1024 ** 3;

test('the probe only reads', () => {
  assert.doesNotMatch(PROBE_SCRIPT, /\b(rm|mv|cp|tee|kill|sudo|chmod|chown|mkdir|touch|dd)\b/);
  assert.doesNotMatch(PROBE_SCRIPT, />\s*[^&/\s]/, 'no redirect into a file');
  assert.match(PROBE_SCRIPT, /@@end/);
});

test('a Mac reading: iostat sample, Activity Monitor memory, pressure, GPU, data volume', () => {
  const reading = parseProbe(fixture('macos-mini.txt'));
  assert.equal(reading.ok, true);
  assert.equal(reading.os, 'macOS');
  assert.equal(reading.model, 'Apple M6');
  assert.equal(reading.cores, 12);
  // Second iostat row: 81 idle is the since-boot line, 38 idle is the sample.
  assert.equal(reading.cpu.percent, 62);
  assert.deepEqual(reading.cpu.load, [6.21, 7.9, 8.46]);
  assert.equal(reading.memory.total, 16 * GB);
  assert.ok(reading.memory.percent > 85 && reading.memory.percent < 95);
  assert.equal(reading.memory.pressure, 'critical');
  assert.equal(reading.memory.freePercent, 21);
  assert.equal(reading.gpu.name, 'Apple M6');
  assert.equal(reading.gpu.percent, 0);
  assert.equal(reading.gpu.shared, true);
  assert.ok(reading.gpu.memUsed > 0);
  assert.equal(reading.gpu.memTotal, null);
  assert.equal(reading.disk.mount, '/System/Volumes/Data');
  assert.ok(reading.disk.percent > 97);
  assert.ok(reading.uptime > 4 * 24 * 3600);
});

test('Mac memory is anonymous minus purgeable, plus wired, plus compressed', () => {
  const reading = parseProbe(fixture('macos-laptop.txt'));
  // The fixture's vm_stat is the one taken with this run.
  const text = fixture('macos-laptop.txt');
  const anon = Number(/Anonymous pages:\s+(\d+)/.exec(text)[1]);
  const wired = Number(/Pages wired down:\s+(\d+)/.exec(text)[1]);
  const compressor = Number(/Pages occupied by compressor:\s+(\d+)/.exec(text)[1]);
  const purgeable = Number(/Pages purgeable:\s+(\d+)/.exec(text)[1]);
  assert.equal(reading.memory.used, (anon - purgeable + wired + compressor) * 16384);
  assert.equal(reading.memory.pressure, 'warn');
  assert.equal(reading.top[0].name, 'WindowServer', 'macOS paths shrink to the program name');
  assert.equal(reading.gpu.percent, 19);
});

test('a Linux reading: /proc/stat delta, MemAvailable, loadavg, uptime', () => {
  const reading = parseProbe(fixture('linux-imac.txt'));
  assert.equal(reading.ok, true);
  assert.equal(reading.os, 'Linux');
  assert.equal(reading.cores, 4);
  assert.equal(reading.model, 'Intel Core i5-6500');
  // 383 of 400 ticks idle between the two samples.
  assert.equal(Math.round(reading.cpu.percent * 100) / 100, 4.25);
  assert.deepEqual(reading.cpu.load, [0.11, 1.05, 1.27]);
  assert.equal(reading.memory.total, 24500104 * 1024);
  assert.equal(reading.memory.used, (24500104 - 20294560) * 1024);
  assert.equal(reading.memory.pressure, null);
  assert.equal(reading.gpu, null, 'no nvidia-smi means no GPU line, not zero');
  assert.equal(reading.uptime, 337688);
  assert.equal(reading.disk.mount, '/');
});

test('Linux top processes skip the probe itself', () => {
  const text = fixture('linux-netcup.txt').replace('@@top\n', '@@top\n 200 ps\n 50 sh\n');
  const reading = parseProbe(text);
  assert.deepEqual(reading.top.map((item) => item.name), ['dockerd', 'containerd', 'node']);
});

test('CPU model names lose trademarks and clock speeds', () => {
  assert.equal(cleanModel('Intel(R) Core(TM) i5-6500 CPU @ 3.20GHz'), 'Intel Core i5-6500');
  assert.equal(cleanModel('AMD EPYC-Genoa Processor'), 'AMD EPYC-Genoa');
  assert.equal(cleanModel('Apple M1 Pro'), 'Apple M1 Pro');
});

test('an ARM box with no model name still reads', () => {
  const reading = parseProbe(fixture('linux-oracle-arm.txt'));
  assert.equal(reading.ok, true);
  assert.equal(reading.arch, 'aarch64');
  assert.equal(reading.model, '');
  assert.equal(reading.cores, 2);
});

test('NVIDIA GPUs from nvidia-smi', () => {
  const text = fixture('linux-netcup.txt').replace('@@nvidia\n', '@@nvidia\nNVIDIA GeForce RTX 4090, 37, 2048, 24564\nNVIDIA GeForce RTX 4090, 63, 1024, 24564\n');
  const reading = parseProbe(text);
  assert.equal(reading.gpu.name, 'NVIDIA GeForce RTX 4090 ×2');
  assert.equal(reading.gpu.percent, 50);
  assert.equal(reading.gpu.memUsed, 3072 * 1024 * 1024);
  assert.equal(reading.gpu.memTotal, 2 * 24564 * 1024 * 1024);
});

test('an Intel Mac GPU reports its own VRAM', () => {
  const text = fixture('macos-mini.txt').replace(/@@gpu[\s\S]*?@@top/, '@@gpu\n      "PerformanceStatistics" = {"Device Utilization %"=23,"vramUsedBytes"=1073741824,"vramFreeBytes"=3221225472}\n      "model" = <"AMD Radeon Pro 570">\n@@top');
  const reading = parseProbe(text);
  assert.equal(reading.gpu.name, 'AMD Radeon Pro 570');
  assert.equal(reading.gpu.percent, 23);
  assert.equal(reading.gpu.memTotal, 4 * GB);
  assert.equal(reading.gpu.shared, false);
});

test('a cut-off answer is not a reading', () => {
  const full = fixture('linux-imac.txt');
  assert.equal(parseProbe(full.slice(0, full.indexOf('@@df'))).ok, false);
  assert.equal(parseProbe('').ok, false);
  const other = parseProbe('@@os\nFreeBSD\namd64\n@@end\n');
  assert.equal(other.ok, false);
  assert.match(other.error, /FreeBSD/);
});

test('Windows: CPU from two os.cpus() samples, disk from statfs', () => {
  const before = [{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }, { times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }];
  const after = [{ times: { user: 130, nice: 0, sys: 60, idle: 910, irq: 0 } }, { times: { user: 110, nice: 0, sys: 50, idle: 940, irq: 0 } }];
  assert.equal(cpuPercentFromSamples(before, after), 25);
  const reading = readingFromNode({
    before,
    after,
    totalmem: 16 * GB,
    freemem: 4 * GB,
    statfs: { bsize: 4096, blocks: 1000, bavail: 250 },
    uptime: 3600.7,
    loadavg: [0, 0, 0],
    nvidia: '',
    host: 'desk',
    platform: 'win32',
    mount: 'C:\\',
  });
  assert.equal(reading.os, 'Windows');
  assert.equal(reading.memory.percent, 75);
  assert.equal(reading.disk.percent, 75);
  assert.equal(reading.cpu.load, null, 'Windows has no load average');
  assert.equal(reading.gpu, null);
  assert.equal(reading.uptime, 3600);
});

test('SSH config: aliases with their details, no wildcards, includes followed', () => {
  const main = [
    '# personal',
    'Host mini',
    '  HostName Zans-Mac-Mini.local',
    '  User me',
    'Host netcup oracle',
    '  HostName 192.0.2.10',
    '  Port 2222',
    'Host *.boxd *.boxd.sh',
    '  User root',
    'Host !bad',
    'Match host foo',
    '  User nobody',
    'Include config.d/*',
    'Host mini',
    '  User someone-else',
  ].join('\n');
  const hosts = parseSshConfig(main, { readInclude: (pattern) => (pattern === 'config.d/*' ? ['Host box1\n  HostName=box1.example\n'] : []) });
  assert.deepEqual(hosts.map((host) => host.alias), ['mini', 'netcup', 'oracle', 'box1']);
  assert.equal(hosts[0].user, 'me', 'first value wins, like ssh');
  assert.equal(hosts[1].port, 2222);
  assert.equal(hosts[2].hostName, '192.0.2.10');
  assert.equal(hosts[3].hostName, 'box1.example');
});

test('targets: aliases and user@host pass, options and shell text do not', () => {
  for (const good of ['mini', 'zan@zan-imac.local', 'root@152.53.0.1', 'ubuntu@[2001:db8::1]', 'ssh://me@box']) {
    assert.equal(cleanTarget(good).ok, true, good);
  }
  assert.equal(cleanTarget('ssh://me@box').target, 'me@box');
  for (const bad of ['', '-oProxyCommand=evil', 'a b', 'box;rm -rf', 'me@-x', '$(id)', 'box`id`']) {
    assert.equal(cleanTarget(bad).ok, false, bad);
  }
  assert.deepEqual(cleanPort(''), { ok: true, port: null });
  assert.deepEqual(cleanPort('22'), { ok: true, port: null });
  assert.deepEqual(cleanPort(2222), { ok: true, port: 2222 });
  assert.equal(cleanPort('70000').ok, false);
  assert.equal(cleanPort('2.5').ok, false);
});

test('ssh runs batch mode with a timeout, never adds a host key, and ends options before the target', () => {
  const args = sshArgs({ target: 'mini', port: 2222 }, { controlPath: '/tmp/umc/%C' });
  const joined = args.join(' ');
  assert.match(joined, /BatchMode=yes/);
  assert.match(joined, /ConnectTimeout=\d+/);
  assert.match(joined, /StrictHostKeyChecking=yes/);
  assert.match(joined, /UpdateHostKeys=no/);
  assert.match(joined, /ControlPath=\/tmp\/umc\/%C/);
  assert.deepEqual(args.slice(-3), ['--', 'mini', '/bin/sh -s']);
  assert.equal(args[args.indexOf('-p') + 1], '2222');
  assert.ok(!sshArgs({ target: 'mini' }).includes('-p'));
});

test('ssh errors read as plain words', () => {
  assert.match(explainSshError('zan@box: Permission denied (publickey).'), /refused the login/);
  assert.match(explainSshError('Host key verification failed.'), /not trusted yet/);
  assert.match(explainSshError('ssh: Could not resolve hostname nope: nodename nor servname provided, or not known'), /did not resolve/);
  assert.match(explainSshError('ssh: connect to host 10.0.0.9 port 22: Operation timed out'), /No answer/);
  assert.match(explainSshError('ssh: connect to host box port 22: Connection refused'), /refused the SSH connection/);
  assert.equal(explainSshError('** WARNING: connection is not using a post-quantum key exchange algorithm.\nsomething odd'), 'something odd');
  assert.equal(explainSshError('', 255), 'SSH stopped with code 255.');
});

test('offline computers back off up to five minutes, idle ones wait a minute', () => {
  assert.equal(backoffMs(0), 0);
  assert.equal(backoffMs(1), 5000);
  assert.equal(backoffMs(2), 10000);
  assert.equal(backoffMs(4), 40000);
  assert.equal(backoffMs(50), MAX_BACKOFF_MS);
  assert.equal(nextDelayMs({ active: true }), 5000);
  assert.equal(nextDelayMs({ active: false }), 60000);
  assert.equal(nextDelayMs({ active: true, failures: 3 }), 20000);
  assert.equal(nextDelayMs({ active: false, failures: 1 }), 60000);
  assert.equal(nextDelayMs({ active: false, failures: 9 }), MAX_BACKOFF_MS);
});
