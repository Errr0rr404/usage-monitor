const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAccountFile } = require('./account-file.cjs');
const {
  LOCAL_ID,
  normalizeComputers,
  addComputer,
  updateComputer,
  removeComputer,
  moveComputer,
} = require('./computer-list.cjs');

let counter = 0;
const makeId = () => `c${++counter}`;

test('added computers keep a name and an SSH target, nothing else', () => {
  const added = addComputer([], { name: '  Mac   mini ', target: 'mini', port: '', password: 'nope', key: 'nope' }, makeId);
  assert.equal(added.ok, true);
  assert.deepEqual(Object.keys(added.computer).sort(), ['id', 'name', 'port', 'target']);
  assert.equal(added.computer.name, 'Mac mini');
  assert.equal(added.computer.port, null);
  const unnamed = addComputer(added.computers, { target: 'zan@zan-imac.local', port: 2222 }, makeId);
  assert.equal(unnamed.computer.name, 'zan@zan-imac.local', 'no name falls back to the target');
  assert.equal(unnamed.computers.length, 2);
});

test('the same target is not added twice, and bad targets are refused', () => {
  const first = addComputer([], { target: 'mini' }, makeId);
  const again = addComputer(first.computers, { target: 'MINI', port: 22 }, makeId);
  assert.equal(again.ok, false);
  assert.match(again.error, /already/);
  assert.equal(addComputer(first.computers, { target: 'mini', port: 2222 }, makeId).ok, true, 'another port is another computer');
  assert.equal(addComputer([], { target: '-oProxyCommand=x' }, makeId).ok, false);
  assert.equal(addComputer([], { target: 'box', port: 'abc' }, makeId).ok, false);
});

test('rename and edit keep the id and the place in the list', () => {
  const list = [
    { id: 'a', name: 'Mini', target: 'mini', port: null },
    { id: 'b', name: 'iMac', target: 'zan@zan-imac.local', port: null },
  ];
  const renamed = updateComputer(list, 'b', { name: 'Study iMac' });
  assert.equal(renamed.ok, true);
  assert.deepEqual(renamed.computers.map((item) => item.id), ['a', 'b']);
  assert.equal(renamed.computers[1].name, 'Study iMac');
  assert.equal(renamed.computers[1].target, 'zan@zan-imac.local');
  const retargeted = updateComputer(list, 'b', { target: 'imac', port: 2200 });
  assert.equal(retargeted.computer.target, 'imac');
  assert.equal(retargeted.computer.port, 2200);
  assert.equal(updateComputer(list, 'b', { target: 'mini' }).ok, false, 'cannot become a duplicate');
  assert.equal(updateComputer(list, 'gone', { name: 'x' }).ok, false);
});

test('reorder moves one step and stops at the ends; remove drops one', () => {
  const list = ['a', 'b', 'c'].map((id) => ({ id, name: id, target: id, port: null }));
  assert.deepEqual(moveComputer(list, 'c', -1).map((item) => item.id), ['a', 'c', 'b']);
  assert.deepEqual(moveComputer(list, 'a', -1).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(moveComputer(list, 'a', 5).map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(moveComputer(list, 'c', 1).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(removeComputer(list, 'b').map((item) => item.id), ['a', 'c']);
});

test('this computer cannot be saved, moved or removed as an added one', () => {
  const list = normalizeComputers([{ id: LOCAL_ID, name: 'Me', target: 'localhost' }, { id: 'a', name: 'A', target: 'a' }]);
  assert.deepEqual(list.map((item) => item.id), ['a']);
});

test('a hand-edited settings file cannot break the list', () => {
  const list = normalizeComputers([
    null,
    'mini',
    { id: 'a', name: 'ok', target: 'mini' },
    { id: 'a', name: 'dup id', target: 'other' },
    { id: 'b', target: 'bad target here' },
    { id: 'c', target: 'box', port: 99999 },
    { name: 'no id', target: 'box' },
  ]);
  assert.deepEqual(list, [{ id: 'a', name: 'ok', target: 'mini', port: null }]);
  assert.deepEqual(normalizeComputers({ not: 'a list' }), []);
});

test('the computer list and tab live in the settings and survive a reload', () => {
  const saved = JSON.stringify({
    settings: { theme: 'ion', tab: 'computers', computers: [{ id: 'a', name: 'Mini', target: 'mini', port: null }] },
    accounts: [{ id: 'x', provider: 'claude', label: 'Claude', secret: 'sealed' }],
  });
  const loaded = parseAccountFile(saved);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.settings.tab, 'computers');
  assert.deepEqual(normalizeComputers(loaded.state.settings.computers), [{ id: 'a', name: 'Mini', target: 'mini', port: null }]);
  assert.equal(loaded.state.accounts.length, 1, 'adding computers leaves the accounts alone');
});
