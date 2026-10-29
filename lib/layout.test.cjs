const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLayout, openingSize, placeLayout } = require('./layout.cjs');

test('a missing layout stays the tall stacked meter', () => {
  assert.equal(normalizeLayout(undefined), 'stacked');
  assert.equal(normalizeLayout('nope'), 'stacked');
  const box = openingSize('stacked', {});
  assert.equal(box.width, 304);
  assert.equal(box.height, 500);
  assert.equal(box.minWidth, 280);
  assert.equal(box.minHeight, 240);
});

test('a short stacked window still opens tall enough to use', () => {
  const box = openingSize('stacked', { bounds: { width: 320, height: 200, x: 12, y: 40 } });
  assert.equal(box.width, 320);
  assert.equal(box.height, 360);
  assert.equal(box.x, 12);
  assert.equal(box.y, 40);
});

test('sideways opens as a wide strip and ignores the stacked size', () => {
  const box = openingSize('sideways', {
    bounds: { width: 304, height: 640, x: 8, y: 8 },
  });
  assert.equal(box.width, 860);
  assert.equal(box.height, 168);
  assert.equal(box.minWidth, 520);
  assert.equal(box.minHeight, 150);
  assert.equal(box.x, undefined);
});

test('a saved sideways size comes back and stays above the minimum', () => {
  const box = openingSize('sideways', {
    sidewaysBounds: { width: 400, height: 120, x: 20, y: 30 },
  });
  assert.equal(box.width, 520);
  assert.equal(box.height, 150);
  assert.equal(box.x, 20);
  assert.equal(box.y, 30);
});

test('switching layouts restores the size you left', () => {
  const placed = placeLayout('sideways', {
    bounds: { width: 330, height: 480, x: 5, y: 6 },
  }, { width: 330, height: 480, x: 15, y: 25 });
  assert.equal(placed.layout, 'sideways');
  assert.equal(placed.box.width, 860);
  assert.equal(placed.box.x, 15);
  assert.equal(placed.box.y, 25);

  const back = placeLayout('stacked', {
    bounds: { width: 330, height: 480, x: 5, y: 6 },
    sidewaysBounds: { width: 900, height: 280, x: 40, y: 50 },
  }, { width: 900, height: 280, x: 40, y: 50 });
  assert.equal(back.layout, 'stacked');
  assert.equal(back.box.width, 330);
  assert.equal(back.box.height, 480);
  assert.equal(back.box.x, 5);
});
