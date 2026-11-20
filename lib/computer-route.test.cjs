const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tunnelFor,
  isConnectivityFailure,
  planRoutes,
  readRoutes,
  judgeAttempt,
  LAN_RETRY_MS,
} = require('./computer-route.cjs');
const { normalizeComputers, updateComputer } = require('./computer-list.cjs');

const hosts = [
  { alias: 'bosgame', hostName: 'bosgame.local', user: 'zan', port: null },
  { alias: 'bosgame-r', hostName: '127.0.0.1', user: 'zan', port: 22201 },
  { alias: 'imac', hostName: '192.168.12.30', user: 'zan', port: null },
  { alias: 'imac-r', hostName: '127.0.0.1', user: 'zan', port: 22202 },
  { alias: 'mini-r', hostName: '127.0.0.1', user: 'zan', port: 22203 },
  { alias: 'netcup', hostName: 'netcup.example', user: 'zan', port: null },
];

test('the tunnel is the -r alias of a saved alias', () => {
  assert.deepEqual(tunnelFor({ target: 'bosgame' }, hosts), { target: 'bosgame-r', port: null, explicit: false });
  assert.equal(tunnelFor({ target: 'zan@imac' }, hosts).target, 'imac-r');
});

test('a saved raw address finds its alias, then that alias -r', () => {
  assert.equal(tunnelFor({ target: 'zan@192.168.12.30' }, hosts).target, 'imac-r');
  assert.equal(tunnelFor({ target: 'bosgame.local' }, hosts).target, 'bosgame-r');
});

test('a name with no tunnel alias has no tunnel', () => {
  assert.equal(tunnelFor({ target: 'netcup' }, hosts), null);
  assert.equal(tunnelFor({ target: 'bosgame-r' }, hosts), null, 'a tunnel alias is not tunnelled again');
  assert.equal(tunnelFor({ target: 'nothing' }, []), null);
});

test('an explicit fallback wins', () => {
  assert.equal(tunnelFor({ target: 'netcup', fallback: 'bosgame-r' }, hosts).target, 'bosgame-r');
  assert.equal(tunnelFor({ target: 'bosgame', fallback: 'x y' }, hosts).target, 'bosgame-r', 'a bad alias is ignored');
});

test('only connection failures try the other route', () => {
  assert.equal(isConnectivityFailure({ timedOut: true }), true);
  assert.equal(isConnectivityFailure({ stderr: 'ssh: connect to host bosgame port 22: No route to host', code: 255 }), true);
  assert.equal(isConnectivityFailure({ stderr: 'ssh: Could not resolve hostname bosgame.local', code: 255 }), true);
  assert.equal(isConnectivityFailure({ stderr: 'zan@x: Permission denied (publickey).', code: 255 }), false);
  assert.equal(isConnectivityFailure({ stderr: 'Host key verification failed.', code: 255 }), false);
});

test('routes: home network first with a short timeout, then the tunnel', () => {
  const plan = planRoutes({ computer: { target: 'bosgame', port: null }, tunnel: { target: 'bosgame-r' }, now: 1000 });
  assert.deepEqual(plan.map((step) => step.route), ['lan', 'tunnel']);
  assert.ok(plan[0].connectTimeout < plan[1].connectTimeout);
  assert.deepEqual(planRoutes({ computer: { target: 'netcup' }, tunnel: null }).map((step) => step.route), ['lan']);
});

test('while on the tunnel the home network is retried only now and then', () => {
  const computer = { target: 'bosgame' };
  const tunnel = { target: 'bosgame-r' };
  const last = { route: 'tunnel', lanAt: 1000 };
  assert.deepEqual(planRoutes({ computer, tunnel, last, now: 1000 + LAN_RETRY_MS - 1 }).map((s) => s.route), ['tunnel', 'lan']);
  assert.deepEqual(planRoutes({ computer, tunnel, last, now: 1000 + LAN_RETRY_MS }).map((s) => s.route), ['lan', 'tunnel']);
});

function fakeRun(table, log = []) {
  return async (step) => {
    log.push(step.target);
    const answer = table[step.target];
    return typeof answer === 'function' ? answer(step) : answer;
  };
}

const up = { ok: true, reading: { ok: true, cpu: { percent: 3 } } };
const noRoute = { ok: false, error: 'No route to that computer.', network: true };

test('reads over the home network when it answers, and does not touch the tunnel', async () => {
  const log = [];
  const reading = await readRoutes({ computer: { id: 'a', target: 'bosgame' }, hosts, run: fakeRun({ bosgame: up }, log) });
  assert.equal(reading.ok, true);
  assert.equal(reading.via, 'lan');
  assert.deepEqual(log, ['bosgame']);
});

test('falls back to the tunnel when the home network is out of reach', async () => {
  const log = [];
  const reading = await readRoutes({ computer: { id: 'a', target: 'bosgame' }, hosts, run: fakeRun({ bosgame: noRoute, 'bosgame-r': up }, log) });
  assert.equal(reading.ok, true);
  assert.equal(reading.via, 'tunnel');
  assert.equal(reading.tunnel, 'bosgame-r');
  assert.deepEqual(log, ['bosgame', 'bosgame-r']);
});

test('a refused login on the home network does not try the tunnel', async () => {
  const log = [];
  const denied = { ok: false, error: 'SSH refused the login.', network: false };
  const reading = await readRoutes({ computer: { id: 'a', target: 'bosgame' }, hosts, run: fakeRun({ bosgame: denied, 'bosgame-r': up }, log) });
  assert.equal(reading.ok, false);
  assert.match(reading.error, /refused the login/);
  assert.deepEqual(log, ['bosgame']);
});

test('both routes down: unreachable, with each reason', async () => {
  const reading = await readRoutes({
    computer: { id: 'a', target: 'bosgame' },
    hosts,
    run: fakeRun({ bosgame: noRoute, 'bosgame-r': { ok: false, error: 'No answer in time.', network: true } }),
  });
  assert.equal(reading.ok, false);
  assert.match(reading.error, /Home network: No route/);
  assert.match(reading.error, /Tunnel \(bosgame-r\): No answer in time/);
});

test('no tunnel alias: one route, the plain error', async () => {
  const log = [];
  const reading = await readRoutes({ computer: { id: 'n', target: 'netcup' }, hosts, run: fakeRun({ netcup: noRoute }, log) });
  assert.equal(reading.ok, false);
  assert.equal(reading.error, 'No route to that computer.');
  assert.deepEqual(log, ['netcup']);
});

test('after a tunnel reading the next one starts on the tunnel, then the home network returns', async () => {
  const memory = new Map();
  let clock = 0;
  const now = () => clock;
  const log = [];
  const computer = { id: 'a', target: 'bosgame' };
  const run = fakeRun({ bosgame: noRoute, 'bosgame-r': up }, log);
  await readRoutes({ computer, hosts, run, memory, now });
  assert.deepEqual(log, ['bosgame', 'bosgame-r']);
  log.length = 0;
  clock = 5000;
  const again = await readRoutes({ computer, hosts, run, memory, now });
  assert.equal(again.via, 'tunnel');
  assert.deepEqual(log, ['bosgame-r'], 'the home network is not probed again within a minute');
  log.length = 0;
  clock = 5000 + LAN_RETRY_MS;
  const home = await readRoutes({
    computer, hosts, memory, now,
    run: fakeRun({ bosgame: up }, log),
  });
  assert.equal(home.via, 'lan');
  assert.deepEqual(log, ['bosgame']);
});

test('a dead tunnel and a dead home network start over from the home network', async () => {
  const memory = new Map([['a', { route: 'tunnel', lanAt: 0 }]]);
  const log = [];
  const reading = await readRoutes({
    computer: { id: 'a', target: 'bosgame' }, hosts, memory, now: () => 1000,
    run: fakeRun({ bosgame: noRoute, 'bosgame-r': noRoute }, log),
  });
  assert.equal(reading.ok, false);
  assert.deepEqual(log, ['bosgame-r', 'bosgame']);
  assert.equal(memory.has('a'), false);
});

test('judgeAttempt turns an ssh result into ok, or a reason and whether it was the network', () => {
  const parse = (out) => (out.includes('@@end') ? { ok: true, cpu: {} } : { ok: false, error: 'bad' });
  assert.equal(judgeAttempt({ code: 0, stdout: '@@end' }, parse).ok, true);
  const timeout = judgeAttempt({ timedOut: true, stdout: '' }, parse);
  assert.equal(timeout.ok, false);
  assert.equal(timeout.network, true);
  const down = judgeAttempt({ code: 255, stdout: '', stderr: 'ssh: connect to host x port 22: Operation timed out' }, parse, { target: 'x' });
  assert.equal(down.network, true);
  assert.match(down.error, /No answer/);
  const denied = judgeAttempt({ code: 255, stdout: '', stderr: 'Permission denied (publickey).' }, parse, { target: 'x' });
  assert.equal(denied.network, false);
  assert.equal(judgeAttempt({ code: 0, stdout: 'junk' }, parse).network, false);
});

test('a saved fallback alias survives normalizing and editing', () => {
  const list = normalizeComputers([{ id: 'a', name: 'Box', target: 'box', port: null, fallback: 'box-r' }, { id: 'b', name: 'B', target: 'b', fallback: 'bad alias' }]);
  assert.equal(list[0].fallback, 'box-r');
  assert.equal('fallback' in list[1], false);
  const edited = updateComputer(list, 'a', { name: 'Renamed' });
  assert.equal(edited.computer.fallback, 'box-r');
});
