const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseAccountFile, legacyAccountFiles } = require('./account-file.cjs');

test('a saved account file keeps every login', () => {
  const parsed = parseAccountFile(JSON.stringify({
    settings: { pinned: false, theme: 'void', defaultAccountId: 'claude-1' },
    accounts: [
      { id: 'claude-1', provider: 'claude', label: 'Claude', secret: 'sealed' },
      { id: 'codex-1', provider: 'codex', label: 'Work', secret: 'sealed-2' },
    ],
    meters: { 'claude-1': { windows: [{ label: 'Fable' }] } },
    resetMarks: { 'claude-1': { 'weekly_scoped:Fable': '2026-10-18T22:00:00Z' } },
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.accounts.length, 2);
  assert.equal(parsed.state.accounts[0].secret, 'sealed');
  assert.equal(parsed.state.settings.theme, 'void');
  assert.equal(parsed.state.settings.pinned, false);
  assert.equal(parsed.state.meters['claude-1'].windows[0].label, 'Fable');
  assert.equal(parsed.state.resetMarks['claude-1']['weekly_scoped:Fable'], '2026-10-18T22:00:00Z');
});

test('a broken account file is not treated as an empty install', () => {
  const parsed = parseAccountFile('{ this is not json');
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.state.accounts, []);
});

test('legacy account locations stay next to the current one', () => {
  const files = legacyAccountFiles('/Users/ada', 'darwin', '/Users/ada/AppData/Roaming');
  assert.deepEqual(files, [
    path.join('/Users/ada', 'Library', 'Application Support', 'usage-monitor', 'accounts.json'),
    path.join('/Users/ada', 'Library', 'Application Support', 'UsageMonitor', 'accounts.json'),
  ]);
  const windows = legacyAccountFiles('/Users/ada', 'win32', 'C:\\Users\\ada\\AppData\\Roaming');
  assert.equal(windows[0], path.join('C:\\Users\\ada\\AppData\\Roaming', 'usage-monitor', 'accounts.json'));
});
