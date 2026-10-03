function ahead(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function previewState() {
  const accounts = [
    { id: 'preview-grok', provider: 'grok', label: 'Personal', meta: {} },
    { id: 'preview-codex-work', provider: 'codex', label: 'Work', meta: {} },
    { id: 'preview-codex-side', provider: 'codex', label: 'zannatun.sheum@gmail.com', meta: {} },
    { id: 'preview-mini', provider: 'minimax', label: 'Studio', meta: { region: 'global', countsAre: 'remaining' } },
    { id: 'preview-cursor', provider: 'cursor', label: 'Main', meta: {} },
    { id: 'preview-copilot', provider: 'copilot', label: 'GitHub', meta: {} },
    { id: 'preview-gemini', provider: 'gemini', label: 'Google', meta: {} },
    { id: 'preview-muse', provider: 'muse', label: 'Meta', meta: { museLiveUsage: true } },
    { id: 'preview-muse-quiet', provider: 'muse', label: 'No meter', meta: {} },
  ].map((account) => ({ ...account, isDefault: account.id === 'preview-cursor' }));

  return {
    accounts,
    snapshots: {
      'preview-grok': {
        ok: true,
        plan: 'SuperGrok Heavy',
        identity: null,
        windows: [
          { key: 'credits', label: 'Week', usedPercent: 92, used: null, limit: null, unit: 'percent', resetsAt: ahead(65 * 3600 * 1000), resetsInMs: null },
        ],
      },
      'preview-mini': {
        ok: true,
        plan: null,
        identity: null,
        windows: [
          { key: 'five_hour', label: '5 hours', usedPercent: 50, used: null, limit: null, unit: 'percent', resetsAt: ahead(46 * 60 * 1000), resetsInMs: null },
          { key: 'week', label: 'Week', usedPercent: 23, used: null, limit: null, unit: 'percent', resetsAt: ahead((43 * 60 + 46) * 60 * 1000), resetsInMs: null },
        ],
      },
      'preview-codex-work': {
        ok: true,
        plan: 'plus',
        identity: null,
        windows: [
          { key: 'primary', label: '5 hours', usedPercent: 14, used: null, limit: null, unit: 'percent', resetsAt: ahead(3 * 3600 * 1000 + 9 * 60 * 1000), resetsInMs: null },
          { key: 'secondary', label: 'Week', usedPercent: 14, used: null, limit: null, unit: 'percent', resetsAt: ahead((6 * 24 + 9) * 3600 * 1000), resetsInMs: null },
        ],
      },
      'preview-codex-side': {
        ok: true,
        plan: 'plus',
        identity: null,
        windows: [
          { key: 'primary', label: '5 hours', usedPercent: 5, used: null, limit: null, unit: 'percent', resetsAt: ahead(4 * 3600 * 1000 + 55 * 60 * 1000), resetsInMs: null },
          { key: 'secondary', label: 'Week', usedPercent: 1, used: null, limit: null, unit: 'percent', resetsAt: ahead((6 * 24 + 23) * 3600 * 1000), resetsInMs: null },
        ],
      },
      'preview-cursor': {
        ok: true,
        plan: 'Ultra',
        identity: null,
        windows: [
          { key: 'cursor-models', label: 'Cursor models', usedPercent: 12, used: null, limit: null, unit: 'percent', resetsAt: ahead((23 * 24 + 18) * 3600 * 1000), resetsInMs: null },
          { key: 'other-models', label: 'Other models', usedPercent: 36, used: null, limit: null, unit: 'percent', resetsAt: ahead((23 * 24 + 18) * 3600 * 1000), resetsInMs: null },
        ],
      },
      'preview-copilot': {
        ok: true,
        plan: 'Individual',
        identity: null,
        windows: [
          { key: 'chat', label: 'Chat', usedPercent: 0, used: null, limit: null, unit: 'unlimited', resetsAt: null, resetsInMs: null },
          { key: 'completions', label: 'Completions', usedPercent: 0, used: null, limit: null, unit: 'unlimited', resetsAt: null, resetsInMs: null },
          { key: 'premium_interactions', label: 'Premium', usedPercent: 81.5, used: 163, limit: 200, unit: 'count', resetsAt: null, resetsInMs: null },
        ],
      },
      'preview-gemini': {
        ok: true,
        plan: 'Antigravity',
        identity: null,
        windows: [
          { key: 'gemini-week', label: 'Gemini week', usedPercent: 0, used: null, limit: null, unit: 'percent', resetsAt: ahead(7 * 24 * 3600 * 1000), resetsInMs: null },
          { key: 'claude-week', label: 'Claude week', usedPercent: 0, used: null, limit: null, unit: 'percent', resetsAt: ahead(7 * 24 * 3600 * 1000), resetsInMs: null },
        ],
      },
      'preview-muse': {
        ok: true,
        plan: 'Everyday Usage',
        identity: null,
        note: null,
        windows: [
          { key: 'window', label: '5 hours', usedPercent: 42, used: null, limit: null, unit: 'percent', resetsAt: ahead(3 * 3600 * 1000), resetsInMs: null },
          { key: 'weekly', label: 'Week', usedPercent: 17, used: null, limit: null, unit: 'percent', resetsAt: ahead(4 * 24 * 3600 * 1000), resetsInMs: null },
        ],
      },
      // The state that used to render as two empty 100%-left dials: Meta omits
      // the meter, and the board has to say so instead of drawing a full gauge.
      'preview-muse-quiet': {
        ok: true,
        plan: 'High Usage',
        identity: null,
        note: 'Meta does not hand Muse usage meters to third-party clients. Turn on “Read the live meter” to spend one tiny request per refresh and see the real numbers.',
        windows: [],
      },
    },
  };
}

module.exports = { previewState };
