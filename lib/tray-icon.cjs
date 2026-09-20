const zlib = require('zlib');

const ACCENT = [94, 210, 255];
const HEAT = [255, 177, 90];
const STOP = [255, 107, 107];
const TRACK_ALPHA = 0.14;
const EMPTY_TRACK_ALPHA = 0.5;

function chunk(tag, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(tag), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

function pngRgba(size, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function coverage(distance, radius, feather) {
  if (distance <= radius - feather) return 1;
  if (distance >= radius + feather) return 0;
  return clamp01(1 - (distance - (radius - feather)) / (2 * feather));
}

function mix(base, color, amount) {
  const t = clamp01(amount);
  return [
    base[0] + (color[0] - base[0]) * t,
    base[1] + (color[1] - base[1]) * t,
    base[2] + (color[2] - base[2]) * t,
  ];
}

function blend(pixel, color, amount) {
  const srcA = clamp01(amount);
  if (srcA <= 0) return;
  const outA = srcA + pixel[3] * (1 - srcA);
  const keep = pixel[3] * (1 - srcA);
  pixel[0] = (color[0] * srcA + pixel[0] * keep) / outA;
  pixel[1] = (color[1] * srcA + pixel[1] * keep) / outA;
  pixel[2] = (color[2] * srcA + pixel[2] * keep) / outA;
  pixel[3] = outA;
}

function clockwiseFromTop(dx, dy) {
  const angle = Math.atan2(dx, -dy);
  if (angle < 0) return angle + Math.PI * 2;
  return angle;
}

function trayMeterColor(left) {
  if (left == null) return ACCENT;
  if (left <= 0) return STOP;
  if (left < 15) return HEAT;
  return ACCENT;
}

function trayPng(size, options = {}) {
  const samples = 2;
  const left = Number.isFinite(options.left) ? Math.max(0, Math.min(100, options.left)) : null;
  const color = options.color || trayMeterColor(left);
  const sweep = ((left == null ? 100 : left) / 100) * Math.PI * 2;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const ring = size * 0.32;
  const half = size * 0.08;
  const feather = 0.55;
  const drawCaps = sweep > 0.001 && sweep < Math.PI * 2 - 0.001;
  const trackAlpha = left === 0 ? EMPTY_TRACK_ALPHA : TRACK_ALPHA;
  const startX = cx;
  const startY = cy - ring;
  const endX = cx + ring * Math.sin(sweep);
  const endY = cy - ring * Math.cos(sweep);

  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const dx = px - cx;
          const dy = py - cy;
          const dRing = Math.abs(Math.sqrt(dx * dx + dy * dy) - ring);
          const ringCover = coverage(dRing, half, feather);
          const onArc = sweep > 0 && clockwiseFromTop(dx, dy) <= sweep;
          let fill = onArc ? ringCover : 0;
          if (drawCaps) {
            const dCap = Math.min(
              Math.hypot(px - startX, py - startY),
              Math.hypot(px - endX, py - endY),
            );
            fill = Math.max(fill, coverage(dCap, half, feather));
          }
          const pixel = [0, 0, 0, 0];
          blend(pixel, color, ringCover * trackAlpha);
          blend(pixel, color, fill);
          r += pixel[0];
          g += pixel[1];
          b += pixel[2];
          a += pixel[3];
        }
      }
      const count = samples * samples;
      const offset = 1 + x * 4;
      row[offset] = Math.round(r / count);
      row[offset + 1] = Math.round(g / count);
      row[offset + 2] = Math.round(b / count);
      row[offset + 3] = Math.round((a / count) * 255);
    }
    rows.push(row);
  }
  return pngRgba(size, rows);
}

function appIconPng(size) {
  const samples = size >= 256 ? 3 : 2;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const ring = size * 0.29;
  const half = size * 0.046;
  const glow = size * 0.016;
  const sweep = 0.72 * Math.PI * 2;
  const feather = 0.7;
  const bg = [9, 15, 22];
  const track = [52, 68, 84];
  const cyan = ACCENT;
  const cap0x = cx;
  const cap0y = cy - ring;
  const cap1x = cx + ring * Math.sin(sweep);
  const cap1y = cy - ring * Math.cos(sweep);

  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const dx = px - cx;
          const dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const onArc = clockwiseFromTop(dx, dy) <= sweep;
          const dRing = Math.abs(dist - ring);
          const dCap = Math.min(
            Math.hypot(px - cap0x, py - cap0y),
            Math.hypot(px - cap1x, py - cap1y),
          );
          const dArc = onArc ? dRing : dCap;
          let pixel = mix(bg, track, coverage(dRing, half * 0.92, feather));
          pixel = mix(pixel, cyan, coverage(dArc, half + glow, glow) * 0.18);
          pixel = mix(pixel, cyan, coverage(dArc, half, feather));
          r += pixel[0];
          g += pixel[1];
          b += pixel[2];
        }
      }
      const count = samples * samples;
      const offset = 1 + x * 4;
      row[offset] = Math.round(r / count);
      row[offset + 1] = Math.round(g / count);
      row[offset + 2] = Math.round(b / count);
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  return pngRgba(size, rows);
}

function icoFromPngs(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map((image) => {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

module.exports = { trayPng, trayMeterColor, appIconPng, icoFromPngs };
