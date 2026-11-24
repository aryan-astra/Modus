// Generate extension icon PNGs programmatically.
// Pure JS PNG encoder — no native dependencies needed.
// Creates pixel-perfect C-grid logos at 48x48 and 128x128.

import { createWriteStream } from 'fs';
import { deflateSync } from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function writeChunk(stream, type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  stream.write(len);
  stream.write(type);
  stream.write(data);
  const crcBuf = Buffer.alloc(4);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  crcBuf.writeUInt32BE(crc32(typeAndData));
  stream.write(crcBuf);
}

function drawRoundedRect(pixels, w, x, y, size, radius, color) {
  // Draw a rounded rectangle filled with color
  for (let py = y; py < y + size; py++) {
    for (let px = x; px < x + size; px++) {
      // Check if this pixel is within the rounded rect
      let inside = true;
      const corners = [
        [x, y], [x + size, y], [x, y + size], [x + size, y + size]
      ];
      for (const [cx, cy] of corners) {
        const dx = px - cx;
        const dy = py - cy;
        // Check if in a corner region
        const inCornerX = (px < x + radius || px >= x + size - radius);
        const inCornerY = (py < y + radius || py >= y + size - radius);
        if (inCornerX && inCornerY) {
          // Find the nearest corner center
          const cornerCx = px < x + size/2 ? x + radius : x + size - 1 - radius;
          const cornerCy = py < y + size/2 ? y + radius : y + size - 1 - radius;
          const dist = Math.sqrt((px - cornerCx) ** 2 + (py - cornerCy) ** 2);
          if (dist > radius) inside = false;
        }
      }
      if (inside) {
        const idx = (py * w + px) * 4;
        pixels[idx] = color[0];
        pixels[idx+1] = color[1];
        pixels[idx+2] = color[2];
        pixels[idx+3] = 255;
      }
    }
  }
}

function generatePng(width, height, drawFn, outputPath) {
  const pixels = Buffer.alloc(width * height * 4);
  // Fill black background
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 255;
  }
  drawFn(pixels, width, height);

  // Convert to RGBA PNG
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0])); // filter: none
    rows.push(pixels.slice(y * width * 4, (y + 1) * width * 4));
  }
  const raw = Buffer.concat(rows);
  const compressed = deflateSync(raw);

  const stream = createWriteStream(outputPath);
  // PNG signature
  stream.write(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  writeChunk(stream, 'IHDR', ihdr);

  // IDAT
  writeChunk(stream, 'IDAT', compressed);

  // IEND
  writeChunk(stream, 'IEND', Buffer.alloc(0));

  stream.end();
}

// 48x48 icon: C-grid only (no text — too small)
function draw48(pixels, w, h) {
  const gridSize = 36; // total grid size
  const gap = 3; // gap between squares
  const cellSize = (gridSize - gap * 2) / 3;
  const offsetX = (w - gridSize) / 2;
  const offsetY = (h - gridSize) / 2;
  const radius = Math.max(2, cellSize * 0.2);

  const positions = [
    [0, 0], [1, 0], [2, 0],   // row 1: all 3
    [0, 1], [1, 1],            // row 2: left 2 only (right empty = C opening)
    [0, 2], [1, 2], [2, 2],   // row 3: all 3
  ];

  const white = [255, 255, 255];
  for (const [col, row] of positions) {
    const x = Math.round(offsetX + col * (cellSize + gap));
    const y = Math.round(offsetY + row * (cellSize + gap));
    drawRoundedRect(pixels, w, x, y, Math.round(cellSize), radius, white);
  }
}

// 128x128 icon: C-grid only, larger (same design as 48, no text — cleaner at all sizes)
function draw128(pixels, w, h) {
  const gridSize = 100;
  const gap = 8;
  const cellSize = (gridSize - gap * 2) / 3;
  const offsetX = (w - gridSize) / 2;
  const offsetY = (h - gridSize) / 2;
  const radius = Math.max(4, cellSize * 0.2);

  const positions = [
    [0, 0], [1, 0], [2, 0],
    [0, 1], [1, 1],
    [0, 2], [1, 2], [2, 2],
  ];

  const white = [255, 255, 255];
  for (const [col, row] of positions) {
    const x = Math.round(offsetX + col * (cellSize + gap));
    const y = Math.round(offsetY + row * (cellSize + gap));
    drawRoundedRect(pixels, w, x, y, Math.round(cellSize), radius, white);
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'assets');

generatePng(48, 48, draw48, path.join(assetsDir, 'chatgpt-enhanced-48_logo.png'));
console.log('Generated: assets/chatgpt-enhanced-48_logo.png (48x48)');

generatePng(128, 128, draw128, path.join(assetsDir, 'chatgpt-enhanced-128_logo.png'));
console.log('Generated: assets/chatgpt-enhanced-128_logo.png (128x128)');
