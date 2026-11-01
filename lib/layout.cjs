// Window sizes for the two board orientations. Stacked is the tall
// meter. Sideways is a short strip that the accounts scroll across.
// Side by side puts AI usage and computers next to each other, so each
// orientation gets a wider window of its own.
const SPECS = {
  stacked: { width: 304, height: 500, minWidth: 280, minHeight: 240, openMinHeight: 360 },
  sideways: { width: 860, height: 168, minWidth: 520, minHeight: 150, openMinHeight: 150 },
  'stacked-split': { width: 620, height: 520, minWidth: 560, minHeight: 240, openMinHeight: 360 },
  'sideways-split': { width: 1180, height: 168, minWidth: 760, minHeight: 150, openMinHeight: 150 },
};

// Where each shape's size is saved in the settings.
const BOX_KEYS = {
  stacked: 'bounds',
  sideways: 'sidewaysBounds',
  'stacked-split': 'splitBounds',
  'sideways-split': 'sidewaysSplitBounds',
};

function normalizeLayout(value) {
  return value === 'sideways' ? 'sideways' : 'stacked';
}

// Tabs show one board at a time. Split shows both, side by side.
function normalizeView(value) {
  return value === 'split' ? 'split' : 'tabs';
}

function shapeOf(layout, view) {
  const mode = normalizeLayout(layout);
  return normalizeView(view) === 'split' ? `${mode}-split` : mode;
}

function boxKey(layout, view) {
  return BOX_KEYS[shapeOf(layout, view)];
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

function openingSize(layout, settings, view) {
  const shape = shapeOf(layout, view);
  const spec = SPECS[shape];
  const saved = finiteBox(settings?.[BOX_KEYS[shape]]);
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

// Remember the size being left, then open the size saved for the shape
// being entered. A first visit uses that shape's default.
function placeLayout(nextLayout, settings, currentBounds, view) {
  const layout = normalizeLayout(nextLayout);
  const box = openingSize(layout, settings, view);
  const current = finiteBox(currentBounds);
  if (!Number.isFinite(box.x) && current && Number.isFinite(current.x)) {
    box.x = Math.round(current.x);
    box.y = Math.round(current.y);
  }
  return { layout, view: normalizeView(view), box };
}

// A wider shape that keeps the old corner can hang off the right or bottom
// of the screen. Slide it back inside the work area, and never let it start
// above or left of it.
function fitInside(box, area) {
  const work = finiteBox(area);
  if (!work || !Number.isFinite(work.x) || !Number.isFinite(work.y)) return box;
  const next = { ...box };
  next.width = Math.min(box.width, work.width);
  next.height = Math.min(box.height, work.height);
  if (Number.isFinite(box.x)) {
    next.x = Math.max(work.x, Math.min(box.x, work.x + work.width - next.width));
  }
  if (Number.isFinite(box.y)) {
    next.y = Math.max(work.y, Math.min(box.y, work.y + work.height - next.height));
  }
  return next;
}

module.exports = {
  SPECS,
  BOX_KEYS,
  normalizeLayout,
  normalizeView,
  boxKey,
  finiteBox,
  openingSize,
  placeLayout,
  fitInside,
};
