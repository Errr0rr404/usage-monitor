// Window sizes for the two board orientations. Stacked is the tall
// meter. Sideways is a short strip that the accounts scroll across.
const SPECS = {
  stacked: { width: 304, height: 500, minWidth: 280, minHeight: 240, openMinHeight: 360 },
  sideways: { width: 860, height: 168, minWidth: 520, minHeight: 150, openMinHeight: 150 },
};

function normalizeLayout(value) {
  return value === 'sideways' ? 'sideways' : 'stacked';
}

function finiteBox(box) {
  if (!box || typeof box !== 'object') return null;
  const width = Number(box.width);
  const height = Number(box.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const next = { width, height };
  if (Number.isFinite(Number(box.x))) next.x = Number(box.x);
  if (Number.isFinite(Number(box.y))) next.y = Number(box.y);
  return next;
}

function openingSize(layout, settings) {
  const mode = normalizeLayout(layout);
  const spec = SPECS[mode];
  const saved = finiteBox(mode === 'sideways' ? settings?.sidewaysBounds : settings?.bounds);
  const box = {
    width: Math.max(spec.minWidth, Math.round(saved?.width || spec.width)),
    height: Math.max(spec.openMinHeight, Math.round(saved?.height || spec.height)),
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
  };
  if (saved && Number.isFinite(saved.x)) box.x = Math.round(saved.x);
  if (saved && Number.isFinite(saved.y)) box.y = Math.round(saved.y);
  return box;
}

// Remember the size being left, then open the size saved for the layout
// being entered. A first visit uses that layout's default.
function placeLayout(nextLayout, settings, currentBounds) {
  const layout = normalizeLayout(nextLayout);
  const box = openingSize(layout, settings);
  const current = finiteBox(currentBounds);
  if (!Number.isFinite(box.x) && current) {
    box.x = Math.round(current.x);
    box.y = Math.round(current.y);
  }
  return { layout, box };
}

module.exports = {
  SPECS,
  normalizeLayout,
  finiteBox,
  openingSize,
  placeLayout,
};
