const test = require('node:test');
const assert = require('node:assert/strict');
const { trayPng, trayMeterColor } = require('./tray-icon.cjs');

function isPng(buffer) {
  return buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71;
}

test('meter color stays app cyan until the window runs low', () => {
  assert.deepEqual(trayMeterColor(null), [94, 210, 255]);
  assert.deepEqual(trayMeterColor(64), [94, 210, 255]);
  assert.deepEqual(trayMeterColor(14), [255, 177, 90]);
  assert.deepEqual(trayMeterColor(0), [255, 107, 107]);
});

test('tray png is a remaining arc, not a fixed white ring', () => {
  const idle = trayPng(22);
  const mid = trayPng(22, { left: 49 });
  const low = trayPng(22, { left: 8 });
  const empty = trayPng(22, { left: 0 });
  assert.equal(isPng(idle), true);
  assert.equal(isPng(mid), true);
  assert.notEqual(Buffer.compare(idle, mid), 0);
  assert.notEqual(Buffer.compare(mid, low), 0);
  assert.notEqual(Buffer.compare(low, empty), 0);
  assert.equal(Buffer.compare(mid, trayPng(22, { left: 49 })), 0);
});
