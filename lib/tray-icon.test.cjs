const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { trayPng, trayMeterColor } = require('./tray-icon.cjs');

// RGBA pixels of an unfiltered PNG from trayPng.
function pixels(buffer, size) {
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * (1 + size * 4) + 1 + x * 4;
      out.push([...raw.subarray(index, index + 4)]);
    }
  }
  return out;
}

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

test('the ring edge keeps the meter color instead of a dark fringe', () => {
  for (const size of [22, 44]) {
    const edge = pixels(trayPng(size, { left: 100 }), size).filter((pixel) => pixel[3] > 0 && pixel[3] < 255);
    assert.ok(edge.length > 0);
    for (const pixel of edge) assert.deepEqual(pixel.slice(0, 3), [94, 210, 255]);
  }
});
