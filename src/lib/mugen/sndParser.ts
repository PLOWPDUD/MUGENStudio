// MUGEN .snd format parser and builder

export interface SndSound {
  id: string; // Unique transient UI ID
  group: number;
  sample: number;
  data: Uint8Array; // Original Audio (usually WAV file)
  format: string; // wav, mp3, ogg etc
  name?: string;
  blobUrl?: string; // Cache for browser playback
}

export interface SndData {
  version: string;
  sounds: SndSound[];
}

/**
 * Parses a MUGEN .snd file buffer
 */
export function parseSndBinary(buffer: ArrayBuffer): SndData {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  // Verify signature
  const signatureBytes = bytes.slice(0, 12);
  const signature = new TextDecoder("utf-8").decode(signatureBytes).replace(/\0/g, "");
  if (signature !== "ElecbyteSnd" && signature !== "ElecbyteSnd\r") {
    // If not a valid header but maybe we can parse it fallback or throw
    throw new Error("Invalid .snd file format: ElecbyteSnd magic tag not found");
  }
  
  // Read version: typically stored in bytes 12-15 as indices (high to low)
  const v1 = view.getUint8(12);
  const v2 = view.getUint8(13);
  const v3 = view.getUint8(14);
  const v4 = view.getUint8(15);
  const version = `${v4}.${v3}.${v2}.${v1}`; // e.g., "1.0.0.0"
  
  const numSounds = view.getUint32(16, true);
  let subheaderOffset = view.getUint32(20, true);
  
  const sounds: SndSound[] = [];
  
  let count = 0;
  while (subheaderOffset > 0 && subheaderOffset < buffer.byteLength) {
    if (subheaderOffset + 16 > buffer.byteLength) {
      break;
    }
    
    const nextOffset = view.getUint32(subheaderOffset, true);
    const soundLen = view.getUint32(subheaderOffset + 4, true);
    const group = view.getUint32(subheaderOffset + 8, true);
    const sample = view.getUint32(subheaderOffset + 12, true);
    
    const dataStart = subheaderOffset + 16;
    if (dataStart + soundLen > buffer.byteLength) {
      break;
    }
    
    const soundData = bytes.slice(dataStart, dataStart + soundLen);
    
    // Create transient id
    const id = `snd-${group}-${sample}-${Math.random().toString(36).substr(2, 9)}`;
    
    sounds.push({
      id,
      group,
      sample,
      data: soundData,
      format: "wav",
      name: `sound_${group}_${sample}`
    });
    
    count++;
    if (nextOffset === 0 || nextOffset <= subheaderOffset) {
      break;
    }
    subheaderOffset = nextOffset;
  }
  
  return {
    version,
    sounds
  };
}

/**
 * Packages a list of SndSound into a binary MUGEN .snd ArrayBuffer
 */
export function buildSndBinary(sounds: SndSound[]): ArrayBuffer {
  // Sort sounds first by group, then by sample index
  const sortedSounds = [...sounds].sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    return a.sample - b.sample;
  });
  
  // Calculate total buffer size
  // Header: 512 bytes is standard or 24 bytes minimum. Let's write the 512-byte header
  const headerSize = 512;
  let currentOffset = headerSize;
  
  // Each sound subheader is 16 bytes:
  // - 4 bytes: next subheader offset
  // - 4 bytes: sound size
  // - 4 bytes: group
  // - 4 bytes: sample
  // followed by sound data
  
  const soundLayouts = sortedSounds.map((snd, idx) => {
    const subheaderPos = currentOffset;
    const dataPos = subheaderPos + 16;
    const len = snd.data.length;
    
    const nextSubheaderPos = idx === sortedSounds.length - 1 ? 0 : dataPos + len;
    currentOffset = dataPos + len;
    
    return {
      snd,
      subheaderPos,
      nextSubheaderPos,
      len
    };
  });
  
  const finalBuffer = new ArrayBuffer(currentOffset);
  const finalBytes = new Uint8Array(finalBuffer);
  const finalView = new DataView(finalBuffer);
  
  // 1. Write Header
  const sig = "ElecbyteSnd\0";
  const encoder = new TextEncoder();
  const sigBytes = encoder.encode(sig);
  finalBytes.set(sigBytes, 0);
  
  // Version: v1.0.0.0
  finalView.setUint8(12, 0);
  finalView.setUint8(13, 0);
  finalView.setUint8(14, 0);
  finalView.setUint8(15, 1);
  
  // Number of sounds
  finalView.setUint32(16, sortedSounds.length, true);
  
  // First subheader offset
  const firstSubheaderOffset = sortedSounds.length > 0 ? headerSize : 0;
  finalView.setUint32(20, firstSubheaderOffset, true);
  
  // 2. Write Sounds
  soundLayouts.forEach((layout) => {
    const { subheaderPos, nextSubheaderPos, len, snd } = layout;
    
    finalView.setUint32(subheaderPos, nextSubheaderPos, true);
    finalView.setUint32(subheaderPos + 4, len, true);
    finalView.setUint32(subheaderPos + 8, snd.group, true);
    finalView.setUint32(subheaderPos + 12, snd.sample, true);
    
    finalBytes.set(snd.data, subheaderPos + 16);
  });
  
  return finalBuffer;
}
