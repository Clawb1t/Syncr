'use strict';

// Dependency-free status-dot icon generator.
//
// Produces small RGBA discs as PNG (Linux/macOS trays) and ICO (Windows tray).
// Colours encode the Syncr host status so the tray is a live "is it working?"
// indicator. Icons are generated once at require-time — no binary assets to ship.

const zlib = require('zlib');

const SIZE = 32;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Draw a filled, anti-aliased disc of the given RGB colour into an RGBA buffer.
function drawDisc(size, [r, g, b]) {
  const px = Buffer.alloc(size * size * 4, 0);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size / 2 - 1.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      // 1px anti-aliased edge
      let alpha = 0;
      if (d <= radius - 0.5) alpha = 1;
      else if (d < radius + 0.5) alpha = radius + 0.5 - d;

      if (alpha > 0) {
        const o = (y * size + x) * 4;
        px[o]     = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = Math.round(alpha * 255);
      }
    }
  }
  return px;
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // colour type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Prefix each scanline with filter byte 0 (none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Wrap a PNG in a single-image ICO container (Vista+ supports PNG-compressed ICOs).
function encodeIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;  // width
  entry[1] = size >= 256 ? 0 : size;  // height
  entry[2] = 0;                       // palette
  entry[3] = 0;                       // reserved
  entry.writeUInt16LE(1, 4);          // colour planes
  entry.writeUInt16LE(32, 6);         // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);    // offset to image data

  return Buffer.concat([header, entry, pngBuf]);
}

function makeIcon(rgb) {
  const rgba = drawDisc(SIZE, rgb);
  const png  = encodePng(SIZE, rgba);
  const ico  = encodeIco(png, SIZE);
  return { png: png.toString('base64'), ico: ico.toString('base64') };
}

// Status palette.
const COLORS = {
  active:  [63, 185, 80],    // green  — showing presence on Discord
  waiting: [210, 153, 34],   // amber  — a supported tab is live but Discord isn't connected
  idle:    [86, 98, 246],    // blurple — host running, waiting for a supported tab
  offline: [107, 107, 136],  // grey   — no browser connected
};

const ICONS = {};
for (const [name, rgb] of Object.entries(COLORS)) ICONS[name] = makeIcon(rgb);

// Platform-appropriate base64 icon string for a given status name.
function iconFor(status) {
  const icon = ICONS[status] || ICONS.idle;
  return process.platform === 'win32' ? icon.ico : icon.png;
}

module.exports = { iconFor, ICONS, COLORS };
