const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDefaultId, remainingLeft, tightestWindow, trayDisplay, markDefault } = require('./tray.cjs');

test('one connected account is always the default', () => {
  assert.equal(resolveDefaultId([{ id: 'a' }], 'other'), 'a');
  assert.equal(resolveDefaultId([], 'a'), null);
});

test('several accounts keep a saved default, or fall back to the first', () => {
  const accounts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(resolveDefaultId(accounts, 'b'), 'b');
  assert.equal(resolveDefaultId(accounts, 'missing'), 'a');
  assert.equal(resolveDefaultId(accounts, null), 'a');
});

test('remainingLeft ignores unlimited and credit windows', () => {
  assert.equal(remainingLeft({ unit: 'unlimited', usedPercent: 0 }), null);
  assert.equal(remainingLeft({ unit: 'credits', usedPercent: null }), null);
  assert.equal(remainingLeft({ unit: 'percent', usedPercent: 12 }), 88);
});

test('tightest window is the one with the least left', () => {
  const windows = [
    { key: 'week', label: 'Week', usedPercent: 23, unit: 'percent' },
    { key: 'five', label: '5 hours', usedPercent: 50, unit: 'percent' },
    { key: 'chat', label: 'Chat', usedPercent: 0, unit: 'unlimited' },
  ];
  assert.equal(tightestWindow(windows).key, 'five');
});

test('tray text comes from the default account, not the lowest across the board', () => {
  const result = {
    accounts: markDefault([
      { id: 'grok', provider: 'grok' },
      { id: 'cursor', provider: 'cursor' },
    ], 'cursor'),
    snapshots: {
      grok: {
        ok: true,
        windows: [{ key: 'week', label: 'Week', usedPercent: 100, unit: 'percent' }],
      },
      cursor: {
        ok: true,
        windows: [
          { key: 'cursor-models', label: 'Cursor models', usedPercent: 12, unit: 'percent' },
          { key: 'other-models', label: 'Other models', usedPercent: 36, unit: 'percent' },
        ],
      },
    },
  };
  const display = trayDisplay(result);
  assert.equal(display.percentText, '64%');
  assert.equal(display.left, 64);
  assert.equal(display.tooltip, 'Cursor · Other models · 64% left');
});

test('tray display has no percent when nothing is connected', () => {
  const display = trayDisplay({ accounts: [], snapshots: {} });
  assert.equal(display.percentText, '');
  assert.equal(display.left, null);
});
