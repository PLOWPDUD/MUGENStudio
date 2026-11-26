import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  CornerUpLeft,
  Cpu,
  Eye,
  FolderOpen,
  Gamepad2,
  Keyboard,
  Move,
  Plus,
  RotateCcw,
  Shield,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { applyPalette } from '../lib/mugen/actParser';
import {
  AiDifficulty,
  canonicalChord,
  createFighterRuntime,
  CustomButtonSlot,
  DEFAULT_BUTTON_SLOTS,
  DEFAULT_CONSTANTS,
  doesControllerFire,
  EvalContext,
  evalMugenNumber,
  ExplodRuntime,
  FightMemberHud,
  FightOutcome,
  FighterRuntime,
  findBoxesOverlap,
  formatKeyLabel,
  getNearestLivingOpponent,
  HitSparkEffect,
  isHoldDirCmd,
  loadStoredButtonSlots,
  ParsedChangeStateRule,
  ParsedCommandDef,
  ParsedHitDef,
  ParsedStateInfo,
  ProjectileRuntime,
  SECONDARY_FALLBACK_KEYS,
  splitButtonToken,
  STORAGE_CONTROLS_KEY,
  TeamSize,
} from '../lib/mugen/combatEngine';
import {
  characterFromSavedProject,
  createBuiltInTrainingFighter,
  getPaletteSwatchColor,
  getPortraitForCharacterPalette,
  importCharactersFromFiles,
  pickDefaultPaletteIdxForCharacter,
  RosterCharacter,
  SlotSelection,
} from '../lib/mugen/characterLoader';
import {
  getKeymapButtonsForPaletteIndex,
  PALETTE_KEYMAP_KEYS,
  PaletteKeyName,
  resolvePaletteSlotIndex,
} from '../lib/mugen/defParser';
import { getAllProjects } from '../lib/projectStorage';
import type { ClsnBox, SffImage } from '../lib/mugen/types';

interface VersusArenaProps {
  onBackToHome: () => void;
}

type ArenaPhase = 'select' | 'fight';

const spriteRenderCache = new WeakMap<SffImage, Map<Uint8Array, HTMLCanvasElement>>();

function getCachedSpriteCanvas(sprite: SffImage, pal: Uint8Array): HTMLCanvasElement | null {
  if (!sprite.pixelIndices || sprite.width <= 0 || sprite.height <= 0) return null;
  let palMap = spriteRenderCache.get(sprite);
  if (!palMap) {
    palMap = new Map();
    spriteRenderCache.set(sprite, palMap);
  }
  const existing = palMap.get(pal);
  if (existing) return existing;

  const imgData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, pal);
  const off = document.createElement('canvas');
  off.width = sprite.width;
  off.height = sprite.height;
  const octx = off.getContext('2d');
  if (!octx) return null;
  octx.putImageData(imgData, 0, 0);
  palMap.set(pal, off);
  return off;
}

export const VersusArena: React.FC<VersusArenaProps> = ({ onBackToHome }) => {
  const [phase, setPhase] = useState<ArenaPhase>('select');
  const [roster, setRoster] = useState<RosterCharacter[]>([]);
  const [isLoadingRoster, setIsLoadingRoster] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [teamSize, setTeamSize] = useState<TeamSize>(1);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('normal');
  const [team1Slots, setTeam1Slots] = useState<(SlotSelection | null)[]>([null, null, null, null]);
  const [team2Slots, setTeam2Slots] = useState<(SlotSelection | null)[]>([null, null, null, null]);
  const [activeSlotTarget, setActiveSlotTarget] = useState<{ team: 1 | 2; idx: number }>({ team: 1, idx: 0 });
  const [showKeymapBank2, setShowKeymapBank2] = useState(false);
  const [keymapFeedback, setKeymapFeedback] = useState<string | null>(null);

  // Battle UI states
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [buttonSlots, setButtonSlots] = useState<CustomButtonSlot[]>(loadStoredButtonSlots);
  const [showCustomize, setShowCustomize] = useState(false);
  const [listeningSlotId, setListeningSlotId] = useState<string | null>(null);
  const [showClsn, setShowClsn] = useState(false);
  const [showExternalPad, setShowExternalPad] = useState(true);
  const [fightOutcome, setFightOutcome] = useState<FightOutcome>(null);
  const [fightBanner, setFightBanner] = useState<string | null>(null);
  const [isHyperActive, setIsHyperActive] = useState(false);
  const [matchedMove, setMatchedMove] = useState<string | null>(null);
  const [inputLog, setInputLog] = useState<string[]>([]);
  const [heldDirs, setHeldDirs] = useState<Set<string>>(new Set());
  const [heldAttackTokens, setHeldAttackTokens] = useState<Set<string>>(new Set());
  const [crouchLocked, setCrouchLocked] = useState(false);
  const [runLocked, setRunLocked] = useState(false);
  const [isLandscapeShort, setIsLandscapeShort] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.innerHeight < 540 && window.innerWidth >= 560
  );
  const [joystickKnob, setJoystickKnob] = useState<{ x: number; y: number; activeDir: string | null }>({
    x: 0,
    y: 0,
    activeDir: null,
  });

  // Individual multi-file selection is enabled on folderInputRef (no webkitdirectory)

  useEffect(() => {
    const onResize = () => {
      setIsLandscapeShort(window.innerHeight < 540 && window.innerWidth >= 560);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_CONTROLS_KEY, JSON.stringify(buttonSlots));
    } catch {
      // ignore
    }
  }, [buttonSlots]);

  const rosterMap = useMemo(() => {
    const map = new Map<string, RosterCharacter>();
    for (const ch of roster) map.set(ch.id, ch);
    return map;
  }, [roster]);

  const pickDistinctPaletteIdx = useCallback(
    (char: RosterCharacter, team: 1 | 2, slotIdx: number, t1: (SlotSelection | null)[], t2: (SlotSelection | null)[]): number => {
      if (char.palettes.length <= 1) return 0;
      const usedPals = new Set<number>();
      for (let i = 0; i < 4; i++) {
        if (!(team === 1 && i === slotIdx) && t1[i]?.characterId === char.id) {
          usedPals.add(t1[i]!.paletteIdx);
        }
        if (!(team === 2 && i === slotIdx) && t2[i]?.characterId === char.id) {
          usedPals.add(t2[i]!.paletteIdx);
        }
      }
      return pickDefaultPaletteIdxForCharacter(char, usedPals);
    },
    []
  );

  // Initial load: IndexedDB saved projects + Built-in Training Fighter fallback
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setIsLoadingRoster(true);
      try {
        const saved = await getAllProjects();
        const converted: RosterCharacter[] = [];
        for (const proj of saved) {
          const ch = characterFromSavedProject(proj);
          if (ch) converted.push(ch);
        }
        const builtin = await createBuiltInTrainingFighter();
        const fullRoster = [...converted, builtin];
        if (cancelled) return;
        setRoster(fullRoster);

        const p1Char = fullRoster[0];
        const p2Char = fullRoster.length > 1 ? fullRoster[1] : fullRoster[0];
        const usedByChar = new Map<string, Set<number>>();
        const nextIdxFor = (ch: RosterCharacter) => {
          const used = usedByChar.get(ch.id) || new Set<number>();
          const idx = pickDefaultPaletteIdxForCharacter(ch, used);
          used.add(idx);
          usedByChar.set(ch.id, used);
          return idx;
        };
        const nextT1: (SlotSelection | null)[] = Array.from({ length: 4 }, (_, i) => {
          const ch = fullRoster[i % fullRoster.length] || p1Char;
          return { characterId: ch.id, paletteIdx: nextIdxFor(ch) };
        });
        const nextT2: (SlotSelection | null)[] = Array.from({ length: 4 }, (_, i) => {
          const ch = fullRoster[(i + (fullRoster.length > 1 ? 1 : 0)) % fullRoster.length] || p2Char;
          return { characterId: ch.id, paletteIdx: nextIdxFor(ch) };
        });
        setTeam1Slots(nextT1);
        setTeam2Slots(nextT2);
      } catch (err) {
        console.error('Failed to initialize Versus Arena roster:', err);
      } finally {
        if (!cancelled) setIsLoadingRoster(false);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImportCharacterFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsImporting(true);
    setImportNotice(null);
    try {
      const { characters, warnings } = await importCharactersFromFiles(files);
      if (characters.length > 0) {
        setRoster(prev => {
          const merged = [...characters, ...prev];
          const usedByChar = new Map<string, Set<number>>();
          const nextIdxFor = (ch: RosterCharacter) => {
            const used = usedByChar.get(ch.id) || new Set<number>();
            const idx = pickDefaultPaletteIdxForCharacter(ch, used);
            used.add(idx);
            usedByChar.set(ch.id, used);
            return idx;
          };
          // Pre-compute defaults for T1 then T2 so mirror P2 avoids P1's palette per pal.defaults
          const nextT1Ids: (SlotSelection | null)[] = Array.from({ length: 4 }, (_, i) => {
            const ch = characters[i % characters.length] || characters[0];
            return { characterId: ch.id, paletteIdx: nextIdxFor(ch) };
          });
          const nextT2Ids: (SlotSelection | null)[] = Array.from({ length: 4 }, (_, i) => {
            const oppStart = characters.length > 1 ? characters[1] : characters[0];
            const ch = characters[(i + (characters.length > 1 ? 1 : 0)) % characters.length] || oppStart;
            return { characterId: ch.id, paletteIdx: nextIdxFor(ch) };
          });

          setTeam1Slots(prevT1 =>
            prevT1.map((cur, i) =>
              !cur || cur.characterId === 'builtin-training-fighter' ? nextT1Ids[i] : cur
            )
          );
          setTeam2Slots(prevT2 =>
            prevT2.map((cur, i) =>
              !cur || cur.characterId === 'builtin-training-fighter' ? nextT2Ids[i] : cur
            )
          );
          return merged;
        });
        const names = characters.map(c => c.name).join(', ');
        setImportNotice(
          warnings.length > 0
            ? `Imported ${characters.length} character(s): ${names}. (${warnings[0]})`
            : `Imported ${characters.length} character(s): ${names}`
        );
      } else {
        setImportNotice(warnings[0] || 'No playable MUGEN characters found in selection.');
      }
    } catch (err: any) {
      setImportNotice(`Import failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleAssignCharToActiveSlot = (char: RosterCharacter) => {
    const { team, idx } = activeSlotTarget;
    const palIdx = pickDistinctPaletteIdx(char, team, idx, team1Slots, team2Slots);
    const nextSel: SlotSelection = { characterId: char.id, paletteIdx: palIdx };

    if (team === 1) {
      setTeam1Slots(prev => prev.map((s, i) => (i === idx ? nextSel : s)));
      // Advance cleanly: P1 -> P2 first in 1v1, or next open Team 1 / Team 2 slot
      if (idx + 1 < teamSize) {
        setActiveSlotTarget({ team: 1, idx: idx + 1 });
      } else {
        setActiveSlotTarget({ team: 2, idx: 0 });
      }
    } else {
      setTeam2Slots(prev => prev.map((s, i) => (i === idx ? nextSel : s)));
      if (idx + 1 < teamSize) {
        setActiveSlotTarget({ team: 2, idx: idx + 1 });
      }
    }
  };

  const handleCycleSlotPalette = (team: 1 | 2, idx: number, palIdx: number) => {
    if (team === 1) {
      setTeam1Slots(prev => prev.map((s, i) => (i === idx && s ? { ...s, paletteIdx: palIdx } : s)));
    } else {
      setTeam2Slots(prev => prev.map((s, i) => (i === idx && s ? { ...s, paletteIdx: palIdx } : s)));
    }
  };

  const handleSelectPaletteByKeymapButton = (
    keyBtn: PaletteKeyName,
    explicitTarget?: { team: 1 | 2; idx: number }
  ) => {
    const target = explicitTarget || activeSlotTarget;
    const sel = target.team === 1 ? team1Slots[target.idx] : team2Slots[target.idx];
    const ch = sel ? rosterMap.get(sel.characterId) : undefined;
    if (!ch || ch.palettes.length === 0) return;

    const palNum = ch.paletteKeymap[keyBtn] ?? 1;
    const resolvedIdx = resolvePaletteSlotIndex(palNum, ch.palettes.length, ch.palSlotIndices);
    handleCycleSlotPalette(target.team, target.idx, resolvedIdx);
    setKeymapFeedback(`[${keyBtn.toUpperCase()}] -> Pal ${palNum}`);
  };

  useEffect(() => {
    if (!keymapFeedback) return;
    const t = window.setTimeout(() => setKeymapFeedback(null), 1800);
    return () => window.clearTimeout(t);
  }, [keymapFeedback]);

  const handleRandomizeLineups = () => {
    if (roster.length === 0) return;
    const playable = roster.filter(r => r.source !== 'builtin');
    const pool = playable.length > 0 ? playable : roster;
    const pick = (offset: number) => pool[Math.floor(Math.random() * pool.length) % pool.length] || pool[offset % pool.length];
    const usedByChar = new Map<string, Set<number>>();
    const nextIdxFor = (ch: RosterCharacter) => {
      const used = usedByChar.get(ch.id) || new Set<number>();
      const idx = pickDefaultPaletteIdxForCharacter(ch, used);
      used.add(idx);
      usedByChar.set(ch.id, used);
      return idx;
    };
    const nextT1: (SlotSelection | null)[] = Array.from({ length: 4 }, (_, i) => {
      const ch = pick(i);
      return { characterId: ch.id, paletteIdx: nextIdxFor(ch) };
    });
    const nextT2: (SlotSelection | null)[] = Array.from({ length: 4 }, (_, i) => {
      const ch = pick(i + 1);
      return { characterId: ch.id, paletteIdx: nextIdxFor(ch) };
    });
    setTeam1Slots(nextT1);
    setTeam2Slots(nextT2);
  };

  const handleRemoveImportedChar = (charId: string) => {
    setRoster(prev => {
      const remaining = prev.filter(c => c.id !== charId);
      const fallback = remaining[0] || null;
      const fixSlot = (s: SlotSelection | null, fallbackPal = 0): SlotSelection | null => {
        if (!s || s.characterId !== charId) return s;
        return fallback ? { characterId: fallback.id, paletteIdx: fallbackPal % Math.max(1, fallback.palettes.length) } : null;
      };
      setTeam1Slots(t1 => t1.map((s, i) => fixSlot(s, i)));
      setTeam2Slots(t2 => t2.map((s, i) => fixSlot(s, i + 1)));
      return remaining;
    });
  };

  const activeTeam1Selections = useMemo(() => team1Slots.slice(0, teamSize), [team1Slots, teamSize]);
  const activeTeam2Selections = useMemo(() => team2Slots.slice(0, teamSize), [team2Slots, teamSize]);
  const canStartFight =
    activeTeam1Selections.every(s => s && rosterMap.has(s.characterId)) &&
    activeTeam2Selections.every(s => s && rosterMap.has(s.characterId));

  // Runtime refs for 60 FPS match engine
  const rosterMapRef = useRef<Map<string, RosterCharacter>>(rosterMap);
  rosterMapRef.current = rosterMap;

  const fighterPaletteMapRef = useRef<Map<string, Uint8Array | null>>(new Map());
  const team1Ref = useRef<FighterRuntime[]>([]);
  const team2Ref = useRef<FighterRuntime[]>([]);
  const p1Ref = useRef<FighterRuntime | null>(null);
  const p2Ref = useRef<FighterRuntime | null>(null);
  const cameraXRef = useRef(0);
  const teamSizeRef = useRef<TeamSize>(1);
  const aiDifficultyRef = useRef<AiDifficulty>('normal');
  const fightOutcomeRef = useRef<FightOutcome>(null);
  const sparksRef = useRef<HitSparkEffect[]>([]);
  const projectilesRef = useRef<ProjectileRuntime[]>([]);
  const helpersRef = useRef<FighterRuntime[]>([]);
  const explodsRef = useRef<ExplodRuntime[]>([]);
  const heldAttackBtnsRef = useRef<Set<string>>(new Set());
  const recentAttackPressesRef = useRef<{ tok: string; time: number }[]>([]);
  const lastInputMetaRef = useRef<{ time: number; btnSet: Set<string> } | null>(null);
  const lastChordUpgradeRef = useRef<{ time: number; stance: 'S' | 'C' | 'A' } | null>(null);
  const superPauseTicksRef = useRef(0);
  const superMoveTimeRef = useRef(0);
  const superCasterRef = useRef<string | null>(null);
  const lastDirTapRef = useRef<{ dir: string; time: number } | null>(null);
  const inputLogRef = useRef<string[]>([]);
  const audioPoolRef = useRef<HTMLAudioElement[]>([]);
  const audioPoolIdxRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const joystickZoneRef = useRef<HTMLDivElement>(null);
  const joystickPointerIdRef = useRef<number | null>(null);
  const joystickHeldDirsRef = useRef<Set<string>>(new Set());
  const activeAttackPointersRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    teamSizeRef.current = teamSize;
  }, [teamSize]);

  useEffect(() => {
    aiDifficultyRef.current = aiDifficulty;
  }, [aiDifficulty]);

  const [fightHud, setFightHud] = useState<{
    team1: FightMemberHud[];
    team2: FightMemberHud[];
    p1Life: number;
    p1Trail: number;
    p1MaxLife: number;
    p1Power: number;
    p1MaxPower: number;
    p1Combo: number;
    p2Life: number;
    p2Trail: number;
    p2MaxLife: number;
    p2Power: number;
    p2MaxPower: number;
    p2Combo: number;
    p2Name: string;
    p2PortraitUrl: string | null;
    p2StateNo: number;
  }>({
    team1: [],
    team2: [],
    p1Life: 1000,
    p1Trail: 1000,
    p1MaxLife: 1000,
    p1Power: 0,
    p1MaxPower: 3000,
    p1Combo: 0,
    p2Life: 1000,
    p2Trail: 1000,
    p2MaxLife: 1000,
    p2Power: 0,
    p2MaxPower: 3000,
    p2Combo: 0,
    p2Name: 'Opponent',
    p2PortraitUrl: null,
    p2StateNo: 0,
  });

  const getCharForFighter = (f: { charProfileId?: string }): RosterCharacter | undefined => {
    if (f.charProfileId && rosterMapRef.current.has(f.charProfileId)) {
      return rosterMapRef.current.get(f.charProfileId);
    }
    const first = rosterMapRef.current.values().next();
    return first.done ? undefined : first.value;
  };

  const getPaletteForFighter = (f: { id: string; ownerId?: string; charProfileId?: string }): Uint8Array | null => {
    const direct = fighterPaletteMapRef.current.get(f.id);
    if (direct) return direct;
    if (f.ownerId) {
      const ownerPal = fighterPaletteMapRef.current.get(f.ownerId);
      if (ownerPal) return ownerPal;
    }
    const ch = getCharForFighter(f);
    return ch?.palettes[0] || null;
  };

  const findFighterById = (id?: string): FighterRuntime | undefined => {
    if (!id) return undefined;
    return (
      team1Ref.current.find(x => x.id === id) ||
      team2Ref.current.find(x => x.id === id) ||
      helpersRef.current.find(x => x.id === id)
    );
  };

  const getStateOwnerChar = (f: FighterRuntime): RosterCharacter | undefined => {
    if (f.customStateOwnerId) {
      const owner =
        team1Ref.current.find(x => x.id === f.customStateOwnerId) ||
        team2Ref.current.find(x => x.id === f.customStateOwnerId);
      if (owner) return getCharForFighter(owner);
    }
    return getCharForFighter(f);
  };

  const getAnimChar = (f: FighterRuntime): RosterCharacter | undefined => {
    if (f.customAnimOwnerId) {
      const owner =
        team1Ref.current.find(x => x.id === f.customAnimOwnerId) ||
        team2Ref.current.find(x => x.id === f.customAnimOwnerId);
      if (owner) return getCharForFighter(owner);
    }
    return getCharForFighter(f);
  };

  const playSoundForCharacter = (charProfileId: string | undefined, group: number, sample: number): boolean => {
    const ch = charProfileId ? rosterMapRef.current.get(charProfileId) : undefined;
    const sndData = ch?.sndData;
    if (!sndData || !sndData.sounds.length) return false;
    let match = sndData.sounds.find(s => s.group === group && s.sample === sample);
    if (!match && group === 11) {
      match = sndData.sounds.find(s => s.group === 11);
    }
    if (!match) return false;
    try {
      if (audioPoolRef.current.length === 0) {
        audioPoolRef.current = Array.from({ length: 10 }, () => new Audio());
      }
      const player = audioPoolRef.current[audioPoolIdxRef.current % audioPoolRef.current.length];
      audioPoolIdxRef.current++;
      const url = match.blobUrl || URL.createObjectURL(new Blob([match.data], { type: 'audio/wav' }));
      match.blobUrl = url;
      player.src = url;
      player.currentTime = 0;
      player.play().catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  const playSynthImpact = (kind: 'hit' | 'guard' | 'ko') => {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      if (kind === 'guard') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (kind === 'ko') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 0.35);
        gain.gain.setValueAtTime(0.24, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.36);
      } else {
        osc.type = 'square';
        osc.frequency.setValueAtTime(210, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.1);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
      }
    } catch {
      // ignore
    }
  };

  const resolveAnimForCharacter = (ch: RosterCharacter | undefined, targetState: number, stateDef?: ParsedStateInfo): number => {
    const airData = ch?.airData;
    if (!airData) return targetState;
    if (stateDef?.anim !== undefined && airData.actions[stateDef.anim]) {
      return stateDef.anim;
    }
    if (airData.actions[targetState]) return targetState;
    if (targetState === 10 && airData.actions[11]) return 11;
    if (targetState === 11 && airData.actions[10]) return 10;
    if (targetState === 106 && airData.actions[47]) return 47;
    if (targetState === 105 && airData.actions[41]) return 41;
    if (targetState === 150) {
      if (airData.actions[130]) return 130;
      if (airData.actions[120]) return 120;
    }
    if (targetState === 152) {
      if (airData.actions[131]) return 131;
      if (airData.actions[150]) return 150;
      if (airData.actions[11]) return 11;
    }
    if (targetState === 154) {
      if (airData.actions[132]) return 132;
      if (airData.actions[150]) return 150;
      if (airData.actions[41]) return 41;
    }
    if (targetState === 5010 && airData.actions[5000]) return 5000;
    if (targetState === 5050) {
      if (airData.actions[5030]) return 5030;
      if (airData.actions[5000]) return 5000;
    }
    if (targetState === 5100) {
      if (airData.actions[5110]) return 5110;
      if (airData.actions[5050]) return 5050;
      if (airData.actions[5000]) return 5000;
    }
    if (targetState === 5110) {
      if (airData.actions[5100]) return 5100;
      if (airData.actions[5050]) return 5050;
      if (airData.actions[5000]) return 5000;
    }
    if (targetState === 5150) {
      if (airData.actions[5110]) return 5110;
      if (airData.actions[5100]) return 5100;
      if (airData.actions[5050]) return 5050;
    }
    if (targetState === 181 && airData.actions[180]) return 180;
    if (airData.actions[0]) return 0;
    return Number(Object.keys(airData.actions)[0] || 0);
  };

  const transitionFighterState = (
    f: FighterRuntime,
    targetState: number,
    options?: { label?: string; asHitOrGuard?: boolean }
  ) => {
    const stateOwnerCh = getStateOwnerChar(f);
    const states = stateOwnerCh?.parsed.states || {};
    const constants = stateOwnerCh?.parsed.constants || DEFAULT_CONSTANTS;
    if ((targetState === 5200 || targetState === 5210) && !states[targetState] && !stateOwnerCh?.airData.actions[targetState]) {
      f.invulnTicks = 12;
      f.comboCount = 0;
      f.velX = -2.2;
      f.velY = -4.2;
      transitionFighterState(f, 50, options);
      return;
    }
    const stateDef = states[targetState];
    const prevWasHyper = Boolean(states[f.stateNo]?.isHyper);

    f.prevStateNo = f.stateNo;
    f.stateNo = targetState;
    f.frameIdx = 0;
    f.tickInFrame = 0;
    f.stateTime = 0;
    f.firedPersist = new Set();
    f.cmdBuffer = {};
    f.landingVelY = 0;
    f.builtinThrowTicks = 0;
    f.builtinThrowDir = undefined;
    if (targetState === 0 || options?.asHitOrGuard || targetState >= 5000) {
      f.throwFwdHeld = undefined;
      if (f.grabTargetId) {
        const tgt = findFighterById(f.grabTargetId);
        if (tgt && tgt.grabbedById === f.id) {
          tgt.grabbedById = undefined;
          tgt.targetBindTicks = 0;
        }
        f.grabTargetId = undefined;
      }
      if (targetState === 0) {
        f.grabbedById = undefined;
        f.customStateOwnerId = undefined;
        f.customAnimOwnerId = undefined;
        f.targetBindTicks = 0;
      }
    }
    const animCh = getAnimChar(f);
    const nextAnim = resolveAnimForCharacter(animCh, targetState, stateDef);
    f.animId = nextAnim;
    const preserveHitDef = !options?.asHitOrGuard && Boolean(stateDef?.hitDefPersist);
    const preserveMoveHit = !options?.asHitOrGuard && Boolean(stateDef?.hitDefPersist || stateDef?.moveHitPersist);
    if (!preserveHitDef) {
      f.activeHitDef = null;
      f.lastHitDefCtrlKey = '';
      f.hitScoredThisWindow = false;
      f.hitTargetsThisWindow = new Set();
    }
    if (!preserveMoveHit) {
      f.moveContact = 0;
      f.moveHit = 0;
      f.moveGuarded = 0;
    }
    if (!options?.asHitOrGuard) {
      f.hitPauseTicks = 0;
    }
    f.pendingLanding = false;

    if (targetState !== 100 && f.runLocked) {
      f.runLocked = false;
      if (f.id === 'p1') setRunLocked(false);
    }

    const isKnownAirState =
      targetState === 40 ||
      targetState === 41 ||
      targetState === 45 ||
      targetState === 50 ||
      targetState === 51 ||
      targetState === 105 ||
      targetState === 154 ||
      targetState === 5050 ||
      (targetState >= 600 && targetState < 700);

    if (options?.asHitOrGuard) {
      f.stateType =
        targetState === 152 || targetState === 5010
          ? 'C'
          : targetState === 154 || targetState === 5050 || f.posY < 270
            ? 'A'
            : targetState === 5110 || targetState === 5150
              ? 'L'
              : 'S';
      f.moveType = targetState >= 5000 ? 'H' : 'I';
      f.physics = targetState === 5050 ? 'N' : f.stateType === 'C' ? 'C' : f.stateType === 'A' ? 'A' : 'S';
      f.ctrl = 0;
    } else {
      f.stateType =
        stateDef?.stateType ||
        (f.posY < 270 || isKnownAirState
          ? 'A'
          : targetState === 10 || targetState === 11 || (targetState >= 400 && targetState < 500)
            ? 'C'
            : 'S');
      f.moveType = stateDef?.moveType || (targetState >= 200 && targetState < 5000 ? 'A' : 'I');
      f.physics =
        stateDef?.physics ||
        (f.posY < 270 || isKnownAirState
          ? 'A'
          : targetState === 10 || targetState === 11 || (targetState >= 400 && targetState < 500)
            ? 'C'
            : 'S');
      const isJumpCtrlState =
        targetState === 40 ||
        targetState === 41 ||
        targetState === 45 ||
        targetState === 50 ||
        targetState === 51;
      const isCrouchCtrlState = targetState === 10 || targetState === 11 || targetState === 12;
      const defaultCtrl =
        targetState === 0 ||
        isCrouchCtrlState ||
        targetState === 20 ||
        targetState === 21 ||
        isJumpCtrlState ||
        targetState === 100
          ? 1
          : 0;
      f.ctrl = isJumpCtrlState || targetState === 10 || targetState === 12 ? 1 : (stateDef?.ctrlVal ?? defaultCtrl);

      if (stateDef?.powerAdd !== undefined) {
        f.power = Math.max(0, Math.min(f.maxPower, f.power + stateDef.powerAdd));
      }

      if (targetState === 105) {
        const vx = stateDef?.velSetX !== undefined ? stateDef.velSetX : constants.runBackX;
        const vy = stateDef?.velSetY !== undefined ? stateDef.velSetY : constants.runBackY;
        f.velX = vx;
        f.velY = vy < 0 ? vy : -3.8;
      } else if (targetState === 100) {
        f.velX = stateDef?.velSetX !== undefined ? stateDef.velSetX : constants.runFwdX;
        f.velY = stateDef?.velSetY ?? 0;
      } else if (isJumpCtrlState) {
        if (stateDef?.velSetX !== undefined && stateDef.velSetX !== 0 && f.velX === 0) {
          f.velX = stateDef.velSetX;
        }
        if (stateDef?.velSetY !== undefined && stateDef.velSetY < 0) {
          f.velY = stateDef.velSetY;
        }
      } else if (stateDef?.velSetX !== undefined || stateDef?.velSetY !== undefined) {
        if (stateDef.velSetX !== undefined) f.velX = stateDef.velSetX;
        if (stateDef.velSetY !== undefined) f.velY = stateDef.velSetY;
      } else if (targetState === 0 || targetState === 10 || targetState === 11 || targetState === 12 || targetState === 106) {
        f.velX = 0;
      }

      const hasSuperPauseCtrl = Boolean(stateDef?.controllers.some(c => c.type === 'superpause'));
      if (stateDef?.isHyper && !hasSuperPauseCtrl && !prevWasHyper) {
        superPauseTicksRef.current = 26;
        superMoveTimeRef.current = 0;
        superCasterRef.current = f.id;
        setIsHyperActive(true);
      } else if (stateDef?.isHyper) {
        setIsHyperActive(true);
      } else if (targetState === 0 && superPauseTicksRef.current === 0) {
        setIsHyperActive(false);
      }

      if (stateDef && stateDef.sounds.length > 0 && !stateDef.controllers.some(c => c.type === 'playsnd')) {
        playSoundForCharacter(f.charProfileId, stateDef.sounds[0].group, stateDef.sounds[0].sample);
      }
    }

    if (f.id === 'p1') {
      if (options?.label) {
        setMatchedMove(stateDef?.isHyper ? `HYPER: ${options.label}` : options.label);
      } else if (stateDef?.label && !options?.asHitOrGuard) {
        setMatchedMove(stateDef.isHyper ? `HYPER: ${stateDef.label}` : stateDef.label);
      }
    }
  };

  const makeMemberHud = (f: FighterRuntime, slotSel?: SlotSelection | null): FightMemberHud => {
    const ch = getCharForFighter(f);
    const portraitUrl = ch && slotSel ? getPortraitForCharacterPalette(ch, slotSel.paletteIdx) : ch?.defaultPortraitUrl || null;
    return {
      id: f.id,
      slotIdx: f.slotIdx,
      name: ch?.name || `Fighter ${f.slotIdx + 1}`,
      portraitUrl,
      life: Math.ceil(f.life),
      trail: Math.round(f.trailLife * 100) / 100,
      maxLife: f.maxLife,
      power: Math.floor(f.power),
      maxPower: f.maxPower,
      stateNo: f.stateNo,
      comboCount: f.comboCount,
    };
  };

  const startOrRestartMatch = () => {
    const count = teamSize;
    const t1: FighterRuntime[] = [];
    const t2: FighterRuntime[] = [];
    fighterPaletteMapRef.current.clear();

    for (let i = 0; i < count; i++) {
      const sel1 = team1Slots[i];
      const ch1 = sel1 ? rosterMap.get(sel1.characterId) : roster[0];
      const c1 = ch1?.parsed.constants || DEFAULT_CONSTANTS;
      const f1 = createFighterRuntime(i === 0 ? 'p1' : `p1-ally-${i}`, 1, i, count, c1, 'fight');
      f1.charProfileId = ch1?.id;
      t1.push(f1);
      fighterPaletteMapRef.current.set(
        f1.id,
        ch1 ? ch1.palettes[sel1?.paletteIdx ?? 0] || ch1.palettes[0] || null : null
      );

      const sel2 = team2Slots[i];
      const ch2 = sel2 ? rosterMap.get(sel2.characterId) : roster[0];
      const c2 = ch2?.parsed.constants || DEFAULT_CONSTANTS;
      const f2 = createFighterRuntime(i === 0 ? 'p2' : `p2-cpu-${i}`, 2, i, count, c2, 'fight');
      f2.charProfileId = ch2?.id;
      t2.push(f2);
      fighterPaletteMapRef.current.set(
        f2.id,
        ch2 ? ch2.palettes[sel2?.paletteIdx ?? 0] || ch2.palettes[0] || null : null
      );
    }

    team1Ref.current = t1;
    team2Ref.current = t2;
    p1Ref.current = t1[0];
    p2Ref.current = t2[0];
    cameraXRef.current = 0;
    fightOutcomeRef.current = null;
    sparksRef.current = [];
    projectilesRef.current = [];
    helpersRef.current = [];
    explodsRef.current = [];
    superPauseTicksRef.current = 0;
    superMoveTimeRef.current = 0;
    superCasterRef.current = null;
    heldAttackBtnsRef.current = new Set();
    recentAttackPressesRef.current = [];
    lastInputMetaRef.current = null;
    lastChordUpgradeRef.current = null;
    inputLogRef.current = [];

    setFightOutcome(null);
    setFightBanner(count > 1 ? `${count}v${count} BATTLE!` : 'FIGHT!');
    setHeldDirs(new Set());
    setHeldAttackTokens(new Set());
    joystickPointerIdRef.current = null;
    joystickHeldDirsRef.current.clear();
    activeAttackPointersRef.current.clear();
    setJoystickKnob({ x: 0, y: 0, activeDir: null });
    setInputLog([]);
    setCrouchLocked(false);
    setRunLocked(false);
    setMatchedMove(null);
    setIsHyperActive(false);

    t1.forEach(f => {
      f.hasPlayedDeathSound = false;
      transitionFighterState(f, 0);
    });
    t2.forEach(f => {
      f.hasPlayedDeathSound = false;
      transitionFighterState(f, 0);
    });

    const p1Hud = makeMemberHud(t1[0], team1Slots[0]);
    const p2Hud = makeMemberHud(t2[0], team2Slots[0]);
    setFightHud({
      team1: t1.map((f, i) => makeMemberHud(f, team1Slots[i])),
      team2: t2.map((f, i) => makeMemberHud(f, team2Slots[i])),
      p1Life: p1Hud.life,
      p1Trail: p1Hud.trail,
      p1MaxLife: p1Hud.maxLife,
      p1Power: 0,
      p1MaxPower: p1Hud.maxPower,
      p1Combo: 0,
      p2Life: p2Hud.life,
      p2Trail: p2Hud.trail,
      p2MaxLife: p2Hud.maxLife,
      p2Power: 0,
      p2MaxPower: p2Hud.maxPower,
      p2Combo: 0,
      p2Name: p2Hud.name || 'Opponent',
      p2PortraitUrl: p2Hud.portraitUrl || null,
      p2StateNo: 0,
    });

    setPhase('fight');
  };

  useEffect(() => {
    if (!fightBanner) return;
    const t = window.setTimeout(() => setFightBanner(null), 1100);
    return () => window.clearTimeout(t);
  }, [fightBanner]);

  const getCharHeldDirs = (f: FighterRuntime): Set<string> => {
    const dirs = new Set<string>();
    const rawF = f.heldDirs.has('F');
    const rawB = f.heldDirs.has('B');
    const fwd = f.facing === 1 ? rawF : rawB;
    const back = f.facing === 1 ? rawB : rawF;
    const up = f.heldDirs.has('U');
    const down = f.heldDirs.has('D') || f.crouchLocked || f.aiHoldDown;
    if (fwd) dirs.add('F');
    if (back) dirs.add('B');
    if (up) dirs.add('U');
    if (down) dirs.add('D');
    if (down && fwd) dirs.add('DF');
    if (down && back) dirs.add('DB');
    if (up && fwd) dirs.add('UF');
    if (up && back) dirs.add('UB');
    return dirs;
  };

  const currentStanceType = (f: FighterRuntime): 'S' | 'C' | 'A' => {
    if (
      f.posY < 270 ||
      f.velY < 0 ||
      f.stateType === 'A' ||
      f.stateNo === 40 ||
      f.stateNo === 41 ||
      f.stateNo === 45 ||
      f.stateNo === 50 ||
      f.stateNo === 51
    ) {
      return 'A';
    }
    if (f.heldDirs.has('D') || f.crouchLocked || f.stateNo === 10 || f.stateNo === 11) return 'C';
    return 'S';
  };

  const enterCrouch = (f: FighterRuntime) => {
    if (f.posY < 270 || f.moveType === 'H' || fightOutcomeRef.current) return;
    const ch = getCharForFighter(f);
    if (f.stateNo === 0 || f.stateNo === 20 || f.stateNo === 21) {
      const target = ch?.airData.actions[10] ? 10 : 11;
      transitionFighterState(f, target, f.id === 'p1' ? { label: 'Crouch' } : undefined);
    }
  };

  const exitCrouch = (f: FighterRuntime) => {
    const ch = getCharForFighter(f);
    if (f.stateNo === 10 || f.stateNo === 11) {
      if (ch?.airData.actions[12]) {
        transitionFighterState(f, 12, f.id === 'p1' ? { label: 'Stand Up' } : undefined);
      } else {
        transitionFighterState(f, 0);
      }
    }
  };

  const startBuiltinThrow = (atk: FighterRuntime, def: FighterRuntime, dir: 1 | -1) => {
    const atkCh = getCharForFighter(atk);
    const airData = atkCh?.airData;
    if (dir === -1) {
      atk.facing = atk.facing === 1 ? -1 : 1;
    }
    const throwAnim = airData?.actions[810]
      ? 810
      : airData?.actions[800]
        ? 800
        : airData?.actions[210]
          ? 210
          : airData?.actions[200]
            ? 200
            : atk.animId;
    atk.prevStateNo = atk.stateNo;
    atk.stateNo = 810;
    atk.animId = throwAnim;
    atk.frameIdx = 0;
    atk.tickInFrame = 0;
    atk.stateTime = 0;
    atk.stateType = 'S';
    atk.moveType = 'A';
    atk.physics = 'N';
    atk.ctrl = 0;
    atk.velX = 0;
    atk.velY = 0;
    atk.activeHitDef = null;
    atk.firedPersist = new Set();
    atk.builtinThrowTicks = 22;
    atk.builtinThrowDir = dir;
    atk.grabTargetId = def.id;

    transitionFighterState(def, 5000, { asHitOrGuard: true });
    def.grabbedById = atk.id;
    def.targetBindTicks = 30;
    def.velX = 0;
    def.velY = 0;
    def.facing = atk.facing === 1 ? -1 : 1;
    def.posX = atk.posX + 34 * atk.facing;
    def.posY = 270;

    if (atk.id === 'p1') {
      setMatchedMove(dir === -1 ? 'Back Throw' : 'Throw');
    }
  };

  const triggerP1StateTransition = (targetState: number, label?: string) => {
    const p1 = p1Ref.current;
    if (!p1 || fightOutcomeRef.current || p1.life <= 0 || p1.moveType === 'H') return;
    const ch = getCharForFighter(p1);
    const states = ch?.parsed.states || {};
    const rules = ch?.parsed.rules || [];
    const stDef = states[targetState];
    const costFromRule = rules.find(r => r.targetState === targetState)?.minPowerRequired ?? 0;
    const costFromState = stDef?.powerAdd && stDef.powerAdd < 0 ? Math.abs(stDef.powerAdd) : 0;
    const superPauseCost = stDef?.controllers.find(c => c.type === 'superpause')?.superPowerAdd;
    const costFromSp = superPauseCost && superPauseCost < 0 ? Math.abs(superPauseCost) : 0;
    const req = Math.max(costFromRule, costFromState, costFromSp);
    if (req > 0 && p1.power < req) {
      setMatchedMove(`Need ${req} Power (${Math.floor(p1.power)}/${req})`);
      return;
    }
    transitionFighterState(p1, targetState, { label });
  };

  const triggerHopBack = () => {
    const p1 = p1Ref.current;
    if (!p1 || fightOutcomeRef.current || p1.life <= 0 || p1.moveType === 'H') return;
    const nextLog = [...inputLogRef.current, 'B', 'B'].slice(-16);
    inputLogRef.current = nextLog;
    setInputLog(nextLog);
    triggerP1StateTransition(105, 'Hop Back');
  };

  const isCommandSatisfied = (
    requiredCmd: string,
    satisfiedCmdNames: Set<string>,
    activeBtns: Set<string>,
    f: FighterRuntime
  ): boolean => {
    const lower = requiredCmd.toLowerCase();
    if (satisfiedCmdNames.has(lower)) return true;
    const dirNorm = lower.replace(/_/g, '');
    const charDirs = getCharHeldDirs(f);
    if (dirNorm === 'holddown') return charDirs.has('D');
    if (dirNorm === 'holdfwd') return charDirs.has('F');
    if (dirNorm === 'holdback') return charDirs.has('B');
    if (dirNorm === 'holdup') return charDirs.has('U');
    if (activeBtns.has(lower)) return true;
    if (lower.includes('+')) {
      const parts = splitButtonToken(lower);
      if (parts.length > 0 && parts.every(p => activeBtns.has(p) || charDirs.has(p.toUpperCase()))) {
        return true;
      }
    }
    return false;
  };

  const ruleMatchesCurrentContext = (
    rule: ParsedChangeStateRule,
    satisfiedCmdNames: Set<string>,
    activeBtns: Set<string>,
    states: Record<number, ParsedStateInfo>,
    stanceOverride: 'S' | 'C' | 'A',
    f: FighterRuntime,
    ignorePower = false
  ): { matches: boolean; multiWeight: number } => {
    if (rule.forbiddenStateNos?.includes(f.stateNo)) {
      return { matches: false, multiWeight: 0 };
    }

    if (rule.requiresP2Close) {
      const opp = getNearestLivingOpponent(f, f.team === 1 ? team2Ref.current : team1Ref.current);
      if (
        !opp ||
        opp.life <= 0 ||
        opp.grabbedById ||
        opp.stateNo === 5110 ||
        opp.stateNo === 5120 ||
        opp.stateNo === 5150 ||
        Math.abs(f.posX - opp.posX) > 68
      ) {
        return { matches: false, multiWeight: 0 };
      }
      if (rule.requiresP2NotHit && opp.moveType === 'H') {
        return { matches: false, multiWeight: 0 };
      }
      if (rule.p2GroundOnly && opp.posY < 270) {
        return { matches: false, multiWeight: 0 };
      }
    }

    if (!ignorePower && rule.minPowerRequired > 0 && f.power < rule.minPowerRequired) {
      return { matches: false, multiWeight: 0 };
    }

    if (rule.allowedStateTypes.length > 0) {
      if (!rule.allowedStateTypes.includes(stanceOverride)) {
        return { matches: false, multiWeight: 0 };
      }
    } else {
      const tgtState = states[rule.targetState];
      const isGroundOnlyTarget =
        tgtState?.stateType === 'S' ||
        tgtState?.stateType === 'C' ||
        (rule.targetState >= 200 && rule.targetState < 600 && tgtState?.stateType !== 'A');
      const isAirOnlyTarget =
        tgtState?.stateType === 'A' || (rule.targetState >= 600 && rule.targetState < 700);
      if (stanceOverride === 'A' && isGroundOnlyTarget) {
        return { matches: false, multiWeight: 0 };
      }
      if (stanceOverride !== 'A' && isAirOnlyTarget) {
        return { matches: false, multiWeight: 0 };
      }
    }

    const charDirs = getCharHeldDirs(f);
    if (rule.branchHoldDirGroups && rule.branchHoldDirGroups.length > 0) {
      const dirBranchOk = rule.branchHoldDirGroups.some(
        bg => bg.req.every(d => charDirs.has(d)) && bg.forb.every(d => !charDirs.has(d))
      );
      if (!dirBranchOk) return { matches: false, multiWeight: 0 };
    }
    for (const req of rule.requiredCommands) {
      const rn = req.toLowerCase().replace(/_/g, '');
      if (rn === 'holddown' && !charDirs.has('D')) return { matches: false, multiWeight: 0 };
      if (rn === 'holdfwd' && !charDirs.has('F')) return { matches: false, multiWeight: 0 };
      if (rn === 'holdback' && !charDirs.has('B')) return { matches: false, multiWeight: 0 };
      if (rn === 'holdup' && !charDirs.has('U')) return { matches: false, multiWeight: 0 };
    }
    for (const forb of rule.forbiddenCommands) {
      const fn = forb.toLowerCase().replace(/_/g, '');
      if (fn === 'holddown' && charDirs.has('D')) return { matches: false, multiWeight: 0 };
      if (fn === 'holdfwd' && charDirs.has('F')) return { matches: false, multiWeight: 0 };
      if (fn === 'holdback' && charDirs.has('B')) return { matches: false, multiWeight: 0 };
      if (fn === 'holdup' && charDirs.has('U')) return { matches: false, multiWeight: 0 };
      if (satisfiedCmdNames.has(forb.toLowerCase())) return { matches: false, multiWeight: 0 };
    }

    for (const reqCmd of rule.requiredAllCommands) {
      if (!isCommandSatisfied(reqCmd, satisfiedCmdNames, activeBtns, f)) {
        return { matches: false, multiWeight: 0 };
      }
    }

    for (const orSet of rule.requiredAllOrSets) {
      const ok = orSet.some(branch => branch.every(c => isCommandSatisfied(c, satisfiedCmdNames, activeBtns, f)));
      if (!ok) return { matches: false, multiWeight: 0 };
    }

    let bestGroupLen = 0;
    if (rule.commandOrGroups.length > 0) {
      for (const grp of rule.commandOrGroups) {
        if (grp.every(c => isCommandSatisfied(c, satisfiedCmdNames, activeBtns, f))) {
          if (grp.length > bestGroupLen) bestGroupLen = grp.length;
        }
      }
      if (bestGroupLen === 0) return { matches: false, multiWeight: 0 };
    } else if (rule.requiredAllCommands.length === 0 && rule.requiredAllOrSets.length === 0) {
      const fallbackHit =
        rule.matchedCommands.some(c => isCommandSatisfied(c, satisfiedCmdNames, activeBtns, f)) ||
        isCommandSatisfied(rule.commandName, satisfiedCmdNames, activeBtns, f);
      if (!fallbackHit) return { matches: false, multiWeight: 0 };
      bestGroupLen = 1;
    }

    return { matches: true, multiWeight: rule.requiredAllCommands.length + bestGroupLen };
  };

  const pushInputToken = (rawToken: string, explicitActiveBtns?: Set<string>) => {
    const p1 = p1Ref.current;
    if (!p1) return;
    const ch = getCharForFighter(p1);
    const commands = ch?.parsed.commands || [];
    const rules = ch?.parsed.rules || [];
    const states = ch?.parsed.states || {};
    const airData = ch?.airData;

    const now = performance.now();
    let token = rawToken;
    if (p1.facing === -1) {
      if (rawToken === 'F') token = 'B';
      else if (rawToken === 'B') token = 'F';
      else if (rawToken === 'DF') token = 'DB';
      else if (rawToken === 'DB') token = 'DF';
      else if (rawToken === 'UF') token = 'UB';
      else if (rawToken === 'UB') token = 'UF';
    }

    const p1LockedOut =
      fightOutcomeRef.current !== null ||
      p1.life <= 0 ||
      p1.moveType === 'H' ||
      Boolean(p1.grabbedById) ||
      Boolean(p1.customStateOwnerId);

    if (!p1LockedOut && (token === 'B' || token === 'F')) {
      const prev = lastDirTapRef.current;
      if (prev && prev.dir === token && now - prev.time < 300 && p1.posY >= 270 && p1.ctrl === 1) {
        lastDirTapRef.current = null;
        if (token === 'B') {
          triggerHopBack();
          return;
        }
        if (token === 'F' && (states[100] || airData?.actions[100])) {
          const runLog = [...inputLogRef.current, 'F', 'F'].slice(-16);
          inputLogRef.current = runLog;
          setInputLog(runLog);
          triggerP1StateTransition(100, 'Run Forward');
          return;
        }
      } else {
        lastDirTapRef.current = { dir: token, time: now };
      }
    }

    const isDirOnly = ['B', 'F', 'U', 'D', 'DF', 'DB', 'UF', 'UB'].includes(token);

    let next: string[];
    const prevMeta = lastInputMetaRef.current;
    if (
      !isDirOnly &&
      explicitActiveBtns &&
      explicitActiveBtns.size >= 2 &&
      prevMeta &&
      now - prevMeta.time <= 130 &&
      inputLogRef.current.length > 0 &&
      Array.from(prevMeta.btnSet as Set<string>).every((b: string) => explicitActiveBtns.has(b))
    ) {
      next = [...inputLogRef.current.slice(0, -1), token];
    } else {
      next = [...inputLogRef.current, token].slice(-16);
    }

    inputLogRef.current = next;
    setInputLog(next);

    if (isDirOnly || p1LockedOut) return;

    const activeBtnSet = explicitActiveBtns
      ? new Set(Array.from(explicitActiveBtns).map(b => b.toLowerCase()))
      : new Set(splitButtonToken(token));
    lastInputMetaRef.current = { time: now, btnSet: activeBtnSet };

    const charHeldDirs = getCharHeldDirs(p1);
    const activeChordSet = new Set<string>([
      ...Array.from(activeBtnSet).map(b => b.toUpperCase()),
      ...Array.from(charHeldDirs).map(d => d.toUpperCase()),
    ]);

    const matchHistToken = (pat: string, inp: string): boolean => {
      const pNorm = pat.toUpperCase();
      const tNorm = inp.toUpperCase();
      const iParts = tNorm.split('+').map(s => s.trim()).filter(Boolean);
      if (pNorm.includes('+')) {
        const pParts = pNorm.split('+').map(s => s.trim()).filter(Boolean);
        return pParts.length > 0 && pParts.every(sub => iParts.includes(sub));
      }
      if (pNorm === 'DF') return tNorm === 'DF' || tNorm === 'F' || tNorm === 'D';
      if (pNorm === 'DB') return tNorm === 'DB' || tNorm === 'B' || tNorm === 'D';
      if (pNorm === 'UF') return tNorm === 'UF' || tNorm === 'F' || tNorm === 'U';
      if (pNorm === 'UB') return tNorm === 'UB' || tNorm === 'B' || tNorm === 'U';
      return iParts.includes(pNorm);
    };

    const matchFinalToken = (pat: string): number => {
      const pParts = pat.toUpperCase().split('+').map(s => s.trim()).filter(Boolean);
      if (pParts.length === 0) return 0;
      return pParts.every(p => activeChordSet.has(p)) ? pParts.length : 0;
    };

    const DIR_TOKENS = new Set(['B', 'F', 'U', 'D', 'DF', 'DB', 'UF', 'UB']);
    const DIAG_TOKENS = new Set(['DF', 'DB', 'UF', 'UB']);
    const matchesCommandPattern = (cleanTokens: string[]): number => {
      if (cleanTokens.length === 0) return 0;
      const lastMatchCount = matchFinalToken(cleanTokens[cleanTokens.length - 1]);
      if (lastMatchCount === 0) return 0;
      if (cleanTokens.length === 1) return lastMatchCount;

      if (next.length >= cleanTokens.length) {
        const tail = next.slice(next.length - cleanTokens.length);
        if (cleanTokens.slice(0, -1).every((p, idx) => matchHistToken(p, tail[idx]))) {
          return lastMatchCount;
        }
      }
      const simplified = cleanTokens.filter(t => !DIAG_TOKENS.has(t.toUpperCase()));
      if (simplified.length > 1 && simplified.length < cleanTokens.length && next.length >= simplified.length) {
        const tail = next.slice(next.length - simplified.length);
        if (simplified.slice(0, -1).every((p, idx) => matchHistToken(p, tail[idx]))) {
          return lastMatchCount;
        }
      }

      const motionPat = cleanTokens.slice(0, -1);
      if (motionPat.length >= 2) {
        const isPureDirMotion = motionPat.every(t => DIR_TOKENS.has(t.toUpperCase()));
        const histPool = next.slice(0, -1);
        let recentPool: string[];
        if (isPureDirMotion) {
          let cutIdx = histPool.length;
          const minIdx = Math.max(0, histPool.length - Math.max(14, motionPat.length + 6));
          while (cutIdx > minIdx && DIR_TOKENS.has(histPool[cutIdx - 1].toUpperCase())) {
            cutIdx--;
          }
          recentPool = histPool.slice(cutIdx);
        } else {
          recentPool = histPool.slice(-Math.max(14, motionPat.length + 6));
        }

        if (recentPool.length >= Math.max(2, motionPat.length - 2)) {
          const lastPat = motionPat[motionPat.length - 1].toUpperCase();
          const lastInp = recentPool[recentPool.length - 1].toUpperCase();
          let endCompatible = true;
          if (isPureDirMotion) {
            if (lastPat === 'F' || lastPat === 'DF' || lastPat === 'UF') {
              if (lastInp === 'B' || lastInp === 'DB' || lastInp === 'UB') endCompatible = false;
            } else if (lastPat === 'B' || lastPat === 'DB' || lastPat === 'UB') {
              if (lastInp === 'F' || lastInp === 'DF' || lastInp === 'UF') endCompatible = false;
            } else if (lastPat === 'D') {
              if (lastInp === 'U' || lastInp === 'UF' || lastInp === 'UB') endCompatible = false;
            } else if (lastPat === 'U') {
              if (lastInp === 'D' || lastInp === 'DF' || lastInp === 'DB') endCompatible = false;
            }
          }
          if (endCompatible) {
            const failed = new Set<number>();
            const matchSubseq = (pi: number, ii: number): boolean => {
              if (pi === motionPat.length) return true;
              if (ii >= recentPool.length) return false;
              const memoKey = pi * 32 + ii;
              if (failed.has(memoKey)) return false;
              const pUpper = motionPat[pi].toUpperCase();
              if (matchHistToken(pUpper, recentPool[ii]) && matchSubseq(pi + 1, ii + 1)) {
                return true;
              }
              if (DIAG_TOKENS.has(pUpper) && pi > 0 && pi < motionPat.length - 1 && matchSubseq(pi + 1, ii)) {
                return true;
              }
              if (matchSubseq(pi, ii + 1)) {
                return true;
              }
              failed.add(memoKey);
              return false;
            };
            if (matchSubseq(0, 0)) {
              return lastMatchCount;
            }
          }
        }
      }
      return 0;
    };

    const isUpgradeWindow =
      lastChordUpgradeRef.current !== null && now - lastChordUpgradeRef.current.time <= 160;
    const stanceForCheck =
      activeBtnSet.size >= 2 && isUpgradeWindow ? lastChordUpgradeRef.current!.stance : currentStanceType(p1);

    const matchedCmdEntries: { cmd: ParsedCommandDef; lastPartCount: number }[] = [];
    const satisfiedCmdNames = new Set<string>();
    for (const cmd of commands) {
      const cmdLower = cmd.name.toLowerCase();
      if (isHoldDirCmd(cmdLower) || cmdLower === 'recovery' || cmdLower === 'recovery2') continue;
      const lastPartCount = matchesCommandPattern(cmd.cleanTokens);
      if (lastPartCount > 0) {
        matchedCmdEntries.push({ cmd, lastPartCount });
        satisfiedCmdNames.add(cmdLower);
      }
    }

    const buf = (p1.cmdBuffer = p1.cmdBuffer || {});
    for (const cname of satisfiedCmdNames) {
      buf[cname] = 10;
    }
    for (const btn of activeBtnSet) {
      buf[btn] = 10;
    }
    buf[token.toLowerCase()] = 10;

    if (p1.ctrl === 0 && states[p1.stateNo]) {
      const curStDef = states[p1.stateNo];
      const constants = ch?.parsed.constants || DEFAULT_CONSTANTS;
      const act = airData?.actions[p1.animId];
      let animTime = -1;
      if (act && act.elements.length > 0) {
        let hasInfinite = false;
        let remaining = 0;
        for (let i = p1.frameIdx; i < act.elements.length; i++) {
          const t = act.elements[i]?.time ?? 1;
          if (t < 0) {
            hasInfinite = true;
            break;
          }
          const dur = Math.max(1, t);
          remaining += i === p1.frameIdx ? Math.max(1, dur - p1.tickInFrame) : dur;
        }
        animTime = hasInfinite ? -999999 : -Math.max(1, remaining);
      }
      const charDirsNow = getCharHeldDirs(p1);
      const heldCmds = new Set<string>();
      if (charDirsNow.has('F') || p1.runLocked) heldCmds.add('holdfwd');
      if (charDirsNow.has('B')) heldCmds.add('holdback');
      if (charDirsNow.has('U')) heldCmds.add('holdup');
      if (charDirsNow.has('D')) heldCmds.add('holddown');
      const pressedCmds = new Set<string>([
        ...Array.from(satisfiedCmdNames),
        ...Array.from(activeBtnSet),
        token.toLowerCase(),
        ...Object.keys(buf).filter(k => buf[k] > 0),
      ]);
      const opp = getNearestLivingOpponent(p1, team2Ref.current);
      const inStateCtx: EvalContext = {
        stateTime: p1.stateTime,
        animElem: p1.frameIdx + 1,
        animElemTick: p1.tickInFrame,
        animId: p1.animId,
        animTime,
        posX: p1.posX,
        posY: p1.posY - 270,
        velX: p1.velX,
        velY: p1.velY,
        stateType: p1.stateType,
        moveType: p1.moveType,
        physics: p1.physics,
        stateNo: p1.stateNo,
        prevStateNo: p1.prevStateNo,
        ctrl: p1.ctrl,
        life: p1.life,
        maxLife: p1.maxLife,
        power: p1.power,
        maxPower: p1.maxPower,
        moveContact: p1.moveContact,
        moveHit: p1.moveHit,
        moveGuarded: p1.moveGuarded,
        mode: 'fight',
        p2BodyDistX: opp ? Math.max(0, Math.abs(opp.posX - p1.posX) - 24) : 120,
        p2PosY: opp ? opp.posY - 270 : 0,
        p2StateType: opp?.stateType,
        p2MoveType: opp?.moveType,
        p2StateNo: opp?.stateNo,
        p2Life: opp?.life,
        actElements: act?.elements,
        constants,
        heldCmds,
        pressedCmds,
        isHelper: p1.isHelper,
        helperId: p1.helperId,
        ownerId: p1.ownerId || p1.id,
        helpers: helpersRef.current,
        explods: explodsRef.current,
        projectiles: projectilesRef.current,
        parentLife: p1.life,
        facing: p1.facing,
      };
      for (const ctrl of curStDef.controllers) {
        if (ctrl.type !== 'changestate') continue;
        if (ctrl.persistent === 0 && p1.firedPersist.has(ctrl.id)) continue;
        const trigText = [...ctrl.triggerAll, ...(Object.values(ctrl.triggerGroups) as string[][]).flat()];
        if (!trigText.some(t => /\bcommand\s*=/i.test(t))) continue;
        if (!doesControllerFire(ctrl, inStateCtx)) continue;
        const nextS = evalMugenNumber(ctrl.valueExpr, inStateCtx);
        if (nextS !== null && nextS !== p1.stateNo) {
          if (ctrl.persistent === 0) p1.firedPersist.add(ctrl.id);
          transitionFighterState(p1, nextS);
          if (ctrl.ctrlVal !== undefined) p1.ctrl = ctrl.ctrlVal;
          return;
        }
      }
    }

    const isNeutralGrounded =
      p1.moveType === 'I' &&
      (p1.stateNo === 0 ||
        p1.stateNo === 10 ||
        p1.stateNo === 11 ||
        p1.stateNo === 12 ||
        p1.stateNo === 20 ||
        p1.stateNo === 21 ||
        p1.stateNo === 100);
    const isSpecialOrHyperStartup = p1.moveType === 'A' && p1.stateNo < 1000 && p1.stateTime <= 4;
    const canCancelMove =
      p1.ctrl === 1 ||
      isNeutralGrounded ||
      p1.moveContact > 0 ||
      isSpecialOrHyperStartup ||
      (activeBtnSet.size >= 2 && isUpgradeWindow);
    if (!canCancelMove) return;

    let bestCandidate: { rule: ParsedChangeStateRule; label: string; score: number; isMulti: boolean } | null = null;
    for (let rIdx = 0; rIdx < rules.length; rIdx++) {
      const rule = rules[rIdx];
      const targetSt = states[rule.targetState];
      const isTargetHyper = Boolean(targetSt?.isHyper || rule.targetState >= 3000);
      const isTargetSpecial = Boolean(
        targetSt?.category === 'special' || (rule.targetState >= 1000 && rule.targetState < 3000)
      );
      const isSpecialOrHyperRule = isTargetHyper || isTargetSpecial;
      const isAirChainCancel =
        p1.moveContact > 0 &&
        stanceForCheck === 'A' &&
        rule.targetState !== p1.stateNo &&
        (rule.allowedStateTypes.includes('A') ||
          targetSt?.stateType === 'A' ||
          (rule.targetState >= 600 && rule.targetState < 700));
      const isGroundSpecialOrHyperCancel =
        p1.moveContact > 0 &&
        rule.targetState !== p1.stateNo &&
        ((isTargetHyper && !states[p1.stateNo]?.isHyper && p1.stateNo < 3000) ||
          (isTargetSpecial && p1.stateNo < 1000) ||
          (stanceForCheck === 'A' && isSpecialOrHyperRule));
      const isSpecialOrHyperKara = isSpecialOrHyperStartup && isSpecialOrHyperRule;
      if (
        rule.requireCtrl &&
        p1.ctrl === 0 &&
        !isNeutralGrounded &&
        !isAirChainCancel &&
        !isGroundSpecialOrHyperCancel &&
        !isSpecialOrHyperKara &&
        !(activeBtnSet.size >= 2 && isUpgradeWindow)
      ) {
        continue;
      }
      const ctxRes = ruleMatchesCurrentContext(rule, satisfiedCmdNames, activeBtnSet, states, stanceForCheck, p1);
      if (!ctxRes.matches) continue;

      let bestLastParts = 1;
      let bestTokenCount = 1;
      let bestChordWeight = 1;
      for (const entry of matchedCmdEntries) {
        const cn = entry.cmd.name.toLowerCase();
        const usedByRule =
          rule.commandName.toLowerCase() === cn ||
          rule.matchedCommands.some(mc => mc.toLowerCase() === cn) ||
          rule.requiredAllCommands.some(rc => rc.toLowerCase() === cn);
        if (usedByRule) {
          if (entry.lastPartCount > bestLastParts) bestLastParts = entry.lastPartCount;
          if (entry.cmd.tokenCount > bestTokenCount) bestTokenCount = entry.cmd.tokenCount;
          if (entry.cmd.chordWeight > bestChordWeight) bestChordWeight = entry.cmd.chordWeight;
        }
      }

      const effectiveChord = Math.max(bestLastParts, ctxRes.multiWeight);
      const isMulti = effectiveChord >= 2 || bestChordWeight > bestTokenCount;
      const airBonus =
        stanceForCheck === 'A' &&
        (rule.allowedStateTypes.includes('A') ||
          targetSt?.stateType === 'A' ||
          (rule.targetState >= 600 && rule.targetState < 700))
          ? 500
          : 0;
      const hyperBonus = isTargetHyper ? 500 : 0;
      const throwBonus = rule.requiresP2Close ? 25000 : 0;
      const score =
        throwBonus +
        effectiveChord * 10000 +
        bestTokenCount * 200 +
        bestChordWeight * 20 +
        airBonus +
        hyperBonus +
        (rules.length - rIdx) * 0.001;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          rule,
          label: rule.label || rule.commandName || token,
          score,
          isMulti,
        };
      }
    }

    if (bestCandidate) {
      if (activeBtnSet.size === 1 && !bestCandidate.isMulti) {
        lastChordUpgradeRef.current = { time: now, stance: stanceForCheck };
      } else if (bestCandidate.isMulti) {
        lastChordUpgradeRef.current = null;
      }
      p1.throwFwdHeld = charHeldDirs.has('F');
      triggerP1StateTransition(bestCandidate.rule.targetState, bestCandidate.label);
      return;
    }

    let missingPowerReq = 0;
    for (const rule of rules) {
      if (rule.minPowerRequired > p1.power) {
        const testRes = ruleMatchesCurrentContext(
          rule,
          satisfiedCmdNames,
          activeBtnSet,
          states,
          stanceForCheck,
          p1,
          true
        );
        if (testRes.matches) {
          missingPowerReq = Math.max(missingPowerReq, rule.minPowerRequired);
        }
      }
    }

    const canAttack =
      p1.stateNo === 0 ||
      p1.stateNo === 10 ||
      p1.stateNo === 11 ||
      p1.stateNo === 12 ||
      p1.stateNo === 20 ||
      p1.stateNo === 21 ||
      p1.stateNo === 100 ||
      p1.posY < 270 ||
      p1.velY < 0 ||
      p1.stateType === 'A' ||
      (p1.stateNo >= 40 && p1.stateNo <= 52);

    if (canAttack && (p1.ctrl === 1 || isNeutralGrounded)) {
      const stance = stanceForCheck;
      if (
        stance === 'S' &&
        p1.stateNo !== 100 &&
        (charHeldDirs.has('F') || charHeldDirs.has('B')) &&
        (activeBtnSet.has('y') || activeBtnSet.has('z'))
      ) {
        const opp = getNearestLivingOpponent(p1, team2Ref.current);
        const canGrabOpp =
          Boolean(opp) &&
          opp.life > 0 &&
          !opp.grabbedById &&
          opp.moveType !== 'H' &&
          opp.posY >= 270 &&
          opp.stateNo !== 5110 &&
          opp.stateNo !== 5120 &&
          opp.stateNo !== 5150 &&
          Math.abs(p1.posX - opp.posX) <= 68;
        if (canGrabOpp) {
          p1.throwFwdHeld = charHeldDirs.has('F');
          if (states[800]) {
            triggerP1StateTransition(800, 'Throw');
          } else {
            startBuiltinThrow(p1, opp, charHeldDirs.has('B') ? -1 : 1);
          }
          return;
        }
      }
      if (activeBtnSet.has('s') && stance !== 'A' && (states[195] || airData?.actions[195])) {
        triggerP1StateTransition(195, 'Taunt');
        return;
      }
      const baseOffset = stance === 'C' ? 400 : stance === 'A' ? 600 : 200;
      const fallbackMap: Record<string, number> = { x: 0, y: 10, z: 20, a: 30, b: 40, c: 50 };
      const singleTok = Array.from(activeBtnSet).reverse().find(b => fallbackMap[b] !== undefined);
      if (singleTok) {
        let st = baseOffset + fallbackMap[singleTok];
        if (stance === 'A' && !states[st] && !airData?.actions[st]) {
          const altMap: Record<string, number[]> = {
            x: [600, 601, 610],
            y: [610, 601, 600, 620],
            z: [620, 610, 602, 600],
            a: [630, 603, 640],
            b: [640, 630, 604, 650],
            c: [650, 640, 605, 630],
          };
          const altFound = (altMap[singleTok] || []).find(cand => states[cand] || airData?.actions[cand]);
          if (altFound !== undefined) st = altFound;
        }
        if (states[st] || airData?.actions[st]) {
          if (activeBtnSet.size === 1) {
            lastChordUpgradeRef.current = { time: now, stance };
          }
          triggerP1StateTransition(st, `${stance === 'C' ? 'Crouch ' : stance === 'A' ? 'Air ' : ''}${singleTok.toUpperCase()}`);
        }
      }
    }
    if (missingPowerReq > 0) {
      setMatchedMove(`Need ${missingPowerReq} Power (${Math.floor(p1.power)}/${missingPowerReq})`);
    }
  };

  const handleAttackPress = (rawToken: string) => {
    const now = performance.now();
    const parts = splitButtonToken(rawToken);
    if (parts.length === 0) return;
    recentAttackPressesRef.current = recentAttackPressesRef.current.filter(p => now - p.time <= 130);
    for (const p of parts) {
      heldAttackBtnsRef.current.add(p);
      recentAttackPressesRef.current.push({ tok: p, time: now });
    }
    setHeldAttackTokens(new Set(heldAttackBtnsRef.current));

    const combinedSet = new Set<string>([
      ...Array.from(heldAttackBtnsRef.current),
      ...recentAttackPressesRef.current.map(p => p.tok),
    ]);
    const chordStr = canonicalChord(combinedSet);
    pushInputToken(chordStr, combinedSet);
  };

  const handleAttackRelease = (rawToken: string) => {
    const parts = splitButtonToken(rawToken);
    if (parts.length === 0) return;
    let changed = false;
    for (const p of parts) {
      if (heldAttackBtnsRef.current.delete(p)) changed = true;
    }
    if (changed) {
      setHeldAttackTokens(new Set(heldAttackBtnsRef.current));
    }
  };

  const handleDirPress = (rawDir: string) => {
    const p1 = p1Ref.current;
    if (!p1) return;
    if (!p1.heldDirs.has(rawDir)) {
      p1.heldDirs.add(rawDir);
      setHeldDirs(new Set(p1.heldDirs));

      let emitDir = rawDir;
      const hasD = p1.heldDirs.has('D');
      const hasU = p1.heldDirs.has('U');
      const hasF = p1.heldDirs.has('F');
      const hasB = p1.heldDirs.has('B');
      if (hasD && hasF && !hasB) emitDir = 'DF';
      else if (hasD && hasB && !hasF) emitDir = 'DB';
      else if (hasU && hasF && !hasB) emitDir = 'UF';
      else if (hasU && hasB && !hasF) emitDir = 'UB';
      pushInputToken(emitDir);

      const lockedOut = fightOutcomeRef.current !== null || p1.life <= 0 || p1.moveType === 'H';
      if (lockedOut) return;

      const ch = getCharForFighter(p1);
      const constants = ch?.parsed.constants || DEFAULT_CONSTANTS;
      const states = ch?.parsed.states || {};
      const airData = ch?.airData;

      if (rawDir === 'U' && p1.posY >= 270 && p1.ctrl === 1) {
        setCrouchLocked(false);
        p1.crouchLocked = false;
        p1.velY = constants.jumpNeuY < -1 ? constants.jumpNeuY : -8.4;
        const jumpLocalX = p1.heldDirs.has('F')
          ? p1.facing === 1
            ? constants.jumpFwdX
            : constants.jumpBackX
          : p1.heldDirs.has('B')
            ? p1.facing === -1
              ? constants.jumpFwdX
              : constants.jumpBackX
            : constants.jumpNeuX;
        p1.velX = jumpLocalX;
        const jumpState = states[50] ? 50 : airData?.actions[41] ? 41 : 40;
        triggerP1StateTransition(jumpState, 'Jump');
      } else if (rawDir === 'D') {
        enterCrouch(p1);
      }
    }
  };

  const handleDirRelease = (rawDir: string) => {
    const p1 = p1Ref.current;
    if (!p1) return;
    if (p1.heldDirs.has(rawDir)) {
      p1.heldDirs.delete(rawDir);
      setHeldDirs(new Set(p1.heldDirs));
      if (rawDir === 'D' && !p1.crouchLocked) {
        exitCrouch(p1);
      }
      if ((rawDir === 'D' || rawDir === 'U') && p1.heldDirs.has('F') !== p1.heldDirs.has('B')) {
        const rem = p1.heldDirs.has('F') ? 'F' : 'B';
        const remFacing = p1.facing === -1 ? (rem === 'F' ? 'B' : 'F') : rem;
        if (inputLogRef.current[inputLogRef.current.length - 1] !== remFacing) {
          const next = [...inputLogRef.current, remFacing].slice(-16);
          inputLogRef.current = next;
          setInputLog(next);
        }
      }
    }
  };

  const releaseAllInputs = () => {
    if (p1Ref.current) {
      p1Ref.current.heldDirs.clear();
      if (!p1Ref.current.crouchLocked) exitCrouch(p1Ref.current);
    }
    heldAttackBtnsRef.current.clear();
    recentAttackPressesRef.current = [];
    joystickPointerIdRef.current = null;
    joystickHeldDirsRef.current.clear();
    activeAttackPointersRef.current.clear();
    setJoystickKnob({ x: 0, y: 0, activeDir: null });
    setHeldDirs(new Set());
    setHeldAttackTokens(new Set());
  };

  const resolveTokenForKeyboardEvent = (eKey: string): string | null => {
    const exact = buttonSlots.find(b => b.key && b.key === eKey);
    if (exact) return exact.token;
    const lower = eKey.toLowerCase();
    const ci = buttonSlots.find(b => b.key && b.key.toLowerCase() === lower);
    if (ci) return ci.token;
    return SECONDARY_FALLBACK_KEYS[lower] || null;
  };

  const applyButtonPreset = (preset: 'default' | 'wasd' | 'kof4') => {
    if (preset === 'default') {
      setButtonSlots(DEFAULT_BUTTON_SLOTS.map(s => ({ ...s })));
    } else if (preset === 'wasd') {
      setButtonSlots(
        DEFAULT_BUTTON_SLOTS.map(s => {
          if (s.id === 'B') return { ...s, key: 'a' };
          if (s.id === 'D') return { ...s, key: 's' };
          if (s.id === 'U') return { ...s, key: 'w' };
          if (s.id === 'F') return { ...s, key: 'd' };
          return { ...s };
        })
      );
    } else if (preset === 'kof4') {
      setButtonSlots(
        DEFAULT_BUTTON_SLOTS.map(s => {
          if (s.id === 'B') return { ...s, key: 'a' };
          if (s.id === 'D') return { ...s, key: 's' };
          if (s.id === 'U') return { ...s, key: 'w' };
          if (s.id === 'F') return { ...s, key: 'd' };
          if (s.id === 'x') return { ...s, label: 'LP', token: 'x', key: 'u', visible: true };
          if (s.id === 'y') return { ...s, label: 'HP', token: 'y', key: 'i', visible: true };
          if (s.id === 'z') return { ...s, visible: false, key: '' };
          if (s.id === 'm1') return { ...s, label: 'LP+LK', token: 'x+a', key: 'p', visible: true };
          if (s.id === 'a') return { ...s, label: 'LK', token: 'a', key: 'j', visible: true };
          if (s.id === 'b') return { ...s, label: 'HK', token: 'b', key: 'k', visible: true };
          if (s.id === 'c') return { ...s, visible: false, key: '' };
          if (s.id === 'm2') return { ...s, label: 'HP+HK', token: 'y+b', key: 'm', visible: true };
          return { ...s };
        })
      );
    }
    setListeningSlotId(null);
  };

  const availableCmdTokens = useMemo(() => {
    const base = [
      'x', 'y', 'z', 'a', 'b', 'c', 's',
      'x+y', 'y+z', 'x+z', 'a+b', 'b+c', 'a+c', 'x+a', 'y+b', 'z+c', 'x+y+z', 'a+b+c',
    ];
    for (const ch of roster) {
      for (const cmd of ch.parsed.commands) {
        for (const tok of cmd.cleanTokens) {
          if (tok.includes('+')) {
            const norm = canonicalChord(splitButtonToken(tok));
            if (norm && !base.includes(norm)) base.push(norm);
          }
        }
      }
    }
    return base;
  }, [roster]);

  const keyHandlersRef = useRef({
    phase,
    showCustomize,
    buttonSlots,
    handleDirPress,
    handleDirRelease,
    handleAttackPress,
    handleAttackRelease,
    releaseAllInputs,
    resolveTokenForKeyboardEvent,
    handleSelectPaletteByKeymapButton,
    listeningSlotId,
    setListeningSlotId,
    setButtonSlots,
  });
  keyHandlersRef.current = {
    phase,
    showCustomize,
    buttonSlots,
    handleDirPress,
    handleDirRelease,
    handleAttackPress,
    handleAttackRelease,
    releaseAllInputs,
    resolveTokenForKeyboardEvent,
    handleSelectPaletteByKeymapButton,
    listeningSlotId,
    setListeningSlotId,
    setButtonSlots,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (keyHandlersRef.current.listeningSlotId) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          keyHandlersRef.current.setListeningSlotId(null);
          return;
        }
        const targetId = keyHandlersRef.current.listeningSlotId;
        const newKey = e.key === 'Backspace' || e.key === 'Delete' ? '' : e.key;
        keyHandlersRef.current.setButtonSlots(prev =>
          prev.map(slot => {
            if (slot.id === targetId) return { ...slot, key: newKey };
            if (newKey && slot.key.toLowerCase() === newKey.toLowerCase()) {
              return { ...slot, key: '' };
            }
            return slot;
          })
        );
        keyHandlersRef.current.setListeningSlotId(null);
        return;
      }

      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') {
        if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
        return;
      }

      if (keyHandlersRef.current.phase === 'select') {
        if (keyHandlersRef.current.showCustomize || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const lower = e.key.toLowerCase();
        const atkButtons = ['x', 'y', 'z', 'a', 'b', 'c'] as const;
        const boundSlot = keyHandlersRef.current.buttonSlots.find(
          b => atkButtons.includes(b.id as any) && b.key && b.key.toLowerCase() === lower
        );
        const keyAssignedElsewhere = keyHandlersRef.current.buttonSlots.some(
          b => b.key && b.key.toLowerCase() === lower
        );
        const matchedBase =
          (boundSlot?.id as (typeof atkButtons)[number] | undefined) ||
          (!keyAssignedElsewhere && atkButtons.includes(lower as any)
            ? (lower as (typeof atkButtons)[number])
            : undefined);
        if (matchedBase) {
          e.preventDefault();
          const keyName = (e.shiftKey ? `${matchedBase}2` : matchedBase) as PaletteKeyName;
          keyHandlersRef.current.handleSelectPaletteByKeymapButton(keyName);
        }
        return;
      }

      if (keyHandlersRef.current.phase !== 'fight') return;

      const token = keyHandlersRef.current.resolveTokenForKeyboardEvent(e.key);
      if (!token) return;
      e.preventDefault();
      if (['B', 'F', 'U', 'D'].includes(token)) {
        keyHandlersRef.current.handleDirPress(token);
      } else if (!e.repeat) {
        keyHandlersRef.current.handleAttackPress(token);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (keyHandlersRef.current.listeningSlotId || keyHandlersRef.current.phase !== 'fight') return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') return;
      const token = keyHandlersRef.current.resolveTokenForKeyboardEvent(e.key);
      if (!token) return;
      e.preventDefault();
      if (['B', 'F', 'U', 'D'].includes(token)) {
        keyHandlersRef.current.handleDirRelease(token);
      } else {
        keyHandlersRef.current.handleAttackRelease(token);
      }
    };

    const onBlur = () => keyHandlersRef.current.releaseAllInputs();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Joystick handlers
  const syncJoystickDirs = (nextDirs: Set<string>, dirLabel: string | null, kx: number, ky: number) => {
    setJoystickKnob({ x: kx, y: ky, activeDir: dirLabel });
    const prev = joystickHeldDirsRef.current;
    for (const h of ['B', 'F']) {
      if (prev.has(h) && !nextDirs.has(h)) handleDirRelease(h);
    }
    for (const d of ['B', 'F', 'D', 'U']) {
      if (nextDirs.has(d) && !prev.has(d)) handleDirPress(d);
    }
    for (const v of ['D', 'U']) {
      if (prev.has(v) && !nextDirs.has(v)) handleDirRelease(v);
    }
    joystickHeldDirsRef.current = nextDirs;
  };

  const updateJoystickFromClientXY = (clientX: number, clientY: number) => {
    const el = joystickZoneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const maxTravel = radius * 0.54;
    const clamped = Math.min(dist, maxTravel);
    const kx = dist > 0 ? (dx / dist) * clamped : 0;
    const ky = dist > 0 ? (dy / dist) * clamped : 0;

    if (dist < radius * 0.2) {
      syncJoystickDirs(new Set(), null, kx * 0.4, ky * 0.4);
      return;
    }

    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    let label: string;
    const nextDirs = new Set<string>();
    if (angleDeg >= -22.5 && angleDeg < 22.5) {
      label = '→';
      nextDirs.add('F');
    } else if (angleDeg >= 22.5 && angleDeg < 67.5) {
      label = '↘';
      nextDirs.add('D');
      nextDirs.add('F');
    } else if (angleDeg >= 67.5 && angleDeg < 112.5) {
      label = '↓';
      nextDirs.add('D');
    } else if (angleDeg >= 112.5 && angleDeg < 157.5) {
      label = '↙';
      nextDirs.add('D');
      nextDirs.add('B');
    } else if (angleDeg >= 157.5 || angleDeg < -157.5) {
      label = '←';
      nextDirs.add('B');
    } else if (angleDeg >= -157.5 && angleDeg < -112.5) {
      label = '↖';
      nextDirs.add('U');
      nextDirs.add('B');
    } else if (angleDeg >= -112.5 && angleDeg < -67.5) {
      label = '↑';
      nextDirs.add('U');
    } else {
      label = '↗';
      nextDirs.add('U');
      nextDirs.add('F');
    }
    syncJoystickDirs(nextDirs, label, kx, ky);
  };

  const onJoystickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (joystickPointerIdRef.current !== null) return;
    joystickPointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    updateJoystickFromClientXY(e.clientX, e.clientY);
  };

  const onJoystickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joystickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    updateJoystickFromClientXY(e.clientX, e.clientY);
  };

  const onJoystickPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joystickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    joystickPointerIdRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
    syncJoystickDirs(new Set(), null, 0, 0);
  };

  const onAttackPointerDown = (e: React.PointerEvent<HTMLButtonElement>, token: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeAttackPointersRef.current.has(e.pointerId)) return;
    activeAttackPointersRef.current.set(e.pointerId, token);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    handleAttackPress(token);
  };

  const onAttackPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    const tok = activeAttackPointersRef.current.get(e.pointerId);
    if (!tok) return;
    e.preventDefault();
    activeAttackPointersRef.current.delete(e.pointerId);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
    handleAttackRelease(tok);
  };

  // 60 FPS Multi-Character MUGEN Battle Loop
  useEffect(() => {
    if (phase !== 'fight') return;
    let rafId = 0;
    let lastTime = performance.now();
    let acc = 0;
    const stepMs = 1000 / 60;
    let hudFrameCounter = 0;

    const runControllersForFighter = (f: FighterRuntime, opp: FighterRuntime) => {
      const ownCh = getCharForFighter(f);
      let transitionsThisTick = 0;
      while (transitionsThisTick < 4) {
        const ch = getStateOwnerChar(f);
        if (!ch) break;
        const states = ch.parsed.states;
        const constants = ch.parsed.constants;
        const airData = getAnimChar(f)?.airData || ch.airData;
        const stDef = states[f.stateNo];
        if (!stDef || stDef.controllers.length === 0) break;

        const act = airData.actions[f.animId];
        let animTime = -1;
        if (act && act.elements.length > 0) {
          let hasInfinite = false;
          let remaining = 0;
          for (let i = f.frameIdx; i < act.elements.length; i++) {
            const t = act.elements[i]?.time ?? 1;
            if (t < 0) {
              hasInfinite = true;
              break;
            }
            const dur = Math.max(1, t);
            remaining += i === f.frameIdx ? Math.max(1, dur - f.tickInFrame) : dur;
          }
          animTime = hasInfinite ? -999999 : -Math.max(1, remaining);
        }

        const charDirsNow = getCharHeldDirs(f);
        const heldCmds = new Set<string>();
        if (charDirsNow.has('F') || f.runLocked) heldCmds.add('holdfwd');
        if (charDirsNow.has('B')) heldCmds.add('holdback');
        if (charDirsNow.has('U')) heldCmds.add('holdup');
        if (charDirsNow.has('D')) heldCmds.add('holddown');
        const pressedCmds = new Set<string>(
          Object.entries(f.cmdBuffer || {})
            .filter(([, ticks]) => ticks > 0)
            .map(([name]) => name)
        );

        const ctx: EvalContext = {
          stateTime: f.stateTime,
          animElem: f.frameIdx + 1,
          animElemTick: f.tickInFrame,
          animId: f.animId,
          animTime,
          posX: f.posX,
          posY: f.posY - 270,
          velX: f.velX,
          velY: f.velY,
          stateType: f.stateType,
          moveType: f.moveType,
          physics: f.physics,
          stateNo: f.stateNo,
          prevStateNo: f.prevStateNo,
          ctrl: f.ctrl,
          life: f.life,
          maxLife: f.maxLife,
          power: f.power,
          maxPower: f.maxPower,
          moveContact: f.moveContact,
          moveHit: f.moveHit,
          moveGuarded: f.moveGuarded,
          mode: 'fight' as const,
          p2BodyDistX: Math.max(0, Math.abs(opp.posX - f.posX) - 24),
          p2PosY: opp.posY - 270,
          p2StateType: opp.stateType,
          p2MoveType: opp.moveType,
          p2StateNo: opp.stateNo,
          p2Life: opp.life,
          actElements: act?.elements,
          constants,
          heldCmds,
          pressedCmds,
          isHelper: f.isHelper,
          helperId: f.helperId,
          ownerId: f.ownerId || f.id,
          helpers: helpersRef.current,
          explods: explodsRef.current,
          projectiles: projectilesRef.current,
          parentLife: f.isHelper
            ? f.ownerId
              ? [...team1Ref.current, ...team2Ref.current].find(o => o.id === f.ownerId)?.life ?? 1000
              : 1000
            : f.life,
          facing: f.facing,
        };

        let transitioned = false;
        for (const ctrl of stDef.controllers) {
          if (ctrl.persistent === 0 && f.firedPersist.has(ctrl.id)) continue;
          if (!doesControllerFire(ctrl, ctx)) continue;

          if (ctrl.persistent === 0) f.firedPersist.add(ctrl.id);

          if (ctrl.type === 'velset') {
            const nx = evalMugenNumber(ctrl.xExpr, ctx);
            const ny = evalMugenNumber(ctrl.yExpr, ctx);
            if (nx !== null) f.velX = nx;
            if (ny !== null) f.velY = ny;
          } else if (ctrl.type === 'veladd') {
            const nx = evalMugenNumber(ctrl.xExpr, ctx);
            const ny = evalMugenNumber(ctrl.yExpr, ctx);
            if (nx !== null) f.velX += nx;
            if (ny !== null) f.velY += ny;
          } else if (ctrl.type === 'velmul') {
            const nx = evalMugenNumber(ctrl.xExpr, ctx);
            const ny = evalMugenNumber(ctrl.yExpr, ctx);
            if (nx !== null) f.velX *= nx;
            if (ny !== null) f.velY *= ny;
          } else if (ctrl.type === 'posadd') {
            const nx = evalMugenNumber(ctrl.xExpr, ctx);
            const ny = evalMugenNumber(ctrl.yExpr, ctx);
            if (nx !== null) f.posX = Math.max(-1400, Math.min(1400, f.posX + nx * f.facing));
            if (ny !== null) f.posY = Math.min(270, f.posY + ny);
          } else if (ctrl.type === 'posset') {
            const ny = evalMugenNumber(ctrl.yExpr, ctx);
            if (ny !== null) f.posY = Math.min(270, 270 + ny);
          } else if (ctrl.type === 'gravity') {
            f.velY += constants.yaccel;
          } else if (ctrl.type === 'ctrlset') {
            if (ctrl.ctrlVal !== undefined) f.ctrl = ctrl.ctrlVal;
          } else if (ctrl.type === 'statetypeset') {
            if (ctrl.stateTypeVal) f.stateType = ctrl.stateTypeVal;
            if (ctrl.moveTypeVal) f.moveType = ctrl.moveTypeVal;
            if (ctrl.physicsVal) f.physics = ctrl.physicsVal;
          } else if (ctrl.type === 'poweradd') {
            const pwKey = `pw-${ctrl.id}-e${ctx.animElem}-t${f.stateTime}`;
            const hasElemOrTime = (Object.values(ctrl.triggerGroups) as string[][]).flat().some(t => /animelem|time/i.test(t));
            const dedupKey = hasElemOrTime ? pwKey : `pw-${ctrl.id}`;
            if (!f.firedPersist.has(dedupKey)) {
              f.firedPersist.add(dedupKey);
              const addVal = evalMugenNumber(ctrl.valueExpr, ctx);
              if (addVal !== null) f.power = Math.max(0, Math.min(f.maxPower, f.power + addVal));
            }
          } else if (ctrl.type === 'hitdef' && ctrl.hitDef) {
            const allTrigLines = [...ctrl.triggerAll, ...(Object.values(ctrl.triggerGroups) as string[][]).flat()];
            const hasPulseTime = allTrigLines.some(t => /\btime\s*%\s*\d+/i.test(t) || /\btime\s*=\s*\d+/i.test(t));
            const hasElemOrTime = allTrigLines.some(t => /animelem|time/i.test(t));
            const armKey = hasPulseTime
              ? `${ctrl.id}-e${ctx.animElem}-t${f.stateTime}`
              : hasElemOrTime
                ? `${ctrl.id}-e${ctx.animElem}`
                : ctrl.id;
            if (f.lastHitDefCtrlKey !== armKey) {
              f.activeHitDef = ctrl.hitDef;
              f.lastHitDefCtrlKey = armKey;
              f.hitScoredThisWindow = false;
              f.hitTargetsThisWindow = new Set();
            }
          } else if (ctrl.type === 'superpause') {
            const spKey = `sp-${ctrl.id}`;
            if (!f.firedPersist.has(spKey)) {
              f.firedPersist.add(spKey);
              superPauseTicksRef.current = Math.min(34, Math.max(12, ctrl.superTime ?? 26));
              superMoveTimeRef.current = ctrl.superMoveTime ?? 0;
              superCasterRef.current = f.id;
              if (ctrl.superPowerAdd !== undefined) {
                f.power = Math.max(0, Math.min(f.maxPower, f.power + ctrl.superPowerAdd));
              }
              setIsHyperActive(true);
            }
          } else if (ctrl.type === 'playsnd' && ctrl.sndValue) {
            const sndKey = `snd-${ctrl.id}-${f.frameIdx}`;
            if (!f.firedPersist.has(sndKey)) {
              f.firedPersist.add(sndKey);
              playSoundForCharacter(f.charProfileId, ctrl.sndValue.group, ctrl.sndValue.sample);
            }
          } else if (ctrl.type === 'changeanim' || ctrl.type === 'changeanim2') {
            const nextA = evalMugenNumber(ctrl.valueExpr, ctx);
            if (ctrl.type === 'changeanim2') {
              f.customAnimOwnerId = f.customStateOwnerId || f.grabbedById;
            } else {
              f.customAnimOwnerId = undefined;
            }
            const targetAir = ctrl.type === 'changeanim2' ? getAnimChar(f)?.airData : ownCh?.airData;
            if (nextA !== null && targetAir?.actions[nextA] && (nextA !== f.animId || ctrl.type === 'changeanim2')) {
              f.animId = nextA;
              f.frameIdx = 0;
              f.tickInFrame = 0;
            }
          } else if (ctrl.type === 'turn') {
            f.facing = f.facing === 1 ? -1 : 1;
          } else if (ctrl.type === 'width') {
            // Accepted for throw spacing compatibility; positioning handled by TargetBind & pushbox skips
          } else if (ctrl.type === 'targetbind') {
            const target = findFighterById(f.grabTargetId) || (opp.grabbedById === f.id ? opp : undefined);
            if (target) {
              const bx = evalMugenNumber(ctrl.xExpr, ctx) ?? 0;
              const by = evalMugenNumber(ctrl.yExpr, ctx) ?? 0;
              target.posX = Math.max(-1400, Math.min(1400, f.posX + bx * f.facing));
              target.posY = Math.min(270, f.posY + by);
              target.velX = 0;
              target.velY = 0;
              target.grabbedById = f.id;
              target.targetBindTicks = ctrl.targetBindTime !== undefined && ctrl.targetBindTime > 0 ? ctrl.targetBindTime : 4;
            }
          } else if (ctrl.type === 'targetlifeadd') {
            const target = findFighterById(f.grabTargetId) || (opp.grabbedById === f.id ? opp : undefined);
            if (target) {
              const tdKey = `tlife-${ctrl.id}-e${ctx.animElem}-t${f.stateTime}`;
              const hasElemOrTime = (Object.values(ctrl.triggerGroups) as string[][]).flat().some(t => /animelem|time/i.test(t));
              const dedupKey = hasElemOrTime ? tdKey : `tlife-${ctrl.id}`;
              if (!f.firedPersist.has(dedupKey)) {
                f.firedPersist.add(dedupKey);
                const val = evalMugenNumber(ctrl.valueExpr, ctx);
                if (val !== null) {
                  const scaled =
                    val < 0
                      ? -Math.max(1, Math.round(Math.abs(val) * (f.attackMul / Math.max(0.1, target.defenceMul))))
                      : Math.round(val);
                  const minLife = ctrl.targetKill === 0 ? 1 : 0;
                  target.life = Math.max(minLife, Math.min(target.maxLife, target.life + scaled));
                  if (scaled < 0) {
                    target.trailHoldTicks = 20;
                    target.comboCount = target.moveType === 'H' ? Math.max(1, target.comboCount + 1) : 1;
                    playSynthImpact('hit');
                    if (target.life <= 0 && !target.hasPlayedDeathSound) {
                      target.hasPlayedDeathSound = true;
                      const playedDeath = playSoundForCharacter(target.charProfileId, 11, 0);
                      if (!playedDeath) playSynthImpact('ko');
                    }
                  }
                }
              }
            }
          } else if (ctrl.type === 'targetstate') {
            const target = findFighterById(f.grabTargetId) || (opp.grabbedById === f.id ? opp : undefined);
            if (target) {
              const nextTS = evalMugenNumber(ctrl.valueExpr, ctx);
              if (nextTS !== null) {
                target.grabbedById = undefined;
                target.targetBindTicks = 0;
                target.customAnimOwnerId = undefined;
                target.customStateOwnerId = f.id;
                f.grabTargetId = undefined;
                transitionFighterState(target, nextTS);
                runControllersForFighter(target, f);
              }
            }
          } else if (ctrl.type === 'targetvelset') {
            const target = findFighterById(f.grabTargetId) || (opp.grabbedById === f.id ? opp : undefined);
            if (target) {
              const vx = evalMugenNumber(ctrl.xExpr, ctx);
              const vy = evalMugenNumber(ctrl.yExpr, ctx);
              if (vx !== null) target.velX = vx;
              if (vy !== null) target.velY = vy;
            }
          } else if (ctrl.type === 'targetfacing') {
            const target = findFighterById(f.grabTargetId) || (opp.grabbedById === f.id ? opp : undefined);
            if (target) {
              const tf = evalMugenNumber(ctrl.valueExpr, ctx);
              if (tf !== null) {
                target.facing = tf >= 0 ? (f.facing === 1 ? -1 : 1) : f.facing;
              }
            }
          } else if (ctrl.type === 'selfstate') {
            const nextS = evalMugenNumber(ctrl.valueExpr, ctx);
            if (nextS !== null) {
              if (f.grabbedById) {
                const owner = findFighterById(f.grabbedById);
                if (owner && owner.grabTargetId === f.id) owner.grabTargetId = undefined;
              }
              f.customStateOwnerId = undefined;
              f.customAnimOwnerId = undefined;
              f.grabbedById = undefined;
              f.targetBindTicks = 0;
              if (nextS === 5100) {
                f.posY = 270;
                f.velX = 0;
                f.velY = 0;
                f.lieDownPhase = 'bounce';
                f.lieDownTimer = 6;
                transitionFighterState(f, 5100, { asHitOrGuard: true });
              } else {
                transitionFighterState(f, nextS);
                if (ctrl.ctrlVal !== undefined) f.ctrl = ctrl.ctrlVal;
              }
              transitionsThisTick++;
              transitioned = true;
              break;
            }
          } else if (ctrl.type === 'changestate') {
            const nextS = evalMugenNumber(ctrl.valueExpr, ctx);
            if (nextS !== null && nextS !== f.stateNo) {
              transitionFighterState(f, nextS);
              if (ctrl.ctrlVal !== undefined) f.ctrl = ctrl.ctrlVal;
              transitionsThisTick++;
              transitioned = true;
              break;
            }
          } else if (ctrl.type === 'projectile') {
            const pKey = `proj-${ctrl.id}-e${ctx.animElem}-t${f.stateTime}`;
            const allTrigLines = [...ctrl.triggerAll, ...(Object.values(ctrl.triggerGroups) as string[][]).flat()];
            const hasElemOrTime = allTrigLines.some(t => /animelem|time/i.test(t));
            const dedupKey = hasElemOrTime ? pKey : `proj-${ctrl.id}`;
            if (!f.firedPersist.has(dedupKey)) {
              f.firedPersist.add(dedupKey);
              const offX = ctrl.projOffsetX ?? 40;
              const offY = ctrl.projOffsetY ?? -55;
              const pAnim = ctrl.projAnim ?? (airData.actions[1005] ? 1005 : f.animId);
              const maxTicks = ctrl.projRemoveTime !== undefined && ctrl.projRemoveTime > 0 ? ctrl.projRemoveTime : 180;
              const hitDefToUse: ParsedHitDef = ctrl.hitDef || {
                attr: f.stateType === 'A' ? 'A' : f.stateType === 'C' ? 'C' : 'S',
                attrMove: stDef?.isHyper || f.stateNo >= 3000 ? 'H' : f.stateNo >= 1000 ? 'S' : 'N',
                hitFlag: 'MAF',
                guardFlag: 'MA',
                damage: stDef?.isHyper ? 130 : 70,
                guardDamage: stDef?.isHyper ? 16 : 10,
                getPowerHit: 40,
                getPowerGuard: 20,
                givePowerHit: 20,
                givePowerGuard: 10,
                pauseP1: 0,
                pauseP2: 10,
                groundVelX: -5.5,
                groundVelY: 0,
                airVelX: -3.5,
                airVelY: -4.5,
                guardVelX: -4,
                groundHittime: 14,
                airHittime: 16,
                guardHittime: 12,
                fall: false,
              };
              projectilesRef.current.push({
                id: `proj-${f.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                projId: ctrl.projId ?? 0,
                ownerId: f.id,
                charProfileId: f.charProfileId,
                team: f.team,
                posX: f.posX + offX * f.facing,
                posY: f.posY + offY,
                velX: ctrl.projVelX ?? 5.2,
                velY: ctrl.projVelY ?? 0,
                facing: f.facing,
                animId: pAnim,
                hitAnimId: ctrl.projHitAnim,
                remAnimId: ctrl.projRemAnim,
                cancelAnimId: ctrl.projCancelAnim,
                frameIdx: 0,
                tickInFrame: 0,
                lifeTicks: 0,
                maxTicks,
                hitDef: hitDefToUse,
                isHitOrDying: false,
                hitTargets: new Set(),
              });
            }
          } else if (ctrl.type === 'helper') {
            const hId = ctrl.helperId ?? 0;
            const hKey = `helper-${ctrl.id}-e${ctx.animElem}-t${f.stateTime}`;
            const allTrigLines = [...ctrl.triggerAll, ...(Object.values(ctrl.triggerGroups) as string[][]).flat()];
            const hasElemOrTime = allTrigLines.some(t => /animelem|time/i.test(t));
            const dedupKey = hasElemOrTime ? hKey : `helper-${ctrl.id}`;
            if (!f.firedPersist.has(dedupKey)) {
              f.firedPersist.add(dedupKey);
              const spawnStateNo = ctrl.helperStateNo ?? f.stateNo;
              const offX = ctrl.helperOffsetX ?? 0;
              const offY = ctrl.helperOffsetY ?? 0;
              let spawnX = f.posX + offX * f.facing;
              let spawnY = f.posY + offY;
              if (ctrl.helperPosType === 'p2') {
                spawnX = opp.posX + offX * opp.facing;
                spawnY = opp.posY + offY;
              }
              const spawnFacing: 1 | -1 = ctrl.helperFacing === -1 ? (f.facing === 1 ? -1 : 1) : f.facing;
              const helperStateDef = states[spawnStateNo];
              const helperAnim = helperStateDef?.anim ?? spawnStateNo;
              const helperRuntimeId = `helper-${f.id}-${hId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const ownerPal = getPaletteForFighter(f);
              fighterPaletteMapRef.current.set(helperRuntimeId, ownerPal);

              helpersRef.current.push({
                id: helperRuntimeId,
                charProfileId: f.charProfileId,
                team: f.team,
                slotIdx: f.slotIdx,
                isPlayer: false,
                isHelper: true,
                helperId: hId,
                ownerId: f.id,
                hasPlayedDeathSound: false,
                posX: spawnX,
                posY: spawnY,
                velX: helperStateDef?.velSetX ?? 0,
                velY: helperStateDef?.velSetY ?? 0,
                facing: spawnFacing,
                stateNo: spawnStateNo,
                prevStateNo: 0,
                animId: airData.actions[helperAnim] ? helperAnim : f.animId,
                frameIdx: 0,
                tickInFrame: 0,
                stateTime: 0,
                stateType: helperStateDef?.stateType ?? 'A',
                moveType: helperStateDef?.moveType ?? 'A',
                physics: helperStateDef?.physics ?? 'N',
                ctrl: 0,
                life: 1000,
                trailLife: 1000,
                maxLife: 1000,
                power: f.power,
                maxPower: f.maxPower,
                attackMul: f.attackMul,
                defenceMul: f.defenceMul,
                hitPauseTicks: 0,
                hitStunTicks: 0,
                lieDownPhase: 'none',
                lieDownTimer: 0,
                invulnTicks: 0,
                comboCount: 0,
                activeHitDef: null,
                lastHitDefCtrlKey: '',
                hitScoredThisWindow: false,
                hitTargetsThisWindow: new Set(),
                moveContact: 0,
                moveHit: 0,
                moveGuarded: 0,
                firedPersist: new Set(),
                heldDirs: new Set(),
                crouchLocked: false,
                runLocked: false,
                aiActionTimer: 0,
                aiCooldown: 0,
                aiWalkDir: 0,
                aiHoldDown: false,
                aiBlockTimer: 0,
              });
            }
          } else if (ctrl.type === 'explod') {
            const exAnim = ctrl.explodAnim ?? f.animId;
            const offX = ctrl.explodOffsetX ?? 0;
            const offY = ctrl.explodOffsetY ?? 0;
            let exPosX = f.posX + offX * f.facing;
            let exPosY = f.posY + offY;
            if (ctrl.explodPosType === 'p2') {
              exPosX = opp.posX + offX * opp.facing;
              exPosY = opp.posY + offY;
            }
            const ownerPos = ctrl.explodPosType === 'p2' ? opp : f;
            if (explodsRef.current.length > 80) {
              explodsRef.current = explodsRef.current.slice(-79);
            }
            explodsRef.current.push({
              id: `explod-${f.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              explodId: ctrl.explodId ?? 0,
              ownerId: f.id,
              charProfileId: f.charProfileId,
              team: f.team,
              animId: exAnim,
              posX: exPosX,
              posY: exPosY,
              velX: ctrl.explodVelX ?? 0,
              velY: ctrl.explodVelY ?? 0,
              facing: ctrl.explodFacing === -1 ? (f.facing === 1 ? -1 : 1) : f.facing,
              vfacing: ctrl.explodVFacing ?? 1,
              bindTime: ctrl.explodBindTime ?? 0,
              removeTime: ctrl.explodRemoveTime ?? -2,
              scaleX: ctrl.explodScaleX ?? 1,
              scaleY: ctrl.explodScaleY ?? 1,
              sprPriority: ctrl.explodSprPriority ?? 3,
              frameIdx: 0,
              tickInFrame: 0,
              ageTicks: 0,
              ownerLastX: ownerPos.posX,
              ownerLastY: ownerPos.posY,
            });
          } else if (ctrl.type === 'removeexplod') {
            const targetId = ctrl.explodId;
            if (targetId !== undefined && targetId !== -1) {
              explodsRef.current = explodsRef.current.filter(e => !(e.ownerId === f.id && e.explodId === targetId));
            } else {
              explodsRef.current = explodsRef.current.filter(e => e.ownerId !== f.id);
            }
          } else if (ctrl.type === 'destroyself') {
            if (f.isHelper) f.life = 0;
          }
        }
        if (!transitioned) break;
      }
    };

    const runAiDecision = (ai: FighterRuntime, opp: FighterRuntime) => {
      const diff = aiDifficultyRef.current;
      ai.heldDirs.clear();
      ai.aiHoldDown = false;
      if (ai.stateNo === 800 && ai.stateTime < 6 && ai.throwFwdHeld !== undefined) {
        const fwdScreen = ai.facing === 1 ? 'F' : 'B';
        const backScreen = ai.facing === 1 ? 'B' : 'F';
        ai.heldDirs.add(ai.throwFwdHeld ? fwdScreen : backScreen);
      }
      if (fightOutcomeRef.current || ai.life <= 0) return;

      if (ai.posY >= 270 && ai.ctrl === 1) {
        if (opp.posX > ai.posX + 4) ai.facing = 1;
        else if (opp.posX < ai.posX - 4) ai.facing = -1;
      }

      if (diff === 'dummy') return;

      const ch = getCharForFighter(ai);
      if (!ch) return;
      const { states, rules, sortedStates } = ch.parsed;
      const airData = ch.airData;

      const dist = Math.abs(opp.posX - ai.posX);
      const isOppAttacking = opp.moveType === 'A' && dist < 135;

      if (ai.aiBlockTimer > 0) {
        ai.aiBlockTimer--;
        ai.heldDirs.add(ai.facing === 1 ? 'B' : 'F');
        if (opp.stateType === 'C' || ai.stateNo === 152) ai.aiHoldDown = true;
        return;
      }

      if (isOppAttacking && ai.ctrl === 1) {
        const blockChance = diff === 'hard' ? 0.78 : 0.42;
        if (Math.random() < blockChance) {
          ai.aiBlockTimer = 14 + Math.floor(Math.random() * 14);
          ai.heldDirs.add(ai.facing === 1 ? 'B' : 'F');
          if (opp.stateType === 'C') ai.aiHoldDown = true;
          return;
        }
      }

      if (ai.aiCooldown > 0) ai.aiCooldown--;

      if (ai.aiActionTimer > 0) {
        ai.aiActionTimer--;
        if (ai.aiWalkDir === 1) ai.heldDirs.add('F');
        else if (ai.aiWalkDir === -1) ai.heldDirs.add('B');
      }

      const canAct = ai.ctrl === 1 && ai.posY >= 270 && ai.moveType === 'I';
      if (!canAct) return;

      if (ai.aiCooldown <= 0) {
        const roll = Math.random();
        const normals = sortedStates.filter(
          s =>
            ((s.stateNo >= 200 && s.stateNo <= 250) || (s.stateNo >= 400 && s.stateNo <= 450)) &&
            (airData.actions[s.anim ?? s.stateNo] || airData.actions[s.stateNo])
        );
        const specials = sortedStates.filter(
          s => s.category === 'special' && s.moveType === 'A' && (airData.actions[s.anim ?? s.stateNo] || airData.actions[s.stateNo])
        );
        const hypers = sortedStates.filter(s => {
          if (!s.isHyper || s.moveType !== 'A') return false;
          const costFromRule = rules.find(r => r.targetState === s.stateNo)?.minPowerRequired ?? 0;
          const costFromSt = s.powerAdd && s.powerAdd < 0 ? Math.abs(s.powerAdd) : 0;
          const req = Math.max(costFromRule, costFromSt, 1000);
          return ai.power >= req && (airData.actions[s.anim ?? s.stateNo] || airData.actions[s.stateNo]);
        });

        if (hypers.length > 0 && dist < 170 && roll < (diff === 'hard' ? 0.55 : 0.35)) {
          const pick = hypers[Math.floor(Math.random() * hypers.length)];
          transitionFighterState(ai, pick.stateNo);
          ai.aiCooldown = diff === 'hard' ? 32 : 48;
          ai.aiWalkDir = 0;
          return;
        }

        const oppThrowable =
          opp.life > 0 &&
          !opp.grabbedById &&
          opp.moveType !== 'H' &&
          opp.posY >= 270 &&
          opp.stateNo !== 5110 &&
          opp.stateNo !== 5120 &&
          opp.stateNo !== 5150;
        const throwChance = diff === 'hard' ? 0.22 : 0.12;
        if (dist < 64 && oppThrowable && roll < throwChance) {
          const throwFwd = Math.random() < 0.5;
          const fwdScreen = ai.facing === 1 ? 'F' : 'B';
          const backScreen = ai.facing === 1 ? 'B' : 'F';
          ai.throwFwdHeld = throwFwd;
          ai.heldDirs.add(throwFwd ? fwdScreen : backScreen);
          if (states[800]) {
            transitionFighterState(ai, 800);
          } else {
            startBuiltinThrow(ai, opp, throwFwd ? 1 : -1);
          }
          ai.aiCooldown = diff === 'hard' ? 28 : 44;
          ai.aiWalkDir = 0;
          return;
        }

        if (dist < 82) {
          if (normals.length > 0 && roll < 0.65) {
            const pick = normals[Math.floor(Math.random() * normals.length)];
            transitionFighterState(ai, pick.stateNo);
            ai.aiCooldown = diff === 'hard' ? 16 : 28;
            ai.aiWalkDir = 0;
            return;
          } else if (specials.length > 0 && roll < 0.85) {
            const pick = specials[Math.floor(Math.random() * specials.length)];
            transitionFighterState(ai, pick.stateNo);
            ai.aiCooldown = diff === 'hard' ? 24 : 38;
            ai.aiWalkDir = 0;
            return;
          } else if (roll >= 0.88 && (states[105] || airData.actions[105])) {
            transitionFighterState(ai, 105);
            ai.aiCooldown = 30;
            ai.aiWalkDir = 0;
            return;
          }
        } else if (dist < 155) {
          if (specials.length > 0 && roll < (diff === 'hard' ? 0.35 : 0.2)) {
            const pick = specials[Math.floor(Math.random() * specials.length)];
            transitionFighterState(ai, pick.stateNo);
            ai.aiCooldown = diff === 'hard' ? 28 : 42;
            ai.aiWalkDir = 0;
            return;
          }
          ai.aiWalkDir = opp.posX >= ai.posX ? 1 : -1;
          ai.aiActionTimer = 22;
          ai.aiCooldown = 14;
          return;
        } else {
          if (roll < 0.25 && (states[100] || airData.actions[100])) {
            transitionFighterState(ai, 100);
            ai.heldDirs.add(ai.facing === 1 ? 'F' : 'B');
            ai.aiActionTimer = 20;
            ai.aiCooldown = 26;
            return;
          }
          ai.aiWalkDir = opp.posX >= ai.posX ? 1 : -1;
          ai.aiActionTimer = 28;
          ai.aiCooldown = 16;
          return;
        }
      }
    };

    const stepFighter = (f: FighterRuntime, opp: FighterRuntime) => {
      if (f.invulnTicks > 0) f.invulnTicks--;
      if (f.cmdBuffer) {
        for (const k of Object.keys(f.cmdBuffer)) {
          if (f.cmdBuffer[k] > 1) f.cmdBuffer[k]--;
          else delete f.cmdBuffer[k];
        }
      }
      if (f.trailLife > f.life) {
        if ((f.trailHoldTicks ?? 0) > 0) {
          f.trailHoldTicks = (f.trailHoldTicks ?? 0) - 1;
        } else {
          const diff = f.trailLife - f.life;
          const step = Math.max(0.65, diff * 0.055);
          f.trailLife = Math.max(f.life, f.trailLife - step);
        }
      } else if (f.trailLife < f.life) {
        f.trailLife = f.life;
        f.trailHoldTicks = 0;
      }
      if (f.hitPauseTicks > 0) return;

      // Built-in F+Y / B+Y grab-and-throw sequence for characters without .cns throw states
      if ((f.builtinThrowTicks ?? 0) > 0) {
        f.builtinThrowTicks = (f.builtinThrowTicks ?? 1) - 1;
        const tLeft = f.builtinThrowTicks;
        const tgt = findFighterById(f.grabTargetId);
        if (tgt && tgt.life > 0 && tgt.grabbedById === f.id) {
          if (tLeft >= 14) {
            tgt.posX = Math.max(-1400, Math.min(1400, f.posX + 32 * f.facing));
            tgt.posY = 270 - (22 - tLeft) * 6;
            tgt.targetBindTicks = 4;
          } else if (tLeft >= 8) {
            tgt.posX = Math.max(-1400, Math.min(1400, f.posX + (32 - (14 - tLeft) * 6) * f.facing));
            tgt.posY = 270 - 54;
            tgt.targetBindTicks = 4;
          } else if (tLeft === 7) {
            const dmg = Math.max(1, Math.round(80 * (f.attackMul / Math.max(0.1, tgt.defenceMul))));
            tgt.life = Math.max(0, tgt.life - dmg);
            tgt.trailHoldTicks = 20;
            f.power = Math.min(f.maxPower, f.power + 65);
            tgt.power = Math.min(tgt.maxPower, tgt.power + 30);
            tgt.comboCount = 1;
            sparksRef.current.push({
              x: tgt.posX,
              y: tgt.posY - 270 - 40,
              age: 0,
              maxAge: 14,
              guarded: false,
              isHyper: false,
            });
            const played = playSoundForCharacter(f.charProfileId, 5, 2);
            if (!played && tgt.life > 0) playSynthImpact('hit');
            if (tgt.life <= 0 && !tgt.hasPlayedDeathSound) {
              tgt.hasPlayedDeathSound = true;
              const playedDeath = playSoundForCharacter(tgt.charProfileId, 11, 0);
              if (!playedDeath) playSynthImpact('ko');
            }
            tgt.grabbedById = undefined;
            tgt.targetBindTicks = 0;
            f.grabTargetId = undefined;
            transitionFighterState(tgt, 5050, { asHitOrGuard: true });
            tgt.velX = -3.8;
            tgt.velY = -6.2;
            tgt.hitStunTicks = 20;
          }
        }
        if (tLeft <= 0) {
          f.builtinThrowTicks = 0;
          f.builtinThrowDir = undefined;
          transitionFighterState(f, 0);
        }
        return;
      }

      // Hold victim securely while bound during a throw; auto-release if thrower is interrupted
      if (f.grabbedById) {
        const owner = findFighterById(f.grabbedById);
        if (!owner || owner.life <= 0 || owner.moveType === 'H' || owner.ctrl === 1 || owner.stateNo === 0 || owner.grabTargetId !== f.id) {
          f.grabbedById = undefined;
          f.customStateOwnerId = undefined;
          f.customAnimOwnerId = undefined;
          f.targetBindTicks = 0;
          transitionFighterState(f, 5050, { asHitOrGuard: true });
          f.velX = -2.5;
          f.velY = -4.5;
          f.hitStunTicks = 18;
          return;
        }
        if ((f.targetBindTicks ?? 0) > 0) {
          f.targetBindTicks = (f.targetBindTicks ?? 1) - 1;
        }
        if ((owner.builtinThrowTicks ?? 0) > 0) {
          return;
        }
      }

      const ch = getStateOwnerChar(f);
      const constants = ch?.parsed.constants || DEFAULT_CONSTANTS;
      const states = ch?.parsed.states || {};
      const airData = getAnimChar(f)?.airData;

      if (
        f.posY >= 270 &&
        f.ctrl === 1 &&
        (f.stateNo === 0 || f.stateNo === 10 || f.stateNo === 11 || f.stateNo === 12 || f.stateNo === 20 || f.stateNo === 21)
      ) {
        if (opp.posX > f.posX + 5) f.facing = 1;
        else if (opp.posX < f.posX - 5) f.facing = -1;
      }

      const downNow = f.heldDirs.has('D') || f.crouchLocked || f.aiHoldDown;

      if (f.stateNo === 150 || f.stateNo === 152 || f.stateNo === 154) {
        f.hitStunTicks--;
        if (f.velX !== 0) {
          f.posX += f.velX * f.facing;
          f.velX *= 0.82;
          if (Math.abs(f.velX) < 0.1) f.velX = 0;
        }
        if (f.posY < 270) {
          f.posY += f.velY;
          f.velY += constants.yaccel;
          if (f.posY >= 270) {
            f.posY = 270;
            f.velY = 0;
          }
        }
        if (f.hitStunTicks <= 0) {
          transitionFighterState(f, f.posY < 270 ? 50 : downNow ? 11 : 0);
        }
        return;
      }

      if (f.moveType === 'H' && (f.stateNo === 5000 || f.stateNo === 5010 || f.stateNo === 5050 || f.stateNo === 5100 || f.stateNo === 5110 || f.stateNo === 5120 || f.stateNo === 5150)) {
        if (f.stateNo === 5150) {
          f.velX = 0;
          f.velY = 0;
          return;
        }
        if (f.stateNo === 5100 || f.stateNo === 5110 || f.stateNo === 5120) {
          f.lieDownTimer--;
          if (f.lieDownPhase === 'bounce' && f.lieDownTimer <= 0) {
            f.lieDownPhase = 'lie';
            f.lieDownTimer = 14;
            transitionFighterState(f, 5110, { asHitOrGuard: true });
          } else if (f.lieDownPhase === 'lie' && f.lieDownTimer <= 0) {
            if (f.life <= 0) {
              f.lieDownPhase = 'ko';
              if (!f.hasPlayedDeathSound) {
                f.hasPlayedDeathSound = true;
                const playedDeath = playSoundForCharacter(f.charProfileId, 11, 0);
                if (!playedDeath) playSynthImpact('ko');
              }
              transitionFighterState(f, 5150, { asHitOrGuard: true });
            } else {
              f.lieDownPhase = 'getup';
              f.lieDownTimer = 15;
              transitionFighterState(f, 5120, { asHitOrGuard: true });
            }
          } else if (f.lieDownPhase === 'getup' && f.lieDownTimer <= 0) {
            f.lieDownPhase = 'none';
            f.invulnTicks = 12;
            f.comboCount = 0;
            transitionFighterState(f, downNow ? 11 : 0);
          }
          return;
        }

        f.hitStunTicks--;
        if (f.velX !== 0) {
          f.posX += f.velX * f.facing;
          if (f.posY >= 270) {
            f.velX *= 0.84;
            if (Math.abs(f.velX) < 0.1) f.velX = 0;
          }
        }
        if (f.stateNo === 5050 || f.posY < 270 || f.velY < 0) {
          f.posY += f.velY;
          f.velY += constants.yaccel;
          if (f.posY >= 270) {
            f.posY = 270;
            f.velY = 0;
            f.velX = 0;
            if (f.life <= 0) {
              f.lieDownPhase = 'ko';
              if (!f.hasPlayedDeathSound) {
                f.hasPlayedDeathSound = true;
                const playedDeath = playSoundForCharacter(f.charProfileId, 11, 0);
                if (!playedDeath) playSynthImpact('ko');
              }
              transitionFighterState(f, 5150, { asHitOrGuard: true });
            } else {
              f.lieDownPhase = 'bounce';
              f.lieDownTimer = 6;
              transitionFighterState(f, 5100, { asHitOrGuard: true });
            }
            return;
          }
        } else if (f.hitStunTicks <= 0) {
          f.comboCount = 0;
          transitionFighterState(f, downNow ? 11 : 0);
          return;
        }
        return;
      }

      const canWalk = f.stateNo === 0 || f.stateNo === 20 || f.stateNo === 21;
      if (canWalk && f.posY >= 270 && !fightOutcomeRef.current) {
        if (downNow) {
          f.velX = 0;
          enterCrouch(f);
        } else if (f.heldDirs.has('F')) {
          const isWalkingForward = f.facing === 1;
          const spd = isWalkingForward ? Math.abs(constants.walkFwd) : Math.abs(constants.walkBack);
          const walkState = isWalkingForward ? 20 : 21;
          f.posX = Math.min(1400, f.posX + spd);
          if (f.stateNo !== walkState && airData?.actions[walkState]) {
            f.animId = walkState;
            f.stateNo = walkState;
            f.frameIdx = 0;
            f.tickInFrame = 0;
          }
        } else if (f.heldDirs.has('B')) {
          const isWalkingForward = f.facing === -1;
          const spd = isWalkingForward ? Math.abs(constants.walkFwd) : Math.abs(constants.walkBack);
          const walkState = isWalkingForward ? 20 : 21;
          f.posX = Math.max(-1400, f.posX - spd);
          if (f.stateNo !== walkState && airData?.actions[walkState]) {
            f.animId = walkState;
            f.stateNo = walkState;
            f.frameIdx = 0;
            f.tickInFrame = 0;
          }
        } else if (f.stateNo === 20 || f.stateNo === 21) {
          f.stateNo = 0;
          f.animId = resolveAnimForCharacter(ch, 0, states[0]);
          f.frameIdx = 0;
          f.tickInFrame = 0;
        }
      } else {
        if (
          (f.stateNo === 40 || f.stateNo === 41 || f.stateNo === 45 || f.stateNo === 50 || f.stateNo === 51) &&
          f.stateTime <= 2 &&
          f.velX === 0
        ) {
          if (f.heldDirs.has('F')) {
            f.velX = f.facing === 1 ? constants.jumpFwdX : constants.jumpBackX;
          } else if (f.heldDirs.has('B')) {
            f.velX = f.facing === -1 ? constants.jumpFwdX : constants.jumpBackX;
          }
        }

        if (f.stateNo === 100) {
          const holdRunFwd = getCharHeldDirs(f).has('F') || f.runLocked;
          const st100 = states[100];
          const hasCustomRunVel = Boolean(st100?.controllers.some(c => c.type === 'velset' || c.type === 'veladd'));
          if (holdRunFwd && !hasCustomRunVel) {
            f.velX = st100?.velSetX !== undefined ? st100.velSetX : constants.runFwdX;
          }
        }

        runControllersForFighter(f, opp);

        if (f.stateNo === 100 && !getCharHeldDirs(f).has('F') && !f.runLocked && f.stateTime >= 2) {
          f.velX = 0;
          transitionFighterState(f, downNow ? 11 : 0);
        }

        if (f.velX !== 0) {
          f.posX = Math.max(-1400, Math.min(1400, f.posX + f.velX * f.facing));
          if (f.posY >= 270 && (f.physics === 'S' || f.physics === 'C')) {
            const friction = f.physics === 'C' ? constants.crouchFriction : constants.standFriction;
            f.velX *= friction;
            if (Math.abs(f.velX) < 0.08) f.velX = 0;
          }
        }
      }

      if (!(f.grabbedById && (f.targetBindTicks ?? 0) > 0) && (f.posY < 270 || f.velY < 0)) {
        f.posY += f.velY;
        const hasGravityCtrl = Boolean(states[f.stateNo]?.controllers.some(c => c.type === 'gravity'));
        const shouldApplyGravity =
          !hasGravityCtrl &&
          (f.physics === 'A' ||
            f.stateNo === 105 ||
            (f.stateNo >= 40 && f.stateNo <= 52) ||
            (f.stateNo >= 600 && f.stateNo < 700) ||
            f.stateNo === 0 ||
            f.stateNo === 11);
        if (shouldApplyGravity) {
          f.velY += constants.yaccel;
        }
        if (f.posY >= 270) {
          f.posY = 270;
          const prevVelY = f.velY;
          f.velY = 0;
          if (
            f.stateNo === 105 ||
            (f.stateNo >= 40 && f.stateNo <= 52) ||
            (f.stateNo >= 600 && f.stateNo < 700) ||
            prevVelY > 0
          ) {
            f.landingVelY = prevVelY;
            f.pendingLanding = true;
          }
        }
      }
    };

    const advanceFighterAnim = (f: FighterRuntime, opp: FighterRuntime) => {
      if (f.hitPauseTicks > 0) {
        f.hitPauseTicks--;
        return;
      }
      if (f.stateNo === 5150) return;

      const ch = getStateOwnerChar(f);
      const states = ch?.parsed.states || {};
      const constants = ch?.parsed.constants || DEFAULT_CONSTANTS;
      const airData = getAnimChar(f)?.airData;
      const downNow = f.heldDirs.has('D') || f.crouchLocked || f.aiHoldDown;

      if (f.pendingLanding) {
        f.pendingLanding = false;
        const landVelY = f.landingVelY || 0;
        f.landingVelY = 0;
        if (f.stateNo === 105) {
          f.velX = 0;
          f.velY = 0;
          transitionFighterState(f, states[106] || airData?.actions[106] ? 106 : downNow ? 11 : 0);
          return;
        }
        if ((f.stateNo >= 40 && f.stateNo <= 52) || (f.stateNo >= 600 && f.stateNo < 700)) {
          f.velX = 0;
          f.velY = 0;
          transitionFighterState(f, downNow ? 11 : 0);
          return;
        }
        const beforeLandState = f.stateNo;
        f.velY = landVelY > 0 ? landVelY : 0.1;
        runControllersForFighter(f, opp);
        if (f.stateNo !== beforeLandState) {
          if (f.posY >= 270 && f.velY > 0) f.velY = 0;
          return;
        }
        if (f.posY >= 270 && f.velY >= 0) f.velY = 0;
        if ((f.customStateOwnerId || f.moveType === 'H') && f.posY >= 270 && !f.grabbedById) {
          f.customStateOwnerId = undefined;
          f.customAnimOwnerId = undefined;
          f.velX = 0;
          f.velY = 0;
          if (f.life <= 0) {
            f.lieDownPhase = 'ko';
            if (!f.hasPlayedDeathSound) {
              f.hasPlayedDeathSound = true;
              const playedDeath = playSoundForCharacter(f.charProfileId, 11, 0);
              if (!playedDeath) playSynthImpact('ko');
            }
            transitionFighterState(f, 5150, { asHitOrGuard: true });
          } else {
            f.lieDownPhase = 'bounce';
            f.lieDownTimer = 6;
            transitionFighterState(f, 5100, { asHitOrGuard: true });
          }
          return;
        }
        if (f.stateType === 'A' && f.posY >= 270) {
          f.velX = 0;
          f.velY = 0;
          transitionFighterState(f, downNow ? 11 : 0);
          return;
        }
      }

      if (f.stateNo === 150 || f.stateNo === 152 || f.stateNo === 154) {
        f.stateTime++;
        const act = airData?.actions[f.animId];
        if (act && act.elements.length > 0) {
          const el = act.elements[f.frameIdx] || act.elements[0];
          const ticks = el.time < 0 ? 999999 : Math.max(1, el.time);
          f.tickInFrame++;
          if (f.tickInFrame >= ticks && f.frameIdx + 1 < act.elements.length) {
            f.tickInFrame = 0;
            f.frameIdx++;
          }
        }
        return;
      }

      if (f.moveType === 'H' && (f.stateNo === 5000 || f.stateNo === 5010 || f.stateNo === 5050 || f.stateNo === 5100 || f.stateNo === 5110 || f.stateNo === 5120)) {
        if (f.stateNo === 5000 || f.stateNo === 5010 || f.stateNo === 5050) f.stateTime++;
        const act = airData?.actions[f.animId];
        if (act && act.elements.length > 0) {
          const el = act.elements[f.frameIdx] || act.elements[0];
          const ticks = el.time < 0 ? 999999 : Math.max(1, el.time);
          f.tickInFrame++;
          if (f.tickInFrame >= ticks && f.frameIdx + 1 < act.elements.length) {
            f.tickInFrame = 0;
            f.frameIdx++;
          }
        }
        return;
      }

      f.stateTime++;
      const act = airData?.actions[f.animId];
      if (act && act.elements.length > 0) {
        const el = act.elements[f.frameIdx] || act.elements[0];
        const ticks = el.time < 0 ? 999999 : Math.max(1, el.time);
        f.tickInFrame++;
        if (f.tickInFrame >= ticks) {
          f.tickInFrame = 0;
          if (f.frameIdx + 1 < act.elements.length) {
            f.frameIdx++;
          } else if (f.stateNo === 10 && downNow) {
            transitionFighterState(f, 11);
          } else if (f.stateNo === 12) {
            transitionFighterState(f, 0);
          } else {
            const isLoopState =
              f.stateNo === 0 ||
              f.stateNo === 11 ||
              f.stateNo === 20 ||
              f.stateNo === 21 ||
              f.stateNo === 100 ||
              f.stateNo === 181 ||
              f.stateNo === 180 ||
              act.loopstartIndex !== undefined;
            if (isLoopState) {
              f.frameIdx = act.loopstartIndex !== undefined ? act.loopstartIndex : 0;
            } else {
              const stDef = states[f.stateNo];
              if (stDef && stDef.controllers.length > 0) {
                const charDirsNow = getCharHeldDirs(f);
                const heldCmds = new Set<string>();
                if (charDirsNow.has('F') || f.runLocked) heldCmds.add('holdfwd');
                if (charDirsNow.has('B')) heldCmds.add('holdback');
                if (charDirsNow.has('U')) heldCmds.add('holdup');
                if (charDirsNow.has('D')) heldCmds.add('holddown');
                const pressedCmds = new Set<string>(
                  Object.entries(f.cmdBuffer || {})
                    .filter(([, t]) => t > 0)
                    .map(([name]) => name)
                );
                const endCtx: EvalContext = {
                  stateTime: f.stateTime,
                  animElem: f.frameIdx + 1,
                  animElemTick: ticks,
                  animId: f.animId,
                  animTime: 0,
                  posX: f.posX,
                  posY: f.posY - 270,
                  velX: f.velX,
                  velY: f.velY,
                  stateType: f.stateType,
                  moveType: f.moveType,
                  physics: f.physics,
                  stateNo: f.stateNo,
                  prevStateNo: f.prevStateNo,
                  ctrl: f.ctrl,
                  life: f.life,
                  maxLife: f.maxLife,
                  power: f.power,
                  maxPower: f.maxPower,
                  moveContact: f.moveContact,
                  moveHit: f.moveHit,
                  moveGuarded: f.moveGuarded,
                  mode: 'fight' as const,
                  p2BodyDistX: Math.max(0, Math.abs(opp.posX - f.posX) - 24),
                  p2PosY: opp.posY - 270,
                  p2StateType: opp.stateType,
                  p2MoveType: opp.moveType,
                  p2StateNo: opp.stateNo,
                  p2Life: opp.life,
                  actElements: act.elements,
                  constants,
                  heldCmds,
                  pressedCmds,
                  isHelper: f.isHelper,
                  helperId: f.helperId,
                  ownerId: f.ownerId || f.id,
                  helpers: helpersRef.current,
                  explods: explodsRef.current,
                  projectiles: projectilesRef.current,
                  parentLife: f.isHelper
                    ? f.ownerId
                      ? [...team1Ref.current, ...team2Ref.current].find(o => o.id === f.ownerId)?.life ?? 1000
                      : 1000
                    : f.life,
                  facing: f.facing,
                };
                for (const ctrl of stDef.controllers) {
                  if (ctrl.type !== 'changestate' && ctrl.type !== 'selfstate') continue;
                  if (ctrl.persistent === 0 && f.firedPersist.has(ctrl.id)) continue;
                  const trigText = [...ctrl.triggerAll, ...(Object.values(ctrl.triggerGroups) as string[][]).flat()];
                  if (!trigText.some(t => /animtime/i.test(t))) continue;
                  if (!doesControllerFire(ctrl, endCtx)) continue;
                  const nextS = evalMugenNumber(ctrl.valueExpr, endCtx);
                  if (nextS !== null && (ctrl.type === 'selfstate' || nextS !== f.stateNo)) {
                    if (ctrl.type === 'selfstate') {
                      if (f.grabbedById) {
                        const owner = findFighterById(f.grabbedById);
                        if (owner && owner.grabTargetId === f.id) owner.grabTargetId = undefined;
                      }
                      f.customStateOwnerId = undefined;
                      f.customAnimOwnerId = undefined;
                      f.grabbedById = undefined;
                      f.targetBindTicks = 0;
                      if (nextS === 5100) {
                        f.posY = 270;
                        f.velX = 0;
                        f.velY = 0;
                        f.lieDownPhase = 'bounce';
                        f.lieDownTimer = 6;
                        transitionFighterState(f, 5100, { asHitOrGuard: true });
                      } else {
                        transitionFighterState(f, nextS);
                        if (ctrl.ctrlVal !== undefined) f.ctrl = ctrl.ctrlVal;
                      }
                    } else {
                      transitionFighterState(f, nextS);
                      if (ctrl.ctrlVal !== undefined) f.ctrl = ctrl.ctrlVal;
                    }
                    return;
                  }
                }
              }
              const nextOnEnd = stDef ? stDef.endToState : 0;
              const stillAirborne = f.posY < 270 || f.velY < 0;
              const isAirHoldState =
                f.stateNo === 40 || f.stateNo === 41 || f.stateNo === 45 || f.stateNo === 50 || f.stateNo === 105 || f.stateType === 'A';
              if (nextOnEnd !== f.stateNo && nextOnEnd !== 0 && (states[nextOnEnd] || airData?.actions[nextOnEnd])) {
                transitionFighterState(f, nextOnEnd);
              } else if (f.isHelper) {
                f.life = 0;
                return;
              } else if (
                f.grabbedById ||
                f.customStateOwnerId ||
                f.moveType === 'H' ||
                (stillAirborne && (isAirHoldState || (stDef && stDef.controllers.some(c => c.type === 'changestate'))))
              ) {
                f.frameIdx = act.elements.length - 1;
              } else {
                transitionFighterState(f, downNow ? 11 : 0);
              }
            }
          }
        }
      }
    };

    const getHurtBoxes = (f: FighterRuntime): ClsnBox[] => {
      const ch = getAnimChar(f);
      const act = ch?.airData.actions[f.animId];
      const el = act?.elements[f.frameIdx];
      const boxes = el?.clsn2 ?? act?.clsn2;
      if (boxes && boxes.length > 0) return boxes;
      return [{ id: 0, x1: -18, y1: f.stateType === 'C' ? -55 : -85, x2: 18, y2: 0 }];
    };

    const getAtkBoxes = (f: FighterRuntime): ClsnBox[] => {
      const ch = getAnimChar(f);
      const act = ch?.airData.actions[f.animId];
      const el = act?.elements[f.frameIdx];
      const boxes = el?.clsn1 ?? act?.clsn1 ?? [];
      if (boxes.length > 0) return boxes;
      if (f.activeHitDef?.isThrow && f.stateTime <= 4) {
        return [{ id: 0, x1: 0, y1: -85, x2: 52, y2: -10 }];
      }
      if (f.isHelper && f.moveType === 'A') {
        return [{ id: 0, x1: -18, y1: -18, x2: 18, y2: 18 }];
      }
      return [];
    };

    const getProjectileAtkBoxes = (p: ProjectileRuntime): ClsnBox[] => {
      const ch = getCharForFighter(p);
      const act = ch?.airData.actions[p.animId];
      const el = act?.elements[p.frameIdx];
      const boxes = el?.clsn1 ?? act?.clsn1 ?? [];
      if (boxes.length > 0) return boxes;
      return [{ id: 0, x1: -18, y1: -18, x2: 18, y2: 18 }];
    };

    const applyHitOutcomeToDefender = (
      hitDef: ParsedHitDef,
      atkCharProfileId: string | undefined,
      atkPowerMul: number,
      def: FighterRuntime,
      hitPoint: { x: number; y: number },
      atk?: FighterRuntime
    ) => {
      const defDirs = getCharHeldDirs(def);
      const canBlockState =
        def.ctrl === 1 ||
        def.stateNo === 120 ||
        def.stateNo === 130 ||
        def.stateNo === 131 ||
        def.stateNo === 132 ||
        def.stateNo === 150 ||
        def.stateNo === 152 ||
        def.stateNo === 154;

      let isGuarded = false;
      if (canBlockState && def.moveType === 'I' && defDirs.has('B') && hitDef.guardFlag.length > 0) {
        if (def.posY < 270) {
          isGuarded = hitDef.guardFlag.includes('A');
        } else if (defDirs.has('D')) {
          isGuarded = hitDef.guardFlag.includes('L') || hitDef.guardFlag.includes('M');
        } else {
          isGuarded = hitDef.guardFlag.includes('H') || hitDef.guardFlag.includes('M');
        }
      }

      const rawBaseDmg = isGuarded ? hitDef.guardDamage : hitDef.damage;
      const scaledDmg =
        rawBaseDmg > 0 ? Math.max(1, Math.round(rawBaseDmg * (atkPowerMul / Math.max(0.1, def.defenceMul)))) : 0;

      def.life = Math.max(0, def.life - scaledDmg);
      if (scaledDmg > 0) def.trailHoldTicks = 20;
      if (atk) {
        atk.power = Math.min(atk.maxPower, atk.power + (isGuarded ? hitDef.getPowerGuard : hitDef.getPowerHit));
        atk.hitPauseTicks = Math.max(2, Math.min(18, hitDef.pauseP1));
      }
      def.power = Math.min(def.maxPower, def.power + (isGuarded ? hitDef.givePowerGuard : hitDef.givePowerHit));
      def.hitPauseTicks = Math.max(2, Math.min(18, hitDef.pauseP2));

      sparksRef.current.push({
        x: hitPoint.x,
        y: hitPoint.y,
        age: 0,
        maxAge: 14,
        guarded: isGuarded,
        isHyper: hitDef.attrMove === 'H',
      });

      if (isGuarded && def.life > 0) {
        if (atk) atk.moveGuarded = 1;
        const played = hitDef.guardSound ? playSoundForCharacter(atkCharProfileId, hitDef.guardSound.group, hitDef.guardSound.sample) : false;
        if (!played) playSynthImpact('guard');
        const guardState = def.posY < 270 ? 154 : defDirs.has('D') ? 152 : 150;
        transitionFighterState(def, guardState, { asHitOrGuard: true });
        def.velX = hitDef.guardVelX;
        def.hitStunTicks = hitDef.guardHittime;
      } else {
        if (atk) atk.moveHit = 1;
        def.comboCount = def.moveType === 'H' ? def.comboCount + 1 : 1;
        const played = hitDef.hitSound ? playSoundForCharacter(atkCharProfileId, hitDef.hitSound.group, hitDef.hitSound.sample) : false;
        if (!played && def.life > 0) playSynthImpact('hit');

        if (def.life <= 0 && !def.hasPlayedDeathSound) {
          def.hasPlayedDeathSound = true;
          const playedDeath = playSoundForCharacter(def.charProfileId, 11, 0);
          if (!playedDeath) playSynthImpact('ko');
        }

        if (def.life <= 0 || def.posY < 270 || hitDef.fall || hitDef.groundVelY < 0) {
          transitionFighterState(def, 5050, { asHitOrGuard: true });
          def.velX = def.posY < 270 ? hitDef.airVelX : hitDef.groundVelX || hitDef.airVelX;
          def.velY = hitDef.airVelY < 0 ? hitDef.airVelY : -4.8;
          def.hitStunTicks = hitDef.airHittime;
          if (def.life <= 0) {
            if (atk) atk.hitPauseTicks = 14;
            def.hitPauseTicks = 14;
          }
        } else {
          const hitState = def.stateType === 'C' ? 5010 : 5000;
          transitionFighterState(def, hitState, { asHitOrGuard: true });
          def.velX = hitDef.groundVelX;
          def.velY = 0;
          def.hitStunTicks = hitDef.groundHittime;
        }
      }
    };

    const resolveHit = (atk: FighterRuntime, def: FighterRuntime) => {
      if (def.life <= 0 || def.invulnTicks > 0 || def.stateNo === 5110 || def.stateNo === 5120 || def.stateNo === 5150) {
        return;
      }
      if ((atk.builtinThrowTicks ?? 0) > 0) return;
      if (atk.grabTargetId && def.id === atk.grabTargetId && !atk.activeHitDef) return;
      if (def.grabbedById && !atk.activeHitDef) return;

      const atkBoxes = getAtkBoxes(atk);
      if (atkBoxes.length === 0) return;

      const ch = getCharForFighter(atk);
      const states = ch?.parsed.states || {};
      const constants = ch?.parsed.constants || DEFAULT_CONSTANTS;

      let hitDef = atk.activeHitDef;
      if (!hitDef && atk.moveType === 'A' && !atk.hitScoredThisWindow) {
        const stDef = states[atk.stateNo];
        const hitDefCtrls = stDef?.controllers.filter(c => c.type === 'hitdef' && c.hitDef) || [];
        if (hitDefCtrls.length === 0) {
          const isH = Boolean(stDef?.isHyper || atk.stateNo >= 3000);
          const isS = atk.stateNo >= 1000 && atk.stateNo < 3000;
          const dmg = isH ? 130 : isS ? 82 : 42;
          hitDef = {
            attr: atk.stateType === 'A' ? 'A' : atk.stateType === 'C' ? 'C' : 'S',
            attrMove: isH ? 'H' : isS ? 'S' : 'N',
            hitFlag: 'MAF',
            guardFlag: 'MA',
            damage: dmg,
            guardDamage: isH ? 16 : isS ? 10 : 0,
            getPowerHit: isH ? 0 : 45,
            getPowerGuard: isH ? 0 : 22,
            givePowerHit: 25,
            givePowerGuard: 12,
            pauseP1: isH ? 10 : 7,
            pauseP2: isH ? 10 : 7,
            groundVelX: isH ? -7 : -4.5,
            groundVelY: isH ? -4.5 : 0,
            airVelX: -3.5,
            airVelY: -4.8,
            guardVelX: -3.8,
            groundHittime: isH ? 20 : 14,
            airHittime: 16,
            guardHittime: 12,
            fall: isH,
          };
          atk.activeHitDef = hitDef;
        } else {
          const currElem = atk.frameIdx + 1;
          const matchingCtrl = hitDefCtrls.find(c => {
            const trigs = [...c.triggerAll, ...(Object.values(c.triggerGroups) as string[][]).flat()];
            const elemNums: number[] = [];
            for (const t of trigs) {
              const m = t.match(/animelem(?:time)?\s*(?:\(\s*(\d+)\s*\)|=\s*(\d+))/i);
              if (m) elemNums.push(parseInt(m[1] || m[2], 10));
            }
            if (elemNums.length > 0 && Math.min(...elemNums) > currElem) return false;
            return true;
          });
          if (matchingCtrl?.hitDef) {
            hitDef = matchingCtrl.hitDef;
            atk.activeHitDef = hitDef;
          }
        }
      }

      if (!hitDef || atk.hitTargetsThisWindow.has(def.id)) return;
      if (def.posY < 270 && !hitDef.hitFlag.includes('A')) return;
      if (hitDef.isThrow && def.grabbedById) return;
      if (hitDef.hitFlag.includes('-') && def.moveType === 'H') return;

      const defBoxes = getHurtBoxes(def);
      const hitPoint = findBoxesOverlap(atkBoxes, atk, defBoxes, def);
      if (!hitPoint) return;

      atk.hitScoredThisWindow = true;
      atk.hitTargetsThisWindow.add(def.id);
      atk.moveContact = 1;

      if (hitDef.isThrow && (hitDef.p1StateNo !== undefined || hitDef.p2StateNo !== undefined)) {
        atk.moveHit = 1;
        atk.activeHitDef = null;
        const atkDirs = getCharHeldDirs(atk);
        const heldCmds = new Set<string>();
        if (atkDirs.has('F') || atk.throwFwdHeld) heldCmds.add('holdfwd');
        if (atkDirs.has('B')) heldCmds.add('holdback');
        if (atkDirs.has('U')) heldCmds.add('holdup');
        if (atkDirs.has('D')) heldCmds.add('holddown');
        const throwCtx: EvalContext = {
          stateTime: atk.stateTime,
          animElem: atk.frameIdx + 1,
          animElemTick: atk.tickInFrame,
          animId: atk.animId,
          animTime: -1,
          posX: atk.posX,
          posY: atk.posY - 270,
          velX: atk.velX,
          velY: atk.velY,
          stateType: atk.stateType,
          moveType: atk.moveType,
          physics: atk.physics,
          stateNo: atk.stateNo,
          prevStateNo: atk.prevStateNo,
          ctrl: atk.ctrl,
          life: atk.life,
          maxLife: atk.maxLife,
          power: atk.power,
          maxPower: atk.maxPower,
          moveContact: 1,
          moveHit: 1,
          moveGuarded: 0,
          mode: 'fight',
          constants,
          heldCmds,
          facing: atk.facing,
        };
        if (hitDef.p1FacingExpr) {
          const p1f = evalMugenNumber(hitDef.p1FacingExpr, throwCtx);
          if (p1f !== null && p1f < 0) {
            atk.facing = atk.facing === 1 ? -1 : 1;
          }
        }
        if (hitDef.p2Facing === 1) {
          def.facing = atk.facing === 1 ? -1 : 1;
        } else if (hitDef.p2Facing === -1) {
          def.facing = atk.facing;
        }
        atk.grabTargetId = def.id;
        def.grabbedById = atk.id;
        def.customStateOwnerId = atk.id;
        def.customAnimOwnerId = undefined;
        def.targetBindTicks = 12;
        def.velX = 0;
        def.velY = 0;

        if (hitDef.p2StateNo !== undefined) {
          transitionFighterState(def, hitDef.p2StateNo);
          def.grabbedById = atk.id;
          def.customStateOwnerId = atk.id;
          def.targetBindTicks = 12;
        }
        if (hitDef.p1StateNo !== undefined) {
          transitionFighterState(atk, hitDef.p1StateNo, atk.id === 'p1' ? { label: 'Throw' } : undefined);
          atk.grabTargetId = def.id;
        }
        runControllersForFighter(def, atk);
        runControllersForFighter(atk, def);
        return;
      }

      applyHitOutcomeToDefender(hitDef, atk.charProfileId, atk.attackMul, def, hitPoint, atk);
    };

    const drawProjectile = (
      ctx: CanvasRenderingContext2D,
      p: ProjectileRuntime,
      camX: number,
      canvasW: number,
      scale: number
    ) => {
      const screenX = canvasW / 2 + (p.posX - camX) * scale;
      const screenY = 270 + (p.posY - 270) * scale;
      const ch = getCharForFighter(p);
      const ownerPal = fighterPaletteMapRef.current.get(p.ownerId) || ch?.palettes[0] || null;
      const act = ch?.airData.actions[p.animId];
      const el = act?.elements[p.frameIdx];
      let drewSprite = false;

      if (act && el && ch?.sffData) {
        const sprite = ch.sffData.images.find(img => img.group === el.group && img.image === el.image);
        if (sprite) {
          const pal =
            sprite.group >= 7000 && sprite.isSharedPalette === false && sprite.palette
              ? sprite.palette
              : ownerPal || sprite.palette || ch.sffData.palettes?.[0]?.data;
          const cached = pal ? getCachedSpriteCanvas(sprite, pal) : null;
          if (cached) {
            const flipStr = (el.flip || '').toUpperCase();
            const flipH = (p.facing === -1) !== flipStr.includes('H');
            const flipV = flipStr.includes('V');
            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(
              cached,
              (el.xOffset - sprite.xOffset) * scale,
              (el.yOffset - sprite.yOffset) * scale,
              sprite.width * scale,
              sprite.height * scale
            );
            ctx.restore();
            drewSprite = true;
          }
        }
      }

      if (!drewSprite) {
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.scale(p.facing, 1);
        const isCyan = p.team === 1;
        const outerGrad = ctx.createRadialGradient(0, 0, 4 * scale, 0, 0, 22 * scale);
        outerGrad.addColorStop(0, '#ffffff');
        outerGrad.addColorStop(0.35, isCyan ? '#38bdf8' : '#fb923c');
        outerGrad.addColorStop(0.7, isCyan ? '#0284c7' : '#ea580c');
        outerGrad.addColorStop(1, 'rgba(2, 132, 199, 0)');
        ctx.fillStyle = outerGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 22 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (showClsn) {
        ctx.save();
        ctx.translate(screenX, screenY);
        if (p.facing === -1) ctx.scale(-1, 1);
        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        ctx.lineWidth = 1.5;
        const actEl = act?.elements[p.frameIdx];
        const rawBoxes = (actEl?.clsn1 ?? act?.clsn1 ?? []).length > 0 ? (actEl?.clsn1 ?? act?.clsn1!) : [{ id: 0, x1: -18, y1: -18, x2: 18, y2: 18 }];
        for (const b of rawBoxes) {
          ctx.fillRect(Math.min(b.x1, b.x2) * scale, Math.min(b.y1, b.y2) * scale, Math.abs(b.x2 - b.x1) * scale, Math.abs(b.y2 - b.y1) * scale);
          ctx.strokeRect(Math.min(b.x1, b.x2) * scale, Math.min(b.y1, b.y2) * scale, Math.abs(b.x2 - b.x1) * scale, Math.abs(b.y2 - b.y1) * scale);
        }
        ctx.restore();
      }
    };

    const drawExplod = (
      ctx: CanvasRenderingContext2D,
      ex: ExplodRuntime,
      camX: number,
      canvasW: number,
      scale: number
    ) => {
      const screenX = canvasW / 2 + (ex.posX - camX) * scale;
      const screenY = 270 + (ex.posY - 270) * scale;
      const ch = getCharForFighter(ex);
      const ownerPal = fighterPaletteMapRef.current.get(ex.ownerId) || ch?.palettes[0] || null;
      const act = ch?.airData.actions[ex.animId];
      const el = act?.elements[ex.frameIdx];
      if (!act || !el || !ch?.sffData) return;

      const sprite = ch.sffData.images.find(img => img.group === el.group && img.image === el.image);
      if (!sprite) return;
      const pal =
        sprite.group >= 7000 && sprite.isSharedPalette === false && sprite.palette
          ? sprite.palette
          : ownerPal || sprite.palette || ch.sffData.palettes?.[0]?.data;
      const cached = pal ? getCachedSpriteCanvas(sprite, pal) : null;
      if (!cached) return;

      const flipStr = (el.flip || '').toUpperCase();
      const flipH = (ex.facing === -1) !== flipStr.includes('H');
      const flipV = (ex.vfacing === -1) !== flipStr.includes('V');
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.scale((flipH ? -1 : 1) * ex.scaleX, (flipV ? -1 : 1) * ex.scaleY);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        cached,
        (el.xOffset - sprite.xOffset) * scale,
        (el.yOffset - sprite.yOffset) * scale,
        sprite.width * scale,
        sprite.height * scale
      );
      ctx.restore();
    };

    const drawFighter = (
      ctx: CanvasRenderingContext2D,
      f: FighterRuntime,
      camX: number,
      canvasW: number,
      scale: number
    ) => {
      const screenX = canvasW / 2 + (f.posX - camX) * scale;
      const screenY = 270 + (f.posY - 270) * scale;

      if (!f.isHelper) {
        const airDist = Math.max(0, 270 - f.posY);
        const shadowScale = Math.max(0.45, 1 - airDist / 160);
        ctx.fillStyle = 'rgba(0,0,0,0.48)';
        ctx.beginPath();
        ctx.ellipse(screenX, 274, 28 * shadowScale, 7 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      const ch = getCharForFighter(f);
      const animCh = getAnimChar(f);
      const fighterPal = getPaletteForFighter(f);
      const act = animCh?.airData.actions[f.animId];
      const el = act?.elements[f.frameIdx];
      let drewSprite = false;

      if (act && el && ch?.sffData) {
        const sprite = ch.sffData.images.find(img => img.group === el.group && img.image === el.image);
        if (sprite) {
          const pal =
            sprite.group >= 7000 && sprite.isSharedPalette === false && sprite.palette
              ? sprite.palette
              : fighterPal || sprite.palette || ch.sffData.palettes?.[0]?.data;
          const cached = pal ? getCachedSpriteCanvas(sprite, pal) : null;
          if (cached) {
            const flipStr = (el.flip || '').toUpperCase();
            const flipH = (f.facing === -1) !== flipStr.includes('H');
            const flipV = flipStr.includes('V');
            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(
              cached,
              (el.xOffset - sprite.xOffset) * scale,
              (el.yOffset - sprite.yOffset) * scale,
              sprite.width * scale,
              sprite.height * scale
            );
            ctx.restore();
            drewSprite = true;
          }
        }

        if (showClsn) {
          const activeClsn2 = el.clsn2 ?? act.clsn2;
          const activeClsn1 = el.clsn1 ?? act.clsn1;
          ctx.save();
          ctx.translate(screenX, screenY);
          if (f.facing === -1) ctx.scale(-1, 1);
          const drawBoxes = (boxes: ClsnBox[], stroke: string, fill: string) => {
            ctx.strokeStyle = stroke;
            ctx.fillStyle = fill;
            ctx.lineWidth = 1.5;
            for (const b of boxes) {
              const bx = Math.min(b.x1, b.x2) * scale;
              const by = Math.min(b.y1, b.y2) * scale;
              const bw = Math.abs(b.x2 - b.x1) * scale;
              const bh = Math.abs(b.y2 - b.y1) * scale;
              ctx.fillRect(bx, by, bw, bh);
              ctx.strokeRect(bx, by, bw, bh);
            }
          };
          drawBoxes(activeClsn2, '#3b82f6', 'rgba(59,130,246,0.2)');
          drawBoxes(activeClsn1, '#ef4444', 'rgba(239,68,68,0.25)');
          ctx.restore();
        }
      }

      if (f.isHelper && !drewSprite) {
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.scale(f.facing, 1);
        const isCyan = f.team === 1;
        const grad = ctx.createRadialGradient(0, 0, 2 * scale, 0, 0, 18 * scale);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.45, isCyan ? '#38bdf8' : '#fb923c');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 18 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (!f.isHelper && teamSizeRef.current > 1 && f.life > 0) {
        const tagText = f.isPlayer
          ? 'P1'
          : f.team === 1
            ? `ALLY ${f.slotIdx + 1}`
            : aiDifficultyRef.current === 'dummy'
              ? `DMY ${f.slotIdx + 1}`
              : `CPU ${f.slotIdx + 1}`;
        const tagY = Math.max(82, screenY - 92 * scale);
        ctx.save();
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillText(tagText, screenX + 1, tagY + 1);
        ctx.fillStyle = f.isPlayer ? '#34d399' : f.team === 1 ? '#2dd4bf' : '#fb7185';
        ctx.fillText(tagText, screenX, tagY);
        ctx.restore();
      }
    };

    const loop = (now: number) => {
      acc += Math.min(100, now - lastTime);
      lastTime = now;

      while (acc >= stepMs) {
        acc -= stepMs;
        const team1 = team1Ref.current;
        const team2 = team2Ref.current;
        if (team1.length === 0 || team2.length === 0) break;

        const p1 = team1[0];
        p1Ref.current = p1;
        p2Ref.current = getNearestLivingOpponent(p1, team2);
        const p2 = p2Ref.current;

        if (superPauseTicksRef.current > 0) {
          superPauseTicksRef.current--;
          if (superPauseTicksRef.current === 0) {
            superCasterRef.current = null;
            setIsHyperActive(false);
          }
          if (superMoveTimeRef.current > 0) {
            superMoveTimeRef.current--;
            const allFighters = [...team1, ...team2];
            const caster = allFighters.find(f => f.id === superCasterRef.current) || p1;
            const oppTeam = caster.team === 1 ? team2 : team1;
            const target = getNearestLivingOpponent(caster, oppTeam) || p2;
            stepFighter(caster, target);
            for (const def of oppTeam) {
              if (def.life > 0) resolveHit(caster, def);
            }
            advanceFighterAnim(caster, target);
          } else {
            continue;
          }
        } else {
          for (const f of team1) {
            const opp = getNearestLivingOpponent(f, team2);
            if (!f.isPlayer) runAiDecision(f, opp);
            stepFighter(f, opp);
          }
          for (const f of team2) {
            const opp = getNearestLivingOpponent(f, team1);
            runAiDecision(f, opp);
            stepFighter(f, opp);
          }

          // Pushbox separation
          for (const a of team1) {
            if (a.life <= 0 || a.grabbedById) continue;
            for (const b of team2) {
              if (b.life <= 0 || b.grabbedById) continue;
              if (a.grabTargetId === b.id || b.grabTargetId === a.id) continue;
              if (Math.abs(a.posY - b.posY) < 48) {
                const minSep = 30;
                const dx = b.posX - a.posX;
                if (Math.abs(dx) < minSep) {
                  const dir = dx >= 0 ? 1 : -1;
                  const push = (minSep - Math.abs(dx)) * 0.5;
                  a.posX -= dir * push;
                  b.posX += dir * push;
                }
              }
            }
          }

          // Camera & Stage clamping
          const stageLimit = 520;
          const allFighters = [...team1, ...team2];
          const living = allFighters.filter(f => f.life > 0);
          const camGroup = living.length > 0 ? living : allFighters;
          for (const f of allFighters) {
            if (!f.grabbedById) {
              f.posX = Math.max(-stageLimit, Math.min(stageLimit, f.posX));
            }
          }
          const minCamX = Math.min(...camGroup.map(f => f.posX));
          const maxCamX = Math.max(...camGroup.map(f => f.posX));
          const targetCam = Math.max(-330, Math.min(330, (minCamX + maxCamX) / 2));
          cameraXRef.current += (targetCam - cameraXRef.current) * 0.2;

          const screenHalfSpan = 190;
          for (const f of allFighters) {
            if (!f.grabbedById) {
              f.posX = Math.max(cameraXRef.current - screenHalfSpan, Math.min(cameraXRef.current + screenHalfSpan, f.posX));
            }
          }

          // Hit detection BEFORE anim advance so 1-tick moves hit reliably
          for (const atk of team1) {
            if (atk.life <= 0) continue;
            for (const def of team2) {
              if (def.life > 0) resolveHit(atk, def);
            }
          }
          for (const atk of team2) {
            if (atk.life <= 0) continue;
            for (const def of team1) {
              if (def.life > 0) resolveHit(atk, def);
            }
          }

          // Team KO detection
          const team1Alive = team1.some(f => f.life > 0);
          const team2Alive = team2.some(f => f.life > 0);
          if (!fightOutcomeRef.current && (!team1Alive || !team2Alive)) {
            const outcome: FightOutcome = !team1Alive && !team2Alive ? 'DRAW' : !team2Alive ? 'P1_WIN' : 'P2_WIN';
            fightOutcomeRef.current = outcome;
            setFightOutcome(outcome);
            const winners = outcome === 'P1_WIN' ? team1 : outcome === 'P2_WIN' ? team2 : [];
            for (const w of winners) {
              const wCh = getCharForFighter(w);
              if (w.life > 0 && w.posY >= 270 && w.ctrl === 1 && (wCh?.airData.actions[181] || wCh?.airData.actions[180])) {
                transitionFighterState(w, wCh?.airData.actions[181] ? 181 : 180);
              }
            }
          }

          for (const f of team1) {
            advanceFighterAnim(f, getNearestLivingOpponent(f, team2));
          }
          for (const f of team2) {
            advanceFighterAnim(f, getNearestLivingOpponent(f, team1));
          }

          // Helpers
          if (helpersRef.current.length > 0) {
            for (const h of helpersRef.current) {
              if (h.life <= 0) continue;
              const hOppTeam = h.team === 1 ? team2 : team1;
              const hOpp = getNearestLivingOpponent(h, hOppTeam);
              stepFighter(h, hOpp);
              if (h.life > 0) {
                for (const def of hOppTeam) {
                  if (def.life > 0) resolveHit(h, def);
                }
              }
              if (h.life > 0) advanceFighterAnim(h, hOpp);
            }
            helpersRef.current = helpersRef.current.filter(
              h => h.life > 0 && Math.abs(h.posX - cameraXRef.current) < 480 && Math.abs(h.posX) < 1200 && h.stateTime < 600
            );
          }

          // Projectiles
          if (projectilesRef.current.length > 0) {
            for (const p of projectilesRef.current) {
              p.lifeTicks++;
              const pCh = getCharForFighter(p);
              if (!p.isHitOrDying) {
                p.posX += p.velX * p.facing;
                p.posY += p.velY;
                const pOppTeam = p.team === 1 ? team2 : team1;
                const atkBoxes = getProjectileAtkBoxes(p);
                for (const def of pOppTeam) {
                  if (
                    def.life <= 0 ||
                    def.invulnTicks > 0 ||
                    def.stateNo === 5110 ||
                    def.stateNo === 5120 ||
                    def.stateNo === 5150 ||
                    p.hitTargets.has(def.id)
                  ) {
                    continue;
                  }
                  const defBoxes = getHurtBoxes(def);
                  const hitPt = findBoxesOverlap(atkBoxes, p, defBoxes, def);
                  if (hitPt) {
                    p.hitTargets.add(def.id);
                    const ownerChar = pCh;
                    const atkMult = (ownerChar?.parsed.constants.attack ?? 100) / 100;
                    applyHitOutcomeToDefender(p.hitDef, p.charProfileId, atkMult, def, hitPt);
                    p.isHitOrDying = true;
                    if (p.hitAnimId !== undefined && pCh?.airData.actions[p.hitAnimId]) {
                      p.animId = p.hitAnimId;
                      p.frameIdx = 0;
                      p.tickInFrame = 0;
                      p.velX = 0;
                      p.velY = 0;
                    } else {
                      p.lifeTicks = p.maxTicks;
                    }
                    break;
                  }
                }
              }

              const act = pCh?.airData.actions[p.animId];
              if (act && act.elements.length > 0) {
                const el = act.elements[p.frameIdx] || act.elements[0];
                const ticks = el.time < 0 ? 999999 : Math.max(1, el.time);
                p.tickInFrame++;
                if (p.tickInFrame >= ticks) {
                  p.tickInFrame = 0;
                  if (p.frameIdx + 1 < act.elements.length) {
                    p.frameIdx++;
                  } else if (!p.isHitOrDying) {
                    p.frameIdx = act.loopstartIndex !== undefined ? act.loopstartIndex : 0;
                  } else {
                    p.lifeTicks = p.maxTicks;
                  }
                }
              }
            }
            projectilesRef.current = projectilesRef.current.filter(
              p => p.lifeTicks < p.maxTicks && Math.abs(p.posX - cameraXRef.current) < 520 && Math.abs(p.posX) < 1200
            );
          }

          // Explods
          if (explodsRef.current.length > 0) {
            const allOwners = [...team1, ...team2, ...helpersRef.current];
            const nextExplods: ExplodRuntime[] = [];
            for (const ex of explodsRef.current) {
              ex.ageTicks++;
              let alive = ex.removeTime > 0 ? ex.ageTicks < ex.removeTime : true;
              if (ex.bindTime !== 0 && (ex.bindTime < 0 || ex.ageTicks <= ex.bindTime)) {
                const owner = allOwners.find(o => o.id === ex.ownerId);
                if (owner) {
                  if (ex.ownerLastX !== undefined && ex.ownerLastY !== undefined) {
                    ex.posX += owner.posX - ex.ownerLastX;
                    ex.posY += owner.posY - ex.ownerLastY;
                  }
                  ex.ownerLastX = owner.posX;
                  ex.ownerLastY = owner.posY;
                }
              } else {
                ex.posX += ex.velX * ex.facing;
                ex.posY += ex.velY;
              }

              const exCh = getCharForFighter(ex);
              const act = exCh?.airData.actions[ex.animId];
              if (act && act.elements.length > 0) {
                const el = act.elements[ex.frameIdx] || act.elements[0];
                const ticks = el.time < 0 ? 999999 : Math.max(1, el.time);
                ex.tickInFrame++;
                if (ex.tickInFrame >= ticks) {
                  ex.tickInFrame = 0;
                  if (ex.frameIdx + 1 < act.elements.length) {
                    ex.frameIdx++;
                  } else if (ex.removeTime === -2) {
                    alive = false;
                  } else {
                    ex.frameIdx = act.loopstartIndex !== undefined ? act.loopstartIndex : 0;
                  }
                }
              } else if (ex.removeTime <= 0 && ex.ageTicks >= 20) {
                alive = false;
              }
              if (alive && ex.ageTicks < 600) nextExplods.push(ex);
            }
            explodsRef.current = nextExplods;
          }
        }

        if (sparksRef.current.length > 0) {
          sparksRef.current = sparksRef.current
            .map(sp => ({ ...sp, age: sp.age + 1 }))
            .filter(sp => sp.age < sp.maxAge);
        }

        hudFrameCounter++;
        const isHealthAnimating =
          team1.some(f => Math.abs(f.trailLife - f.life) > 0.01) ||
          team2.some(f => Math.abs(f.trailLife - f.life) > 0.01);
        if (hudFrameCounter % 3 === 0 || isHealthAnimating) {
          const leadP2 = p2Ref.current || team2[0];
          const leadP2Slot = team2Slots[leadP2.slotIdx];
          const leadP2Hud = makeMemberHud(leadP2, leadP2Slot);
          const team1Combo = Math.max(0, ...team2.map(f => f.comboCount));
          const team2Combo = Math.max(0, ...team1.map(f => f.comboCount));
          const nextT1 = team1.map((f, i) => makeMemberHud(f, team1Slots[i]));
          const nextT2 = team2.map((f, i) => makeMemberHud(f, team2Slots[i]));
          const p1Life = Math.ceil(p1.life);
          const p1Trail = Math.round(p1.trailLife * 100) / 100;
          const p1Power = Math.floor(p1.power);
          const p2Name = leadP2Hud.name || 'Opponent';
          const p2PortraitUrl = leadP2Hud.portraitUrl || null;
          setFightHud(prev => {
            const membersEqual = (a: FightMemberHud[], b: FightMemberHud[]) =>
              a.length === b.length &&
              a.every(
                (m, idx) =>
                  m.id === b[idx].id &&
                  m.life === b[idx].life &&
                  m.trail === b[idx].trail &&
                  m.power === b[idx].power &&
                  m.stateNo === b[idx].stateNo &&
                  m.comboCount === b[idx].comboCount
              );
            if (
              prev.p1Life === p1Life &&
              prev.p1Trail === p1Trail &&
              prev.p1MaxLife === p1.maxLife &&
              prev.p1Power === p1Power &&
              prev.p1MaxPower === p1.maxPower &&
              prev.p1Combo === team1Combo &&
              prev.p2Life === leadP2Hud.life &&
              prev.p2Trail === leadP2Hud.trail &&
              prev.p2MaxLife === leadP2Hud.maxLife &&
              prev.p2Power === leadP2Hud.power &&
              prev.p2MaxPower === leadP2Hud.maxPower &&
              prev.p2Combo === team2Combo &&
              prev.p2Name === p2Name &&
              prev.p2PortraitUrl === p2PortraitUrl &&
              prev.p2StateNo === leadP2.stateNo &&
              membersEqual(prev.team1, nextT1) &&
              membersEqual(prev.team2, nextT2)
            ) {
              return prev;
            }
            return {
              team1: nextT1,
              team2: nextT2,
              p1Life,
              p1Trail,
              p1MaxLife: p1.maxLife,
              p1Power,
              p1MaxPower: p1.maxPower,
              p1Combo: team1Combo,
              p2Life: leadP2Hud.life,
              p2Trail: leadP2Hud.trail,
              p2MaxLife: leadP2Hud.maxLife,
              p2Power: leadP2Hud.power,
              p2MaxPower: leadP2Hud.maxPower,
              p2Combo: team2Combo,
              p2Name,
              p2PortraitUrl,
              p2StateNo: leadP2.stateNo,
            };
          });
        }
      }

      // Render Battle Canvas
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const team1 = team1Ref.current;
        const team2 = team2Ref.current;
        const p1 = team1[0];
        const allFighters = [...team1, ...team2];
        const scale = 1.6;
        const hyperFlash = superPauseTicksRef.current > 0;
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, hyperFlash ? '#1e0b36' : '#10121a');
        grad.addColorStop(0.75, hyperFlash ? '#2d124d' : '#181b28');
        grad.addColorStop(1, '#0d0f17');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (hyperFlash && p1) {
          const caster = allFighters.find(f => f.id === superCasterRef.current) || p1;
          const sx = canvas.width / 2 + (caster.posX - cameraXRef.current) * scale;
          const sy = 270 + (caster.posY - 270) * scale;
          const prog = 1 - superPauseTicksRef.current / 30;
          ctx.save();
          ctx.strokeStyle = `rgba(216, 180, 254, ${Math.max(0.1, 0.85 - prog * 0.7)})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(sx, sy - 55 * scale, 18 + prog * 140, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Floor perspective lines
        ctx.strokeStyle = hyperFlash ? 'rgba(192, 132, 252, 0.25)' : 'rgba(99, 102, 241, 0.16)';
        ctx.lineWidth = 1;
        const step = 40 * scale;
        const camOffset = (((cameraXRef.current * scale) % step) + step) % step;
        for (let gx = -camOffset; gx <= canvas.width + step; gx += step) {
          ctx.beginPath();
          ctx.moveTo(gx, 270);
          ctx.lineTo(gx + (gx - canvas.width / 2) * 0.35, canvas.height);
          ctx.stroke();
        }

        ctx.strokeStyle = hyperFlash ? 'rgba(216, 180, 254, 0.6)' : 'rgba(129, 140, 248, 0.4)';
        ctx.beginPath();
        ctx.moveTo(0, 270);
        ctx.lineTo(canvas.width, 270);
        ctx.stroke();

        const drawOrder = [...allFighters].sort((a, b) => {
          const za = (a.life <= 0 ? 0 : a.moveType === 'A' ? 2 : 1) + (a.isPlayer ? 0.5 : 0);
          const zb = (b.life <= 0 ? 0 : b.moveType === 'A' ? 2 : 1) + (b.isPlayer ? 0.5 : 0);
          return za - zb;
        });

        for (const f of drawOrder) {
          drawFighter(ctx, f, cameraXRef.current, canvas.width, scale);
        }
        for (const h of helpersRef.current) {
          drawFighter(ctx, h, cameraXRef.current, canvas.width, scale);
        }
        for (const ex of explodsRef.current) {
          drawExplod(ctx, ex, cameraXRef.current, canvas.width, scale);
        }
        for (const p of projectilesRef.current) {
          drawProjectile(ctx, p, cameraXRef.current, canvas.width, scale);
        }

        for (const sp of sparksRef.current) {
          const sx = canvas.width / 2 + (sp.x - cameraXRef.current) * scale;
          const sy = 270 + sp.y * scale;
          const t = sp.age / sp.maxAge;
          const alpha = Math.max(0, 1 - t);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.strokeStyle = sp.guarded
            ? `rgba(96, 165, 250, ${alpha})`
            : sp.isHyper
              ? `rgba(232, 121, 249, ${alpha})`
              : `rgba(251, 191, 36, ${alpha})`;
          ctx.fillStyle = sp.guarded
            ? `rgba(147, 197, 253, ${alpha * 0.5})`
            : `rgba(254, 240, 138, ${alpha * 0.7})`;
          ctx.lineWidth = sp.isHyper ? 3 : 2;
          const rad = (sp.isHyper ? 22 : 14) + t * (sp.isHyper ? 42 : 24);
          ctx.beginPath();
          ctx.arc(0, 0, rad * 0.45, 0, Math.PI * 2);
          ctx.fill();
          for (let k = 0; k < 8; k++) {
            const ang = (k * Math.PI) / 4 + t * 0.4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * rad * 0.35, Math.sin(ang) * rad * 0.35);
            ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [phase, showClsn]);

  const toggleCrouchLock = () => {
    const p1 = p1Ref.current;
    if (!p1) return;
    const next = !crouchLocked;
    setCrouchLocked(next);
    p1.crouchLocked = next;
    if (next) enterCrouch(p1);
    else exitCrouch(p1);
  };

  const toggleRunLock = () => {
    const p1 = p1Ref.current;
    if (!p1) return;
    const nextRun = !runLocked;
    setRunLocked(nextRun);
    p1.runLocked = nextRun;
    if (nextRun) {
      setCrouchLocked(false);
      p1.crouchLocked = false;
      const runLog = [...inputLogRef.current, 'F', 'F'].slice(-16);
      inputLogRef.current = runLog;
      setInputLog(runLog);
      triggerP1StateTransition(100, 'Run Forward');
    } else if (p1.stateNo === 100) {
      p1.velX = 0;
      triggerP1StateTransition(0);
    }
  };

  const visibleAttacks = buttonSlots.filter(b => b.kind === 'attack' && b.visible);
  const macroAttackIds = new Set(['m1', 'm2', 's']);
  const primaryAttacks = visibleAttacks.filter(b => !macroAttackIds.has(b.id));
  const extraAttacks = visibleAttacks.filter(b => macroAttackIds.has(b.id));
  const mainPadList = primaryAttacks.length > 0 ? primaryAttacks : visibleAttacks;
  const macroPadList = primaryAttacks.length > 0 ? extraAttacks : [];
  const splitIdx = Math.ceil(mainPadList.length / 2);
  const topAttackRow = mainPadList.slice(0, splitIdx);
  const bottomAttackRow = mainPadList.slice(splitIdx);

  const renderExternalJoystick = (compact = false) => {
    const dirFlags = {
      U: heldDirs.has('U'),
      D: heldDirs.has('D'),
      B: heldDirs.has('B'),
      F: heldDirs.has('F'),
    };
    return (
      <div className="flex flex-col items-center gap-2 select-none touch-none">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            onPointerDown={e => {
              e.preventDefault();
              e.stopPropagation();
              triggerHopBack();
            }}
            className="min-h-[40px] px-2.5 sm:px-3 py-1 rounded-xl bg-[#191922] active:scale-95 hover:bg-[#252534] border border-amber-500/50 text-amber-200 text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer touch-none whitespace-nowrap"
          >
            <CornerUpLeft size={13} />
            <span>Hop</span>
          </button>
          <button
            type="button"
            onPointerDown={e => {
              e.preventDefault();
              e.stopPropagation();
              toggleRunLock();
            }}
            className={`min-h-[40px] px-2.5 sm:px-3 py-1 rounded-xl border text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer active:scale-95 touch-none transition-colors whitespace-nowrap ${
              runLocked
                ? 'bg-indigo-600 border-indigo-300 text-white'
                : 'bg-[#191922] hover:bg-[#252534] border-indigo-500/50 text-indigo-200'
            }`}
          >
            <Move size={13} />
            <span>{runLocked ? 'Run ✓' : 'Run'}</span>
          </button>
          <button
            type="button"
            onPointerDown={e => {
              e.preventDefault();
              e.stopPropagation();
              toggleCrouchLock();
            }}
            className={`min-h-[40px] px-2.5 sm:px-3 py-1 rounded-xl border text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer active:scale-95 touch-none transition-colors whitespace-nowrap ${
              crouchLocked
                ? 'bg-cyan-600 border-cyan-300 text-white'
                : 'bg-[#191922] hover:bg-[#252534] border-cyan-500/50 text-cyan-200'
            }`}
          >
            <ArrowDown size={13} />
            <span>{crouchLocked ? 'Crch ✓' : 'Crouch'}</span>
          </button>
          <button
            type="button"
            onPointerDown={e => onAttackPointerDown(e, 's')}
            onPointerUp={onAttackPointerEnd}
            onPointerCancel={onAttackPointerEnd}
            title="Taunt (State 195 · Space / Enter)"
            className={`min-h-[40px] px-2.5 sm:px-3 py-1 rounded-xl border text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer active:scale-95 touch-none transition-colors whitespace-nowrap ${
              heldAttackTokens.has('s')
                ? 'bg-fuchsia-600 border-fuchsia-300 text-white'
                : 'bg-[#191922] hover:bg-[#252534] border-fuchsia-500/50 text-fuchsia-200'
            }`}
          >
            <Sparkles size={13} />
            <span>Taunt</span>
          </button>
        </div>

        <div
          ref={joystickZoneRef}
          onPointerDown={onJoystickPointerDown}
          onPointerMove={onJoystickPointerMove}
          onPointerUp={onJoystickPointerEnd}
          onPointerCancel={onJoystickPointerEnd}
          style={{ touchAction: 'none' }}
          className={`relative rounded-full bg-gradient-to-b from-[#1e1e28] to-[#101016] border-2 ${
            joystickKnob.activeDir ? 'border-blue-400/80 shadow-[0_0_28px_rgba(59,130,246,0.35)]' : 'border-zinc-500/60 shadow-[0_10px_30px_rgba(0,0,0,0.8)]'
          } flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing ${
            compact ? 'w-[144px] h-[144px]' : 'w-[152px] h-[152px] sm:w-[172px] sm:h-[172px]'
          }`}
        >
          <div className="absolute inset-3 rounded-full border border-white/10 pointer-events-none" />
          <div className="absolute inset-8 rounded-full border border-dashed border-white/10 pointer-events-none" />
          <span className={`absolute top-2 text-xs font-black pointer-events-none ${dirFlags.U && !dirFlags.B && !dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>▲</span>
          <span className={`absolute bottom-2 text-xs font-black pointer-events-none ${dirFlags.D && !dirFlags.B && !dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>▼</span>
          <span className={`absolute left-2.5 text-xs font-black pointer-events-none ${dirFlags.B && !dirFlags.U && !dirFlags.D ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>◀</span>
          <span className={`absolute right-2.5 text-xs font-black pointer-events-none ${dirFlags.F && !dirFlags.U && !dirFlags.D ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>▶</span>
          <span className={`absolute top-4 left-4 text-[10px] font-bold pointer-events-none ${dirFlags.U && dirFlags.B ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↖</span>
          <span className={`absolute top-4 right-4 text-[10px] font-bold pointer-events-none ${dirFlags.U && dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↗</span>
          <span className={`absolute bottom-4 left-4 text-[10px] font-bold pointer-events-none ${dirFlags.D && dirFlags.B ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↙</span>
          <span className={`absolute bottom-4 right-4 text-[10px] font-bold pointer-events-none ${dirFlags.D && dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↘</span>

          <div
            style={{ transform: `translate3d(${joystickKnob.x}px, ${joystickKnob.y}px, 0)` }}
            className={`rounded-full pointer-events-none flex items-center justify-center border-2 transition-colors ${
              compact ? 'w-14 h-14' : 'w-16 h-16 sm:w-[70px] sm:h-[70px]'
            } ${
              joystickKnob.activeDir
                ? 'bg-gradient-to-br from-blue-400 via-blue-600 to-indigo-700 border-white/80 shadow-[0_0_20px_rgba(59,130,246,0.75)]'
                : 'bg-gradient-to-br from-zinc-500 via-zinc-700 to-zinc-900 border-zinc-400/60 shadow-xl'
            }`}
          >
            <span className="text-sm font-black text-white/95 drop-shadow">{joystickKnob.activeDir || '●'}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderAttackButtonCircle = (btn: CustomButtonSlot, compact = false, colIndex = 0) => {
    const parts = splitButtonToken(btn.token);
    const isPressed = parts.length > 0 && parts.every(p => heldAttackTokens.has(p));
    const staggerClass =
      colIndex === 1 ? '-translate-y-2' : colIndex === 2 ? '-translate-y-0.5' : colIndex >= 3 ? 'translate-y-1' : '';
    return (
      <button
        key={btn.id}
        type="button"
        onPointerDown={e => onAttackPointerDown(e, btn.token)}
        onPointerUp={onAttackPointerEnd}
        onPointerCancel={onAttackPointerEnd}
        style={{ touchAction: 'none' }}
        title={`Send "${btn.token}" · Key: ${formatKeyLabel(btn.key)}`}
        className={`rounded-full border-2 font-mono font-black uppercase cursor-pointer select-none touch-none flex flex-col items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.7)] transition-transform ${staggerClass} ${
          compact ? 'w-[54px] h-[54px] text-xs' : 'w-[56px] h-[56px] sm:w-[66px] sm:h-[66px] text-sm sm:text-base'
        } ${btn.colorClass} ${isPressed ? 'ring-4 ring-white brightness-150 scale-90' : 'hover:brightness-125 active:scale-90'}`}
      >
        <span className="leading-none tracking-tight">{btn.label}</span>
        {btn.token.includes('+') ? (
          <span className="text-[8px] font-bold opacity-85 leading-none mt-0.5">{btn.token.toUpperCase()}</span>
        ) : btn.key ? (
          <span className="text-[8px] opacity-70 leading-none mt-0.5 hidden sm:inline">{formatKeyLabel(btn.key)}</span>
        ) : null}
      </button>
    );
  };

  const renderExternalActionPad = (compact = false) => (
    <div className="flex flex-col items-end justify-end gap-2 select-none touch-none">
      {macroPadList.length > 0 && (
        <div className="flex items-center gap-1.5 pb-1">
          {macroPadList.map(btn => {
            const parts = splitButtonToken(btn.token);
            const isPressed = parts.length > 0 && parts.every(p => heldAttackTokens.has(p));
            return (
              <button
                key={btn.id}
                type="button"
                onPointerDown={e => onAttackPointerDown(e, btn.token)}
                onPointerUp={onAttackPointerEnd}
                onPointerCancel={onAttackPointerEnd}
                style={{ touchAction: 'none' }}
                className={`min-h-[40px] px-3 py-1 rounded-xl border font-mono font-bold text-xs uppercase cursor-pointer select-none touch-none shadow-lg transition-transform whitespace-nowrap ${btn.colorClass} ${
                  isPressed ? 'ring-2 ring-white brightness-150 scale-95' : 'active:scale-95'
                }`}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 pr-0.5">
        {topAttackRow.map((btn, idx) => renderAttackButtonCircle(btn, compact, idx))}
      </div>
      {bottomAttackRow.length > 0 && (
        <div className="flex items-center gap-2 pr-2">
          {bottomAttackRow.map((btn, idx) => renderAttackButtonCircle(btn, compact, idx))}
        </div>
      )}
    </div>
  );

  const p1Selection = team1Slots[0];
  const p1Char = p1Selection ? rosterMap.get(p1Selection.characterId) : undefined;
  const p1PortraitUrl = p1Char && p1Selection ? getPortraitForCharacterPalette(p1Char, p1Selection.paletteIdx) : null;

  return (
    <div className="min-h-screen bg-[#0a0a0d] text-zinc-100 flex flex-col selection:bg-rose-500/30">
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files) handleImportCharacterFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files) handleImportCharacterFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Ambient Arena Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-24 left-[-10%] w-[42%] h-[42%] rounded-full bg-emerald-900/10 blur-[130px]" />
        <div className="absolute -top-24 right-[-10%] w-[42%] h-[42%] rounded-full bg-rose-900/10 blur-[130px]" />
      </div>

      {phase === 'select' ? (
        <div className="relative z-10 flex-1 flex flex-col max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 gap-5">
          {/* Top Bar */}
          <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800/90">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onBackToHome}
                className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowLeft size={14} />
                <span>Home</span>
              </button>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center shadow-lg shadow-rose-500/20 shrink-0">
                  <Swords size={18} className="text-white" />
                </div>
                <div>
                  <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-tight">
                    Versus Battle Arena
                  </h1>
                  <p className="text-xs text-zinc-400">
                    P1 (You) vs P2 (CPU) · 1v1 to 4v4 multi-character combat
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Team Size */}
              <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                {([1, 2, 3, 4] as TeamSize[]).map(sz => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setTeamSize(sz)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      teamSize === sz ? 'bg-rose-600 text-white shadow' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {sz}v{sz}
                  </button>
                ))}
              </div>

              {/* AI Difficulty */}
              <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                {(['dummy', 'normal', 'hard'] as AiDifficulty[]).map(diff => (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => setAiDifficulty(diff)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold capitalize cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      aiDifficulty === diff ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {diff === 'dummy' ? 'Dummy' : diff === 'normal' ? 'CPU Normal' : 'CPU Hard'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowCustomize(true)}
                className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal size={14} />
                <span>Controls</span>
              </button>

              <button
                type="button"
                disabled={!canStartFight}
                onClick={startOrRestartMatch}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-500 hover:to-orange-400 disabled:opacity-40 text-white text-sm font-black tracking-wide flex items-center gap-2 shadow-lg shadow-rose-600/25 cursor-pointer transition-all whitespace-nowrap shrink-0"
              >
                <Swords size={16} />
                <span>START {teamSize}v{teamSize} BATTLE</span>
              </button>
            </div>
          </header>

          {/* Team Lineups (P1 Side vs P2 Opponent Side) */}
          <section className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            {/* Team 1: Player Side */}
            <div className="bg-zinc-900/70 border border-emerald-500/25 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <h2 className="text-sm font-bold text-emerald-300 uppercase tracking-wider">
                    Team 1 · Player Side
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-zinc-400">
                  Slot 1 = P1 (You)
                </span>
              </div>

              <div className={`grid gap-2.5 ${teamSize === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {Array.from({ length: teamSize }, (_, idx) => {
                  const sel = team1Slots[idx];
                  const ch = sel ? rosterMap.get(sel.characterId) : undefined;
                  const isTarget = activeSlotTarget.team === 1 && activeSlotTarget.idx === idx;
                  const portrait = ch && sel ? getPortraitForCharacterPalette(ch, sel.paletteIdx) : null;
                  return (
                    <div
                      key={`t1-${idx}`}
                      onClick={() => setActiveSlotTarget({ team: 1, idx })}
                      className={`rounded-xl p-3 border transition-all cursor-pointer flex items-center gap-3 ${
                        isTarget
                          ? 'bg-emerald-950/40 border-emerald-400 ring-2 ring-emerald-400/25'
                          : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="w-12 h-12 rounded-lg bg-zinc-900 border border-emerald-500/35 overflow-hidden flex items-center justify-center shrink-0">
                        {portrait ? (
                          <img
                            src={portrait}
                            alt={ch?.name || 'Fighter'}
                            className="w-full h-full object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <Gamepad2 size={18} className="text-emerald-400/70" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-bold uppercase text-emerald-400">
                            {idx === 0 ? 'P1 · YOU' : `ALLY ${idx + 1} (AI)`}
                          </span>
                          {isTarget && (
                            <span className="text-[10px] font-mono text-emerald-300 font-bold">TARGET</span>
                          )}
                        </div>
                        <p className="text-sm font-bold text-white truncate">
                          {ch ? ch.name : 'Click a character below'}
                        </p>
                        {ch && (
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-[10px] font-mono text-zinc-400">
                              HP {ch.parsed.constants.life} · ATK {ch.parsed.constants.attack}%
                            </span>
                            {ch.palettes.length > 1 && (
                              <div className="flex items-center flex-wrap gap-1" onClick={e => e.stopPropagation()}>
                                {ch.palettes.map((pal, pIdx) => {
                                  const mappedBtns = getKeymapButtonsForPaletteIndex(
                                    pIdx,
                                    ch.paletteKeymap,
                                    ch.palettes.length,
                                    ch.palSlotIndices
                                  );
                                  const hint = mappedBtns.length > 0 ? ` · Key [${mappedBtns.slice(0, 2).map(b => b.toUpperCase()).join('/')}]` : '';
                                  return (
                                    <button
                                      key={pIdx}
                                      type="button"
                                      onClick={() => handleCycleSlotPalette(1, idx, pIdx)}
                                      title={`Palette ${pIdx + 1}${hint}`}
                                      className={`w-3.5 h-3.5 rounded-full border cursor-pointer transition-transform ${
                                        sel?.paletteIdx === pIdx ? 'border-white scale-125' : 'border-zinc-700 opacity-70 hover:opacity-100'
                                      }`}
                                      style={{ backgroundColor: getPaletteSwatchColor(pal) }}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Center VS & Quick Actions */}
            <div className="flex lg:flex-col items-center justify-center gap-2 py-1">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-700 flex items-center justify-center font-black text-base text-amber-400 shadow-inner">
                VS
              </div>
              <button
                type="button"
                onClick={handleRandomizeLineups}
                disabled={roster.length === 0}
                title="Randomize teams with different characters"
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
              >
                <Shuffle size={12} />
                <span>Randomize</span>
              </button>
            </div>

            {/* Team 2: Opponent Side */}
            <div className="bg-zinc-900/70 border border-rose-500/25 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                  <h2 className="text-sm font-bold text-rose-300 uppercase tracking-wider">
                    Team 2 · Opponent Side
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-zinc-400">
                  Slot 1 = P2 Opponent
                </span>
              </div>

              <div className={`grid gap-2.5 ${teamSize === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {Array.from({ length: teamSize }, (_, idx) => {
                  const sel = team2Slots[idx];
                  const ch = sel ? rosterMap.get(sel.characterId) : undefined;
                  const isTarget = activeSlotTarget.team === 2 && activeSlotTarget.idx === idx;
                  const portrait = ch && sel ? getPortraitForCharacterPalette(ch, sel.paletteIdx) : null;
                  return (
                    <div
                      key={`t2-${idx}`}
                      onClick={() => setActiveSlotTarget({ team: 2, idx })}
                      className={`rounded-xl p-3 border transition-all cursor-pointer flex items-center gap-3 ${
                        isTarget
                          ? 'bg-rose-950/40 border-rose-400 ring-2 ring-rose-400/25'
                          : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="w-12 h-12 rounded-lg bg-zinc-900 border border-rose-500/35 overflow-hidden flex items-center justify-center shrink-0">
                        {portrait ? (
                          <img
                            src={portrait}
                            alt={ch?.name || 'Opponent'}
                            className="w-full h-full object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <Cpu size={18} className="text-rose-400/70" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-bold uppercase text-rose-400">
                            {idx === 0 ? 'P2 · OPPONENT' : `CPU ${idx + 1}`}
                          </span>
                          {isTarget && (
                            <span className="text-[10px] font-mono text-rose-300 font-bold">TARGET</span>
                          )}
                        </div>
                        <p className="text-sm font-bold text-white truncate">
                          {ch ? ch.name : 'Click a character below'}
                        </p>
                        {ch && (
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-[10px] font-mono text-zinc-400">
                              HP {ch.parsed.constants.life} · ATK {ch.parsed.constants.attack}%
                            </span>
                            {ch.palettes.length > 1 && (
                              <div className="flex items-center flex-wrap gap-1" onClick={e => e.stopPropagation()}>
                                {ch.palettes.map((pal, pIdx) => {
                                  const mappedBtns = getKeymapButtonsForPaletteIndex(
                                    pIdx,
                                    ch.paletteKeymap,
                                    ch.palettes.length,
                                    ch.palSlotIndices
                                  );
                                  const hint = mappedBtns.length > 0 ? ` · Key [${mappedBtns.slice(0, 2).map(b => b.toUpperCase()).join('/')}]` : '';
                                  return (
                                    <button
                                      key={pIdx}
                                      type="button"
                                      onClick={() => handleCycleSlotPalette(2, idx, pIdx)}
                                      title={`Palette ${pIdx + 1}${hint}`}
                                      className={`w-3.5 h-3.5 rounded-full border cursor-pointer transition-transform ${
                                        sel?.paletteIdx === pIdx ? 'border-white scale-125' : 'border-zinc-700 opacity-70 hover:opacity-100'
                                      }`}
                                      style={{ backgroundColor: getPaletteSwatchColor(pal) }}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* [Palette Keymap] Interactive Selector Bar for Active Target Slot */}
          {(() => {
            const targetSel = activeSlotTarget.team === 1 ? team1Slots[activeSlotTarget.idx] : team2Slots[activeSlotTarget.idx];
            const targetChar = targetSel ? rosterMap.get(targetSel.characterId) : undefined;
            if (!targetChar || targetChar.palettes.length === 0) return null;

            const keysToShow: PaletteKeyName[] = showKeymapBank2
              ? [...PALETTE_KEYMAP_KEYS]
              : PALETTE_KEYMAP_KEYS.slice(0, 6);

            const keyForBtn = (btnId: string) => {
              const baseId = btnId.replace('2', '');
              const slot = buttonSlots.find(s => s.id === baseId);
              const label = slot?.key ? formatKeyLabel(slot.key) : baseId.toUpperCase();
              return btnId.endsWith('2') ? `⇧+${label}` : label;
            };

            return (
              <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                        Palette Keymap
                      </span>
                      <span className={`text-xs font-bold ${activeSlotTarget.team === 1 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {activeSlotTarget.team === 1
                          ? activeSlotTarget.idx === 0
                            ? 'P1 (You)'
                            : `Ally ${activeSlotTarget.idx + 1}`
                          : activeSlotTarget.idx === 0
                            ? 'P2 (Opponent)'
                            : `CPU ${activeSlotTarget.idx + 1}`}{' '}
                        · {targetChar.name}
                      </span>
                      {keymapFeedback && (
                        <span className="text-[11px] font-mono font-bold text-amber-300">
                          {keymapFeedback}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-zinc-500">
                      Press bound X/Y/Z/A/B/C keys (hold Shift for X2–C2) · pal.defaults = {targetChar.palDefaults.join(',')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-1.5">
                  {keysToShow.map(btnKey => {
                    const palNum = targetChar.paletteKeymap[btnKey] ?? 1;
                    const resolvedIdx = resolvePaletteSlotIndex(palNum, targetChar.palettes.length, targetChar.palSlotIndices);
                    const palData = targetChar.palettes[resolvedIdx];
                    const isSelected = targetSel?.paletteIdx === resolvedIdx;
                    return (
                      <button
                        key={btnKey}
                        type="button"
                        onClick={() => handleSelectPaletteByKeymapButton(btnKey)}
                        title={`Keymap ${btnKey.toUpperCase()} = pal${palNum} (keyboard: ${keyForBtn(btnKey)})`}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                          isSelected
                            ? 'bg-zinc-100 text-zinc-950 border-white font-bold shadow'
                            : 'bg-zinc-950 hover:bg-zinc-800 text-zinc-200 border-zinc-700'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/40 shrink-0"
                          style={{ backgroundColor: getPaletteSwatchColor(palData) }}
                        />
                        <span className="uppercase font-bold">{btnKey}</span>
                        <span className={isSelected ? 'text-zinc-700' : 'text-zinc-500'}>
                          P{palNum}
                        </span>
                        <span className={`text-[10px] ${isSelected ? 'text-zinc-600' : 'text-zinc-500'}`}>
                          ({keyForBtn(btnKey)})
                        </span>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setShowKeymapBank2(b => !b)}
                    className={`px-2 py-1 rounded-lg border text-[10px] font-mono cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      showKeymapBank2
                        ? 'bg-amber-500/20 border-amber-400/60 text-amber-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {showKeymapBank2 ? 'Hide X2–C2' : '+ X2–C2'}
                  </button>
                </div>
              </section>
            );
          })()}

          {/* Character Roster & Multi-Importer */}
          <section
            onDragOver={e => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={e => {
              e.preventDefault();
              setIsDraggingOver(false);
              if (e.dataTransfer.files?.length) {
                handleImportCharacterFiles(e.dataTransfer.files);
              }
            }}
            className={`flex-1 bg-zinc-900/50 border rounded-2xl p-4 sm:p-5 flex flex-col gap-4 transition-colors ${
              isDraggingOver ? 'border-rose-400 bg-rose-950/20' : 'border-zinc-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Users size={16} className="text-amber-400" />
                  <span>Character Roster ({roster.length})</span>
                </h3>
                <p className="text-xs text-zinc-400">
                  Assigning to{' '}
                  <span className={activeSlotTarget.team === 1 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {activeSlotTarget.team === 1
                      ? activeSlotTarget.idx === 0
                        ? 'Team 1 · P1 (You)'
                        : `Team 1 · Ally ${activeSlotTarget.idx + 1}`
                      : activeSlotTarget.idx === 0
                        ? 'Team 2 · P2 (Opponent)'
                        : `Team 2 · CPU ${activeSlotTarget.idx + 1}`}
                  </span>{' '}
                  — click any fighter card to equip. Drop .ZIP archives or select individual character files to add fighters.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => zipInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-900 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
                >
                  <Upload size={14} />
                  <span>{isImporting ? 'Importing...' : 'Import Character (.zip)'}</span>
                </button>
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => folderInputRef.current?.click()}
                  title="Select individual character files (.def, .sff, .air, .act, .cmd, .cns, .snd)"
                  className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
                >
                  <FolderOpen size={14} />
                  <span>Import Files</span>
                </button>
              </div>
            </div>

            {importNotice && (
              <div className="px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 flex items-center justify-between gap-2">
                <span>{importNotice}</span>
                <button
                  type="button"
                  onClick={() => setImportNotice(null)}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {isLoadingRoster ? (
              <div className="py-12 text-center text-sm text-zinc-400">Loading saved characters...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {roster.map(ch => {
                  const assignedT1 = activeTeam1Selections
                    .map((s, i) => (s?.characterId === ch.id ? (i === 0 ? 'P1' : `A${i + 1}`) : null))
                    .filter(Boolean);
                  const assignedT2 = activeTeam2Selections
                    .map((s, i) => (s?.characterId === ch.id ? (i === 0 ? 'P2' : `C${i + 1}`) : null))
                    .filter(Boolean);
                  return (
                    <div
                      key={ch.id}
                      onClick={() => handleAssignCharToActiveSlot(ch)}
                      className="group bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 hover:border-amber-400/60 rounded-xl p-3 cursor-pointer transition-all flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-14 h-14 rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                          {ch.defaultPortraitUrl ? (
                            <img
                              src={ch.defaultPortraitUrl}
                              alt={ch.name}
                              className="w-full h-full object-contain"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          ) : (
                            <Gamepad2 size={20} className="text-zinc-500" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-mono text-zinc-500 uppercase">
                              {ch.source === 'imported' ? 'Imported' : ch.source === 'saved' ? 'Saved Studio' : 'Built-in'}
                            </span>
                            {ch.source === 'imported' && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleRemoveImportedChar(ch.id);
                                }}
                                title="Remove from roster"
                                className="p-1 text-zinc-500 hover:text-rose-400 rounded cursor-pointer"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                          <h4 className="text-sm font-bold text-white truncate group-hover:text-amber-300 transition-colors">
                            {ch.name}
                          </h4>
                          <p className="text-[11px] font-mono text-zinc-400 mt-0.5 truncate">
                            HP {ch.parsed.constants.life} · {ch.palettes.length} pal
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-[10px] font-mono text-zinc-400">
                        <span>
                          {ch.spriteCount} spr · {ch.animCount} anim
                        </span>
                        <div className="flex items-center gap-1">
                          {assignedT1.map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 font-bold">
                              {tag}
                            </span>
                          ))}
                          {assignedT2.map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-rose-600/20 text-rose-300 border border-rose-500/40 font-bold">
                              {tag}
                            </span>
                          ))}
                          {assignedT1.length === 0 && assignedT2.length === 0 && (
                            <span className="text-amber-400/80 group-hover:text-amber-300 font-semibold flex items-center gap-0.5">
                              <Plus size={11} /> Equip
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* FIGHT PHASE */
        <div className="relative z-10 flex-1 flex flex-col max-w-6xl w-full mx-auto px-3 sm:px-5 py-3 gap-3">
          {/* Fight Top Bar */}
          <div className="px-3 sm:px-4 py-2 bg-[#121218] border border-zinc-800 rounded-2xl flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => {
                  releaseAllInputs();
                  setPhase('select');
                }}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowLeft size={13} />
                <span>Character Select</span>
              </button>
              <span className="text-xs sm:text-sm font-bold text-white truncate">
                {teamSize}v{teamSize} Match · {p1Char?.name || 'P1'} vs {fightHud.p2Name}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex bg-[#1a1a21] p-0.5 rounded-lg border border-zinc-800">
                {(['dummy', 'normal', 'hard'] as AiDifficulty[]).map(diff => (
                  <button
                    key={diff}
                    type="button"
                    onClick={() => setAiDifficulty(diff)}
                    className={`px-2 py-1 rounded text-[10px] font-semibold capitalize cursor-pointer whitespace-nowrap ${
                      aiDifficulty === diff ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {diff === 'dummy' ? 'Dummy' : diff}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowClsn(s => !s)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  showClsn
                    ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                }`}
              >
                <Eye size={12} />
                <span>Hitboxes</span>
              </button>

              <button
                type="button"
                onClick={() => setShowExternalPad(p => !p)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  showExternalPad
                    ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                }`}
              >
                <Gamepad2 size={12} />
                <span>Pad</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCustomize(true)}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <SlidersHorizontal size={12} />
                <span>Controls</span>
              </button>

              <button
                type="button"
                onClick={startOrRestartMatch}
                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw size={12} />
                <span>Rematch</span>
              </button>
            </div>
          </div>

          {/* Arcade Canvas + Integrated HUD */}
          <div className="relative bg-[#09090d] border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
            {/* MUGEN Health / Power / Portrait HUD */}
            <div className="px-3 sm:px-4 pt-3 pb-2 bg-gradient-to-b from-[#0b0b12] to-[#11121a] border-b border-zinc-800/80 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
              {/* Left: P1 & Allies */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-zinc-950 border-2 border-emerald-400/75 overflow-hidden flex items-center justify-center shrink-0">
                    {p1PortraitUrl ? (
                      <img
                        src={p1PortraitUrl}
                        alt={p1Char?.name || 'P1'}
                        className="w-full h-full object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <Gamepad2 size={18} className="text-emerald-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-[11px] font-mono mb-0.5">
                      <span className="font-bold text-emerald-300 truncate">P1 · {p1Char?.name || 'Player'}</span>
                      <span className="text-zinc-200 font-bold shrink-0">
                        {fightHud.p1Life}/{fightHud.p1MaxLife}
                      </span>
                    </div>
                    <div className="h-3.5 bg-zinc-950 border border-zinc-700 rounded overflow-hidden relative">
                      <div
                        className="absolute inset-y-0 right-0 bg-rose-500/90"
                        style={{ width: `${Math.max(0, Math.min(100, (fightHud.p1Trail / Math.max(1, fightHud.p1MaxLife)) * 100))}%` }}
                      />
                      <div
                        className="absolute inset-y-0 right-0 bg-gradient-to-l from-emerald-400 to-lime-300 transition-[width] duration-150 ease-out"
                        style={{ width: `${Math.max(0, Math.min(100, (fightHud.p1Life / Math.max(1, fightHud.p1MaxLife)) * 100))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="flex-1 h-2 bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-sky-300 transition-[width] duration-100 ease-out"
                          style={{ width: `${Math.max(0, Math.min(100, (fightHud.p1Power / Math.max(1, fightHud.p1MaxPower)) * 100))}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-cyan-300 shrink-0">
                        PWR {Math.floor(fightHud.p1Power / 1000)} ({fightHud.p1Power})
                      </span>
                    </div>
                  </div>
                </div>

                {teamSize > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {fightHud.team1.map((m, i) => (
                      <div
                        key={m.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-mono ${
                          m.life <= 0
                            ? 'bg-zinc-950/60 border-zinc-800 text-zinc-500 opacity-60'
                            : 'bg-zinc-900/90 border-emerald-500/30 text-zinc-200'
                        }`}
                      >
                        <span className="font-bold text-emerald-400">{i === 0 ? 'P1' : `A${i + 1}`}</span>
                        <span className="truncate max-w-[75px]">{m.name}</span>
                        <span className="text-zinc-400">{m.life <= 0 ? 'KO' : m.life}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Center Infinite Time */}
              <div className="flex flex-col items-center justify-center px-2 pt-1">
                <div className="w-11 h-10 rounded-xl bg-zinc-950 border border-amber-500/40 flex items-center justify-center text-2xl font-black text-amber-300 leading-none">
                  ∞
                </div>
                <span className="text-[9px] font-mono text-zinc-500 mt-1">
                  {teamSize}v{teamSize}
                </span>
              </div>

              {/* Right: P2 & CPU Teammates */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-row-reverse">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-zinc-950 border-2 border-rose-400/75 overflow-hidden flex items-center justify-center shrink-0">
                    {fightHud.p2PortraitUrl ? (
                      <img
                        src={fightHud.p2PortraitUrl}
                        alt={fightHud.p2Name}
                        className="w-full h-full object-contain -scale-x-100"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <Cpu size={18} className="text-rose-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-[11px] font-mono mb-0.5 flex-row-reverse">
                      <span className="font-bold text-rose-300 truncate">P2 · {fightHud.p2Name}</span>
                      <span className="text-zinc-200 font-bold shrink-0">
                        {fightHud.p2Life}/{fightHud.p2MaxLife}
                      </span>
                    </div>
                    <div className="h-3.5 bg-zinc-950 border border-zinc-700 rounded overflow-hidden relative">
                      <div
                        className="absolute inset-y-0 left-0 bg-amber-400/90"
                        style={{ width: `${Math.max(0, Math.min(100, (fightHud.p2Trail / Math.max(1, fightHud.p2MaxLife)) * 100))}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-500 to-orange-400 transition-[width] duration-150 ease-out"
                        style={{ width: `${Math.max(0, Math.min(100, (fightHud.p2Life / Math.max(1, fightHud.p2MaxLife)) * 100))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 flex-row-reverse">
                      <div className="flex-1 h-2 bg-zinc-950 border border-zinc-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-l from-amber-500 to-rose-400 ml-auto transition-[width] duration-100 ease-out"
                          style={{ width: `${Math.max(0, Math.min(100, (fightHud.p2Power / Math.max(1, fightHud.p2MaxPower)) * 100))}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-amber-300 shrink-0">
                        PWR {Math.floor(fightHud.p2Power / 1000)} ({fightHud.p2Power})
                      </span>
                    </div>
                  </div>
                </div>

                {teamSize > 1 && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {fightHud.team2.map((m, i) => (
                      <div
                        key={m.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-mono ${
                          m.life <= 0
                            ? 'bg-zinc-950/60 border-zinc-800 text-zinc-500 opacity-60'
                            : 'bg-zinc-900/90 border-rose-500/30 text-zinc-200'
                        }`}
                      >
                        <span className="font-bold text-rose-400">{i === 0 ? 'P2' : `C${i + 1}`}</span>
                        <span className="truncate max-w-[75px]">{m.name}</span>
                        <span className="text-zinc-400">{m.life <= 0 ? 'KO' : m.life}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Canvas Viewport */}
            <div className="relative flex justify-center bg-[#09090d]">
              <canvas
                ref={canvasRef}
                width={760}
                height={330}
                className="w-full max-w-[880px] h-auto block"
                style={{ imageRendering: 'pixelated' }}
              />

              {/* Combo Callouts */}
              {fightHud.p1Combo >= 2 && (
                <div className="absolute left-4 top-4 pointer-events-none">
                  <div className="text-2xl sm:text-3xl font-black italic text-amber-300 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                    {fightHud.p1Combo} HITS!
                  </div>
                </div>
              )}
              {fightHud.p2Combo >= 2 && (
                <div className="absolute right-4 top-4 pointer-events-none text-right">
                  <div className="text-2xl sm:text-3xl font-black italic text-rose-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                    {fightHud.p2Combo} HITS!
                  </div>
                </div>
              )}

              {/* Fight Start Banner */}
              {fightBanner && !fightOutcome && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="px-6 py-2 rounded-2xl bg-black/75 border border-amber-400/60 text-2xl sm:text-4xl font-black italic tracking-wider text-amber-300 shadow-2xl">
                    {fightBanner}
                  </div>
                </div>
              )}

              {/* Hyper Banner */}
              {isHyperActive && !fightOutcome && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none px-3 py-1 rounded bg-purple-950/90 border border-purple-400/60 text-xs font-black tracking-widest text-purple-200 flex items-center gap-1">
                  <Zap size={12} className="text-purple-300" /> HYPER FINISH / SUPER PAUSE
                </div>
              )}

              {/* K.O. / Match Result Overlay */}
              {fightOutcome && (
                <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 p-4">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Trophy size={28} />
                    <span className="text-2xl sm:text-4xl font-black italic tracking-wider uppercase drop-shadow">
                      {fightOutcome === 'P1_WIN'
                        ? teamSize > 1
                          ? 'TEAM 1 VICTORY!'
                          : `${p1Char?.name || 'P1'} WINS!`
                        : fightOutcome === 'P2_WIN'
                          ? teamSize > 1
                            ? 'OPPONENT TEAM WINS!'
                            : `${fightHud.p2Name} WINS!`
                          : 'DOUBLE K.O.!'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={startOrRestartMatch}
                      className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold flex items-center gap-2 shadow-lg cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw size={15} />
                      <span>Rematch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        releaseAllInputs();
                        setPhase('select');
                      }}
                      className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <Shield size={15} />
                      <span>Character Select</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Compact Status & Input History Footer */}
            <div className="px-3 sm:px-4 py-1.5 bg-[#0e0e14] border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-400">
              <div className="flex items-center gap-2 truncate">
                <span className="text-zinc-500">Move:</span>
                <span className="text-emerald-300 font-semibold truncate">{matchedMove || 'Neutral'}</span>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto max-w-full">
                {inputLog.slice(-8).map((tok, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-[10px]">
                    {tok}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* External Mobile Touch Controller (Outside Battle Canvas) */}
          {showExternalPad && (
            <div className="bg-[#121218] border border-zinc-800 rounded-2xl px-4 py-3 flex flex-wrap items-end justify-between gap-4">
              {renderExternalJoystick(isLandscapeShort)}
              <div className="hidden md:flex flex-col items-center text-center gap-1 text-[11px] text-zinc-500 font-mono">
                <span>Keyboard Controls</span>
                <span>
                  Move: {buttonSlots.filter(b => b.kind === 'dir').map(b => formatKeyLabel(b.key)).join(' ')}
                </span>
                <span>
                  Attacks:{' '}
                  {buttonSlots
                    .filter(b => b.kind === 'attack' && b.visible)
                    .map(b => `${formatKeyLabel(b.key)}(${b.label})`)
                    .join(' ')}
                </span>
                <span>Throw: F/B+Y · Taunt: Space / Enter</span>
              </div>
              {renderExternalActionPad(isLandscapeShort)}
            </div>
          )}
        </div>
      )}

      {/* Keyboard / Attack Customization Modal */}
      {showCustomize && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            setListeningSlotId(null);
            setShowCustomize(false);
          }}
        >
          <div
            className="bg-[#16161d] border border-zinc-700 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-[#111116] border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Keyboard size={16} className="text-purple-400" />
                <h3 className="text-sm font-bold text-white">Player 1 Controls & Keybinds</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setListeningSlotId(null);
                  setShowCustomize(false);
                }}
                className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400">Quick Presets:</span>
                <button
                  type="button"
                  onClick={() => applyButtonPreset('default')}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
                >
                  Arrows + U/I/O/J/K/L
                </button>
                <button
                  type="button"
                  onClick={() => applyButtonPreset('wasd')}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
                >
                  WASD + U/I/O/J/K/L
                </button>
                <button
                  type="button"
                  onClick={() => applyButtonPreset('kof4')}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
                >
                  KOF 4-Button
                </button>
              </div>

              <div className="space-y-2">
                {buttonSlots.map(slot => (
                  <div
                    key={slot.id}
                    className="grid grid-cols-[90px_1fr_1fr_auto] items-center gap-2 bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2 text-xs"
                  >
                    <span className="font-mono font-bold text-zinc-200">
                      {slot.kind === 'dir' ? `Dir ${slot.label}` : `Btn ${slot.id.toUpperCase()}`}
                    </span>
                    {slot.kind === 'attack' ? (
                      <select
                        value={slot.token}
                        onChange={e => {
                          const val = e.target.value;
                          setButtonSlots(prev =>
                            prev.map(s => (s.id === slot.id ? { ...s, token: val, label: val.toUpperCase() } : s))
                          );
                        }}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-200 font-mono"
                      >
                        {availableCmdTokens.map(tok => (
                          <option key={tok} value={tok}>
                            {tok.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-zinc-500 font-mono">{slot.token}</span>
                    )}

                    <button
                      type="button"
                      onClick={() => setListeningSlotId(slot.id)}
                      className={`px-2.5 py-1 rounded-lg border font-mono cursor-pointer ${
                        listeningSlotId === slot.id
                          ? 'bg-amber-600/30 border-amber-400 text-amber-200 animate-pulse'
                          : 'bg-zinc-950 border-zinc-700 text-zinc-200 hover:border-zinc-500'
                      }`}
                    >
                      {listeningSlotId === slot.id ? 'Press any key...' : formatKeyLabel(slot.key)}
                    </button>

                    {slot.kind === 'attack' ? (
                      <label className="flex items-center gap-1 text-[11px] text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={slot.visible}
                          onChange={e =>
                            setButtonSlots(prev =>
                              prev.map(s => (s.id === slot.id ? { ...s, visible: e.target.checked } : s))
                            )
                          }
                        />
                        Show
                      </label>
                    ) : (
                      <span className="text-[10px] text-zinc-500">Fixed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VersusArena;
