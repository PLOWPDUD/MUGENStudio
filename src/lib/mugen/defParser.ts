/**
 * Parses INI-style MUGEN text files (.def, .cns, .cmd).
 * Maps groups like [Info] or [StateDef 0] to properties and key-value pairs.
 */
export function parseIniString(data: string) {
  const result: Record<string, Record<string, string>> = {};
  let currentGroup = "Global";

  result[currentGroup] = {};

  const lines = data.split(/\r?\n/);
  const groupCount: Record<string, number> = {};
  const keyCount: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Ignore comments (MUGEN uses ';' for comments)
    const commentIdx = line.indexOf(';');
    if (commentIdx !== -1) {
      line = line.substring(0, commentIdx).trim();
    }
    
    if (!line) continue;

    // Check for [Group]
    let groupMatch = line.match(/^\[(.*)\]$/);
    if (groupMatch) {
      const baseGroup = groupMatch[1].trim();
      groupCount[baseGroup] = (groupCount[baseGroup] || 0) + 1;
      
      // Assign structured unique key name to group to display in explorer
      currentGroup = `${baseGroup} ##${groupCount[baseGroup]}`;
      if (!result[currentGroup]) {
        result[currentGroup] = {};
      }
      continue;
    }

    // Check for key = value or key = "value"
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const origKey = line.substring(0, eqIdx).trim().toLowerCase();
      let value = line.substring(eqIdx + 1).trim();
      
      // Create a unique key on state to prevent duplicate keys from overwriting each other (e.g., trigger1)
      const keyPath = `${currentGroup}::${origKey}`;
      keyCount[keyPath] = (keyCount[keyPath] || 0) + 1;
      const key = `${origKey} ##${keyCount[keyPath]}`;
      
      // Remove encapsulating quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      
      result[currentGroup][key] = value;
    }
  }

  // Cleanup Global if empty
  if (result["Global"] && Object.keys(result["Global"]).length === 0) {
    delete result["Global"];
  }

  return result;
}

/**
 * Stringifies parsed INI data back into MUGEN standardized text format.
 */
export function stringifyIni(data: Record<string, Record<string, string>>): string {
  let output = "";
  for (const group in data) {
    if (group !== "Global") {
      const cleanGroup = group.replace(/\s*##\d+$/, '');
      output += `\n[${cleanGroup}]\n`;
    }
    for (const key in data[group]) {
      const cleanKey = key.replace(/\s*##\d+$/, '');
      output += `${cleanKey} = ${data[group][key]}\n`;
    }
  }
  return output.trim();
}

/**
 * Strips the parser's deduplication suffix (e.g. "Info ##1" -> "Info").
 */
export function stripIniSuffix(name: string): string {
  return name.replace(/\s*##\d+$/, '');
}

/**
 * Reads a key from a single parsed INI section object (ignoring ##N suffixes, case-insensitive).
 */
export function getSectionKeyValue(
  sectionObj: Record<string, string> | null | undefined,
  keyName: string
): string {
  if (!sectionObj) return "";
  const target = keyName.toLowerCase();
  for (const [k, v] of Object.entries(sectionObj)) {
    if (stripIniSuffix(k).toLowerCase() === target) {
      return v ?? "";
    }
  }
  return "";
}

/**
 * Reads a field from parsed INI data by section name and key name (ignoring ##N suffixes, case-insensitive).
 */
export function getIniField(
  data: Record<string, Record<string, string>> | null | undefined,
  sectionName: string,
  keyName: string
): string {
  if (!data) return "";
  const targetSection = sectionName.toLowerCase();
  for (const [sec, fields] of Object.entries(data)) {
    if (stripIniSuffix(sec).toLowerCase() === targetSection) {
      const val = getSectionKeyValue(fields, keyName);
      if (val !== undefined && val !== "") return val;
    }
  }
  return "";
}

/**
 * Updates or inserts a key inside a specific [Section] of raw INI/DEF text while preserving comments and formatting.
 */
export function updateIniTextField(
  rawText: string,
  sectionName: string,
  keyName: string,
  value: string,
  preferQuoted: boolean = false
): string {
  const lines = rawText.split(/\r?\n/);
  const targetSec = sectionName.toLowerCase();
  const targetKey = keyName.toLowerCase();

  let secStartIdx = -1;
  let secEndIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const semiIdx = lines[i].indexOf(';');
    const code = (semiIdx !== -1 ? lines[i].slice(0, semiIdx) : lines[i]).trim();
    const headerMatch = code.match(/^\[(.*)\]$/);
    if (headerMatch) {
      const headerName = headerMatch[1].trim().toLowerCase();
      if (secStartIdx === -1) {
        if (headerName === targetSec) {
          secStartIdx = i;
        }
      } else {
        secEndIdx = i;
        break;
      }
    }
  }

  const formatVal = (wasQuoted: boolean) => {
    const clean = value.replace(/^"(.*)"$/, '$1');
    if (wasQuoted || preferQuoted) {
      return `"${clean}"`;
    }
    return clean;
  };

  if (secStartIdx !== -1) {
    let lastNonEmptyInSec = secStartIdx;
    for (let i = secStartIdx + 1; i < secEndIdx; i++) {
      const rawLine = lines[i];
      const semiIdx = rawLine.indexOf(';');
      const code = semiIdx !== -1 ? rawLine.slice(0, semiIdx) : rawLine;
      const commentSuffix = semiIdx !== -1 ? rawLine.slice(semiIdx) : '';
      if (code.trim()) {
        lastNonEmptyInSec = i;
      }

      const eqIdx = code.indexOf('=');
      if (eqIdx !== -1) {
        const k = code.slice(0, eqIdx).trim().toLowerCase();
        if (k === targetKey) {
          const leftSide = code.slice(0, eqIdx + 1);
          const origValTrimmed = code.slice(eqIdx + 1).trim();
          const wasQuoted = origValTrimmed.startsWith('"') && origValTrimmed.endsWith('"');
          const nextVal = formatVal(wasQuoted);
          if (commentSuffix) {
            lines[i] = `${leftSide} ${nextVal}\t${commentSuffix}`;
          } else {
            lines[i] = `${leftSide} ${nextVal}`;
          }
          return lines.join('\n');
        }
      }
    }

    // Key doesn't exist in section yet — insert right after last non-empty line of section
    const newLine = `${keyName} = ${formatVal(false)}`;
    lines.splice(lastNonEmptyInSec + 1, 0, newLine);
    return lines.join('\n');
  }

  // Section doesn't exist — append it cleanly
  const trimmedEnd = rawText.replace(/\s+$/, '');
  const appended = `${trimmedEnd ? trimmedEnd + '\n\n' : ''}[${sectionName}]\n${keyName} = ${formatVal(false)}\n`;
  return appended;
}

export const PALETTE_KEYMAP_KEYS = [
  'x',
  'y',
  'z',
  'a',
  'b',
  'c',
  'x2',
  'y2',
  'z2',
  'a2',
  'b2',
  'c2',
] as const;

export type PaletteKeyName = (typeof PALETTE_KEYMAP_KEYS)[number];
export type PaletteKeymap = Record<PaletteKeyName, number>;

export const DEFAULT_KFM_PALETTE_KEYMAP: PaletteKeymap = {
  x: 1,
  y: 2,
  z: 3,
  a: 4,
  b: 5,
  c: 6,
  x2: 7,
  y2: 8,
  z2: 9,
  a2: 10,
  b2: 11,
  c2: 12,
};

/**
 * Parses [Palette Keymap] from a character .def INI structure,
 * falling back to standard Kung Fu Man (KFM) defaults for omitted keys.
 */
export function parsePaletteKeymap(
  data: Record<string, Record<string, string>> | null | undefined
): PaletteKeymap {
  const keymap: PaletteKeymap = { ...DEFAULT_KFM_PALETTE_KEYMAP };
  if (!data) return keymap;

  for (const [sec, fields] of Object.entries(data)) {
    if (stripIniSuffix(sec).toLowerCase() !== 'palette keymap') continue;
    for (const k of PALETTE_KEYMAP_KEYS) {
      const rawVal = getSectionKeyValue(fields, k);
      if (!rawVal) continue;
      const parsed = parseInt(rawVal.trim(), 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        keymap[k] = Math.min(12, Math.max(1, parsed));
      }
    }
  }
  return keymap;
}

/**
 * Parses [Info] pal.defaults (comma-separated 1-based palette slot numbers like "6,3,4,2").
 */
export function parsePalDefaults(
  data: Record<string, Record<string, string>> | null | undefined
): number[] {
  const raw = getIniField(data, 'Info', 'pal.defaults');
  if (!raw) return [1];
  const nums = raw
    .split(/[,\s]+/)
    .map(part => parseInt(part.trim(), 10))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= 12);
  return nums.length > 0 ? nums : [1];
}

/**
 * Extracts 1-based [Files] pal1..pal12 references normalized to lowercase slash paths.
 */
export function parseDefPalFiles(
  data: Record<string, Record<string, string>> | null | undefined
): Record<number, string> {
  const map: Record<number, string> = {};
  if (!data) return map;
  for (let slot = 1; slot <= 12; slot++) {
    const raw = getIniField(data, 'Files', `pal${slot}`);
    if (raw) {
      const cleaned = raw.trim().replace(/^"|"$/g, '').replace(/\\/g, '/').toLowerCase();
      if (cleaned) map[slot] = cleaned;
    }
  }
  return map;
}

/**
 * Resolves a 1-based MUGEN palette number (pal1..pal12) to a 0-based index in palettes[].
 * Optionally accepts body-only indices so wrap-around never falls onto group >= 7000 portrait/FX palettes.
 */
export function resolvePaletteSlotIndex(
  palNum1Based: number,
  totalPalettes: number,
  palSlotIndices?: Record<number, number>,
  fallbackIndices?: number[]
): number {
  if (totalPalettes <= 0) return 0;
  const clampedPal = Math.max(1, Math.round(palNum1Based));
  if (palSlotIndices && typeof palSlotIndices[clampedPal] === 'number') {
    const idx = palSlotIndices[clampedPal];
    if (idx >= 0 && idx < totalPalettes) return idx;
  }
  if (fallbackIndices && fallbackIndices.length > 0) {
    return fallbackIndices[(clampedPal - 1) % fallbackIndices.length];
  }
  return (clampedPal - 1) % totalPalettes;
}

/**
 * Returns the keymap button names (e.g. ['x'], ['a']) mapped to a given 0-based palette index.
 */
export function getKeymapButtonsForPaletteIndex(
  paletteIdx: number,
  keymap: PaletteKeymap,
  totalPalettes: number,
  palSlotIndices?: Record<number, number>,
  fallbackIndices?: number[]
): PaletteKeyName[] {
  const hits: PaletteKeyName[] = [];
  for (const key of PALETTE_KEYMAP_KEYS) {
    const targetIdx = resolvePaletteSlotIndex(keymap[key], totalPalettes, palSlotIndices, fallbackIndices);
    if (targetIdx === paletteIdx) {
      hits.push(key);
    }
  }
  return hits;
}


