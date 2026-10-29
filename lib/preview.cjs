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
    { id: 'preview-opencode', provider: 'opencode', label: 'OpenCode', meta: {} },
    { id: 'preview-deepseek', provider: 'deepseek', label: 'DeepSeek', meta: {} },
    { id: 'preview-openrouter', provider: 'openrouter', label: 'Team', meta: {} },
    { id: 'preview-kimi', provider: 'kimi', label: 'Kimi Code', meta: {} },
    { id: 'preview-zai', provider: 'zai', label: 'Z.ai', meta: {} },
    { id: 'preview-moonshot', provider: 'moonshot', label: 'Kimi API', meta: {} },
    { id: 'preview-poe', provider: 'poe', label: 'Poe', meta: {} },
  ].map((account) => ({ ...account, isDefault: account.id === 'preview-cursor' }));

  const snapshots = {
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
        { key: 'video:day', label: 'Video day', usedPercent: 33.3, used: 1, limit: 3, unit: 'count', resetsAt: ahead(9 * 3600 * 1000), resetsInMs: null },
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
    // Antigravity's live shape: the summary only knows the Claude & GPT pool
    // (its 5 hours switched off while the week is spent); the Gemini models
    // come from the per-model quotas, pooled where they share one meter.
    'preview-gemini': {
      ok: true,
      plan: 'Google AI Pro',
      identity: null,
      windows: [
        { key: 'claude-gpt:week', label: 'Claude & GPT week', usedPercent: 100, used: null, limit: null, unit: 'percent', resetsAt: ahead((2 * 24 + 5) * 3600 * 1000), resetsInMs: null, models: ['Claude Sonnet 5.5', 'Claude Opus 5.5', 'GPT-OSS 120B'] },
        { key: 'claude-gpt:5h', label: 'Claude & GPT 5 hours', usedPercent: 0, used: null, limit: null, unit: 'percent', resetsAt: null, resetsInMs: null, paused: true },
        { key: 'models:google:gemini-3-flash', label: 'Gemini models', usedPercent: 0.07, used: null, limit: null, unit: 'percent', resetsAt: ahead(4 * 3600 * 1000 + 12 * 60 * 1000), resetsInMs: null, models: ['Gemini 3.8 Flash Tiered', 'Gemini 3.5 Flash Lite', 'Gemini 3.5 Flash', 'Gemini 3.1 Flash Lite', 'Gemini 3.1 Flash Image', 'Gemini 3 Flash'] },
        { key: 'models:google:gemini-2.5-pro', label: 'Gemini 2.5 Pro', usedPercent: 40, used: null, limit: null, unit: 'percent', resetsAt: ahead(2 * 3600 * 1000 + 30 * 60 * 1000), resetsInMs: null },
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
      note: 'Meta did not include Muse usage on this refresh. Turn on “Read the live meter” to spend one tiny request per refresh and see the real numbers.',
      windows: [],
    },
    'preview-opencode': {
      ok: true,
      plan: 'Go',
      identity: null,
      windows: [
        { key: 'rolling', label: '5 hours', usedPercent: 1, used: null, limit: null, unit: 'percent', resetsAt: ahead(4 * 3600 * 1000 + 40 * 60 * 1000), resetsInMs: null },
        { key: 'weekly', label: 'Week', usedPercent: 22, used: null, limit: null, unit: 'percent', resetsAt: ahead((3 * 24 + 21) * 3600 * 1000), resetsInMs: null },
        { key: 'monthly', label: 'Month', usedPercent: 11, used: null, limit: null, unit: 'percent', resetsAt: ahead((30 * 24 + 4) * 3600 * 1000), resetsInMs: null },
      ],
    },
    'preview-deepseek': {
      ok: true,
      plan: 'Pay as you go',
      identity: null,
      windows: [
        { key: 'balance-usd', label: 'Balance', usedPercent: null, used: null, limit: null, unit: 'balance', amount: 9.88, currency: 'USD', granted: 0, resetsAt: null, resetsInMs: null },
      ],
    },
    'preview-openrouter': {
      ok: true,
      plan: 'Pay as you go',
      identity: null,
      windows: [
        { key: 'credits', label: 'Credits', usedPercent: 25.62, used: 25.75, limit: 100.5, unit: 'dollars', resetsAt: null, resetsInMs: null },
      ],
    },
    'preview-kimi': {
      ok: true,
      plan: 'Kimi Code',
      identity: null,
      windows: [
        { key: 'limit-0', label: '5 hours', usedPercent: 18, used: 18, limit: 100, unit: 'count', resetsAt: ahead(2 * 3600 * 1000 + 5 * 60 * 1000), resetsInMs: null },
        { key: 'usage', label: 'Week', usedPercent: 31, used: 620, limit: 2000, unit: 'count', resetsAt: ahead((4 * 24 + 6) * 3600 * 1000), resetsInMs: null },
      ],
    },
    'preview-zai': {
      ok: true,
      plan: 'GLM Pro',
      identity: null,
      windows: [
        { key: 'tokens-0', label: '5 hours', usedPercent: 12, used: null, limit: null, unit: 'percent', resetsAt: ahead(3 * 3600 * 1000 + 20 * 60 * 1000), resetsInMs: null },
        { key: 'tools-1', label: 'MCP calls', usedPercent: 4, used: 40, limit: 1000, unit: 'count', resetsAt: ahead(19 * 24 * 3600 * 1000), resetsInMs: null },
      ],
    },
    'preview-moonshot': {
      ok: true,
      plan: 'Pay as you go',
      identity: null,
      windows: [
        { key: 'balance-usd', label: 'Balance', usedPercent: null, used: null, limit: null, unit: 'balance', amount: 18.4, currency: 'USD', granted: 5, resetsAt: null, resetsInMs: null },
      ],
    },
    'preview-poe': {
      ok: true,
      plan: 'API points',
      identity: null,
      windows: [
        { key: 'points', label: 'Points', usedPercent: null, used: null, limit: null, unit: 'balance', amount: 812400, currency: 'USD', granted: 0, format: 'points', resetsAt: null, resetsInMs: null },
      ],
    },
  };

  // Read a couple of minutes ago, so the header shows its "Updated" line.
  const fetchedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  for (const snapshot of Object.values(snapshots)) snapshot.fetchedAt = snapshot.fetchedAt || fetchedAt;
  return { accounts, snapshots };
}

module.exports = { previewState };
