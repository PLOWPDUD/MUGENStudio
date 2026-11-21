import { applyPalette } from './actParser';
import type { AirAction, SffData } from './types';

function writeUint16LE(arr: number[], v: number) {
  arr.push(v & 0xff, (v >> 8) & 0xff);
}

/**
 * Standard GIF89a LZW encoder for 8-bit indexed frames (max 256 colors).
 */
function encodeLzw(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map<number, number>();

  const resetDict = () => {
    dict.clear();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  const outBytes: number[] = [];
  let bitBuf = 0;
  let bitLen = 0;

  const emit = (code: number) => {
    bitBuf |= code << bitLen;
    bitLen += codeSize;
    while (bitLen >= 8) {
      outBytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitLen -= 8;
    }
  };

  resetDict();
  emit(clearCode);

  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const existing = dict.get(key);
      if (existing !== undefined) {
        prefix = existing;
      } else {
        emit(prefix);
        if (nextCode < 4096) {
          dict.set(key, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < 12) {
            codeSize++;
          }
        } else {
          emit(clearCode);
          resetDict();
        }
        prefix = k;
      }
    }
    emit(prefix);
  }

  emit(eoiCode);
  if (bitLen > 0) {
    outBytes.push(bitBuf & 0xff);
  }

  // Pack into GIF sub-blocks (max 255 bytes each)
  const subBlocks: number[] = [minCodeSize];
  for (let i = 0; i < outBytes.length; i += 255) {
    const chunk = outBytes.slice(i, i + 255);
    subBlocks.push(chunk.length, ...chunk);
  }
  subBlocks.push(0); // block terminator
  return subBlocks;
}

/**
 * Quantizes an RGBA canvas into 8-bit indices mapped to a 256-color palette (index 0 = transparent).
 */
function quantizeCanvasToPalette(
  canvas: HTMLCanvasElement,
  palette: Uint8Array
): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(canvas.width * canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8Array(canvas.width * canvas.height);
  const cache = new Map<number, number>();

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const pIdx = i / 4;
    if (a < 80) {
      out[pIdx] = 0;
      continue;
    }
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const rgbKey = (r << 16) | (g << 8) | b;
    const cached = cache.get(rgbKey);
    if (cached !== undefined) {
      out[pIdx] = cached;
      continue;
    }

    let best = 1;
    let bestDist = Infinity;
    for (let c = 1; c < 256; c++) {
      const pr = palette[c * 4];
      const pg = palette[c * 4 + 1];
      const pb = palette[c * 4 + 2];
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = c;
        if (d === 0) break;
      }
    }
    cache.set(rgbKey, best);
    out[pIdx] = best;
  }
  return out;
}

function getEffectiveSpritePalette(
  sff: SffData,
  sprite: any,
  fallbackAct: Uint8Array | null
): Uint8Array {
  if (sprite?.isSharedPalette === false && sprite?.palette) {
    return sprite.palette;
  }
  const firstSffPal = sff.palettes && sff.palettes.length > 0 ? sff.palettes[0].data : null;
  return fallbackAct || firstSffPal || sprite?.palette || new Uint8Array(1024);
}

/**
 * Computes tight bounding box across all frames relative to the character origin (0,0).
 */
function computeActionBounds(sff: SffData, action: AirAction) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of action.elements) {
    const sprite = sff.images.find(img => img.group === el.group && img.image === el.image);
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) continue;

    const x0 = el.xOffset - sprite.xOffset;
    const y0 = el.yOffset - sprite.yOffset;
    const x1 = x0 + sprite.width;
    const y1 = y0 + sprite.height;

    const flip = (el.flip || '').toUpperCase();
    const fx0 = flip.includes('H') ? -x1 : x0;
    const fx1 = flip.includes('H') ? -x0 : x1;
    const fy0 = flip.includes('V') ? -y1 : y0;
    const fy1 = flip.includes('V') ? -y0 : y1;

    minX = Math.min(minX, fx0);
    minY = Math.min(minY, fy0);
    maxX = Math.max(maxX, fx1);
    maxY = Math.max(maxY, fy1);
  }

  if (!Number.isFinite(minX)) {
    return { minX: -32, minY: -64, width: 64, height: 64 };
  }

  const pad = 2;
  const width = Math.max(16, Math.ceil(maxX - minX) + pad * 2);
  const height = Math.max(16, Math.ceil(maxY - minY) + pad * 2);
  return { minX: Math.floor(minX) - pad, minY: Math.floor(minY) - pad, width, height };
}

function drawFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  sff: SffData,
  el: AirAction['elements'][number],
  originX: number,
  originY: number,
  fallbackAct: Uint8Array | null
) {
  const sprite = sff.images.find(img => img.group === el.group && img.image === el.image);
  if (!sprite || !sprite.pixelIndices || sprite.width <= 0 || sprite.height <= 0) return;

  const pal = getEffectiveSpritePalette(sff, sprite, fallbackAct);
  const imgData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, pal);
  const tmp = document.createElement('canvas');
  tmp.width = sprite.width;
  tmp.height = sprite.height;
  const tctx = tmp.getContext('2d');
  if (!tctx) return;
  tctx.putImageData(imgData, 0, 0);

  const flip = (el.flip || '').toUpperCase();
  const color = (el.color || '').toUpperCase();

  ctx.save();
  ctx.translate(originX, originY);
  if (flip.includes('H')) ctx.scale(-1, 1);
  if (flip.includes('V')) ctx.scale(1, -1);
  if (color === 'A' || color === 'A1') {
    ctx.globalAlpha = 0.7;
  } else if (color === 'S') {
    ctx.globalAlpha = 0.65;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, el.xOffset - sprite.xOffset, el.yOffset - sprite.yOffset);
  ctx.restore();
}

/**
 * Exports a single MUGEN AirAction as an animated GIF89a Blob.
 */
export function exportActionGif(
  sff: SffData,
  action: AirAction,
  fallbackAct: Uint8Array | null
): Blob {
  const { minX, minY, width, height } = computeActionBounds(sff, action);
  const globalPal =
    fallbackAct ||
    (sff.palettes && sff.palettes.length > 0 ? sff.palettes[0].data : null) ||
    sff.images[0]?.palette ||
    new Uint8Array(1024);

  const bytes: number[] = [];
  // Header GIF89a
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);

  // Logical Screen Descriptor
  writeUint16LE(bytes, width);
  writeUint16LE(bytes, height);
  // Global Color Table Flag (1), Color Res (7), Sort (0), Size of GCT (7 => 256 colors)
  bytes.push(0xf7, 0x00, 0x00);

  // Global Color Table (256 * 3 bytes)
  for (let i = 0; i < 256; i++) {
    bytes.push(globalPal[i * 4] || 0, globalPal[i * 4 + 1] || 0, globalPal[i * 4 + 2] || 0);
  }

  // Netscape 2.0 Application Extension (infinite loop)
  bytes.push(
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00
  );

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = width;
  frameCanvas.height = height;
  const fctx = frameCanvas.getContext('2d');

  for (const el of action.elements) {
    if (fctx) {
      fctx.clearRect(0, 0, width, height);
      drawFrameToCanvas(fctx, sff, el, -minX, -minY, fallbackAct);
    }

    const ticks = el.time <= 0 ? 30 : el.time;
    const delayCs = Math.max(2, Math.round((ticks * 100) / 60));

    // Graphic Control Extension (Disposal 2 = restore background, transparent index = 0)
    bytes.push(0x21, 0xf9, 0x04, 0x09);
    writeUint16LE(bytes, delayCs);
    bytes.push(0x00, 0x00);

    // Image Descriptor
    bytes.push(0x2c);
    writeUint16LE(bytes, 0);
    writeUint16LE(bytes, 0);
    writeUint16LE(bytes, width);
    writeUint16LE(bytes, height);
    bytes.push(0x00);

    const indices = quantizeCanvasToPalette(frameCanvas, globalPal);
    const lzwBlocks = encodeLzw(indices, 8);
    for (let i = 0; i < lzwBlocks.length; i++) {
      bytes.push(lzwBlocks[i]);
    }
  }

  // GIF Trailer
  bytes.push(0x3b);
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}

/**
 * Exports all frames of an AirAction as a single aligned horizontal PNG sprite sheet.
 */
export function exportActionSpriteSheet(
  sff: SffData,
  action: AirAction,
  fallbackAct: Uint8Array | null
): Promise<Blob | null> {
  const { minX, minY, width, height } = computeActionBounds(sff, action);
  const count = Math.max(1, action.elements.length);
  const sheet = document.createElement('canvas');
  sheet.width = width * count;
  sheet.height = height;
  const ctx = sheet.getContext('2d');
  if (ctx) {
    action.elements.forEach((el, idx) => {
      drawFrameToCanvas(ctx, sff, el, idx * width - minX, -minY, fallbackAct);
    });
  }
  return new Promise(resolve => sheet.toBlob(blob => resolve(blob), 'image/png'));
}
