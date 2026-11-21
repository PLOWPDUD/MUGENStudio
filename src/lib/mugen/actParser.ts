import type { SffImage } from "./types";

/**
 * 256-color ACT files are exactly 768 bytes long (3 bytes per color).
 * M.U.G.E.N palettes map transparent color to index 0 (sometimes index 255 depending on version).
 * SFF palettes use index 0 as transparency standard for WinMUGEN.
 */
export function parseActBinary(buffer: ArrayBuffer): Uint8Array {
    if (buffer.byteLength < 768) {
      throw new Error("Invalid ACT file: Must be at least 768 bytes.");
    }
    
    const view = new Uint8Array(buffer);
    const palette = new Uint8Array(256 * 4); // Map to RGBA format for web Canvas usage
    
    for (let i = 0; i < 256; i++) {
        // Read RGB in standard order for MUGEN .act files (Color 0 is byte 0)
        palette[i * 4] = view[i * 3];         // R
        palette[i * 4 + 1] = view[i * 3 + 1]; // G
        palette[i * 4 + 2] = view[i * 3 + 2]; // B
        
        // Alpha mapping: index 0 is transparent (or background) in standard M.U.G.E.N palettes.
        // If an editor wants to force solid color viewing, this can be overridden.
        palette[i * 4 + 3] = i === 0 ? 0 : 255; 
    }
    
    return palette;
  }

  /**
   * Reverses a 256-color RGBA palette (index 0 <-> 255) to fix upside-down ACT/palette tables.
   * Preserves WinMUGEN transparency rules (index 0 alpha = 0, indices 1..255 alpha = 255).
   */
  export function reversePalette(paletteRGBA: Uint8Array): Uint8Array {
    const flipped = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const srcIdx = 255 - i;
      flipped[i * 4] = paletteRGBA[srcIdx * 4] ?? 0;
      flipped[i * 4 + 1] = paletteRGBA[srcIdx * 4 + 1] ?? 0;
      flipped[i * 4 + 2] = paletteRGBA[srcIdx * 4 + 2] ?? 0;
      flipped[i * 4 + 3] = i === 0 ? 0 : 255;
    }
    return flipped;
  }

  /**
   * Detects when an imported palette is stored upside down (255..0 instead of 0..255),
   * which causes character sprites (referencing low indices) to hit unused black slots and render completely black.
   * Compares sprite pixel coverage against original vs reversed palettes and flips only when the reversed
   * palette cleanly restores real colors on an otherwise near-black render.
   */
  export function detectAndFixUpsideDownPalette(
    paletteRGBA: Uint8Array,
    images?: SffImage[]
  ): { palette: Uint8Array; wasFlipped: boolean } {
    if (!images || images.length === 0 || paletteRGBA.length < 1024) {
      return { palette: paletteRGBA, wasFlipped: false };
    }

    const validImages = images.filter(
      img => img.width > 0 && img.height > 0 && img.pixelIndices && img.pixelIndices.length > 0
    );
    if (validImages.length === 0) {
      return { palette: paletteRGBA, wasFlipped: false };
    }

    const sharedBody = validImages.filter(img => img.group < 9000 && img.isSharedPalette !== false);
    const anyBody = validImages.filter(img => img.group < 9000);
    const pool = sharedBody.length > 0 ? sharedBody : anyBody.length > 0 ? anyBody : validImages;
    const sampled = pool.slice(0, 12);

    const evaluate = (pal: Uint8Array) => {
      let nonZero = 0;
      let lit = 0;
      const distinct = new Set<number>();

      for (const img of sampled) {
        const px = img.pixelIndices;
        const step = Math.max(1, Math.floor(px.length / 4096));
        for (let k = 0; k < px.length; k += step) {
          const idx = px[k];
          if (idx === 0) continue;
          nonZero++;
          const off = idx * 4;
          const r = pal[off] ?? 0;
          const g = pal[off + 1] ?? 0;
          const b = pal[off + 2] ?? 0;
          const a = pal[off + 3] ?? 255;
          if (a > 0 && (r > 10 || g > 10 || b > 10)) {
            lit++;
            distinct.add((r << 16) | (g << 8) | b);
          }
        }
      }

      return {
        nonZero,
        litRatio: nonZero > 0 ? lit / nonZero : 0,
        distinctCount: distinct.size,
      };
    };

    const orig = evaluate(paletteRGBA);
    if (orig.nonZero === 0) {
      return { palette: paletteRGBA, wasFlipped: false };
    }

    const flipped = reversePalette(paletteRGBA);
    const rev = evaluate(flipped);

    const isUpsideDown =
      orig.litRatio < 0.08 &&
      rev.litRatio > 0.25 &&
      rev.litRatio > orig.litRatio * 3 &&
      (rev.distinctCount >= 3 || (orig.litRatio === 0 && rev.litRatio > 0.35 && rev.distinctCount >= 1));

    return isUpsideDown
      ? { palette: flipped, wasFlipped: true }
      : { palette: paletteRGBA, wasFlipped: false };
  }
  
  /**
   * Applies a raw MUGEN Palette to an uncompressed 8bpp Pixel Array.
   * Outputs raw ImageData buffer for usage in HTML Canvas.
   */
  export function applyPalette(pixelIndices: Uint8Array, width: number, height: number, paletteRGBA: Uint8Array): ImageData {
      const outputBuffer = new Uint8ClampedArray(width * height * 4);
      
      for(let i = 0; i < pixelIndices.length; i++) {
          const colorIndex = pixelIndices[i];
          const palOffset = colorIndex * 4;
          
          outputBuffer[i * 4] = paletteRGBA[palOffset];         // R
          outputBuffer[i * 4 + 1] = paletteRGBA[palOffset + 1]; // G
          outputBuffer[i * 4 + 2] = paletteRGBA[palOffset + 2]; // B
          outputBuffer[i * 4 + 3] = paletteRGBA[palOffset + 3]; // A
      }
      
      return new ImageData(outputBuffer, width, height);
  }

  /**
   * Quantizes an RGBA pixel array to 8-bit palette indices.
   * Uses best match color distance to the active palette, or builds a palette if none is provided.
   */
  export function imageToSpriteIndices(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    paletteRGBA: Uint8Array | null
  ): { indices: Uint8Array; palette: Uint8Array } {
    const indices = new Uint8Array(width * height);
    let finalPalette = paletteRGBA ? new Uint8Array(paletteRGBA) : null;

    if (!finalPalette) {
      finalPalette = new Uint8Array(256 * 4);
      finalPalette[0] = 0;
      finalPalette[1] = 0;
      finalPalette[2] = 0;
      finalPalette[3] = 0;

      const colors: string[] = [];
      const colorMap = new Map<string, number>();
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < 128) continue;
        const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;
        if (!colorMap.has(key)) {
          colorMap.set(key, 1);
          colors.push(key);
        } else {
          colorMap.set(key, colorMap.get(key)! + 1);
        }
      }

      colors.sort((a, b) => (colorMap.get(b) || 0) - (colorMap.get(a) || 0));
      const maxColors = Math.min(255, colors.length);

      for (let i = 0; i < maxColors; i++) {
        const [r, g, b] = colors[i].split(',').map(Number);
        const palOffset = (i + 1) * 4;
        finalPalette[palOffset] = r;
        finalPalette[palOffset + 1] = g;
        finalPalette[palOffset + 2] = b;
        finalPalette[palOffset + 3] = 255;
      }

      for (let i = maxColors + 1; i < 256; i++) {
        const palOffset = i * 4;
        finalPalette[palOffset] = i;
        finalPalette[palOffset + 1] = i;
        finalPalette[palOffset + 2] = i;
        finalPalette[palOffset + 3] = 255;
      }
    }

    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      const pixelIdx = i / 4;

      if (a < 80) {
        indices[pixelIdx] = 0;
        continue;
      }

      let bestIndex = 1;
      let minDistance = Infinity;

      for (let p = 1; p < 256; p++) {
        const pr = finalPalette[p * 4];
        const pg = finalPalette[p * 4 + 1];
        const pb = finalPalette[p * 4 + 2];
        const pa = finalPalette[p * 4 + 3];

        if (pa < 128) continue;

        const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (dist < minDistance) {
          minDistance = dist;
          bestIndex = p;
        }
      }
      indices[pixelIdx] = bestIndex;
    }

    return { indices, palette: finalPalette };
  }

