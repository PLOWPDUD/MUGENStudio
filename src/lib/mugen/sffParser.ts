/**
 * Binary parser for SFF files.
 * Covers SFFv1 (ElecbyteSpr standard 512-byte header, followed by Subfile Nodes)
 * Decoding PCX RLE pixel blobs.
 */
import { SffData, SffImage, SffPalette } from "./types";

export function parseSffBinary(buffer: ArrayBuffer): SffData {
  const view = new DataView(buffer);
  
  // 1. Signature Check (12 bytes): "ElecbyteSpr\0"
  const encoder = new TextDecoder("ascii");
  const signature = encoder.decode(buffer.slice(0, 11));
  if (signature !== "ElecbyteSpr") {
    throw new Error("Invalid SFF Signature: Not a 'ElecbyteSpr' file.");
  }

  // 2. Version Header
  const verPart4 = view.getUint8(15);
  const version = `${view.getUint8(15)}.${view.getUint8(14)}.${view.getUint8(13)}.${view.getUint8(12)}`;
  
  const isV2 = verPart4 >= 2 || (view.getUint8(14) === 2); // Handles little/big endian variants of 2.0.0.0

  if (isV2) {
      return parseSffV2(buffer, view);
  }

  // SFFv1 Parsing
  const verHigh = view.getUint16(12, true);
  const verLow = view.getUint16(14, true);
  const v1version = `${verHigh}.${verLow}`;

  // 3. Stats & Pointers (SFFv1)
  const numGroups = view.getUint32(16, true);
  const numImages = view.getUint32(20, true);
  const nextSubfileOffset = view.getUint32(24, true); // Point to first subfile
  
  const images: SffImage[] = [];
  let currentOffset = nextSubfileOffset;
  let parsedCount = 0;

  let lastSubfileEnd = 0;

  // 4. Traverse Linked List of Subfiles
  while (currentOffset > 0 && currentOffset < view.byteLength && parsedCount < numImages) {
    const nextNodeOffset = view.getUint32(currentOffset, true);
    const subfileLength = view.getUint32(currentOffset + 4, true);
    const xOffset = view.getInt16(currentOffset + 8, true);
    const yOffset = view.getInt16(currentOffset + 10, true);
    const group = view.getUint16(currentOffset + 12, true);
    const image = view.getUint16(currentOffset + 14, true);
    const previousCopyIndex = view.getUint16(currentOffset + 16, true);
    const isSharedPalette = view.getUint8(currentOffset + 18) !== 0;     
    const comment = encoder.decode(buffer.slice(currentOffset + 19, currentOffset + 32)).replace(/\0/g, '');

    const isLink = subfileLength === 0 && images.length > 0;
    
    if (isLink) {
        const sourceSprite = images[previousCopyIndex];
        if (sourceSprite) {
            images.push({
                ...sourceSprite,
                group,
                image,
                xOffset,
                yOffset,
                isSharedPalette,
                comment,
                isCompressed: false,
                format: "Linked"
            });
        }
    } else {
        const pcxOffset = currentOffset + 32;
        const pcxData = new Uint8Array(buffer, pcxOffset, subfileLength);
        const subfileEnd = pcxOffset + subfileLength;
        if (subfileEnd > lastSubfileEnd) {
            lastSubfileEnd = subfileEnd;
        }
        
        try {
            const decoded = decodePcx(pcxData);
            images.push({
                group,
                image,
                xOffset,
                yOffset,
                width: decoded.width,
                height: decoded.height,
                pixelIndices: decoded.pixelIndices,
                isSharedPalette,
                comment,
                palette: decoded.embeddedPalette || undefined,
                format: "PCX",
                isCompressed: false
            });
        } catch(e) {
            images.push({
                group, image, xOffset, yOffset, width: 0, height: 0, 
                pixelIndices: new Uint8Array(),
                isSharedPalette, comment, format: "PCX (Failed)", isCompressed: true
            });
        }
    }

    parsedCount++;
    currentOffset = nextNodeOffset;
    if (nextNodeOffset === 0) break;
  }

  let globalPalette: Uint8Array | undefined;
  // SFF v1 global palette is 768 bytes at the VERY end, IF it exists.
  // It only exists if there are 768 bytes left after the last subfile.
  if (view.byteLength >= lastSubfileEnd + 768) {
      const lastPalOffset = view.byteLength - 768;
      globalPalette = new Uint8Array(1024);
      for (let i = 0; i < 256; i++) {
          globalPalette[i * 4] = view.getUint8(lastPalOffset + i * 3);
          globalPalette[i * 4 + 1] = view.getUint8(lastPalOffset + i * 3 + 1);
          globalPalette[i * 4 + 2] = view.getUint8(lastPalOffset + i * 3 + 2);
          globalPalette[i * 4 + 3] = i === 0 ? 0 : 255;
      }
  }

  // Collect all unique palettes
  const sffPalettes: SffPalette[] = [];
  if (globalPalette) {
      sffPalettes.push({ group: 1, item: 1, data: globalPalette });
  }

  // Also collect palettes from images that have them and are NOT shared
  images.forEach(img => {
      if (!img.isSharedPalette && img.palette) {
          // Check if we already have this exact palette data
          const existing = sffPalettes.find(p => 
              p.data.length === img.palette!.length && 
              p.data.every((v, i) => v === img.palette![i])
          );
          
          if (!existing) {
              sffPalettes.push({ group: img.group, item: img.image, data: img.palette });
          }
      }
  });

  // Fallback global palette for rendering sprites that marked themselves as shared but didn't find a global pal
  if (!globalPalette && sffPalettes.length > 0) {
      globalPalette = sffPalettes[0].data;
  }

  // Assign the global palette to images that need it
  const finalImages = images.map(img => {
      if (img.isSharedPalette && (!img.palette || img.palette === globalPalette) && globalPalette) {
          return { ...img, palette: globalPalette };
      }
      return img;
  });

  return {
    version: v1version,
    numGroups,
    numImages,
    images: finalImages,
    isV2: false,
    palettes: sffPalettes
  };
}

function parseSffV2(buffer: ArrayBuffer, view: DataView): SffData {
    const ldataOffset = view.getUint32(52, true);
    const tdataOffset = view.getUint32(60, true);
    
    const spriteNodeOffset = view.getUint32(36, true);
    const numSpriteNodes = view.getUint32(40, true);
    const palNodeOffset = view.getUint32(44, true);
    const numPalNodes = view.getUint32(48, true);
    
    const versionBytes = [view.getUint8(15), view.getUint8(14), view.getUint8(13), view.getUint8(12)];
    const isV200 = versionBytes[2] === 0;
    
    const images: SffImage[] = [];
    
    const palettes: SffPalette[] = [];
    
    // Parse Palette Nodes
    if (numPalNodes > 0 && palNodeOffset < view.byteLength) {
        for (let i = 0; i < numPalNodes; i++) {
            const nodeOff = palNodeOffset + (i * 16);
            if (nodeOff + 16 > view.byteLength) break;
            
            const pGroup = view.getUint16(nodeOff, true);
            const pItem = view.getUint16(nodeOff + 2, true);
            const pOffsetRel = view.getUint32(nodeOff + 8, true);
            const pSize = view.getUint32(nodeOff + 12, true);
            const pOffset = ldataOffset + pOffsetRel;

            if ((pSize === 1024 || pSize === 768) && pOffset + pSize <= view.byteLength) {
                const rawPal = new Uint8Array(buffer, pOffset, pSize);
                const paletteData = new Uint8Array(1024);
                const bytesPerColor = pSize / 256;

                for (let j = 0; j < 256; j++) {
                    paletteData[j * 4] = rawPal[j * bytesPerColor];
                    paletteData[j * 4 + 1] = rawPal[j * bytesPerColor + 1];
                    paletteData[j * 4 + 2] = rawPal[j * bytesPerColor + 2];
                    if (pSize === 768 || isV200) {
                        paletteData[j * 4 + 3] = j === 0 ? 0 : 255;
                    } else {
                        paletteData[j * 4 + 3] = rawPal[j * 4 + 3];
                    }
                }
                palettes.push({
                    group: pGroup,
                    item: pItem,
                    data: paletteData
                });
            }
        }
    }

    let defaultPalette = palettes.length > 0 ? palettes[0].data : undefined;

    // In SFFv2, sprite node is 28 bytes
    let currentOffset = spriteNodeOffset;
    for (let i = 0; i < numSpriteNodes; i++) {
        if (currentOffset + 28 > view.byteLength) break;
        
        const group = view.getUint16(currentOffset, true);
        const image = view.getUint16(currentOffset + 2, true);
        const width = view.getUint16(currentOffset + 4, true);
        const height = view.getUint16(currentOffset + 6, true);
        const axisX = view.getInt16(currentOffset + 8, true);
        const axisY = view.getInt16(currentOffset + 10, true);
        const linkIndex = view.getUint16(currentOffset + 12, true);
        const fmt = view.getUint8(currentOffset + 14);
        const dataOffsetRel = view.getUint32(currentOffset + 16, true);
        const dataSize = view.getUint32(currentOffset + 20, true);
        const palIndex = view.getUint16(currentOffset + 24, true);
        const flags = view.getUint16(currentOffset + 26, true);
        
        const dataOffset = dataOffsetRel + ((flags & 1) === 0 ? ldataOffset : tdataOffset);
        
        let formatStr = "Unknown";
        let isCompressed = true;
        if (fmt === 0) formatStr = "Raw";
        else if (fmt === 1) formatStr = "Invalid";
        else if (fmt === 2) formatStr = "RLE8";
        else if (fmt === 3) formatStr = "RLE5";
        else if (fmt === 4) formatStr = "LZ5";

        let pixelIndices = new Uint8Array();
        
        if (fmt === 0 && dataSize === width * height && dataOffset + dataSize <= view.byteLength) {
            pixelIndices = new Uint8Array(buffer, dataOffset, dataSize);
            isCompressed = false;
        } else if (dataSize > 4 && dataOffset + dataSize <= view.byteLength) {
            const rawData = new Uint8Array(buffer, dataOffset + 4, dataSize - 4);
            try {
                if (fmt === 2) {
                    pixelIndices = decodeRle8(rawData, width, height);
                    isCompressed = false;
                } else if (fmt === 3) {
                    pixelIndices = decodeRle5(rawData, width, height);
                    isCompressed = false;
                } else if (fmt === 4) {
                    pixelIndices = decodeLz5(rawData, width, height);
                    isCompressed = false;
                }
            } catch(e) {
                console.warn(`Failed to decompress sprite ${group},${image}: FMT ${fmt}`, e);
            }
        } else if (dataSize === 0 && linkIndex !== 0xFFFF && images[linkIndex]) {
            formatStr = "Linked";
            isCompressed = false;
            // The renderer will handle linkIndex if needed, or we just copy data
            const source = images[linkIndex];
            pixelIndices = source.pixelIndices;
        }

        images.push({
            group,
            image,
            xOffset: axisX,
            yOffset: axisY,
            width,
            height,
            pixelIndices,
            isSharedPalette: true,
            comment: "",
            palette: palettes[palIndex]?.data || defaultPalette,
            isCompressed,
            format: formatStr
        });

        currentOffset += 28;
    }

    return {
        version: "2.0",
        numGroups: 0,
        numImages: numSpriteNodes,
        images,
        isV2: true,
        palettes
    };
}

/**
 * Minimal PCX RLE Decoder for MUGEN 8-bit sprites.
 */
function decodePcx(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  
  // PCX Header is 128 bytes
  // Byte 8,9: Xmin, 10,11: Ymin, 12,13: Xmax, 14,15: Ymax
  const xMin = view.getUint16(4, true);
  const yMin = view.getUint16(6, true);
  const xMax = view.getUint16(8, true);
  const yMax = view.getUint16(10, true);

  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  const bytesPerLine = view.getUint16(66, true);

  const expectedPixels = bytesPerLine * height;
  const pixelIndices = new Uint8Array(width * height);

  let offset = 128; // Start after 128-byte header
  let pixelPointer = 0;

  // Run-Length Encoding 
  for (let y = 0; y < height; y++) {
    let linePointer = 0;
    while (linePointer < bytesPerLine && offset < buffer.length) {
      const byte = buffer[offset++];
      // If the top two bits are 1 (0xC0), it's a run-length marker
      if ((byte & 0xC0) === 0xC0) {
        const count = byte & 0x3F;
        const colorIndex = buffer[offset++];
        for (let i = 0; i < count; i++) {
          if (linePointer < width) {
            pixelIndices[pixelPointer++] = colorIndex;
          }
          linePointer++;
        }
      } else {
        if (linePointer < width) {
          pixelIndices[pixelPointer++] = byte;
        }
        linePointer++;
      }
    }
  }

  let embeddedPalette: Uint8Array | null = null;
  // If the buffer has exactly a 768 byte palette ending preceded by 0x0C (12)
  if (buffer.length > 769 && buffer[buffer.length - 769] === 12) {
      embeddedPalette = new Uint8Array(1024); // Map to RGBA format 256 * 4
      let palOffset = buffer.length - 768;
      for (let i = 0; i < 256; i++) {
          embeddedPalette[i * 4] = buffer[palOffset + i * 3];       // R
          embeddedPalette[i * 4 + 1] = buffer[palOffset + i * 3 + 1]; // G
          embeddedPalette[i * 4 + 2] = buffer[palOffset + i * 3 + 2]; // B
          // Alpha mapping: index 0 is transparent (or background) in standard palettes.
          embeddedPalette[i * 4 + 3] = i === 0 ? 0 : 255; 
      }
  }

  return { width, height, pixelIndices, embeddedPalette };
}

/**
 * Helper to specifically extract 9000:0 and 9000:1 Portrait templates
 */
export function extractPortraits(sffData: SffData) {
    // SFF portraits:
    // 9000, 0: 25x25 Small select icon
    // 9000, 1: 120x140 Large versus screen portrait
    const smallPortrait = sffData.images.find(img => img.group === 9000 && img.image === 0);
    const largePortrait = sffData.images.find(img => img.group === 9000 && img.image === 1);
    
    return { smallPortrait, largePortrait };
}

function decodeRle8(rle: Uint8Array, width: number, height: number): Uint8Array {
	if (rle.length === 0) return rle;
	const p = new Uint8Array(width * height);
	let i = 0, j = 0;
	while (j < p.length && i < rle.length) {
		let n = 1;
		let d = rle[i++];
		if ((d & 0xc0) === 0x40) {
			n = d & 0x3f;
			if (i < rle.length) {
				d = rle[i++];
			}
		}
		for (; n > 0; n--) {
			if (j < p.length) {
				p[j++] = d;
			}
		}
	}
	return p;
}

function decodeRle5(rle: Uint8Array, width: number, height: number): Uint8Array {
	if (rle.length === 0) return rle;
	const p = new Uint8Array(width * height);
	let i = 0, j = 0;
	while (j < p.length && i < rle.length) {
		let rl = rle[i++];
		if (i >= rle.length) break;
		let dl = rle[i] & 0x7f;
		let c = 0;
		if ((rle[i] >> 7) !== 0) {
			i++;
			if (i >= rle.length) break;
			c = rle[i];
		}
		i++;
		while (true) {
			if (j < p.length) {
				p[j++] = c;
			}
			rl--;
			if (rl < 0) {
				dl--;
				if (dl < 0) break;
				if (i >= rle.length) break;
				c = rle[i] & 0x1f;
				rl = rle[i] >> 5;
				i++;
			}
		}
	}
	return p;
}

function decodeLz5(rle: Uint8Array, width: number, height: number): Uint8Array {
	if (rle.length === 0) return rle;
	const p = new Uint8Array(width * height);
	let i = 0, j = 0, n = 0;
	let ct = rle[i], cts = 0, rb = 0, rbc = 0;
	i++;
    
	while (j < p.length && i < rle.length) {
		let d = rle[i++];
		if ((ct & (1 << cts)) !== 0) {
			if ((d & 0x3f) === 0) {
				if (i >= rle.length) break;
				d = ((d << 2) | rle[i]) + 1;
				i++;
				if (i >= rle.length) break;
				n = rle[i] + 2;
				i++;
			} else {
				rb |= ((d & 0xc0) >> rbc);
				rbc += 2;
				n = d & 0x3f;
				if (rbc < 8) {
					if (i >= rle.length) break;
					d = rle[i] + 1;
					i++;
				} else {
					d = rb + 1;
					rb = 0;
					rbc = 0;
				}
			}
			while (true) {
				if (j < p.length) {
					if (j - d >= 0) {
						p[j] = p[j - d];
					}
					j++;
				}
				n--;
				if (n < 0) {
					break;
				}
			}
		} else {
			if ((d & 0xe0) === 0) {
				if (i >= rle.length) break;
				n = rle[i] + 8;
				i++;
			} else {
				n = d >> 5;
				d &= 0x1f;
			}
			for (; n > 0; n--) {
				if (j < p.length) {
					p[j++] = d;
				}
			}
		}
		cts++;
		if (cts >= 8) {
			if (i >= rle.length) break;
			ct = rle[i];
			cts = 0;
			i++;
		}
	}
	return p;
}
