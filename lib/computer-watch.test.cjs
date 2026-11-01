const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatch } = require('../electron/computers.cjs');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ remote }) {
  let clock = 1000;
  let list = [{ id: 'box', name: 'Box', target: 'box', port: null }];
  const sent = [];
  const calls = [];
  const watch = createWatch({
    list: () => list,
    send: (payload) => sent.push(payload),
    now: () => clock,
    localName: 'Here',
    readLocalFn: async () => ({ ok: true, cpu: { percent: 5 } }),
    readRemoteFn: async (computer) => {
      calls.push(computer.target);
      return remote(computer);
    },
  });
  return {
    watch,
    sent,
    calls,
    advance: (ms) => { clock += ms; },
    setList: (next) => { list = next; },
    last: () => sent[sent.length - 1],
  };
}

test('this computer comes first and cannot be renamed by the list', async () => {
  const h = harness({ remote: async () => ({ ok: true }) });
  h.watch.tick();
  await flush();
  const { computers } = h.last();
  assert.equal(computers[0].id, 'local');
  assert.equal(computers[0].name, 'Here');
  assert.equal(computers[0].local, true);
  assert.equal(computers[1].id, 'box');
});

test('an offline computer keeps its error and retries later each time', async () => {
  let up = false;
  const h = harness({ remote: async () => (up ? { ok: true, cpu: { percent: 1 } } : { ok: false, error: 'No answer within 8 seconds.' }) });
  h.watch.setActive(true);
  await flush();
  let box = h.last().readings.box;
  assert.equal(box.failures, 1);
  assert.equal(box.error, 'No answer within 8 seconds.');
  assert.equal(box.retryAt, 1000 + 5000);
  h.advance(4999);
  h.watch.tick();
  await flush();
  assert.equal(h.calls.length, 1, 'not retried before the backoff');
  h.advance(1);
  h.watch.tick();
  await flush();
  box = h.last().readings.box;
  assert.equal(box.failures, 2);
  assert.equal(box.retryAt, 6000 + 10000, 'the wait doubles');
  up = true;
  h.advance(10000);
  h.watch.tick();
  await flush();
  box = h.last().readings.box;
  assert.equal(box.failures, 0);
  assert.equal(box.error, '');
  assert.equal(box.retryAt, null);
  assert.equal(box.reading.cpu.percent, 1);
});

test('a computer removed or retargeted mid-read drops the old answer', async () => {
  let release;
  const h = harness({ remote: () => new Promise((resolve) => { release = resolve; }) });
  h.watch.tick();
  await flush();
  assert.equal(h.watch.snapshot().box.checking, true);
  h.setList([{ id: 'box', name: 'Box', target: 'other', port: null }]);
  release({ ok: true, cpu: { percent: 99 } });
  await flush();
  assert.equal(h.watch.snapshot().box.reading, null, 'the old address does not fill the card');
  h.setList([]);
  h.watch.tick();
  await flush();
  assert.equal('box' in h.watch.snapshot(), false);
});

test('a hidden tab reads once a minute, opening it reads at once', async () => {
  const h = harness({ remote: async () => ({ ok: true }) });
  h.watch.tick();
  await flush();
  assert.equal(h.calls.length, 1);
  h.advance(30000);
  h.watch.tick();
  await flush();
  assert.equal(h.calls.length, 1);
  h.watch.setActive(true);
  await flush();
  assert.equal(h.calls.length, 2);
});
