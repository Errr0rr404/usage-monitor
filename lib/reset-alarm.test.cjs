const test = require('node:test');
const assert = require('node:assert/strict');
const { collectResets, describeResets, sirenWav } = require('./reset-alarm.cjs');

const now = Date.parse('2026-04-08T12:00:00.000Z');
const hour = 60 * 60 * 1000;

function at(offset) {
  return new Date(now + offset).toISOString();
}

function account(id, provider, label) {
  return { id, provider, label };
}

function meter(key, label, usedPercent, resetsAt) {
  return { key, label, unit: 'percent', usedPercent, resetsAt };
}

function run(marks, accounts, snapshots) {
  return collectResets({ marks, accounts, snapshots, now });
}

test('a 5-hour, weekly, or monthly deadline jump is a reset', () => {
  const accounts = [account('codex', 'codex', 'Work')];
  const seen = run({}, accounts, {
    codex: {
      ok: true,
      windows: [
        meter('primary', '5 hours', 80, at(30 * 60 * 1000)),
        meter('secondary', 'Week', 40, at(2 * 24 * hour)),
        meter('plan', 'Month', 20, at(10 * 24 * hour)),
      ],
    },
  });
  assert.equal(seen.events.length, 0);

  const reset = run(seen.marks, accounts, {
    codex: {
      ok: true,
      windows: [
        meter('primary', '5 hours', 1, at(5 * hour)),
        meter('secondary', 'Week', 0, at(9 * 24 * hour)),
        meter('plan', 'Month', 0, at(40 * 24 * hour)),
      ],
    },
  });
  assert.deepEqual(reset.events.map((event) => event.windowLabel), ['5 hours', 'Week', 'Month']);
  assert.equal(reset.events.every((event) => event.accountLabel === 'Work'), true);
});

test('a few seconds of deadline drift is the same window', () => {
  const accounts = [account('claude', 'claude', 'Claude')];
  const seen = run({}, accounts, {
    claude: { ok: true, windows: [meter('five_hour', '5 hours', 22, at(hour))] },
  });
  const again = run(seen.marks, accounts, {
    claude: { ok: true, windows: [meter('five_hour', '5 hours', 24, at(hour + 15 * 1000))] },
  });
  assert.equal(again.events.length, 0);
});

test('usage falling while the deadline is still ahead is not a reset', () => {
  const accounts = [account('grok', 'grok', 'Personal')];
  const seen = run({}, accounts, {
    grok: { ok: true, windows: [meter('credits', 'Month', 80, at(20 * 24 * hour))] },
  });
  const dropped = run(seen.marks, accounts, {
    grok: { ok: true, windows: [meter('credits', 'Month', 0, at(20 * 24 * hour))] },
  });
  assert.equal(dropped.events.length, 0);
});

test('an empty bar after its deadline, with no new deadline yet, resets once', () => {
  const accounts = [account('muse', 'muse', 'Meta')];
  const seen = run({}, accounts, {
    muse: { ok: true, windows: [meter('window', '5 hours', 55, at(-60 * 1000))] },
  });
  const reset = run(seen.marks, accounts, {
    muse: { ok: true, windows: [meter('window', '5 hours', 0, null)] },
  });
  assert.equal(reset.events.length, 1);
  assert.equal(reset.events[0].windowLabel, '5 hours');

  const stillEmpty = run(reset.marks, accounts, {
    muse: { ok: true, windows: [meter('window', '5 hours', 0, null)] },
  });
  assert.equal(stillEmpty.events.length, 0);

  const deadlineArrives = run(stillEmpty.marks, accounts, {
    muse: { ok: true, windows: [meter('window', '5 hours', 2, at(5 * hour))] },
  });
  assert.equal(deadlineArrives.events.length, 0);

  const nextWindow = run(deadlineArrives.marks, accounts, {
    muse: { ok: true, windows: [meter('window', '5 hours', 1, at(10 * hour))] },
  });
  assert.equal(nextWindow.events.length, 1);
});

test('a failed refresh keeps the last deadlines and does not celebrate', () => {
  const accounts = [account('mini', 'minimax', 'Studio')];
  const seen = run({}, accounts, {
    mini: { ok: true, windows: [meter('chat', '5 hours', 63, at(hour))] },
  });
  const failed = run(seen.marks, accounts, {
    mini: { ok: false, windows: [] },
  });
  assert.equal(failed.events.length, 0);
  assert.equal(failed.marks.mini.chat.resetsAt, at(hour));
});

test('unlimited meters and removed accounts stay quiet', () => {
  const accounts = [account('copilot', 'copilot', 'GitHub')];
  const seen = run({
    gone: { week: { resetsAt: at(-hour), usedPercent: 90 } },
  }, accounts, {
    copilot: {
      ok: true,
      windows: [
        { key: 'chat', label: 'Chat', unit: 'unlimited', usedPercent: 0, resetsAt: at(hour) },
        meter('premium', 'Premium', 10, at(7 * 24 * hour)),
      ],
    },
  });
  assert.equal(seen.events.length, 0);
  assert.equal(seen.marks.gone, undefined);
  assert.equal(seen.marks.copilot.chat, undefined);
  assert.ok(seen.marks.copilot.premium);
});

test('the alarm names the account and the window that reset', () => {
  const described = describeResets([
    { provider: 'codex', accountLabel: 'Work', windowLabel: '5 hours' },
    { provider: 'claude', accountLabel: 'Claude', windowLabel: 'Week' },
  ], 1);
  assert.equal(described.headline, 'A bunch of meters just reset');
  assert.match(described.lines[0], /Codex · Work/);
  assert.match(described.lines[0], /5 hours/);
  assert.match(described.lines[1], /Claude/);
  assert.match(described.lines[1], /Week/);
});

test('the siren is a playable wav', () => {
  const wav = sirenWav();
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.ok(wav.length > 1000);
});
