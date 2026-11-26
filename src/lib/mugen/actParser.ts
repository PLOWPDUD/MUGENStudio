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
   * Encodes a 256-color RGBA (1024-byte) or RGB (768-byte) palette into a standard
   * 768-byte M.U.G.E.N / IKEMEN GO .act binary file.
   * M.U.G.E.N, IKEMEN GO, and Fighter Factory read .act tables in reverse index order
   * (255 down to 0): byte 0..2 = index 255, byte 765..767 = index 0 (transparency).
   */
  export function encodeActBinary(paletteData: Uint8Array, mugenReverseOrder = true): Uint8Array {
    const actBuffer = new Uint8Array(768);
    const stride = paletteData.length >= 1024 ? 4 : 3;
    for (let i = 0; i < 256; i++) {
      const srcIdx = mugenReverseOrder ? 255 - i : i;
      const srcOff = srcIdx * stride;
      actBuffer[i * 3] = paletteData[srcOff] ?? 0;
      actBuffer[i * 3 + 1] = paletteData[srcOff + 1] ?? 0;
      actBuffer[i * 3 + 2] = paletteData[srcOff + 2] ?? 0;
    }
    return actBuffer;
  }

  /**
   * Detects when an imported palette is stored upside down (255..0 instead of 0..255),
   * which causes character sprites (referencing low indices) to hit unused/filler slots.
   * Evaluates pixel index histograms across body sprites against original vs reversed palettes,
   * incorporating reference PCX palette distance and luminance correlation when available.
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

    const sharedBody = validImages.filter(img => img.group < 7000 && img.isSharedPalette !== false);
    const anyBody = validImages.filter(img => img.group < 7000);
    const pool = sharedBody.length > 0 ? sharedBody : anyBody.length > 0 ? anyBody : validImages;
    const sampled = pool.slice(0, 28);

    const idxCounts = new Uint32Array(256);
    let totalNonZero = 0;
    for (const img of sampled) {
      const px = img.pixelIndices;
      const step = Math.max(1, Math.floor(px.length / 4096));
      for (let k = 0; k < px.length; k += step) {
        const idx = px[k];
        if (idx === 0) continue;
        idxCounts[idx]++;
        totalNonZero++;
      }
    }

    if (totalNonZero === 0) {
      return { palette: paletteRGBA, wasFlipped: false };
    }

    const refPal =
      validImages.find(
        img => img.group < 7000 && !img.isSharedPalette && img.palette && img.palette.length >= 1024
      )?.palette ||
      validImages.find(img => img.group < 7000 && img.palette && img.palette.length >= 1024)?.palette;

    const evaluate = (pal: Uint8Array) => {
      let lit = 0;
      const colorCounts = new Map<number, number>();
      let maxColorFreq = 0;
      let weightedRgbDist = 0;
      let exactMatches = 0;

      // For weighted Pearson luminance correlation against refPal
      let sumW = 0;
      let sumL = 0;
      let sumRefL = 0;
      let sumLL = 0;
      let sumRefLL = 0;
      let sumLRefL = 0;

      for (let idx = 1; idx < 256; idx++) {
        const count = idxCounts[idx];
        if (count === 0) continue;
        const off = idx * 4;
        const r = pal[off] ?? 0;
        const g = pal[off + 1] ?? 0;
        const b = pal[off + 2] ?? 0;

        const rgb = (r << 16) | (g << 8) | b;
        const nextFreq = (colorCounts.get(rgb) ?? 0) + count;
        colorCounts.set(rgb, nextFreq);
        if (nextFreq > maxColorFreq) maxColorFreq = nextFreq;
        if (r > 10 || g > 10 || b > 10) {
          lit += count;
        }

        if (refPal) {
          const rr = refPal[off] ?? 0;
          const rg = refPal[off + 1] ?? 0;
          const rb = refPal[off + 2] ?? 0;
          const dr = Math.abs(r - rr);
          const dg = Math.abs(g - rg);
          const db = Math.abs(b - rb);
          weightedRgbDist += count * (dr + dg + db);
          if (dr <= 10 && dg <= 10 && db <= 10) {
            exactMatches += count;
          }

          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const refLum = 0.299 * rr + 0.587 * rg + 0.114 * rb;
          sumW += count;
          sumL += count * lum;
          sumRefL += count * refLum;
          sumLL += count * lum * lum;
          sumRefLL += count * refLum * refLum;
          sumLRefL += count * lum * refLum;
        }
      }

      let lumCorr = 0;
      if (refPal && sumW > 0) {
        const meanL = sumL / sumW;
        const meanRef = sumRefL / sumW;
        const varL = Math.max(0, sumLL / sumW - meanL * meanL);
        const varRef = Math.max(0, sumRefLL / sumW - meanRef * meanRef);
        const denom = Math.sqrt(varL * varRef);
        if (denom > 1e-4) {
          lumCorr = (sumLRefL / sumW - meanL * meanRef) / denom;
        }
      }

      const bgDist = refPal
        ? (Math.abs((pal[0] ?? 0) - (refPal[0] ?? 0)) +
            Math.abs((pal[1] ?? 0) - (refPal[1] ?? 0)) +
            Math.abs((pal[2] ?? 0) - (refPal[2] ?? 0))) /
          3
        : 0;

      return {
        nonZero: totalNonZero,
        litRatio: lit / totalNonZero,
        distinctCount: colorCounts.size,
        dominantRatio: maxColorFreq / totalNonZero,
        meanRgbDistToRef: refPal ? weightedRgbDist / (3 * totalNonZero) : 999,
        exactMatchRatio: refPal ? exactMatches / totalNonZero : 0,
        lumCorr,
        bgDist,
      };
    };

    const orig = evaluate(paletteRGBA);
    // Safety guard: if the original palette already closely matches the SFF body reference palette, keep it upright
    if (refPal && orig.meanRgbDistToRef <= 18 && orig.exactMatchRatio >= 0.6) {
      return { palette: paletteRGBA, wasFlipped: false };
    }

    const flipped = reversePalette(paletteRGBA);
    const rev = evaluate(flipped);
    const refStats = refPal ? evaluate(refPal) : null;

    const blackUnusedFlip =
      orig.litRatio < 0.14 &&
      rev.litRatio > 0.25 &&
      rev.litRatio > orig.litRatio * 2.5 &&
      (rev.distinctCount >= 3 || (orig.litRatio === 0 && rev.litRatio > 0.3 && rev.distinctCount >= 1));

    const fillerUnusedFlip =
      orig.distinctCount <= 6 &&
      orig.dominantRatio >= 0.78 &&
      rev.distinctCount >= Math.max(8, orig.distinctCount * 2.5) &&
      rev.dominantRatio <= 0.78;

    const refCollapseFlip =
      Boolean(refStats && refStats.distinctCount >= 8) &&
      orig.distinctCount <= Math.max(6, Math.floor((refStats?.distinctCount ?? 0) * 0.5)) &&
      rev.distinctCount >= Math.max(orig.distinctCount * 1.5, Math.floor((refStats?.distinctCount ?? 0) * 0.6)) &&
      (rev.dominantRatio <= orig.dominantRatio - 0.12 || rev.distinctCount >= orig.distinctCount * 2);

    const refExactMatchFlip =
      Boolean(refStats) &&
      rev.meanRgbDistToRef <= 24 &&
      rev.exactMatchRatio >= 0.55 &&
      orig.meanRgbDistToRef > Math.max(22, rev.meanRgbDistToRef * 1.6);

    const refLumCorrFlip =
      Boolean(refStats && refStats.distinctCount >= 8 && rev.distinctCount >= 8) &&
      ((rev.lumCorr >= 0.32 && orig.lumCorr <= 0.18 && rev.lumCorr - Math.max(0, orig.lumCorr) >= 0.25 && orig.distinctCount <= rev.distinctCount * 1.15) ||
        (Math.abs(rev.lumCorr) >= 0.38 && Math.abs(orig.lumCorr) <= 0.16 && rev.bgDist <= 18 && orig.bgDist >= 30));

    const isUpsideDown =
      blackUnusedFlip || fillerUnusedFlip || refCollapseFlip || refExactMatchFlip || refLumCorrFlip;

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

