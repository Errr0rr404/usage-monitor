const { providerName } = require('./tray.cjs');

// A real 5-hour, weekly, or monthly rollover moves the deadline by hours.
// Polls recompute the same deadline and drift by seconds, which is not a reset.
const RESET_JUMP_MS = 20 * 60 * 1000;
const DUE_GRACE_MS = 2 * 60 * 1000;

function describeResets(events) {
  const accounts = new Map();
  for (const event of events || []) {
    const provider = providerName(event.provider);
    const label = String(event.accountLabel || '').trim();
    const id = event.accountId || JSON.stringify([event.provider, label]);
    if (!accounts.has(id)) {
      accounts.set(id, {
        id,
        provider,
        label: label.toLowerCase() === provider.toLowerCase() ? '' : label,
        windows: [],
      });
    }
    const group = accounts.get(id);
    const windowLabel = event.windowLabel || 'Usage';
    if (!group.windows.includes(windowLabel)) group.windows.push(windowLabel);
  }
  return { headline: 'Usage reset', accounts: [...accounts.values()] };
}

function resetsAtMs(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function percent(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function markFrom(window, celebratedLow) {
  const mark = {
    resetsAt: window.resetsAt || null,
    usedPercent: percent(window.usedPercent),
  };
  if (celebratedLow) mark.celebratedLow = true;
  return mark;
}

// A reset is either a deadline that jumped to the next 5-hour, weekly, or
// monthly boundary, or a meter that refilled after its own deadline passed.
// Muse's 5-hour reset is the second kind: the new bar is empty and has no
// deadline yet. A later deadline for that same empty bar is not a second reset.
function judgeWindow(previous, window, now) {
  const before = resetsAtMs(previous.resetsAt);
  const after = resetsAtMs(window.resetsAt);
  const usedBefore = percent(previous.usedPercent);
  const usedAfter = percent(window.usedPercent);
  const jumped = before != null && after != null && after - before >= RESET_JUMP_MS;
  const due = before != null && now >= before - DUE_GRACE_MS;
  const refilled = due
    && usedBefore != null
    && usedAfter != null
    && usedBefore - usedAfter >= 8
    && usedAfter <= 5;

  if (jumped) {
    if (previous.celebratedLow && usedAfter != null && usedAfter <= 10) {
      return { alarm: false, celebratedLow: false };
    }
    return { alarm: true, celebratedLow: false };
  }
  // The empty bar grew a deadline after we already celebrated it.
  if (before == null && after != null && previous.celebratedLow) {
    return { alarm: false, celebratedLow: false };
  }
  if (refilled) return { alarm: true, celebratedLow: true };
  if (usedAfter != null && usedAfter > 15) return { alarm: false, celebratedLow: false };
  return { alarm: false, celebratedLow: Boolean(previous.celebratedLow) };
}

function collectResets({ marks, accounts, snapshots, now = Date.now() }) {
  const previousMarks = marks && typeof marks === 'object' ? marks : {};
  const events = [];
  const nextMarks = {};

  for (const account of accounts || []) {
    if (!account?.id) continue;
    const previous = previousMarks[account.id] && typeof previousMarks[account.id] === 'object'
      ? previousMarks[account.id]
      : {};
    const snapshot = snapshots?.[account.id];
    if (!snapshot?.ok) {
      nextMarks[account.id] = { ...previous };
      continue;
    }

    const kept = {};
    for (const window of snapshot.windows || []) {
      if (!window?.key || window.unit === 'unlimited') continue;
      const prior = previous[window.key];
      let celebratedLow = Boolean(prior?.celebratedLow);
      if (prior) {
        const judged = judgeWindow(prior, window, now);
        celebratedLow = judged.celebratedLow;
        if (judged.alarm) {
          events.push({
            accountId: account.id,
            provider: account.provider,
            accountLabel: account.label || '',
            windowKey: window.key,
            windowLabel: window.label || prior.label || window.key,
          });
        }
      }
      kept[window.key] = markFrom(window, celebratedLow);
    }
    for (const [key, mark] of Object.entries(previous)) {
      if (!kept[key]) kept[key] = mark;
    }
    nextMarks[account.id] = kept;
  }

  return { events, marks: nextMarks };
}

function resetChimeWav() {
  const sampleRate = 22050;
  const duration = 0.65;
  const samples = Math.floor(sampleRate * duration);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const second = time >= 0.22;
    const noteTime = second ? time - 0.22 : time;
    const noteDuration = second ? duration - 0.22 : 0.22;
    const freq = second ? 880 : 659.25;
    const env = Math.min(1, noteTime / 0.012) * Math.max(0, 1 - noteTime / noteDuration) ** 2;
    const sample = Math.sin(2 * Math.PI * freq * noteTime) * 0.2 * env;
    data.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return data;
}

module.exports = {
  collectResets,
  describeResets,
  resetChimeWav,
};
