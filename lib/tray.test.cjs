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
  assert.equal(display.percentText, '88% left');
  assert.equal(display.left, 88);
  assert.equal(display.tooltip, 'Cursor · Cursor models · 88% left');
});

test('tray shows the primary window per provider, not the tightest', () => {
  const show = (provider, windows) => trayDisplay({
    accounts: markDefault([{ id: 'a', provider }], 'a'),
    snapshots: { a: { ok: true, windows } },
  });
  const claude = show('claude', [
    { key: 'five_hour', label: '5 hours', usedPercent: 5, unit: 'percent' },
    { key: 'weekly_scoped:Fable', label: 'Fable', usedPercent: 89, unit: 'percent' },
  ]);
  assert.equal(claude.percentText, '95% left');
  const grok = show('grok', [
    { key: 'hour', label: 'Hour', usedPercent: 90, unit: 'percent' },
    { key: 'week', label: 'Week', usedPercent: 3, unit: 'percent' },
  ]);
  assert.equal(grok.percentText, '97% left');
  const other = show('minimax', [
    { key: 'week', label: 'Week', usedPercent: 0, unit: 'unlimited' },
    { key: 'five', label: '5 hours', usedPercent: 61, unit: 'percent' },
    { key: 'video', label: 'Video day', usedPercent: 100, unit: 'percent' },
  ]);
  assert.equal(other.percentText, '39% left');
});

test('tray display has no percent when nothing is connected', () => {
  const display = trayDisplay({ accounts: [], snapshots: {} });
  assert.equal(display.percentText, '');
  assert.equal(display.left, null);
});

test('a balance account shows its amount in the tray', () => {
  const result = {
    accounts: markDefault([{ id: 'ds', provider: 'deepseek' }], 'ds'),
    snapshots: {
      ds: { ok: true, windows: [{ key: 'balance-usd', label: 'Balance', unit: 'balance', usedPercent: null, amount: 9.88, currency: 'USD' }] },
    },
  };
  const display = trayDisplay(result);
  assert.equal(display.percentText, '$9.88');
  assert.equal(display.left, null);
  assert.equal(display.tooltip, 'DeepSeek · Balance · $9.88 left');
});

test('a paused window binds nothing, and Poe points read as points', () => {
  assert.equal(remainingLeft({ label: '5 hours', unit: 'percent', usedPercent: 0, paused: true }), null);
  const result = {
    accounts: markDefault([{ id: 'poe', provider: 'poe' }], 'poe'),
    snapshots: {
      poe: { ok: true, windows: [{ key: 'points', label: 'Points', unit: 'balance', usedPercent: null, amount: 812400, currency: 'USD', format: 'points' }] },
    },
  };
  const display = trayDisplay(result);
  assert.equal(display.percentText, '812,400 points');
  assert.equal(display.tooltip, 'Poe · Points · 812,400 points left');
});
