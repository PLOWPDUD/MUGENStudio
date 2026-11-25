import JSZip from 'jszip';
import { applyPalette, detectAndFixUpsideDownPalette, parseActBinary } from './actParser';
import { parseAirString } from './airParser';
import {
  palettesAreSame,
  parseCmdAndStates,
  ParsedCharacterMoveset,
  TextFileLike,
} from './combatEngine';
import {
  DEFAULT_KFM_PALETTE_KEYMAP,
  getIniField,
  PaletteKeymap,
  parseDefPalFiles,
  parseIniString,
  parsePalDefaults,
  parsePaletteKeymap,
  resolvePaletteSlotIndex,
} from './defParser';
import { generateTemplateSff } from './sffGenerator';
import { parseSffBinary } from './sffParser';
import { parseSndBinary, SndData, SndSound } from './sndParser';
import { templateAir, templateCmd, templateCns } from './templateFiles';
import type { AirData, SffData, SffImage, SffPalette } from './types';
import type { SavedProject } from '../projectStorage';

export interface RosterCharacter {
  id: string;
  name: string;
  author?: string;
  source: 'saved' | 'imported' | 'builtin';
  sffData: SffData;
  airData: AirData;
  sndData: SndData | null;
  parsed: ParsedCharacterMoveset;
  palettes: Uint8Array[];
  paletteKeymap: PaletteKeymap;
  palDefaults: number[];
  palSlotIndices: Record<number, number>;
  portraitCache: Record<number, string | null>;
  defaultPortraitUrl: string | null;
  spriteCount: number;
  animCount: number;
  soundCount: number;
  createdAt: number;
}

export interface SlotSelection {
  characterId: string;
  paletteIdx: number;
}

function toUint8Array(input: any): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (Array.isArray(input)) return new Uint8Array(input);
  return new Uint8Array(0);
}

function normalizeSffData(raw: any): SffData {
  if (!raw || !Array.isArray(raw.images)) {
    return { version: '1.0', numGroups: 0, numImages: 0, images: [], palettes: [] };
  }
  const images: SffImage[] = raw.images.map((img: any) => ({
    ...img,
    pixelIndices: toUint8Array(img.pixelIndices),
    palette: img.palette ? toUint8Array(img.palette) : undefined,
  }));
  const palettes: SffPalette[] = Array.isArray(raw.palettes)
    ? raw.palettes.map((p: any) => ({
        ...p,
        data: toUint8Array(p.data),
      }))
    : [];
  return {
    version: raw.version || '1.0',
    numGroups: raw.numGroups ?? 0,
    numImages: raw.numImages ?? images.length,
    isV2: raw.isV2,
    images,
    palettes,
  };
}

function normalizeSndData(raw: any): SndData | null {
  if (!raw || !Array.isArray(raw.sounds)) return null;
  const sounds: SndSound[] = raw.sounds.map((s: any, idx: number) => ({
    ...s,
    id: s.id || `snd-${idx}`,
    data: toUint8Array(s.data),
  }));
  return {
    version: raw.version || '1.0',
    sounds,
  };
}

export function renderCharacterPortrait(
  sffData: SffData | null | undefined,
  targetPal: Uint8Array | null | undefined
): string | null {
  if (typeof document === 'undefined' || !sffData || !sffData.images?.length) return null;

  const iconSprite =
    sffData.images.find(
      img => img.group === 9000 && img.image === 0 && img.pixelIndices?.length > 0 && img.width > 0 && img.height > 0
    ) ||
    sffData.images.find(
      img => img.group === 9000 && img.image === 1 && img.pixelIndices?.length > 0 && img.width > 0 && img.height > 0
    ) ||
    sffData.images.find(
      img => img.group === 0 && img.image === 0 && img.pixelIndices?.length > 0 && img.width > 0 && img.height > 0
    ) ||
    sffData.images.find(img => img.pixelIndices?.length > 0 && img.width > 0 && img.height > 0);

  if (!iconSprite) return null;

  const mainPal =
    sffData.palettes?.find(p => p.group < 7000)?.data || sffData.palettes?.[0]?.data || null;
  const hasDedicatedPortraitPalette = Boolean(
    iconSprite.palette &&
      mainPal &&
      !palettesAreSame(iconSprite.palette, mainPal) &&
      (iconSprite.isSharedPalette === false || sffData.isV2)
  );

  const resolvedPal = hasDedicatedPortraitPalette
    ? iconSprite.palette
    : targetPal || iconSprite.palette || sffData.palettes?.[0]?.data;

  if (!resolvedPal || resolvedPal.length < 1024) return null;

  try {
    const imgData = applyPalette(iconSprite.pixelIndices, iconSprite.width, iconSprite.height, resolvedPal);
    const off = document.createElement('canvas');
    off.width = iconSprite.width;
    off.height = iconSprite.height;
    const octx = off.getContext('2d');
    if (!octx) return null;
    octx.putImageData(imgData, 0, 0);
    return off.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function getPortraitForCharacterPalette(char: RosterCharacter, paletteIdx: number): string | null {
  const safeIdx = char.palettes.length > 0 ? Math.max(0, Math.min(paletteIdx, char.palettes.length - 1)) : 0;
  if (safeIdx in char.portraitCache) {
    return char.portraitCache[safeIdx];
  }
  const pal = char.palettes[safeIdx] || char.sffData.palettes?.[0]?.data || null;
  const url = renderCharacterPortrait(char.sffData, pal) || char.defaultPortraitUrl;
  char.portraitCache[safeIdx] = url;
  return url;
}

export function getPaletteSwatchColor(pal: Uint8Array | null | undefined): string {
  if (!pal || pal.length < 1024) return '#71717a';
  // Pick first bright saturated representative color in palette (skip index 0 transparent)
  let bestScore = -1;
  let bestRgb = 'rgb(161, 161, 170)';
  for (let i = 1; i < 256; i++) {
    const r = pal[i * 4];
    const g = pal[i * 4 + 1];
    const b = pal[i * 4 + 2];
    const a = pal[i * 4 + 3];
    if (a < 128) continue;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC - minC;
    const lum = r * 0.3 + g * 0.59 + b * 0.11;
    if (lum < 25 || lum > 245) continue;
    const score = sat * 2 + (140 - Math.abs(lum - 135));
    if (score > bestScore) {
      bestScore = score;
      bestRgb = `rgb(${r}, ${g}, ${b})`;
    }
  }
  return bestRgb;
}

function buildFallbackPalette(): Uint8Array {
  const pal = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    pal[i * 4] = i;
    pal[i * 4 + 1] = i;
    pal[i * 4 + 2] = i;
    pal[i * 4 + 3] = i === 0 ? 0 : 255;
  }
  return pal;
}

export function pickDefaultPaletteIdxForCharacter(
  char: Pick<RosterCharacter, 'palettes' | 'palDefaults' | 'palSlotIndices'>,
  usedIndices?: Set<number>
): number {
  const total = char.palettes.length;
  if (total <= 1) return 0;

  if (!usedIndices || usedIndices.size === 0) {
    return resolvePaletteSlotIndex(1, total, char.palSlotIndices);
  }

  for (const defPalNum of char.palDefaults || []) {
    const resolved = resolvePaletteSlotIndex(defPalNum, total, char.palSlotIndices);
    if (!usedIndices.has(resolved)) {
      return resolved;
    }
  }

  for (let i = 0; i < total; i++) {
    if (!usedIndices.has(i)) {
      return i;
    }
  }

  return resolvePaletteSlotIndex(1, total, char.palSlotIndices);
}

interface ParsedActItem {
  nameLower: string;
  relLower: string;
  palette: Uint8Array;
}

function collectCharacterPalettes(
  sffData: SffData,
  actItems: ParsedActItem[],
  defPalMap: Record<number, string>,
  primaryAct?: Uint8Array | null
): { palettes: Uint8Array[]; palSlotIndices: Record<number, number> } {
  const pool: Uint8Array[] = [];
  const palSlotIndices: Record<number, number> = {};

  const pushOrFind = (rawPal: Uint8Array | null | undefined): number => {
    if (!rawPal || rawPal.length < 1024) return -1;
    const { palette: fixed } = detectAndFixUpsideDownPalette(rawPal, sffData.images);
    const existingIdx = pool.findIndex(existing => palettesAreSame(existing, fixed));
    if (existingIdx !== -1) return existingIdx;
    pool.push(fixed);
    return pool.length - 1;
  };

  // 1. Honor explicit .def [Files] pal1..pal12 references first so [Palette Keymap] aligns 1-to-1
  const usedActs = new Set<ParsedActItem>();
  for (let slot = 1; slot <= 12; slot++) {
    const ref = defPalMap[slot];
    if (!ref) continue;
    const baseRef = ref.split('/').pop() || ref;
    const match =
      actItems.find(a => a.relLower === ref || a.relLower.endsWith(`/${ref}`)) ||
      actItems.find(a => a.nameLower === baseRef);
    if (match) {
      usedActs.add(match);
      const idx = pushOrFind(match.palette);
      if (idx !== -1) {
        palSlotIndices[slot] = idx;
      }
    }
  }

  // 2. Include any leftover .act files not explicitly listed in .def
  for (const act of actItems) {
    if (usedActs.has(act)) continue;
    pushOrFind(act.palette);
  }

  if (primaryAct) {
    pushOrFind(primaryAct);
  }

  // 3. Include embedded SFF body palettes (mapping SFFv2 (1, N) first, then (0, N), ignoring portrait/FX >= 7000)
  const sffBodyPalettes = (sffData.palettes || []).filter(sPal => sPal.group < 7000);
  const orderedSffBody = [
    ...sffBodyPalettes.filter(p => p.group === 1),
    ...sffBodyPalettes.filter(p => p.group !== 1),
  ];
  for (const sPal of orderedSffBody) {
    const idx = pushOrFind(sPal.data);
    if (idx !== -1 && sPal.group <= 1 && sPal.item >= 1 && sPal.item <= 12 && palSlotIndices[sPal.item] === undefined) {
      palSlotIndices[sPal.item] = idx;
    }
  }

  if (pool.length === 0) {
    const firstImgPal =
      sffData.images.find(img => img.group < 7000 && img.palette && img.palette.length >= 1024)?.palette ||
      sffData.images.find(img => img.palette && img.palette.length >= 1024)?.palette;
    pushOrFind(firstImgPal);
  }
  if (pool.length === 0) {
    pool.push(buildFallbackPalette());
  }

  // Fill any missing sequential slot mappings for characters without explicit palN metadata
  if (Object.keys(palSlotIndices).length === 0) {
    for (let i = 0; i < Math.min(12, pool.length); i++) {
      palSlotIndices[i + 1] = i;
    }
  }

  return { palettes: pool, palSlotIndices };
}

export function characterFromSavedProject(proj: SavedProject): RosterCharacter | null {
  const sffData = normalizeSffData(proj.sffData);
  const airText = proj.airRawText || templateAir;
  const airData = parseAirString(airText);

  // Only expose saved projects that actually have sprites & animations (skip empty blank stubs)
  if (sffData.images.length === 0 && Object.keys(airData.actions).length === 0) {
    return null;
  }

  const cmdFiles: TextFileLike[] =
    Array.isArray(proj.cmdFiles) && proj.cmdFiles.length > 0
      ? proj.cmdFiles.map((f: any, idx: number) => ({
          id: f.id || `cmd-${idx}`,
          filename: f.filename || `char.cmd`,
          content: f.content || '',
        }))
      : [{ id: 'default', filename: 'template.cmd', content: templateCmd }];

  const stFiles: TextFileLike[] =
    Array.isArray(proj.stFiles) && proj.stFiles.length > 0
      ? proj.stFiles.map((f: any, idx: number) => ({
          id: f.id || `st-${idx}`,
          filename: f.filename || `char.cns`,
          content: f.content || '',
        }))
      : [{ id: 'default', filename: 'template.cns', content: templateCns }];

  const parsed = parseCmdAndStates(cmdFiles, stFiles);
  const sndData = normalizeSndData(proj.sndData);
  const primaryAct = proj.actPalette ? toUint8Array(proj.actPalette) : null;
  const { palettes, palSlotIndices } = collectCharacterPalettes(sffData, [], {}, primaryAct);
  const paletteKeymap = parsePaletteKeymap(proj.iniData);
  const palDefaults = parsePalDefaults(proj.iniData);

  let displayName = proj.name || 'Saved Fighter';
  let author = '';
  if (proj.iniData) {
    const defDisplay = getIniField(proj.iniData, 'Info', 'displayname');
    const defName = getIniField(proj.iniData, 'Info', 'name');
    author = getIniField(proj.iniData, 'Info', 'author') || '';
    if (defDisplay) displayName = defDisplay;
    else if (defName) displayName = defName;
  }

  const matchedPrimaryIdx =
    primaryAct && primaryAct.length >= 1024
      ? palettes.findIndex(p => palettesAreSame(p, primaryAct))
      : -1;
  const defaultIdx =
    matchedPrimaryIdx >= 0
      ? matchedPrimaryIdx
      : resolvePaletteSlotIndex(1, palettes.length, palSlotIndices);
  const defaultPortrait = renderCharacterPortrait(sffData, palettes[defaultIdx] || palettes[0]) || proj.portraitDataUrl || null;

  return {
    id: `saved-${proj.id}`,
    name: displayName,
    author: author || undefined,
    source: 'saved',
    sffData,
    airData,
    sndData,
    parsed,
    palettes,
    paletteKeymap,
    palDefaults,
    palSlotIndices,
    portraitCache: { [defaultIdx]: defaultPortrait },
    defaultPortraitUrl: defaultPortrait,
    spriteCount: sffData.images.length,
    animCount: Object.keys(airData.actions).length,
    soundCount: sndData?.sounds.length || 0,
    createdAt: proj.updatedAt || Date.now(),
  };
}

export async function createBuiltInTrainingFighter(): Promise<RosterCharacter> {
  const sffBlob = generateTemplateSff();
  const sffBuffer = await sffBlob.arrayBuffer();
  const sffData = parseSffBinary(sffBuffer);
  const airData = parseAirString(templateAir);
  const parsed = parseCmdAndStates(
    [{ id: 'builtin-cmd', filename: 'kfm.cmd', content: templateCmd }],
    [{ id: 'builtin-cns', filename: 'kfm.cns', content: templateCns }]
  );

  // Build 2 distinct palettes (Green P1 / Crimson P2) so mirror sparring is visually clear
  const basePal = sffData.palettes?.[0]?.data || sffData.images[0]?.palette || buildFallbackPalette();
  const p1Pal = new Uint8Array(basePal);
  const p2Pal = new Uint8Array(basePal);
  p2Pal[11 * 4] = 239;
  p2Pal[11 * 4 + 1] = 68;
  p2Pal[11 * 4 + 2] = 68;
  p2Pal[11 * 4 + 3] = 255;

  const palettes = [p1Pal, p2Pal];
  const defaultPortrait = renderCharacterPortrait(sffData, palettes[0]);

  return {
    id: 'builtin-training-fighter',
    name: 'Training Fighter',
    author: 'MugenStudio Built-in',
    source: 'builtin',
    sffData,
    airData,
    sndData: null,
    parsed,
    palettes,
    paletteKeymap: { ...DEFAULT_KFM_PALETTE_KEYMAP },
    palDefaults: [1, 2],
    palSlotIndices: { 1: 0, 2: 1 },
    portraitCache: { 0: defaultPortrait },
    defaultPortraitUrl: defaultPortrait,
    spriteCount: sffData.images.length,
    animCount: Object.keys(airData.actions).length,
    soundCount: 0,
    createdAt: 0,
  };
}

interface RawImportEntry {
  name: string;
  relativePath: string;
  dirPath: string;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function getDirPath(relativePath: string): string {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

function cleanFileRef(ref: string): string {
  return ref.trim().replace(/^"|"$/g, '').replace(/\\/g, '/').toLowerCase();
}

async function buildCharacterFromEntries(
  entries: RawImportEntry[],
  fallbackName: string,
  primaryDef?: RawImportEntry
): Promise<RosterCharacter | null> {
  if (entries.length === 0) return null;

  let iniData: Record<string, Record<string, string>> | null = null;
  let targetAnimFile = '';
  let targetSffFile = '';
  let targetSndFile = '';
  const defPalOrder: string[] = [];
  let defPalMap: Record<number, string> = {};

  const defEntries = primaryDef
    ? [primaryDef]
    : entries.filter(e => e.name.toLowerCase().endsWith('.def'));

  if (defEntries.length > 0) {
    try {
      const defText = await defEntries[0].text();
      iniData = parseIniString(defText);
      const animRef = getIniField(iniData, 'Files', 'anim');
      const sprRef = getIniField(iniData, 'Files', 'sprite');
      const sndRef = getIniField(iniData, 'Files', 'sound');
      if (animRef) targetAnimFile = cleanFileRef(animRef).split('/').pop() || '';
      if (sprRef) targetSffFile = cleanFileRef(sprRef).split('/').pop() || '';
      if (sndRef) targetSndFile = cleanFileRef(sndRef).split('/').pop() || '';
      defPalMap = parseDefPalFiles(iniData);
      for (let pi = 1; pi <= 12; pi++) {
        const pField = defPalMap[pi];
        if (pField) {
          const pBase = pField.split('/').pop();
          if (pBase && !defPalOrder.includes(pBase)) defPalOrder.push(pBase);
        }
      }
    } catch {
      // ignore malformed def
    }
  }

  // Parse SFF
  const sffCandidates = entries.filter(e => e.name.toLowerCase().endsWith('.sff'));
  const chosenSff =
    (targetSffFile ? sffCandidates.find(c => c.name.toLowerCase() === targetSffFile) : undefined) ||
    sffCandidates[0];

  let sffData: SffData = { version: '1.0', numGroups: 0, numImages: 0, images: [], palettes: [] };
  if (chosenSff) {
    try {
      const buf = await chosenSff.arrayBuffer();
      sffData = parseSffBinary(buf);
      if (sffData.palettes && sffData.palettes.length > 0) {
        let anyFlipped = false;
        const fixedPalettes = sffData.palettes.map(pal => {
          if (pal.group >= 7000) return pal;
          const res = detectAndFixUpsideDownPalette(pal.data, sffData.images);
          if (res.wasFlipped) anyFlipped = true;
          return res.wasFlipped ? { ...pal, data: res.palette } : pal;
        });
        if (anyFlipped) {
          const fallbackFixed = fixedPalettes.find(p => p.group < 7000)?.data || fixedPalettes[0]?.data;
          sffData = {
            ...sffData,
            palettes: fixedPalettes,
            images: sffData.images.map(img =>
              img.group < 7000 && img.isSharedPalette && fallbackFixed ? { ...img, palette: fallbackFixed } : img
            ),
          };
        }
      }
    } catch (err) {
      console.warn('Failed to parse SFF during character load:', err);
    }
  }

  // Parse ACT palettes in .def pal1..pal12 order
  const actEntries = entries
    .filter(e => e.name.toLowerCase().endsWith('.act'))
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const ia = defPalOrder.indexOf(aName);
      const ib = defPalOrder.indexOf(bName);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return aName.localeCompare(bName);
    });

  const parsedActs: ParsedActItem[] = [];
  for (const actFile of actEntries) {
    try {
      const buf = await actFile.arrayBuffer();
      const rawPal = parseActBinary(buf);
      const { palette } = detectAndFixUpsideDownPalette(rawPal, sffData.images);
      parsedActs.push({
        nameLower: actFile.name.toLowerCase(),
        relLower: actFile.relativePath.replace(/\\/g, '/').toLowerCase(),
        palette,
      });
    } catch {
      // ignore invalid act
    }
  }

  // Parse AIR
  const airCandidates = entries.filter(e => e.name.toLowerCase().endsWith('.air'));
  const chosenAir =
    (targetAnimFile ? airCandidates.find(c => c.name.toLowerCase() === targetAnimFile) : undefined) ||
    airCandidates[0];
  let airData: AirData = parseAirString(templateAir);
  if (chosenAir) {
    try {
      airData = parseAirString(await chosenAir.text());
    } catch {
      // fallback to templateAir
    }
  }

  // Require at least some sprites or animations to count as a character
  if (sffData.images.length === 0 && !chosenAir) {
    return null;
  }

  // Parse SND
  const sndCandidates = entries.filter(e => e.name.toLowerCase().endsWith('.snd'));
  const chosenSnd =
    (targetSndFile ? sndCandidates.find(c => c.name.toLowerCase() === targetSndFile) : undefined) ||
    sndCandidates[0];
  let sndData: SndData | null = null;
  if (chosenSnd) {
    try {
      sndData = parseSndBinary(await chosenSnd.arrayBuffer());
    } catch {
      sndData = null;
    }
  }

  // Parse CMD & CNS/ST files
  const cmdFiles: TextFileLike[] = [];
  const stFiles: TextFileLike[] = [];
  for (const entry of entries) {
    const ext = entry.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'cmd') {
      try {
        cmdFiles.push({
          id: `cmd-${entry.relativePath}`,
          filename: entry.name,
          content: await entry.text(),
        });
      } catch {}
    } else if (ext === 'cns' || /^st\d*$/i.test(ext) || /^cns\d*$/i.test(ext)) {
      try {
        stFiles.push({
          id: `st-${entry.relativePath}`,
          filename: entry.name,
          content: await entry.text(),
        });
      } catch {}
    }
  }

  if (cmdFiles.length === 0) {
    cmdFiles.push({ id: 'default', filename: 'template.cmd', content: templateCmd });
  }
  if (stFiles.length === 0) {
    stFiles.push({ id: 'default', filename: 'template.cns', content: templateCns });
  }

  const parsed = parseCmdAndStates(cmdFiles, stFiles);
  const { palettes, palSlotIndices } = collectCharacterPalettes(
    sffData,
    parsedActs,
    defPalMap,
    parsedActs[0]?.palette
  );
  const paletteKeymap = parsePaletteKeymap(iniData);
  const palDefaults = parsePalDefaults(iniData);

  const defDisplay = iniData ? getIniField(iniData, 'Info', 'displayname') : '';
  const defName = iniData ? getIniField(iniData, 'Info', 'name') : '';
  const author = iniData ? getIniField(iniData, 'Info', 'author') : '';
  const resolvedName =
    defDisplay ||
    defName ||
    defEntries[0]?.name.replace(/\.def$/i, '') ||
    fallbackName ||
    'Imported Fighter';

  const defaultIdx = resolvePaletteSlotIndex(1, palettes.length, palSlotIndices);
  const defaultPortrait = renderCharacterPortrait(sffData, palettes[defaultIdx] || palettes[0]);

  return {
    id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: resolvedName,
    author: author || undefined,
    source: 'imported',
    sffData,
    airData,
    sndData,
    parsed,
    palettes,
    paletteKeymap,
    palDefaults,
    palSlotIndices,
    portraitCache: { [defaultIdx]: defaultPortrait },
    defaultPortraitUrl: defaultPortrait,
    spriteCount: sffData.images.length,
    animCount: Object.keys(airData.actions).length,
    soundCount: sndData?.sounds.length || 0,
    createdAt: Date.now(),
  };
}

function pickPrimaryDef(defs: RawImportEntry[], folderLeaf: string): RawImportEntry {
  const exact = defs.find(d => d.name.replace(/\.def$/i, '').toLowerCase() === folderLeaf);
  if (exact) return exact;
  const nonStoryboard = defs.find(d => {
    const base = d.name.replace(/\.def$/i, '').toLowerCase();
    return base !== 'intro' && base !== 'ending' && base !== 'storyboard';
  });
  return nonStoryboard || defs[0];
}

function groupEntriesByCharacter(entries: RawImportEntry[]): { def?: RawImportEntry; entries: RawImportEntry[]; label: string }[] {
  const defEntries = entries.filter(e => e.name.toLowerCase().endsWith('.def'));
  if (defEntries.length === 0) {
    return [{ entries, label: entries[0]?.dirPath.split('/').pop() || 'Character' }];
  }

  // Deduplicate dirs when a single char folder has multiple .def presets (e.g., kfm.def + kfm_tag.def)
  const defsByDir = new Map<string, RawImportEntry[]>();
  for (const d of defEntries) {
    const arr = defsByDir.get(d.dirPath) || [];
    arr.push(d);
    defsByDir.set(d.dirPath, arr);
  }

  if (defsByDir.size === 1) {
    const [dirPath, defs] = Array.from(defsByDir.entries())[0];
    const folderLeaf = dirPath.split('/').pop()?.toLowerCase() || '';
    const primary = pickPrimaryDef(defs, folderLeaf);
    return [{ def: primary, entries, label: primary.name.replace(/\.def$/i, '') }];
  }

  // Multiple character subdirectories detected (e.g., pack zip or chars/ folder)
  const groups: { def?: RawImportEntry; entries: RawImportEntry[]; label: string }[] = [];
  for (const [dirPath, defs] of defsByDir.entries()) {
    const folderLeaf = dirPath.split('/').pop()?.toLowerCase() || '';
    const primary = pickPrimaryDef(defs, folderLeaf);
    const scoped = entries.filter(e =>
      dirPath === '' ? e.dirPath === '' : e.dirPath === dirPath || e.dirPath.startsWith(`${dirPath}/`)
    );
    groups.push({
      def: primary,
      entries: scoped,
      label: primary.name.replace(/\.def$/i, '') || folderLeaf || 'Fighter',
    });
  }
  return groups;
}

export async function importCharactersFromFiles(
  fileList: FileList | File[]
): Promise<{ characters: RosterCharacter[]; warnings: string[] }> {
  const rawFiles = Array.from(fileList);
  const characters: RosterCharacter[] = [];
  const warnings: string[] = [];
  const looseEntries: RawImportEntry[] = [];

  for (const file of rawFiles) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'zip') {
      try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const zipEntries: RawImportEntry[] = [];
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue;
          if (entry.name.startsWith('__MACOSX/') || entry.name.endsWith('.DS_Store')) continue;
          const baseName = entry.name.split('/').pop() || entry.name;
          zipEntries.push({
            name: baseName,
            relativePath: entry.name,
            dirPath: getDirPath(entry.name),
            text: () => entry.async('string'),
            arrayBuffer: () => entry.async('arraybuffer'),
          });
        }
        const groups = groupEntriesByCharacter(zipEntries);
        let loadedFromZip = 0;
        for (const grp of groups) {
          const ch = await buildCharacterFromEntries(
            grp.entries,
            file.name.replace(/\.zip$/i, ''),
            grp.def
          );
          if (ch) {
            characters.push(ch);
            loadedFromZip++;
          }
        }
        if (loadedFromZip === 0) {
          warnings.push(`No playable MUGEN character assets found inside "${file.name}".`);
        }
      } catch (err: any) {
        warnings.push(`Failed to extract "${file.name}": ${err?.message || 'Unknown error'}`);
      }
    } else {
      const rel = (file as any).webkitRelativePath || file.name;
      looseEntries.push({
        name: file.name,
        relativePath: rel,
        dirPath: getDirPath(rel),
        text: () => file.text(),
        arrayBuffer: () => file.arrayBuffer(),
      });
    }
  }

  if (looseEntries.length > 0) {
    const groups = groupEntriesByCharacter(looseEntries);
    let loadedLoose = 0;
    for (const grp of groups) {
      const ch = await buildCharacterFromEntries(grp.entries, grp.label, grp.def);
      if (ch) {
        characters.push(ch);
        loadedLoose++;
      }
    }
    if (loadedLoose === 0) {
      warnings.push('No playable MUGEN character (.sff / .air) found in selected folder/files.');
    }
  }

  return { characters, warnings };
}
