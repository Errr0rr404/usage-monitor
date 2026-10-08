const { providerName } = require('./tray.cjs');

// A real 5-hour, weekly, or monthly rollover moves the deadline by hours.
// Polls recompute the same deadline and drift by seconds, which is not a reset.
const RESET_JUMP_MS = 20 * 60 * 1000;
const DUE_GRACE_MS = 2 * 60 * 1000;

const HEADLINES = [
  'The bucket flipped',
  'Quota jailbreak',
  'The meter burped',
  'Fresh tank, who dis',
];

const GAGS = [
  (name, windowLabel) => `${name} ${windowLabel} just did a backflip and landed empty.`,
  (name, windowLabel) => `Beep beep. ${name} ${windowLabel} reset. The meter is pretending you two never met.`,
  (name, windowLabel) => `${windowLabel} on ${name} rolled over and asked for more prompts.`,
  (name, windowLabel) => `Fresh ${windowLabel}. ${name} forgave everything. Try not to spend it on one sentence.`,
];

function accountTitle(event) {
  const provider = providerName(event.provider);
  const label = String(event.accountLabel || '').trim();
  if (!label || label.toLowerCase() === provider.toLowerCase()) return provider;
  return `${provider} · ${label}`;
}

function describeResets(events, seed = Date.now()) {
  const list = Array.isArray(events) ? events : [];
  const headline = list.length > 1
    ? 'A bunch of meters just reset'
    : HEADLINES[Math.abs(Number(seed) || 0) % HEADLINES.length];
  const lines = list.map((event, index) => {
    const gag = GAGS[(Math.abs(Number(seed) || 0) + index) % GAGS.length];
    return gag(accountTitle(event), event.windowLabel || 'Usage');
  });
  return { headline, lines };
}

function resetsAtMs(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function percent(value) {
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

function sirenWav() {
  const sampleRate = 22050;
  const duration = 1.6;
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
    const high = time < 0.4 || (time >= 0.8 && time < 1.2);
    const freq = (high ? 660 : 440) + Math.sin(time * Math.PI * 4) * 70;
    const env = Math.min(1, time / 0.03) * Math.min(1, (duration - time) / 0.08);
    const sample = Math.max(-1, Math.min(1, Math.sin(2 * Math.PI * freq * time) * 0.32 * env));
    data.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return data;
}

module.exports = {
  collectResets,
  describeResets,
  sirenWav,
};
