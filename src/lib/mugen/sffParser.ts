/**
 * Binary parser for SFF files.
 * Covers SFFv1 (ElecbyteSpr standard 512-byte header, followed by Subfile Nodes)
 * Decoding PCX RLE pixel blobs.
 */
import { SffData, SffImage, SffPalette } from "./types";

export function parseSffBinary(buffer: ArrayBuffer): SffData {
  if (!buffer || buffer.byteLength < 28) {
    throw new Error("Invalid SFF file: File is too small to contain an SFF header.");
  }

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
  const visitedOffsets = new Set<number>();

  // 4. Traverse Linked List of Subfiles (each node header is 32 bytes)
  while (
    currentOffset > 0 &&
    currentOffset + 32 <= view.byteLength &&
    parsedCount < numImages &&
    !visitedOffsets.has(currentOffset)
  ) {
    visitedOffsets.add(currentOffset);

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
        const availableBytes = Math.max(0, view.byteLength - pcxOffset);
        const safeLength = Math.min(subfileLength, availableBytes);
        const pcxData = new Uint8Array(buffer, pcxOffset, safeLength);
        const subfileEnd = pcxOffset + safeLength;
        if (subfileEnd > lastSubfileEnd) {
            lastSubfileEnd = subfileEnd;
        }
        
        if (safeLength === 0) {
            images.push({
                group, image, xOffset, yOffset, width: 0, height: 0,
                pixelIndices: new Uint8Array(),
                isSharedPalette, comment, format: "PCX (Empty)", isCompressed: false
            });
        } else {
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
    }

    parsedCount++;
    currentOffset = nextNodeOffset;
    if (nextNodeOffset === 0) break;
  }

  let globalPalette: Uint8Array | undefined;
  // SFF v1 global palette is 768 bytes at the VERY end, IF it exists.
  // It only exists if there are 768 bytes left after the last subfile and is not all-zero padding.
  if (view.byteLength >= lastSubfileEnd + 768) {
      const lastPalOffset = view.byteLength - 768;
      let hasNonZeroRgb = false;
      const candidate = new Uint8Array(1024);
      for (let i = 0; i < 256; i++) {
          const r = view.getUint8(lastPalOffset + i * 3);
          const g = view.getUint8(lastPalOffset + i * 3 + 1);
          const b = view.getUint8(lastPalOffset + i * 3 + 2);
          if (r !== 0 || g !== 0 || b !== 0) hasNonZeroRgb = true;
          candidate[i * 4] = r;
          candidate[i * 4 + 1] = g;
          candidate[i * 4 + 2] = b;
          candidate[i * 4 + 3] = i === 0 ? 0 : 255;
      }
      if (hasNonZeroRgb) {
          globalPalette = candidate;
      }
  }

  const palettesEqual = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((v, idx) => v === b[idx]);

  // Collect all unique palettes
  const sffPalettes: SffPalette[] = [];
  if (globalPalette) {
    sffPalettes.push({ group: 1, item: 1, data: globalPalette });
  }

  // Collect palettes from sprites that carry their own palette (!isSharedPalette)
  images.forEach(img => {
    if (!img.isSharedPalette && img.palette) {
      const existingBody = sffPalettes.find(p => p.group < 7000 && palettesEqual(p.data, img.palette!));
      const existingAny = sffPalettes.find(p => palettesEqual(p.data, img.palette!));

      if (img.group < 7000) {
        if (!sffPalettes.some(p => p.group === 1 && p.item === 1)) {
          if (existingAny && existingAny.group === 9000 && existingAny.item === 0) {
            // In WinMUGEN SFFv1, 9000,0 often shares the character's primary body palette.
            existingAny.group = 1;
            existingAny.item = 1;
          } else if (!existingBody) {
            sffPalettes.push({ group: 1, item: 1, data: img.palette });
          }
        } else if (!existingBody) {
          sffPalettes.push({ group: img.group, item: img.image, data: img.palette });
        }
      } else if (!existingAny) {
        sffPalettes.push({ group: img.group, item: img.image, data: img.palette });
      }
    }
  });

  // If no body palette was tagged as (1,1) yet (e.g. 9000,0 holds the shared palette and 0,0 is flagged shared),
  // promote the first body embedded palette or 9000,0 palette rather than 9000,1 portrait palettes.
  if (!sffPalettes.some(p => p.group === 1 && p.item === 1)) {
    const firstBodyEmbedded = images.find(img => img.group < 7000 && img.palette);
    const smallPortraitPal = sffPalettes.find(p => p.group === 9000 && p.item === 0);
    if (firstBodyEmbedded?.palette) {
      sffPalettes.unshift({ group: 1, item: 1, data: firstBodyEmbedded.palette });
    } else if (smallPortraitPal) {
      smallPortraitPal.group = 1;
      smallPortraitPal.item = 1;
    } else {
      const firstEmbedded = images.find(img => img.palette);
      if (firstEmbedded?.palette) {
        sffPalettes.unshift({ group: 1, item: 1, data: firstEmbedded.palette });
      }
    }
  }

  // Always order body palettes (group < 7000, with 1,1 first) ahead of portrait/FX palettes (group >= 7000)
  sffPalettes.sort((a, b) => {
    const aIsPortrait = a.group >= 7000 ? 1 : 0;
    const bIsPortrait = b.group >= 7000 ? 1 : 0;
    if (aIsPortrait !== bIsPortrait) return aIsPortrait - bIsPortrait;
    return (a.group - b.group) || (a.item - b.item);
  });

  const primaryBodyPalette =
    sffPalettes.find(p => p.group === 1 && p.item === 1)?.data ||
    sffPalettes.find(p => p.group < 7000)?.data ||
    sffPalettes[0]?.data;

  if (!globalPalette && primaryBodyPalette) {
    globalPalette = primaryBodyPalette;
  }

  // Propagate palettes cleanly in subfile order without letting 9000,1 portrait palettes poison shared body sprites
  let lastBodyPal: Uint8Array | undefined = primaryBodyPalette || globalPalette;
  let runningPal: Uint8Array | undefined = lastBodyPal;
  const finalImages = images.map(img => {
    if (!img.isSharedPalette && img.palette) {
      runningPal = img.palette;
      if (img.group < 7000) {
        lastBodyPal = img.palette;
      }
      return img;
    }

    const inherited =
      img.group < 7000
        ? (lastBodyPal || globalPalette || runningPal || img.palette)
        : (runningPal || lastBodyPal || globalPalette || img.palette);

    if (inherited) {
      return { ...img, palette: inherited };
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
    if (view.byteLength < 64) {
        throw new Error("Invalid SFFv2 file: File is smaller than 64-byte SFFv2 header.");
    }
    const ldataOffset = view.getUint32(52, true);
    const tdataOffset = view.getUint32(60, true);
    
    const spriteNodeOffset = view.getUint32(36, true);
    const numSpriteNodes = view.getUint32(40, true);
    const palNodeOffset = view.getUint32(44, true);
    const numPalNodes = view.getUint32(48, true);
    
    const versionBytes = [view.getUint8(15), view.getUint8(14), view.getUint8(13), view.getUint8(12)];
    const isV200 = versionBytes[2] === 0;
    
    const images: SffImage[] = [];
    
    const rawPalettes: { group: number; item: number; data: Uint8Array; valid: boolean }[] = [];

    // Parse ALL Palette Nodes in exact table order so palIndex aligns 1:1
    if (numPalNodes > 0 && palNodeOffset < view.byteLength) {
        for (let i = 0; i < numPalNodes; i++) {
            const nodeOff = palNodeOffset + (i * 16);
            if (nodeOff + 16 > view.byteLength) break;

            const pGroup = view.getUint16(nodeOff, true);
            const pItem = view.getUint16(nodeOff + 2, true);
            const pNumCols = view.getUint16(nodeOff + 4, true);
            const pLinkIndex = view.getUint16(nodeOff + 6, true);
            const pOffsetRel = view.getUint32(nodeOff + 8, true);
            const pSize = view.getUint32(nodeOff + 12, true);
            const pOffset = ldataOffset + pOffsetRel;

            if (pSize === 0) {
                const linkedData = rawPalettes[pLinkIndex]?.data
                    ? new Uint8Array(rawPalettes[pLinkIndex].data)
                    : new Uint8Array(1024);
                rawPalettes.push({
                    group: pGroup,
                    item: pItem,
                    data: linkedData,
                    valid: Boolean(rawPalettes[pLinkIndex]?.valid),
                });
            } else if (pSize >= 3 && pOffset + pSize <= view.byteLength) {
                const rawPal = new Uint8Array(buffer, pOffset, pSize);
                const paletteData = new Uint8Array(1024);
                const guessedCols4 = Math.floor(pSize / 4);
                const guessedCols3 = Math.floor(pSize / 3);
                let bytesPerColor = 4;
                if (pNumCols > 0 && pSize === pNumCols * 3) {
                    bytesPerColor = 3;
                } else if (pNumCols > 0 && pSize === pNumCols * 4) {
                    bytesPerColor = 4;
                } else if (pSize === 768 || (guessedCols4 === 0 && guessedCols3 > 0)) {
                    bytesPerColor = 3;
                }
                const colCount = Math.min(
                    256,
                    pNumCols > 0 ? pNumCols : Math.floor(pSize / bytesPerColor)
                );

                let hasAnyNonZeroAlpha = false;
                if (bytesPerColor === 4 && !isV200) {
                    for (let j = 1; j < colCount; j++) {
                        if (rawPal[j * 4 + 3] > 0) {
                            hasAnyNonZeroAlpha = true;
                            break;
                        }
                    }
                }

                for (let j = 0; j < colCount; j++) {
                    paletteData[j * 4] = rawPal[j * bytesPerColor];
                    paletteData[j * 4 + 1] = rawPal[j * bytesPerColor + 1];
                    paletteData[j * 4 + 2] = rawPal[j * bytesPerColor + 2];
                    if (j === 0) {
                        paletteData[3] = 0;
                    } else if (bytesPerColor === 3 || isV200 || !hasAnyNonZeroAlpha) {
                        paletteData[j * 4 + 3] = 255;
                    } else {
                        paletteData[j * 4 + 3] = rawPal[j * 4 + 3];
                    }
                }
                rawPalettes.push({
                    group: pGroup,
                    item: pItem,
                    data: paletteData,
                    valid: colCount > 0,
                });
            } else {
                rawPalettes.push({
                    group: pGroup,
                    item: pItem,
                    data: new Uint8Array(1024),
                    valid: false,
                });
            }
        }
    }

    const validPalettes: SffPalette[] = rawPalettes
        .filter(p => p.valid)
        .map(({ group, item, data }) => ({ group, item, data }));

    const defaultPalette =
        validPalettes.find(p => p.group === 1 && p.item === 1)?.data ||
        validPalettes.find(p => p.group < 7000)?.data ||
        validPalettes[0]?.data;

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
        let linkedPalette: Uint8Array | undefined;

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
            const source = images[linkIndex];
            pixelIndices = source.pixelIndices;
            linkedPalette = source.palette;
        }

        const indexedPalEntry = palIndex < rawPalettes.length && rawPalettes[palIndex].valid
            ? rawPalettes[palIndex]
            : undefined;
        const resolvedSpritePal = indexedPalEntry?.data || linkedPalette || defaultPalette;
        const isShared = indexedPalEntry
            ? indexedPalEntry.group < 7000
            : group < 7000;

        images.push({
            group,
            image,
            xOffset: axisX,
            yOffset: axisY,
            width,
            height,
            pixelIndices,
            isSharedPalette: isShared,
            comment: "",
            palette: resolvedSpritePal,
            isCompressed,
            format: formatStr
        });

        currentOffset += 28;
    }

    // Order exported palettes with body palettes (< 7000) ahead of portrait/FX palettes (>= 7000)
    const palettes = [...validPalettes].sort((a, b) => {
        const aPort = a.group >= 7000 ? 1 : 0;
        const bPort = b.group >= 7000 ? 1 : 0;
        if (aPort !== bPort) return aPort - bPort;
        return (a.group - b.group) || (a.item - b.item);
    });

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
  if (buffer.length < 128) {
    return { width: 0, height: 0, pixelIndices: new Uint8Array(0), embeddedPalette: null as Uint8Array | null };
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  
  // PCX Header is 128 bytes
  // Byte 4..11: Xmin, Ymin, Xmax, Ymax
  const xMin = view.getUint16(4, true);
  const yMin = view.getUint16(6, true);
  const xMax = view.getUint16(8, true);
  const yMax = view.getUint16(10, true);

  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  const bytesPerLine = view.getUint16(66, true);

  if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
    return { width: 0, height: 0, pixelIndices: new Uint8Array(0), embeddedPalette: null as Uint8Array | null };
  }

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
        if (offset >= buffer.length) break;
        const colorIndex = buffer[offset++];
        for (let i = 0; i < count; i++) {
          if (linePointer < width && pixelPointer < pixelIndices.length) {
            pixelIndices[pixelPointer++] = colorIndex;
          }
          linePointer++;
        }
      } else {
        if (linePointer < width && pixelPointer < pixelIndices.length) {
          pixelIndices[pixelPointer++] = byte;
        }
        linePointer++;
      }
    }
  }

  let embeddedPalette: Uint8Array | null = null;
  // A 256-color PCX 768-byte palette only exists after the RLE stream completes, preceded by marker 0x0C (12).
  if (buffer.length >= 128 + 769 && offset <= buffer.length - 769 && buffer[buffer.length - 769] === 12) {
      embeddedPalette = new Uint8Array(1024); // Map to RGBA format 256 * 4
      const palOffset = buffer.length - 768;
      for (let i = 0; i < 256; i++) {
          embeddedPalette[i * 4] = buffer[palOffset + i * 3];         // R
          embeddedPalette[i * 4 + 1] = buffer[palOffset + i * 3 + 1]; // G
          embeddedPalette[i * 4 + 2] = buffer[palOffset + i * 3 + 2]; // B
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
