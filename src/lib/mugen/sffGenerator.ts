import { SffData } from "./types";

export function createDummyPcx(width: number, height: number, r: number, g: number, b: number): Uint8Array {
    const pixelIndices = new Uint8Array(width * height);
    const colorIndex = 11;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                pixelIndices[y * width + x] = 0; // Transparent/Padding
            } else {
                pixelIndices[y * width + x] = colorIndex; // Main color
            }
        }
    }
    
    const palette = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
        if (i === colorIndex) {
            palette[i * 4] = r;  
            palette[i * 4 + 1] = g;
            palette[i * 4 + 2] = b;
            palette[i * 4 + 3] = 255;
        } else {
            palette[i * 4] = i; 
            palette[i * 4 + 1] = i;
            palette[i * 4 + 2] = i;
            palette[i * 4 + 3] = 255;
        }
    }
    
    return encodePcx(width, height, pixelIndices, palette);
}

export function generateTemplateSff(): Blob {
    const spritesInfo = [
        { group: 0, image: 0, w: 60, h: 90, x: 30, y: 90, r: 0, g: 255, b: 0 }     // Stance frame (green)
    ];
    
    // Being hit sprites from user request
    const hitFrames = [
        [5000, 0], [5000, 10], [5000, 20],
        [5001, 0], [5001, 10], [5001, 20],
        [5002, 0], [5002, 10], [5002, 20],
        [5010, 0], [5010, 10], [5010, 20],
        [5011, 0], [5011, 10], [5011, 20],
        [5012, 0], [5012, 10], [5012, 20],
        [5020, 0], [5020, 10], [5020, 20],
        [5030, 0], [5030, 10], [5030, 20], [5030, 30], [5030, 40], [5030, 50],
        [5031, 0], [5031, 10], [5031, 20], [5031, 30], [5031, 40], [5031, 50],
        [5032, 0], [5032, 10], [5032, 20], [5032, 30], [5032, 40], [5032, 50],
        [5040, 0], [5040, 10], [5040, 20],
        [5041, 0], [5041, 10], [5041, 20],
        [5042, 0], [5042, 10], [5042, 20],
        [5060, 0], [5060, 10],
        [5061, 0], [5061, 10],
        [5062, 0], [5062, 10],
        [5070, 0], [5070, 10], [5070, 20],
        [5071, 0], [5071, 10], [5071, 20],
        [5072, 0], [5072, 10], [5072, 20]
    ];

    for (const [g, i] of hitFrames) {
        spritesInfo.push({ group: g, image: i, w: 60, h: 90, x: 30, y: 90, r: 255, g: 165, b: 0 }); // Orange for hit frames
    }

    spritesInfo.push({ group: 9000, image: 0, w: 25, h: 25, x: 0, y: 0, r: 255, g: 0, b: 0 });   // Small portrait (red)
    spritesInfo.push({ group: 9000, image: 1, w: 120, h: 140, x: 0, y: 0, r: 0, g: 0, b: 255 }); // Large portrait (blue)

    const masterPalette = new Uint8Array(1024);
    // Initialize with some default colors for 0-255 indices
    for (let i = 0; i < 256; i++) {
        masterPalette[i * 4] = i;
        masterPalette[i * 4 + 1] = i;
        masterPalette[i * 4 + 2] = i;
        masterPalette[i * 4 + 3] = 255;
    }
    // Color index 11 is used by createDummyPcx for the "solid" parts
    masterPalette[11 * 4] = 0;
    masterPalette[11 * 4 + 1] = 255;
    masterPalette[11 * 4 + 2] = 0;
    // Transparent index 0
    masterPalette[0] = 255;
    masterPalette[1] = 0;
    masterPalette[2] = 255;
    masterPalette[3] = 0;

    const images = spritesInfo.map((info, idx) => {
        const pixelIndices = new Uint8Array(info.w * info.h);
        const colorIndex = 11;
        for (let y = 0; y < info.h; y++) {
            for (let x = 0; x < info.w; x++) {
                if (x === 0 || x === info.w - 1 || y === 0 || y === info.h - 1) {
                    pixelIndices[y * info.w + x] = 0;
                } else {
                    // Use info colors (approximate by index if we wanted to be fancy, but let's keep it simple)
                    pixelIndices[y * info.w + x] = colorIndex; 
                }
            }
        }
        return {
            group: info.group,
            image: info.image,
            xOffset: info.x,
            yOffset: info.y,
            width: info.w,
            height: info.h,
            pixelIndices,
            palette: (idx === 0) ? masterPalette : undefined,
            isSharedPalette: (idx === 0) ? false : true,
            comment: "",
            format: "PCX" as const,
            isCompressed: false
        };
    });

    const sffData: any = {
        version: "1.0",
        images,
        palettes: [{ group: 1, item: 1, data: masterPalette }],
        isV2: false
    };

    const buffer = buildSffBinary(sffData);
    return new Blob([buffer], { type: 'application/octet-stream' });
}

export function encodePcx(width: number, height: number, pixelIndices: Uint8Array, palette?: Uint8Array): Uint8Array {
    const bytesPerLine = width % 2 !== 0 ? width + 1 : width;
    const rleBytes: number[] = [];
    
    for (let y = 0; y < height; y++) {
        const row = new Uint8Array(bytesPerLine);
        for (let x = 0; x < bytesPerLine; x++) {
            if (x < width) {
                row[x] = pixelIndices[y * width + x];
            } else {
                row[x] = 0;
            }
        }
        
        let x = 0;
        while (x < bytesPerLine) {
            const val = row[x];
            let run = 1;
            while (x + run < bytesPerLine && row[x + run] === val && run < 63) {
                run++;
            }
            if (run > 1 || (val & 0xC0) === 0xC0) {
                rleBytes.push(0xC0 | run);
                rleBytes.push(val);
            } else {
                rleBytes.push(val);
            }
            x += run;
        }
    }

    const hasPalette = palette && palette.length >= 768;
    const palBufferLength = hasPalette ? 769 : 0;
    
    const buffer = new Uint8Array(128 + rleBytes.length + palBufferLength);
    const view = new DataView(buffer.buffer);
    
    buffer[0] = 10;
    buffer[1] = 5;
    buffer[2] = 1;
    buffer[3] = 8;
    
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, width - 1, true);
    view.setUint16(10, height - 1, true);
    
    view.setUint16(12, 72, true);
    view.setUint16(14, 72, true);
    
    buffer[65] = 1;
    view.setUint16(66, bytesPerLine, true);
    view.setUint16(68, 1, true);
    
    buffer.set(rleBytes, 128);
    
    if (hasPalette) {
        const palOffset = 128 + rleBytes.length;
        buffer[palOffset] = 12;
        for (let i = 0; i < 256; i++) {
            const rgbOffset = palOffset + 1 + i * 3;
            if (palette.length >= 1024) {
                buffer[rgbOffset] = palette[i * 4];
                buffer[rgbOffset + 1] = palette[i * 4 + 1];
                buffer[rgbOffset + 2] = palette[i * 4 + 2];
            } else {
                buffer[rgbOffset] = palette[i * 3];
                buffer[rgbOffset + 1] = palette[i * 3 + 1];
                buffer[rgbOffset + 2] = palette[i * 3 + 2];
            }
        }
    }
    
    return buffer;
}

export function buildSffBinary(sffData: SffData): ArrayBuffer {
    const images = sffData.images || [];
    const pcxBuffers: (Uint8Array | null)[] = [];
    
    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.format === "Linked" || !img.pixelIndices || img.pixelIndices.length === 0) {
            pcxBuffers.push(null);
        } else {
            // Encode the existing pixel indices back into PCX
            // CRITICAL FIX: If the sprite uses a shared palette, we must NOT embed the palette
            // in the subfile's PCX data! Otherwise MUGEN's decoder reads the palette bytes as run indices.
            const hasPalette = !img.isSharedPalette && img.palette;
            const pcx = encodePcx(img.width, img.height, img.pixelIndices, hasPalette ? img.palette : undefined);
            pcxBuffers.push(pcx);
        }
    }
    
    // Calculate total size
    let totalSize = 512;
    for (let i = 0; i < images.length; i++) {
        const pcx = pcxBuffers[i];
        const len = pcx ? pcx.byteLength : 0;
        totalSize += 32 + len;
    }
    
    // SFFv1: Append a 768-byte palette at the end if the first palette is available
    const paletteToAppend = sffData.palettes.length > 0 ? sffData.palettes[0].data : null;
    const hasGlobalPalette = paletteToAppend !== null;
    if (hasGlobalPalette) {
        totalSize += 768;
    }
    
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);
    
    // 1. Signature
    const encoder = new TextEncoder();
    buffer.set(encoder.encode("ElecbyteSpr"), 0);
    buffer[11] = 0;
    
    // 2. Version: Standard MUGEN SFF v1.0.1.0
    buffer[12] = 0;
    buffer[13] = 1;
    buffer[14] = 0;
    buffer[15] = 1;
    
    // 3. Stats
    // Find number of unique groups
    const groups = new Set(images.map(img => img.group));
    view.setUint32(16, groups.size, true);
    view.setUint32(20, images.length, true);
    view.setUint32(24, images.length > 0 ? 512 : 0, true);
    view.setUint32(28, 32, true);
    view.setUint32(32, 1, true); // 1 = Shared Palette Type (Standard for characters)
    
    let currentOffset = 512;
    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const pcx = pcxBuffers[i];
        const pcxLen = pcx ? pcx.byteLength : 0;
        
        const nextOffset = (i === images.length - 1) ? 0 : currentOffset + 32 + pcxLen;
        
        view.setUint32(currentOffset, nextOffset, true);
        view.setUint32(currentOffset + 4, pcxLen, true);
        view.setInt16(currentOffset + 8, img.xOffset, true);
        view.setInt16(currentOffset + 10, img.yOffset, true);
        view.setUint16(currentOffset + 12, img.group, true);
        view.setUint16(currentOffset + 14, img.image, true);
        
        // previousCopyIndex check if linked (match exact pixelIndices reference)
        let prevCopyIndex = 0;
        if (img.format === "Linked" || pcxLen === 0) {
            const matchIndex = images.findIndex((other, idx) => idx < i && other.pixelIndices === img.pixelIndices && other.format !== "Linked");
            prevCopyIndex = matchIndex >= 0 ? matchIndex : 0;
        }
        view.setUint16(currentOffset + 16, prevCopyIndex, true);
        view.setUint8(currentOffset + 18, img.isSharedPalette ? 1 : 0);
        
        // Write comment
        if (img.comment) {
            const commentBytes = encoder.encode(img.comment.slice(0, 12));
            const dstBytes = new Uint8Array(buffer.buffer, currentOffset + 19, 13);
            dstBytes.set(commentBytes);
        }
        
        if (pcx) {
            buffer.set(pcx, currentOffset + 32);
        }
        
        currentOffset = nextOffset;
    }
    
    // Write global palette at the end for SFFv1 compatibility
    if (hasGlobalPalette && paletteToAppend) {
        const palOffset = buffer.byteLength - 768;
        for (let i = 0; i < 256; i++) {
            buffer[palOffset + i * 3] = paletteToAppend[i * 4];
            buffer[palOffset + i * 3 + 1] = paletteToAppend[i * 4 + 1];
            buffer[palOffset + i * 3 + 2] = paletteToAppend[i * 4 + 2];
        }
    }
    
    return buffer.buffer;
}

