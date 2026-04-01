const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

const sizes = [16, 32, 48, 64, 128, 256];

const colors = {
  outer: [250, 15, 0, 255],
  inner: [200, 18, 18, 255],
  highlight: [255, 201, 89, 255],
  white: [255, 255, 255, 255],
  shadow: [87, 10, 10, 255],
};

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pngFromRgba(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    rgba.copy(raw, rowOffset + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function blendPixel(rgba, width, height, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) {
    return;
  }

  const index = (y * width + x) * 4;
  const destA = rgba[index + 3] / 255;
  const srcA = (color[3] / 255) * alpha;
  const outA = srcA + destA * (1 - srcA);

  if (outA <= 0) {
    return;
  }

  for (let channel = 0; channel < 3; channel += 1) {
    const dest = rgba[index + channel] / 255;
    const src = color[channel] / 255;
    const out = (src * srcA + dest * destA * (1 - srcA)) / outA;
    rgba[index + channel] = Math.round(out * 255);
  }

  rgba[index + 3] = Math.round(outA * 255);
}

function drawCircle(rgba, width, height, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, Math.min(1, radius + 0.8 - distance));
      blendPixel(rgba, width, height, x, y, color, alpha);
    }
  }
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  const dx = px - qx;
  const dy = py - qy;

  return Math.sqrt(dx * dx + dy * dy);
}

function drawSegment(rgba, width, height, ax, ay, bx, by, thickness, color) {
  const radius = thickness / 2;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = distanceToSegment(x + 0.5, y + 0.5, ax, ay, bx, by);
      const alpha = Math.max(0, Math.min(1, radius + 0.8 - distance));
      blendPixel(rgba, width, height, x, y, color, alpha);
    }
  }
}

function drawY(rgba, size, scale, color, shadowColor) {
  const topY = size * 0.22;
  const midY = size * 0.50;
  const bottomY = size * 0.80;
  const leftX = size * 0.28;
  const rightX = size * 0.72;
  const centerX = size * 0.50;
  const thickness = size * 0.16;
  const shadowOffset = Math.max(1, size * 0.03);

  const segments = [
    [leftX, topY, centerX, midY],
    [rightX, topY, centerX, midY],
    [centerX, midY, centerX, bottomY],
  ];

  for (const [ax, ay, bx, by] of segments) {
    drawSegment(
      rgba,
      size,
      size,
      ax + shadowOffset,
      ay + shadowOffset,
      bx + shadowOffset,
      by + shadowOffset,
      thickness,
      shadowColor
    );
  }

  for (const [ax, ay, bx, by] of segments) {
    drawSegment(rgba, size, size, ax, ay, bx, by, thickness, color);
  }

  const dotRadius = Math.max(1.5, size * 0.06 * scale);
  drawCircle(rgba, size, size, size * 0.78, size * 0.26, dotRadius, colors.highlight);
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.46;
  const innerRadius = size * 0.40;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const index = (y * size + x) * 4;

      if (distance > radius) {
        continue;
      }

      const t = Math.min(1, distance / radius);
      const blend = Math.max(0, Math.min(1, (distance - innerRadius * 0.35) / radius));
      const base = [
        Math.round(colors.outer[0] * (1 - blend) + colors.inner[0] * blend),
        Math.round(colors.outer[1] * (1 - blend) + colors.inner[1] * blend),
        Math.round(colors.outer[2] * (1 - blend) + colors.inner[2] * blend),
        255,
      ];

      const sheen = Math.max(0, 1 - ((x / size) * 0.65 + (y / size) * 0.85));
      rgba[index] = Math.min(255, Math.round(base[0] + 28 * sheen));
      rgba[index + 1] = Math.min(255, Math.round(base[1] + 10 * sheen));
      rgba[index + 2] = Math.min(255, Math.round(base[2] + 10 * sheen));
      rgba[index + 3] = Math.round(255 * Math.max(0, Math.min(1, radius + 0.8 - distance)));

      const rim = Math.max(0, 1 - Math.abs(distance - innerRadius) / (size * 0.028));
      if (rim > 0) {
        rgba[index] = Math.min(255, Math.round(rgba[index] + 18 * rim));
        rgba[index + 1] = Math.min(255, Math.round(rgba[index + 1] + 8 * rim));
        rgba[index + 2] = Math.min(255, Math.round(rgba[index + 2] + 8 * rim));
      }

      if (t < 0.22) {
        rgba[index] = Math.min(255, rgba[index] + 14);
        rgba[index + 1] = Math.min(255, rgba[index + 1] + 8);
        rgba[index + 2] = Math.min(255, rgba[index + 2] + 8);
      }
    }
  }

  drawY(rgba, size, size / 256, colors.white, colors.shadow);

  return rgba;
}

function writeIco(outputPath, pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const directory = Buffer.alloc(count * 16);
  let offset = header.length + directory.length;

  pngBuffers.forEach(({ size, data }, index) => {
    const entry = index * 16;
    directory[entry] = size >= 256 ? 0 : size;
    directory[entry + 1] = size >= 256 ? 0 : size;
    directory[entry + 2] = 0;
    directory[entry + 3] = 0;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  fs.writeFileSync(outputPath, Buffer.concat([header, directory, ...pngBuffers.map((item) => item.data)]));
}

fs.mkdirSync(publicDir, { recursive: true });

const pngBuffers = sizes.map((size) => {
  const rgba = makeIcon(size);
  const png = pngFromRgba(size, size, rgba);
  return { size, data: png };
});

writeIco(path.join(publicDir, 'favicon.ico'), pngBuffers);
fs.writeFileSync(path.join(publicDir, 'favicon-256.png'), pngBuffers[pngBuffers.length - 1].data);

console.log(`Generated ${path.join('public', 'favicon.ico')} with sizes: ${sizes.join(', ')}`);
