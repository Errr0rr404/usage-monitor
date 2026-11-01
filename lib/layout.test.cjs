const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLayout, normalizeView, boxKey, openingSize, placeLayout, fitInside } = require('./layout.cjs');

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

test('side by side is off unless it was chosen', () => {
  assert.equal(normalizeView(undefined), 'tabs');
  assert.equal(normalizeView('nope'), 'tabs');
  assert.equal(normalizeView('split'), 'split');
  assert.equal(boxKey('stacked'), 'bounds');
  assert.equal(boxKey('sideways', 'tabs'), 'sidewaysBounds');
  assert.equal(boxKey('stacked', 'split'), 'splitBounds');
  assert.equal(boxKey('sideways', 'split'), 'sidewaysSplitBounds');
});

test('side by side opens wide enough for both boards and keeps its own size', () => {
  const settings = {
    bounds: { width: 330, height: 480, x: 5, y: 6 },
    splitBounds: { width: 700, height: 600, x: 50, y: 60 },
  };
  const tabs = openingSize('stacked', settings);
  assert.equal(tabs.width, 330);
  const split = openingSize('stacked', settings, 'split');
  assert.equal(split.width, 700);
  assert.equal(split.height, 600);
  assert.equal(split.x, 50);
  assert.equal(split.minWidth, 560);

  const fresh = openingSize('sideways', {}, 'split');
  assert.equal(fresh.width, 1180);
  assert.equal(fresh.height, 168);
  assert.equal(fresh.minWidth, 760);
});

test('turning side by side on keeps the window where it was', () => {
  const placed = placeLayout('stacked', { bounds: { width: 304, height: 500, x: 900, y: 40 } }, { width: 304, height: 500, x: 900, y: 40 }, 'split');
  assert.equal(placed.view, 'split');
  assert.equal(placed.box.width, 620);
  assert.equal(placed.box.x, 900);
  assert.equal(placed.box.y, 40);
});

test('a wider window slides back onto the screen', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  assert.deepEqual(fitInside({ width: 620, height: 520, x: 1200, y: 40 }, area), { width: 620, height: 520, x: 820, y: 40 });
  assert.deepEqual(fitInside({ width: 620, height: 520, x: -40, y: 0 }, area), { width: 620, height: 520, x: 0, y: 25 });
  assert.deepEqual(fitInside({ width: 2000, height: 168, x: 100, y: 800 }, area), { width: 1440, height: 168, x: 0, y: 732 });
  const unplaced = fitInside({ width: 620, height: 520 }, area);
  assert.equal(unplaced.x, undefined);
  assert.deepEqual(fitInside({ width: 620, height: 520, x: 3000, y: 10 }, null), { width: 620, height: 520, x: 3000, y: 10 });
});
