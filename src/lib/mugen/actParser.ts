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
        // Read RGB in reverse order for MUGEN .act files (Color 255 is byte 0)
        const actIndex = 255 - i;
        palette[i * 4] = view[actIndex * 3];         // R
        palette[i * 4 + 1] = view[actIndex * 3 + 1]; // G
        palette[i * 4 + 2] = view[actIndex * 3 + 2]; // B
        
        // Alpha mapping: index 0 is transparent (or background) in standard M.U.G.E.N palettes.
        // If an editor wants to force solid color viewing, this can be overridden.
        palette[i * 4 + 3] = i === 0 ? 0 : 255; 
    }
    
    return palette;
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

