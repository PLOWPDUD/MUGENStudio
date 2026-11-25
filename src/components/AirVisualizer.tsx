import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Download,
  Film,
  GripVertical,
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { applyPalette } from '../lib/mugen/actParser';
import { serializeAirData } from '../lib/mugen/airParser';
import type { AirAction, AirData, AirElement, SffData, SffImage } from '../lib/mugen/types';

// Shared offscreen canvas cache so SFF sprite thumbnails render instantaneously
const airThumbCanvasCache = new WeakMap<Uint8Array, Map<Uint8Array, HTMLCanvasElement>>();

function getAirCachedSpriteCanvas(sprite: SffImage, palette: Uint8Array): HTMLCanvasElement | null {
  if (!sprite?.pixelIndices || !palette || sprite.width <= 0 || sprite.height <= 0) return null;
  let palMap = airThumbCanvasCache.get(sprite.pixelIndices);
  if (!palMap) {
    palMap = new Map();
    airThumbCanvasCache.set(sprite.pixelIndices, palMap);
  }
  let cached = palMap.get(palette);
  if (!cached) {
    const imgData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, palette);
    cached = document.createElement('canvas');
    cached.width = sprite.width;
    cached.height = sprite.height;
    const ctx = cached.getContext('2d');
    if (ctx) ctx.putImageData(imgData, 0, 0);
    palMap.set(palette, cached);
  }
  return cached;
}

export function resolveSpritePalette(
  sprite: SffImage | undefined,
  sffData: SffData | null,
  selectedPaletteIdx: number,
  actPalette: Uint8Array | null
): Uint8Array | null {
  if (!sprite) return null;
  const selectionPal = sffData?.palettes?.[selectedPaletteIdx]?.data;
  const firstSffPal = sffData?.palettes?.[0]?.data;
  const isDedicatedPortraitOrFx =
    sprite.group >= 7000 && !(sprite.group === 9000 && sprite.image === 0);
  if (isDedicatedPortraitOrFx && sprite.isSharedPalette === false && sprite.palette) {
    return sprite.palette;
  }
  return selectionPal || firstSffPal || actPalette || sprite.palette || null;
}

export function findSffSprite(sffData: SffData | null, group: number, image: number): SffImage | undefined {
  if (!sffData?.images) return undefined;
  return sffData.images.find(img => img.group === group && img.image === image);
}

export function formatTicksToMs(ticks: number): string {
  if (ticks <= 0) return '∞ hold';
  const ms = Math.round((ticks * 1000) / 60);
  return `${ms}ms`;
}

export function getActionTimingStats(action: AirAction | null | undefined, sffData: SffData | null) {
  if (!action || action.elements.length === 0) {
    return {
      frameCount: 0,
      totalTicks: 0,
      hasInfinite: false,
      totalSeconds: '0.00s',
      missingCount: 0,
      matchedCount: 0,
      maxFrameTicks: 1,
    };
  }
  let totalTicks = 0;
  let hasInfinite = false;
  let missingCount = 0;
  let matchedCount = 0;
  let maxFrameTicks = 1;

  for (const el of action.elements) {
    if (el.time <= 0) {
      hasInfinite = true;
    } else {
      totalTicks += el.time;
      if (el.time > maxFrameTicks) maxFrameTicks = el.time;
    }
    if (findSffSprite(sffData, el.group, el.image)) {
      matchedCount++;
    } else {
      missingCount++;
    }
  }

  return {
    frameCount: action.elements.length,
    totalTicks,
    hasInfinite,
    totalSeconds: `${(totalTicks / 60).toFixed(2)}s`,
    missingCount,
    matchedCount,
    maxFrameTicks,
  };
}

interface AirSpriteThumbProps {
  sprite: SffImage | undefined;
  palette: Uint8Array | null;
  flip?: string;
  colorMode?: string;
  group: number;
  image: number;
  size?: number;
}

export const AirSpriteThumb: React.FC<AirSpriteThumbProps> = ({
  sprite,
  palette,
  flip = '',
  colorMode = '',
  group,
  image,
  size = 56,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprite || !palette) return;

    const src = getAirCachedSpriteCanvas(sprite, palette);
    if (!src) return;

    const pad = 4;
    const availW = canvas.width - pad * 2;
    const availH = canvas.height - pad * 2;
    const scale = Math.min(availW / sprite.width, availH / sprite.height, 2);
    const drawW = Math.max(1, Math.round(sprite.width * scale));
    const drawH = Math.max(1, Math.round(sprite.height * scale));
    const upperFlip = (flip || '').toUpperCase();
    const upperColor = (colorMode || '').toUpperCase();

    ctx.save();
    if (upperColor === 'A' || upperColor === 'A1') {
      ctx.globalAlpha = upperColor === 'A1' ? 0.6 : 0.85;
    } else if (upperColor === 'S') {
      ctx.globalAlpha = 0.7;
    }
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (upperFlip.includes('H')) ctx.scale(-1, 1);
    if (upperFlip.includes('V')) ctx.scale(1, -1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }, [sprite, palette, flip, colorMode, sprite?.pixelIndices, sprite?.width, sprite?.height]);

  if (!sprite) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded border border-amber-700/50 bg-amber-950/30 text-amber-300 text-center px-1 select-none shrink-0"
        style={{ width: size, height: size }}
        title={`Sprite (${group}, ${image}) not found in current SFF`}
      >
        <AlertTriangle size={Math.max(12, Math.floor(size * 0.28))} className="text-amber-400 mb-0.5" />
        <span className="text-[8px] font-mono leading-tight tabular-nums">
          No SFF
        </span>
        <span className="text-[8px] font-mono text-amber-400/80 leading-tight tabular-nums">
          {group},{image}
        </span>
      </div>
    );
  }

  return (
    <div
      className="relative rounded border border-[#2f2f35] overflow-hidden shrink-0 flex items-center justify-center bg-[#141418]"
      style={{
        width: size,
        height: size,
        backgroundImage:
          'linear-gradient(45deg, #1d1d22 25%, transparent 25%), linear-gradient(-45deg, #1d1d22 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1d1d22 75%), linear-gradient(-45deg, transparent 75%, #1d1d22 75%)',
        backgroundSize: '10px 10px',
        backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px',
      }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="w-full h-full object-contain pointer-events-none"
        style={{ imageRendering: 'pixelated' }}
      />
      {flip && (
        <span className="absolute top-0.5 left-0.5 px-1 rounded bg-black/75 text-[7px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
          {flip.toUpperCase()}
        </span>
      )}
      {colorMode && (
        <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/75 text-[7px] font-mono font-bold text-purple-300 border border-purple-500/30">
          {colorMode.toUpperCase()}
        </span>
      )}
    </div>
  );
};

interface TickDurationInputProps {
  value: number;
  onChange: (nextTicks: number) => void;
  compact?: boolean;
}

const TickDurationInput: React.FC<TickDurationInputProps> = ({ value, onChange, compact = false }) => {
  const [draft, setDraft] = useState<string>(String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(value));
    }
  }, [value, isFocused]);

  const commit = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(-1, Math.min(9999, parsed));
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div
      className="flex items-center gap-0.5 bg-[#121216] border border-[#35353d] rounded px-0.5 py-0.5"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        type="button"
        title="Decrease duration by 1 tick"
        onClick={e => {
          e.stopPropagation();
          const next = value <= 1 ? -1 : value - 1;
          onChange(next);
        }}
        className="w-4 h-4 flex items-center justify-center rounded bg-[#1f1f26] hover:bg-[#2f2f39] text-zinc-300 text-[10px] font-bold cursor-pointer select-none"
      >
        -
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          commit(draft);
        }}
        onChange={e => {
          const val = e.target.value;
          if (/^-?\d*$/.test(val)) {
            setDraft(val);
            const parsed = parseInt(val, 10);
            if (!Number.isNaN(parsed) && val !== '-') {
              onChange(Math.max(-1, Math.min(9999, parsed)));
            }
          }
        }}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        title="Frame display duration in MUGEN ticks (60 ticks = 1s, -1 = infinite hold)"
        className={`${compact ? 'w-8 text-[10px]' : 'w-11 text-xs'} bg-transparent text-center font-mono font-bold text-blue-300 outline-none tabular-nums`}
      />
      <button
        type="button"
        title="Increase duration by 1 tick"
        onClick={e => {
          e.stopPropagation();
          const next = value < 1 ? 1 : Math.min(9999, value + 1);
          onChange(next);
        }}
        className="w-4 h-4 flex items-center justify-center rounded bg-[#1f1f26] hover:bg-[#2f2f39] text-zinc-300 text-[10px] font-bold cursor-pointer select-none"
      >
        +
      </button>
    </div>
  );
};

export interface AirTimelineStripProps {
  sffData: SffData | null;
  airData: AirData | null;
  selectedActionId: number | null;
  currentFrame: number;
  selectedPaletteIdx: number;
  actPalette: Uint8Array | null;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlay: () => void;
  onStop: () => void;
  onSelectFrame: (idx: number) => void;
  onSetPlaybackSpeed: (speed: number) => void;
  onUpdateFrameAt: (frameIdx: number, updates: Partial<AirElement>) => void;
  onReorderFrame: (fromIdx: number, toIdx: number) => void;
  onToggleLoopstartAt: (frameIdx: number) => void;
  onAddFrame: () => void;
  onDuplicateFrameAt: (frameIdx: number) => void;
  onDeleteFrameAt: (frameIdx: number) => void;
  onSetAllDurations: (ticks: number) => void;
  onOpenFullVisualizer: () => void;
}

export const AirTimelineStrip: React.FC<AirTimelineStripProps> = ({
  sffData,
  airData,
  selectedActionId,
  currentFrame,
  selectedPaletteIdx,
  actPalette,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onStop,
  onSelectFrame,
  onSetPlaybackSpeed,
  onUpdateFrameAt,
  onReorderFrame,
  onToggleLoopstartAt,
  onAddFrame,
  onDuplicateFrameAt,
  onDeleteFrameAt,
  onSetAllDurations,
  onOpenFullVisualizer,
}) => {
  const action = selectedActionId !== null && airData ? airData.actions[selectedActionId] : null;
  const elements = action ? action.elements : [];
  const totalFrames = elements.length;
  const currentElement = elements[currentFrame] || null;
  const stats = useMemo(() => getActionTimingStats(action, sffData), [action, sffData]);

  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [bulkTicksText, setBulkTicksText] = useState('5');

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      onMouseMove={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      className="absolute bottom-0 left-0 md:left-10 right-0 h-52 md:h-48 bg-[#18181d] border-t border-[#32323a] px-2.5 py-2 flex flex-col gap-1.5 shadow-2xl z-20 select-none"
    >
      {/* Toolbar Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a2a32] pb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`px-2.5 py-1 rounded border flex items-center gap-1 font-bold text-[10px] cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              isPlaying
                ? 'bg-red-950/60 text-red-300 border-red-700/80 hover:bg-red-900/60'
                : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/80 hover:bg-emerald-900/60'
            }`}
            title={isPlaying ? 'Pause animation playback' : 'Play animation sequence'}
          >
            {isPlaying ? <Pause size={11} /> : <Play size={11} />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={onStop}
            className="px-2 py-1 rounded bg-[#26262e] hover:bg-[#32323c] border border-[#3a3a45] text-zinc-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Stop and reset playhead to Frame #1"
          >
            <Square size={10} />
            <span>Stop</span>
          </button>

          <div className="flex items-center bg-[#222229] rounded border border-[#35353f] p-0.5">
            {[0.25, 0.5, 1, 2].map(sp => (
              <button
                key={sp}
                type="button"
                onClick={() => onSetPlaybackSpeed(sp)}
                className={`px-1.5 py-0.5 text-[9px] font-mono rounded cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  playbackSpeed === sp
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#2f2f38]'
                }`}
              >
                {sp}x
              </button>
            ))}
          </div>

          {/* Timing & SFF Sync Readout */}
          {action && (
            <div className="hidden lg:flex items-center gap-2 text-[10px] font-mono text-zinc-400 ml-1 tabular-nums">
              <span className="text-zinc-200 font-semibold">
                {stats.frameCount} {stats.frameCount === 1 ? 'frame' : 'frames'}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-blue-300">
                {stats.totalTicks}t ({stats.totalSeconds}
                {stats.hasInfinite ? ' + ∞' : ''})
              </span>
              <span className="text-zinc-600">·</span>
              {stats.missingCount === 0 ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={11} /> SFF synced
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertTriangle size={11} /> {stats.missingCount} missing SFF
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {currentElement && (
            <div className="hidden sm:flex items-center gap-1 bg-[#222229] border border-[#35353f] px-1.5 py-0.5 rounded text-[10px]">
              <span className="text-zinc-400 font-medium">All frames:</span>
              <input
                type="number"
                value={bulkTicksText}
                onChange={e => setBulkTicksText(e.target.value)}
                className="w-9 bg-[#121216] border border-[#3a3a45] rounded text-center text-[10px] font-mono text-zinc-200 outline-none py-0.5 tabular-nums"
                title="Set duration (ticks) for all frames in this action"
              />
              <button
                type="button"
                onClick={() => {
                  const val = parseInt(bulkTicksText, 10);
                  if (!Number.isNaN(val)) {
                    onSetAllDurations(Math.max(-1, Math.min(9999, val)));
                  }
                }}
                className="px-1.5 py-0.5 rounded bg-[#2d2d37] hover:bg-[#3c3c4a] text-zinc-200 text-[9px] font-semibold cursor-pointer whitespace-nowrap"
              >
                Apply
              </button>
            </div>
          )}

          {action && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onAddFrame}
                className="px-2 py-1 rounded bg-blue-950/50 border border-blue-700/70 hover:bg-blue-900/60 text-blue-300 text-[10px] font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                + Frame
              </button>
              <button
                type="button"
                onClick={() => onDuplicateFrameAt(currentFrame)}
                className="px-2 py-1 rounded bg-amber-950/40 border border-amber-700/60 hover:bg-amber-900/50 text-amber-300 text-[10px] font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                Dup
              </button>
              <button
                type="button"
                onClick={() => onDeleteFrameAt(currentFrame)}
                disabled={totalFrames <= 1}
                className="px-2 py-1 rounded bg-red-950/40 border border-red-800/70 hover:bg-red-900/50 disabled:opacity-40 text-red-300 text-[10px] font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                Del
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onOpenFullVisualizer}
            className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap shrink-0 transition-colors"
            title="Open Full AIR Animation File Visualizer & Parser"
          >
            <Maximize2 size={11} />
            <span>AIR Visualizer</span>
          </button>
        </div>
      </div>

      {/* Scrollable Visual Frame Strip (SFF Thumbnails + Drag Reorder + Inline Duration) */}
      <div className="flex-1 flex gap-2 overflow-x-auto overflow-y-hidden py-0.5 items-stretch px-0.5 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
        {elements.map((elem, idx) => {
          const isActive = idx === currentFrame;
          const isLoopStart = Boolean(action && action.loopstartIndex === idx);
          const sprite = findSffSprite(sffData, elem.group, elem.image);
          const pal = resolveSpritePalette(sprite, sffData, selectedPaletteIdx, actPalette);
          const duration = elem.time;
          const effClsn1 = elem.clsn1 ?? action?.clsn1 ?? [];
          const effClsn2 = elem.clsn2 ?? action?.clsn2 ?? [];
          const isDragOver = dragOverIdx === idx && dragFromIdx !== null && dragFromIdx !== idx;
          const barPct =
            duration <= 0
              ? 100
              : Math.max(8, Math.min(100, Math.round((duration / Math.max(1, stats.maxFrameTicks)) * 100)));

          return (
            <div
              key={`${idx}-${elem.group}-${elem.image}`}
              draggable
              onDragStart={e => {
                setDragFromIdx(idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(idx));
              }}
              onDragOver={e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverIdx !== idx) setDragOverIdx(idx);
              }}
              onDragLeave={() => {
                if (dragOverIdx === idx) setDragOverIdx(null);
              }}
              onDrop={e => {
                e.preventDefault();
                const from = dragFromIdx ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
                setDragFromIdx(null);
                setDragOverIdx(null);
                if (!Number.isNaN(from) && from !== idx) {
                  onReorderFrame(from, idx);
                }
              }}
              onDragEnd={() => {
                setDragFromIdx(null);
                setDragOverIdx(null);
              }}
              onClick={() => onSelectFrame(idx)}
              className={`w-40 flex-shrink-0 rounded-lg border p-1.5 flex flex-col justify-between gap-1 cursor-pointer transition-all ${
                isActive
                  ? 'bg-[#1f293d] border-blue-500 ring-1 ring-blue-500/40 text-white'
                  : 'bg-[#121216] border-[#2c2c34] text-zinc-300 hover:border-zinc-500'
              } ${isDragOver ? 'border-l-4 border-l-cyan-400 scale-[1.01]' : ''} ${
                dragFromIdx === idx ? 'opacity-60' : ''
              }`}
            >
              {/* Top Row: Index, Drag Grip, Loop Marker, Quick Nudge */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    className="text-zinc-500 hover:text-zinc-300 cursor-grab active:cursor-grabbing"
                    title="Drag frame card to reorder"
                  >
                    <GripVertical size={11} />
                  </span>
                  <span className={`text-[10px] font-mono font-bold tabular-nums ${isActive ? 'text-blue-300' : 'text-zinc-400'}`}>
                    #{idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onToggleLoopstartAt(idx);
                    }}
                    title={isLoopStart ? 'Clear Loopstart marker' : 'Set Loopstart at this frame'}
                    className={`px-1 py-0.2 rounded text-[8px] font-bold cursor-pointer ${
                      isLoopStart
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#1c1c22] text-zinc-500 hover:text-emerald-300'
                    }`}
                  >
                    LOOP
                  </button>
                </div>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={e => {
                      e.stopPropagation();
                      onReorderFrame(idx, idx - 1);
                    }}
                    title="Move frame earlier"
                    className="w-4 h-4 rounded bg-[#1f1f26] hover:bg-[#2f2f3a] disabled:opacity-30 flex items-center justify-center text-zinc-300 cursor-pointer"
                  >
                    <ChevronLeft size={10} />
                  </button>
                  <button
                    type="button"
                    disabled={idx >= totalFrames - 1}
                    onClick={e => {
                      e.stopPropagation();
                      onReorderFrame(idx, idx + 1);
                    }}
                    title="Move frame later"
                    className="w-4 h-4 rounded bg-[#1f1f26] hover:bg-[#2f2f3a] disabled:opacity-30 flex items-center justify-center text-zinc-300 cursor-pointer"
                  >
                    <ChevronRight size={10} />
                  </button>
                </div>
              </div>

              {/* Middle Row: SFF Sprite Thumbnail + Sprite ID & Duration Editor */}
              <div className="flex items-center gap-2">
                <AirSpriteThumb
                  sprite={sprite}
                  palette={pal}
                  flip={elem.flip}
                  colorMode={elem.color}
                  group={elem.group}
                  image={elem.image}
                  size={44}
                />

                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-1 text-[9px] font-mono">
                    <span className="truncate text-zinc-300 tabular-nums" title={`Sprite (${elem.group}, ${elem.image})`}>
                      S:{elem.group},{elem.image}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {effClsn1.length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Clsn1 Attack Box" />
                      )}
                      {effClsn2.length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Clsn2 Defense Box" />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <TickDurationInput
                      value={duration}
                      compact
                      onChange={nextTicks => onUpdateFrameAt(idx, { time: nextTicks })}
                    />
                    <span className="text-[8px] font-mono text-zinc-400 tabular-nums">
                      {duration <= 0 ? '∞' : `${duration}t`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Proportional Duration Bar */}
              <div className="h-1 w-full rounded-full bg-[#22222b] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    duration <= 0
                      ? 'bg-amber-500'
                      : isActive
                        ? 'bg-blue-400'
                        : 'bg-cyan-500/75'
                  }`}
                  style={{ width: `${barPct}%` }}
                />
              </div>
            </div>
          );
        })}

        {elements.length === 0 && (
          <div className="text-zinc-500 text-xs italic flex items-center justify-center w-full">
            No animation frames in sequence. Click + Frame or open AIR Visualizer to parse or build frames.
          </div>
        )}
      </div>
    </div>
  );
};

export interface AirStoryboardModalProps {
  sffData: SffData | null;
  airData: AirData | null;
  airRawText: string | null;
  selectedActionId: number | null;
  currentFrame: number;
  selectedPaletteIdx: number;
  actPalette: Uint8Array | null;
  isPlaying: boolean;
  playbackSpeed: number;
  showClsn: boolean;
  showAxis: boolean;
  showOnionSkin: boolean;
  onClose: () => void;
  onSelectAction: (actionId: number) => void;
  onSelectFrame: (idx: number) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onSetPlaybackSpeed: (speed: number) => void;
  onToggleClsn: () => void;
  onToggleAxis: () => void;
  onToggleOnionSkin: () => void;
  onUpdateFrameAt: (frameIdx: number, updates: Partial<AirElement>) => void;
  onReorderFrame: (fromIdx: number, toIdx: number) => void;
  onToggleLoopstartAt: (frameIdx: number) => void;
  onAddFrame: () => void;
  onDuplicateFrameAt: (frameIdx: number) => void;
  onDeleteFrameAt: (frameIdx: number) => void;
  onBatchUpdateAction: (updater: (action: AirAction) => AirAction, logMessage?: string) => void;
  onParseAirText: (rawText: string) => { actionsCount: number; framesCount: number; missingSffCount: number };
  onExportAir: () => void;
  onExportGif: () => void;
}

export const AirStoryboardVisualizer: React.FC<AirStoryboardModalProps> = ({
  sffData,
  airData,
  airRawText,
  selectedActionId,
  currentFrame,
  selectedPaletteIdx,
  actPalette,
  isPlaying,
  playbackSpeed,
  showClsn,
  showAxis,
  showOnionSkin,
  onClose,
  onSelectAction,
  onSelectFrame,
  onTogglePlay,
  onStop,
  onSetPlaybackSpeed,
  onToggleClsn,
  onToggleAxis,
  onToggleOnionSkin,
  onUpdateFrameAt,
  onReorderFrame,
  onToggleLoopstartAt,
  onAddFrame,
  onDuplicateFrameAt,
  onDeleteFrameAt,
  onBatchUpdateAction,
  onParseAirText,
  onExportAir,
  onExportGif,
}) => {
  const actionIds = useMemo(
    () => (airData ? Object.keys(airData.actions).map(Number).sort((a, b) => a - b) : []),
    [airData]
  );

  const activeAction = selectedActionId !== null && airData ? airData.actions[selectedActionId] : null;
  const stats = useMemo(() => getActionTimingStats(activeAction, sffData), [activeAction, sffData]);

  const [actionFilter, setActionFilter] = useState('');
  const [showRawParser, setShowRawParser] = useState(false);
  const [rawDraft, setRawDraft] = useState(() => airRawText || (airData ? serializeAirData(airData) : ''));
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [bulkTicks, setBulkTicks] = useState('5');
  const [selectedSffGroup, setSelectedSffGroup] = useState<string>('');
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const airUploadInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Keep raw text draft synced when user switches away/back or edits frames visually
  useEffect(() => {
    if (!showRawParser) {
      setRawDraft(airRawText || (airData ? serializeAirData(airData) : ''));
    }
  }, [airData, airRawText, showRawParser]);

  // Distinct SFF groups sorted numerically for "Append SFF Group as Frames"
  const sffGroups = useMemo(() => {
    if (!sffData?.images) return [];
    const counts = new Map<number, number>();
    for (const img of sffData.images) {
      counts.set(img.group, (counts.get(img.group) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([group, count]) => ({ group, count }));
  }, [sffData]);

  useEffect(() => {
    if (sffGroups.length > 0 && !selectedSffGroup) {
      setSelectedSffGroup(String(sffGroups[0].group));
    }
  }, [sffGroups, selectedSffGroup]);

  const sffSpriteOptions = useMemo(() => {
    if (!sffData?.images) return [];
    const seen = new Set<string>();
    const opts: { group: number; image: number; width: number; height: number }[] = [];
    for (const img of sffData.images) {
      const key = `${img.group},${img.image}`;
      if (!seen.has(key)) {
        seen.add(key);
        opts.push({ group: img.group, image: img.image, width: img.width, height: img.height });
      }
    }
    return opts;
  }, [sffData]);

  const filteredActionIds = useMemo(() => {
    const q = actionFilter.trim().toLowerCase();
    if (!q || !airData) return actionIds;
    return actionIds.filter(id => {
      const act = airData.actions[id];
      const actName = (act?.name || '').toLowerCase();
      if (q === 'missing') {
        return getActionTimingStats(act, sffData).missingCount > 0;
      }
      return String(id).includes(q) || actName.includes(q);
    });
  }, [actionIds, actionFilter, airData, sffData]);

  // Render live mini stage canvas synced with SFF + current palette
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = Math.round(canvas.height * 0.76);
    const zoom = 1.65;

    if (showAxis) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(canvas.width, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, canvas.height);
      ctx.stroke();
    }

    if (!activeAction || !activeAction.elements[currentFrame]) return;

    if (showOnionSkin && currentFrame > 0 && activeAction.elements[currentFrame - 1]) {
      const prevEl = activeAction.elements[currentFrame - 1];
      const prevSpr = findSffSprite(sffData, prevEl.group, prevEl.image);
      const prevPal = resolveSpritePalette(prevSpr, sffData, selectedPaletteIdx, actPalette);
      if (prevSpr && prevPal) {
        const prevCanvas = getAirCachedSpriteCanvas(prevSpr, prevPal);
        if (prevCanvas) {
          const prevFlip = (prevEl.flip || '').toUpperCase();
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.translate(cx, cy);
          if (prevFlip.includes('H')) ctx.scale(-1, 1);
          if (prevFlip.includes('V')) ctx.scale(1, -1);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            prevCanvas,
            (prevEl.xOffset - prevSpr.xOffset) * zoom,
            (prevEl.yOffset - prevSpr.yOffset) * zoom,
            prevSpr.width * zoom,
            prevSpr.height * zoom
          );
          ctx.restore();
        }
      }
    }

    const el = activeAction.elements[currentFrame];
    const spr = findSffSprite(sffData, el.group, el.image);
    const pal = resolveSpritePalette(spr, sffData, selectedPaletteIdx, actPalette);
    const upperFlip = (el.flip || '').toUpperCase();
    const upperColor = (el.color || '').toUpperCase();

    if (spr && pal) {
      const src = getAirCachedSpriteCanvas(spr, pal);
      if (src) {
        ctx.save();
        if (upperColor === 'A' || upperColor === 'A1') {
          ctx.globalAlpha = upperColor === 'A1' ? 0.55 : 0.8;
          ctx.globalCompositeOperation = 'lighter';
        } else if (upperColor === 'S') {
          ctx.globalAlpha = 0.65;
          ctx.globalCompositeOperation = 'difference';
        }
        ctx.translate(cx, cy);
        if (upperFlip.includes('H')) ctx.scale(-1, 1);
        if (upperFlip.includes('V')) ctx.scale(1, -1);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          src,
          (el.xOffset - spr.xOffset) * zoom,
          (el.yOffset - spr.yOffset) * zoom,
          spr.width * zoom,
          spr.height * zoom
        );
        ctx.restore();
      }
    } else {
      ctx.save();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
      ctx.setLineDash([4, 3]);
      ctx.fillRect(cx - 28, cy - 72, 56, 72);
      ctx.strokeRect(cx - 28, cy - 72, 56, 72);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`No SFF`, cx, cy - 40);
      ctx.fillText(`(${el.group},${el.image})`, cx, cy - 26);
      ctx.restore();
    }

    if (showClsn) {
      const c2 = el.clsn2 ?? activeAction.clsn2 ?? [];
      const c1 = el.clsn1 ?? activeAction.clsn1 ?? [];
      ctx.save();
      ctx.translate(cx, cy);
      if (upperFlip.includes('H')) ctx.scale(-1, 1);
      if (upperFlip.includes('V')) ctx.scale(1, -1);
      for (const b of c2) {
        ctx.strokeStyle = 'rgba(59,130,246,0.9)';
        ctx.fillStyle = 'rgba(59,130,246,0.18)';
        const bx = Math.min(b.x1, b.x2) * zoom;
        const by = Math.min(b.y1, b.y2) * zoom;
        const bw = Math.max(1, Math.abs(b.x2 - b.x1) * zoom);
        const bh = Math.max(1, Math.abs(b.y2 - b.y1) * zoom);
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);
      }
      for (const b of c1) {
        ctx.strokeStyle = 'rgba(239,68,68,0.9)';
        ctx.fillStyle = 'rgba(239,68,68,0.22)';
        const bx = Math.min(b.x1, b.x2) * zoom;
        const by = Math.min(b.y1, b.y2) * zoom;
        const bw = Math.max(1, Math.abs(b.x2 - b.x1) * zoom);
        const bh = Math.max(1, Math.abs(b.y2 - b.y1) * zoom);
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);
      }
      ctx.restore();
    }
  }, [activeAction, currentFrame, sffData, selectedPaletteIdx, actPalette, showAxis, showClsn, showOnionSkin]);

  const handleUploadAirFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setRawDraft(text);
      const result = onParseAirText(text);
      setParseStatus(
        `Parsed "${file.name}": ${result.actionsCount} actions, ${result.framesCount} frames (${result.missingSffCount} missing SFF links)`
      );
      setShowRawParser(false);
    } catch (err: any) {
      setParseStatus(`Failed to read AIR file: ${err?.message || 'Unknown error'}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleParseDraftNow = () => {
    const result = onParseAirText(rawDraft);
    setParseStatus(
      `Parsed AIR text: ${result.actionsCount} actions, ${result.framesCount} frames (${result.missingSffCount} missing SFF links)`
    );
  };

  const handleAppendSffGroup = () => {
    if (!sffData || !activeAction) return;
    const grpNum = parseInt(selectedSffGroup, 10);
    if (Number.isNaN(grpNum)) return;
    const groupSprites = sffData.images
      .filter(img => img.group === grpNum)
      .sort((a, b) => a.image - b.image);
    if (groupSprites.length === 0) return;

    const defaultTicks = Math.max(1, parseInt(bulkTicks, 10) || 5);
    const appended: AirElement[] = groupSprites.map(img => ({
      group: img.group,
      image: img.image,
      xOffset: 0,
      yOffset: 0,
      time: defaultTicks,
      flip: '',
      color: '',
    }));

    onBatchUpdateAction(
      act => ({ ...act, elements: [...act.elements, ...appended] }),
      `Appended ${appended.length} SFF frames from Group ${grpNum} into Action ${activeAction.id}.`
    );
  };

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      onMouseMove={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      className="absolute inset-0 z-[60] bg-[#121216] flex flex-col overflow-hidden select-none"
    >
      <input
        ref={airUploadInputRef}
        type="file"
        accept=".air,.txt"
        className="hidden"
        onChange={handleUploadAirFile}
      />

      {/* Visualizer Top Header */}
      <div className="px-3 sm:px-4 py-2 bg-[#18181f] border-b border-[#2c2c36] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0">
            <Film size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-white truncate">
                AIR Animation File Visualizer
              </h2>
              {sffData && (
                <span className="hidden sm:inline text-[10px] font-mono text-zinc-400 tabular-nums">
                  · SFF: {sffData.images.length} sprites
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-400 truncate">
              Parse .AIR frames, drag to reorder, adjust tick durations, and sync live with current SFF sprites
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => airUploadInputRef.current?.click()}
            className="px-2.5 py-1.5 rounded-lg bg-[#22222b] hover:bg-[#2d2d38] border border-[#383846] text-zinc-200 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload size={12} />
            <span>Load .AIR</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRawParser(p => !p)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              showRawParser
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-[#22222b] hover:bg-[#2d2d38] border-[#383846] text-zinc-200'
            }`}
          >
            <Code2 size={12} />
            <span>AIR Source / Parse</span>
          </button>

          <button
            type="button"
            onClick={onExportAir}
            className="px-2.5 py-1.5 rounded-lg bg-[#22222b] hover:bg-[#2d2d38] border border-[#383846] text-teal-300 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download size={12} />
            <span>Export .AIR</span>
          </button>

          <button
            type="button"
            onClick={onExportGif}
            disabled={!activeAction || activeAction.elements.length === 0}
            className="px-2.5 py-1.5 rounded-lg bg-[#22222b] hover:bg-[#2d2d38] disabled:opacity-40 border border-[#383846] text-amber-300 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Film size={12} />
            <span>GIF</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-100 text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Return to Animation Stage"
          >
            <Minimize2 size={12} />
            <span>Stage View</span>
          </button>
        </div>
      </div>

      {/* Parse Notification Banner */}
      {parseStatus && (
        <div className="px-4 py-1.5 bg-indigo-950/50 border-b border-indigo-700/50 text-[11px] text-indigo-200 flex items-center justify-between gap-2 shrink-0">
          <span>{parseStatus}</span>
          <button
            type="button"
            onClick={() => setParseStatus(null)}
            className="text-indigo-300 hover:text-white cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Collapsible Raw AIR Source Parser */}
      {showRawParser && (
        <div className="px-4 py-3 bg-[#15151b] border-b border-[#2c2c36] flex flex-col gap-2 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-zinc-300">
              Raw .AIR Text (Paste or edit [Begin Action] definitions and click Parse &amp; Sync)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRawDraft(airData ? serializeAirData(airData) : '')}
                className="px-2.5 py-1 rounded bg-[#22222b] hover:bg-[#2e2e39] border border-[#383846] text-zinc-300 text-[10px] font-semibold cursor-pointer whitespace-nowrap"
              >
                Reset to Current
              </button>
              <button
                type="button"
                onClick={handleParseDraftNow}
                className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer whitespace-nowrap"
              >
                Parse AIR &amp; Sync SFF
              </button>
            </div>
          </div>
          <textarea
            value={rawDraft}
            onChange={e => setRawDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-36 bg-[#0d0d11] border border-[#32323c] focus:border-indigo-500 rounded-lg p-2.5 font-mono text-[11px] text-emerald-300 outline-none resize-y"
            placeholder="[Begin Action 0]&#10;Clsn2Default: 1&#10;  Clsn2Default[0] = -15, -80, 15, 0&#10;0, 0, 0, 0, 5"
          />
        </div>
      )}

      {/* Main Two-Column Visualizer Body */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Rail: Live Preview + Action Navigator */}
        <aside className="lg:w-72 w-full border-b lg:border-b-0 lg:border-r border-[#2a2a34] bg-[#16161c] flex flex-col min-h-0 shrink-0 max-h-[42vh] lg:max-h-none">
          {/* Live SFF-Synced Preview Canvas */}
          <div className="p-2.5 border-b border-[#2a2a34] flex flex-col gap-2">
            <div className="relative h-40 rounded-lg border border-[#2d2d37] bg-[#101015] overflow-hidden flex items-center justify-center">
              <canvas
                ref={previewCanvasRef}
                width={260}
                height={160}
                className="w-full h-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
              {activeAction && activeAction.elements[currentFrame] && (
                <div className="absolute top-1.5 left-2 right-2 flex items-center justify-between text-[9px] font-mono pointer-events-none tabular-nums">
                  <span className="px-1.5 py-0.5 rounded bg-black/75 text-zinc-200 border border-zinc-700/60">
                    F {currentFrame + 1}/{activeAction.elements.length}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-black/75 text-blue-300 border border-blue-700/50">
                    {activeAction.elements[currentFrame].time <= 0
                      ? '∞ hold'
                      : `${activeAction.elements[currentFrame].time}t (${formatTicksToMs(activeAction.elements[currentFrame].time)})`}
                  </span>
                </div>
              )}
            </div>

            {/* Playback & Preview Toggles */}
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (!activeAction) return;
                    onSelectFrame(currentFrame > 0 ? currentFrame - 1 : activeAction.elements.length - 1);
                  }}
                  className="p-1.5 rounded bg-[#22222b] hover:bg-[#2e2e39] border border-[#353542] text-zinc-300 cursor-pointer"
                  title="Previous Frame"
                >
                  <SkipBack size={12} />
                </button>
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className={`px-2.5 py-1 rounded border text-[10px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                    isPlaying
                      ? 'bg-red-950/60 border-red-700 text-red-300'
                      : 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                  }`}
                >
                  {isPlaying ? <Pause size={11} /> : <Play size={11} />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  type="button"
                  onClick={onStop}
                  className="p-1.5 rounded bg-[#22222b] hover:bg-[#2e2e39] border border-[#353542] text-zinc-300 cursor-pointer"
                  title="Stop & Reset to Frame #1"
                >
                  <Square size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeAction) return;
                    onSelectFrame(currentFrame + 1 < activeAction.elements.length ? currentFrame + 1 : 0);
                  }}
                  className="p-1.5 rounded bg-[#22222b] hover:bg-[#2e2e39] border border-[#353542] text-zinc-300 cursor-pointer"
                  title="Next Frame"
                >
                  <SkipForward size={12} />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onToggleOnionSkin}
                  title="Toggle Onion Skin"
                  className={`p-1.5 rounded border cursor-pointer ${
                    showOnionSkin
                      ? 'bg-amber-600/25 border-amber-500/60 text-amber-300'
                      : 'bg-[#22222b] border-[#353542] text-zinc-400'
                  }`}
                >
                  <Layers size={12} />
                </button>
                <button
                  type="button"
                  onClick={onToggleClsn}
                  title="Toggle Collision Boxes"
                  className={`px-1.5 py-1 rounded border text-[9px] font-mono font-bold cursor-pointer ${
                    showClsn
                      ? 'bg-red-600/20 border-red-500/60 text-red-300'
                      : 'bg-[#22222b] border-[#353542] text-zinc-400'
                  }`}
                >
                  CLSN
                </button>
                <button
                  type="button"
                  onClick={onToggleAxis}
                  title="Toggle Crosshair Axis"
                  className={`px-1.5 py-1 rounded border text-[9px] font-mono font-bold cursor-pointer ${
                    showAxis
                      ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                      : 'bg-[#22222b] border-[#353542] text-zinc-400'
                  }`}
                >
                  AXIS
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-1 text-[10px]">
              <span className="text-zinc-400 font-mono">Speed</span>
              <div className="flex items-center gap-1 bg-[#1e1e26] p-0.5 rounded border border-[#30303b]">
                {[0.25, 0.5, 1, 2].map(sp => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => onSetPlaybackSpeed(sp)}
                    className={`px-2 py-0.5 rounded text-[9px] font-mono cursor-pointer ${
                      playbackSpeed === sp ? 'bg-blue-600 text-white font-bold' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Parsed Actions Directory */}
          <div className="p-2 border-b border-[#2a2a34] flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[10px] font-semibold text-zinc-400">
              <span>Parsed Actions ({actionIds.length})</span>
              <button
                type="button"
                onClick={() => setActionFilter(prev => (prev === 'missing' ? '' : 'missing'))}
                className={`text-[9px] font-mono cursor-pointer ${
                  actionFilter === 'missing' ? 'text-amber-300 font-bold underline' : 'text-zinc-500 hover:text-amber-300'
                }`}
              >
                Filter missing
              </button>
            </div>
            <input
              type="text"
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              placeholder="Search action ID or name..."
              className="w-full bg-[#101014] border border-[#30303b] focus:border-blue-500 rounded px-2 py-1 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
            {filteredActionIds.map(id => {
              const act = airData!.actions[id];
              const actStats = getActionTimingStats(act, sffData);
              const isSelected = id === selectedActionId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectAction(id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-blue-950/50 border-blue-500 text-white'
                      : 'bg-[#121216] border-[#25252e] text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-bold text-blue-300 tabular-nums">
                        [{id}]
                      </span>
                      <span className="text-[11px] font-medium truncate">
                        {act.name?.trim() || `Action ${id}`}
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-zinc-400 mt-0.5 tabular-nums">
                      {actStats.frameCount} frames · {actStats.totalTicks}t ({actStats.totalSeconds})
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    {act.loopstartIndex !== undefined && (
                      <Repeat size={11} className="text-emerald-400" title={`Loops at frame #${act.loopstartIndex + 1}`} />
                    )}
                    {actStats.missingCount > 0 ? (
                      <span
                        className="text-[9px] font-mono font-bold text-amber-400 tabular-nums"
                        title={`${actStats.missingCount} frame(s) missing in SFF`}
                      >
                        !{actStats.missingCount}
                      </span>
                    ) : (
                      <CheckCircle2 size={11} className="text-emerald-500/80" />
                    )}
                  </div>
                </button>
              );
            })}
            {filteredActionIds.length === 0 && (
              <div className="text-center text-xs text-zinc-500 py-6">No matching actions</div>
            )}
          </div>
        </aside>

        {/* Right Workspace: Frame Storyboard, Duration Strip & Reorder Grid */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#121216]">
          {activeAction ? (
            <>
              {/* Batch Controls & SFF Group Append Toolbar */}
              <div className="px-3 sm:px-4 py-2.5 bg-[#18181f] border-b border-[#2a2a34] flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-bold text-white tabular-nums">
                    Action [{activeAction.id}] {activeAction.name ? `· ${activeAction.name}` : ''}
                  </span>
                  <span className="text-zinc-500">·</span>
                  <span className="font-mono text-zinc-300 tabular-nums">
                    {stats.frameCount} frames
                  </span>
                  <span className="text-zinc-500">·</span>
                  <span className="font-mono text-blue-300 tabular-nums flex items-center gap-1">
                    <Clock size={12} />
                    {stats.totalTicks} ticks ({stats.totalSeconds}
                    {stats.hasInfinite ? ' + ∞' : ''})
                  </span>
                  <span className="text-zinc-500">·</span>
                  {stats.missingCount === 0 ? (
                    <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
                      <CheckCircle2 size={12} /> All synced with SFF
                    </span>
                  ) : (
                    <span className="text-amber-400 font-mono text-[11px] flex items-center gap-1">
                      <AlertTriangle size={12} /> {stats.missingCount} missing in SFF
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Bulk Duration */}
                  <div className="flex items-center gap-1 bg-[#121216] border border-[#32323c] rounded-lg px-2 py-1 text-[10px]">
                    <span className="text-zinc-400">Set all:</span>
                    <input
                      type="number"
                      value={bulkTicks}
                      onChange={e => setBulkTicks(e.target.value)}
                      className="w-10 bg-[#1c1c24] border border-[#383844] rounded text-center font-mono text-blue-300 outline-none py-0.5 tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = parseInt(bulkTicks, 10);
                        if (Number.isNaN(val)) return;
                        const clamped = Math.max(-1, Math.min(9999, val));
                        onBatchUpdateAction(
                          act => ({
                            ...act,
                            elements: act.elements.map(el => ({ ...el, time: clamped })),
                          }),
                          `Set all ${activeAction.elements.length} frames in Action ${activeAction.id} to ${clamped} ticks.`
                        );
                      }}
                      className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold cursor-pointer whitespace-nowrap"
                    >
                      Apply
                    </button>
                  </div>

                  {/* Half / Double Timing */}
                  <button
                    type="button"
                    onClick={() =>
                      onBatchUpdateAction(
                        act => ({
                          ...act,
                          elements: act.elements.map(el =>
                            el.time > 0 ? { ...el, time: Math.max(1, Math.round(el.time * 0.5)) } : el
                          ),
                        }),
                        `Halved frame durations in Action ${activeAction.id}.`
                      )
                    }
                    className="px-2 py-1 rounded-lg bg-[#22222b] hover:bg-[#2e2e39] border border-[#353542] text-zinc-200 text-[10px] font-mono font-bold cursor-pointer whitespace-nowrap"
                    title="Halve tick duration of all finite frames (2x faster)"
                  >
                    ÷2 Time
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onBatchUpdateAction(
                        act => ({
                          ...act,
                          elements: act.elements.map(el =>
                            el.time > 0 ? { ...el, time: Math.min(9999, el.time * 2) } : el
                          ),
                        }),
                        `Doubled frame durations in Action ${activeAction.id}.`
                      )
                    }
                    className="px-2 py-1 rounded-lg bg-[#22222b] hover:bg-[#2e2e39] border border-[#353542] text-zinc-200 text-[10px] font-mono font-bold cursor-pointer whitespace-nowrap"
                    title="Double tick duration of all finite frames (2x slower)"
                  >
                    ×2 Time
                  </button>

                  {/* Reverse Frame Order */}
                  <button
                    type="button"
                    disabled={activeAction.elements.length <= 1}
                    onClick={() =>
                      onBatchUpdateAction(
                        act => ({
                          ...act,
                          elements: [...act.elements].reverse(),
                          loopstartIndex:
                            act.loopstartIndex !== undefined
                              ? act.elements.length - 1 - act.loopstartIndex
                              : undefined,
                        }),
                        `Reversed frame order in Action ${activeAction.id}.`
                      )
                    }
                    className="px-2 py-1 rounded-lg bg-[#22222b] hover:bg-[#2e2e39] disabled:opacity-40 border border-[#353542] text-zinc-200 text-[10px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    title="Reverse order of all frames in this action"
                  >
                    <ArrowLeftRight size={11} />
                    <span>Reverse</span>
                  </button>

                  {/* Append SFF Group */}
                  {sffGroups.length > 0 && (
                    <div className="flex items-center gap-1 bg-[#121216] border border-[#32323c] rounded-lg px-1.5 py-0.5 text-[10px]">
                      <select
                        value={selectedSffGroup}
                        onChange={e => setSelectedSffGroup(e.target.value)}
                        className="bg-transparent text-zinc-200 font-mono outline-none py-0.5 cursor-pointer"
                        title="Choose SFF Sprite Group to append sequentially"
                      >
                        {sffGroups.map(g => (
                          <option key={g.group} value={g.group} className="bg-[#18181f]">
                            Grp {g.group} ({g.count} spr)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleAppendSffGroup}
                        className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold cursor-pointer whitespace-nowrap"
                        title="Append every sprite from this SFF group as sequential frames"
                      >
                        + Append Group
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onAddFrame}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Plus size={12} />
                    <span>Add Frame</span>
                  </button>
                </div>
              </div>

              {/* Proportional Timing Timeline Bar */}
              {activeAction.elements.length > 0 && (
                <div className="px-3 sm:px-4 py-2 bg-[#14141a] border-b border-[#262630] shrink-0">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                    <span>Proportional Timing Strip (click segment to jump · drag frame cards below to reorder)</span>
                    <span className="font-mono tabular-nums">60 ticks = 1.00s</span>
                  </div>
                  <div className="h-5 w-full rounded-md bg-[#0c0c10] border border-[#2a2a34] p-0.5 flex gap-0.5 overflow-hidden">
                    {activeAction.elements.map((el, idx) => {
                      const weight = el.time <= 0 ? 12 : Math.max(1, el.time);
                      const isActive = idx === currentFrame;
                      const missing = !findSffSprite(sffData, el.group, el.image);
                      return (
                        <button
                          key={`seg-${idx}`}
                          type="button"
                          onClick={() => onSelectFrame(idx)}
                          style={{ flexGrow: weight }}
                          title={`Frame #${idx + 1} · SFF (${el.group},${el.image}) · ${el.time <= 0 ? '∞' : `${el.time} ticks (${formatTicksToMs(el.time)})`}`}
                          className={`h-full rounded-sm flex items-center justify-center text-[9px] font-mono font-bold transition-colors cursor-pointer overflow-hidden px-0.5 tabular-nums ${
                            isActive
                              ? 'bg-blue-500 text-white ring-1 ring-white/80'
                              : missing
                                ? 'bg-amber-900/60 text-amber-200 hover:bg-amber-800/70'
                                : el.time <= 0
                                  ? 'bg-amber-600/50 text-amber-100 hover:bg-amber-600/75'
                                  : 'bg-[#262936] text-zinc-300 hover:bg-[#34384a]'
                          }`}
                        >
                          #{idx + 1} ({el.time <= 0 ? '∞' : `${el.time}t`})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Storyboard Frame Cards Grid */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {activeAction.elements.map((elem, idx) => {
                    const isActive = idx === currentFrame;
                    const isLoopStart = activeAction.loopstartIndex === idx;
                    const sprite = findSffSprite(sffData, elem.group, elem.image);
                    const pal = resolveSpritePalette(sprite, sffData, selectedPaletteIdx, actPalette);
                    const isDragOver = dragOverIdx === idx && dragFromIdx !== null && dragFromIdx !== idx;
                    const spriteKey = `${elem.group},${elem.image}`;

                    return (
                      <div
                        key={`card-${idx}`}
                        draggable
                        onDragStart={e => {
                          setDragFromIdx(idx);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(idx));
                        }}
                        onDragOver={e => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOverIdx !== idx) setDragOverIdx(idx);
                        }}
                        onDragLeave={() => {
                          if (dragOverIdx === idx) setDragOverIdx(null);
                        }}
                        onDrop={e => {
                          e.preventDefault();
                          const from = dragFromIdx ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
                          setDragFromIdx(null);
                          setDragOverIdx(null);
                          if (!Number.isNaN(from) && from !== idx) {
                            onReorderFrame(from, idx);
                          }
                        }}
                        onDragEnd={() => {
                          setDragFromIdx(null);
                          setDragOverIdx(null);
                        }}
                        onClick={() => onSelectFrame(idx)}
                        className={`rounded-xl border p-3 flex flex-col gap-2.5 transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#1a2234] border-blue-500 ring-1 ring-blue-500/40'
                            : 'bg-[#17171e] border-[#2c2c36] hover:border-zinc-500'
                        } ${isDragOver ? 'ring-2 ring-cyan-400 scale-[1.01]' : ''} ${
                          dragFromIdx === idx ? 'opacity-50' : ''
                        }`}
                      >
                        {/* Card Top Row: Drag Handle, Frame #, Loopstart, Reorder & Actions */}
                        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#272732]">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-zinc-500 hover:text-zinc-200 cursor-grab active:cursor-grabbing"
                              title="Drag card to reorder frame"
                            >
                              <GripVertical size={14} />
                            </span>
                            <span className="text-xs font-mono font-bold text-white tabular-nums">
                              Frame #{idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                onToggleLoopstartAt(idx);
                              }}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer ${
                                isLoopStart
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-[#22222c] text-zinc-400 hover:text-emerald-300'
                              }`}
                            >
                              {isLoopStart ? 'Loopstart ✓' : 'Loop'}
                            </button>
                          </div>

                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => onReorderFrame(idx, idx - 1)}
                              title="Move earlier"
                              className="p-1 rounded bg-[#22222c] hover:bg-[#31313f] disabled:opacity-30 text-zinc-200 cursor-pointer"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <button
                              type="button"
                              disabled={idx >= activeAction.elements.length - 1}
                              onClick={() => onReorderFrame(idx, idx + 1)}
                              title="Move later"
                              className="p-1 rounded bg-[#22222c] hover:bg-[#31313f] disabled:opacity-30 text-zinc-200 cursor-pointer"
                            >
                              <ChevronRight size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDuplicateFrameAt(idx)}
                              title="Duplicate frame"
                              className="p-1 rounded bg-[#22222c] hover:bg-amber-900/60 text-amber-300 cursor-pointer"
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              type="button"
                              disabled={activeAction.elements.length <= 1}
                              onClick={() => onDeleteFrameAt(idx)}
                              title="Delete frame"
                              className="p-1 rounded bg-[#22222c] hover:bg-red-900/60 disabled:opacity-30 text-red-400 cursor-pointer"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Sprite Thumb + SFF Link Controls */}
                        <div className="flex items-start gap-3">
                          <AirSpriteThumb
                            sprite={sprite}
                            palette={pal}
                            flip={elem.flip}
                            colorMode={elem.color}
                            group={elem.group}
                            image={elem.image}
                            size={72}
                          />

                          <div className="flex-1 min-w-0 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                            {/* Synced SFF Sprite Selector */}
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-zinc-400 font-medium">SFF Sprite Link</span>
                                {sprite ? (
                                  <span className="font-mono text-[9px] text-emerald-400 tabular-nums">
                                    {sprite.width}×{sprite.height}px
                                  </span>
                                ) : (
                                  <span className="font-mono text-[9px] text-amber-400">
                                    Missing in SFF
                                  </span>
                                )}
                              </div>
                              {sffSpriteOptions.length > 0 && (
                                <select
                                  value={sprite ? spriteKey : ''}
                                  onChange={e => {
                                    if (!e.target.value) return;
                                    const [gStr, iStr] = e.target.value.split(',');
                                    onUpdateFrameAt(idx, {
                                      group: parseInt(gStr, 10) || 0,
                                      image: parseInt(iStr, 10) || 0,
                                    });
                                  }}
                                  className="w-full bg-[#101015] border border-[#32323e] focus:border-blue-500 rounded px-1.5 py-1 text-[11px] font-mono text-zinc-200 outline-none cursor-pointer"
                                >
                                  {!sprite && (
                                    <option value="">
                                      Missing ({elem.group}, {elem.image}) — Pick SFF...
                                    </option>
                                  )}
                                  {sffSpriteOptions.map(opt => (
                                    <option
                                      key={`${opt.group},${opt.image}`}
                                      value={`${opt.group},${opt.image}`}
                                      className="bg-[#18181f]"
                                    >
                                      {opt.group}, {opt.image} ({opt.width}×{opt.height})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>

                            {/* Group / Image manual inputs + X/Y offset */}
                            <div className="grid grid-cols-4 gap-1 text-[10px]">
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[8px] text-zinc-500 uppercase">Grp</span>
                                <input
                                  type="number"
                                  value={elem.group}
                                  onChange={e => onUpdateFrameAt(idx, { group: parseInt(e.target.value, 10) || 0 })}
                                  className="w-full bg-[#101015] border border-[#30303b] rounded px-1 py-0.5 text-center font-mono text-zinc-200 outline-none tabular-nums"
                                />
                              </label>
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[8px] text-zinc-500 uppercase">Img</span>
                                <input
                                  type="number"
                                  value={elem.image}
                                  onChange={e => onUpdateFrameAt(idx, { image: parseInt(e.target.value, 10) || 0 })}
                                  className="w-full bg-[#101015] border border-[#30303b] rounded px-1 py-0.5 text-center font-mono text-zinc-200 outline-none tabular-nums"
                                />
                              </label>
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[8px] text-zinc-500 uppercase">OffX</span>
                                <input
                                  type="number"
                                  value={elem.xOffset}
                                  onChange={e => onUpdateFrameAt(idx, { xOffset: parseInt(e.target.value, 10) || 0 })}
                                  className="w-full bg-[#101015] border border-[#30303b] rounded px-1 py-0.5 text-center font-mono text-zinc-200 outline-none tabular-nums"
                                />
                              </label>
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[8px] text-zinc-500 uppercase">OffY</span>
                                <input
                                  type="number"
                                  value={elem.yOffset}
                                  onChange={e => onUpdateFrameAt(idx, { yOffset: parseInt(e.target.value, 10) || 0 })}
                                  className="w-full bg-[#101015] border border-[#30303b] rounded px-1 py-0.5 text-center font-mono text-zinc-200 outline-none tabular-nums"
                                />
                              </label>
                            </div>
                          </div>
                        </div>

                        {/* Display Duration Control Block */}
                        <div
                          className="bg-[#111116] border border-[#292934] rounded-lg p-2 flex flex-col gap-1.5"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold text-zinc-300 flex items-center gap-1">
                              <Clock size={11} className="text-blue-400" />
                              Display Duration
                            </span>
                            <div className="flex items-center gap-1.5">
                              <TickDurationInput
                                value={elem.time}
                                onChange={nextTicks => onUpdateFrameAt(idx, { time: nextTicks })}
                              />
                              <span className="text-[10px] font-mono text-zinc-400 tabular-nums min-w-[42px] text-right">
                                {formatTicksToMs(elem.time)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1">
                              {[1, 3, 5, 8, -1].map(preset => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => onUpdateFrameAt(idx, { time: preset })}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono cursor-pointer transition-colors ${
                                    elem.time === preset
                                      ? 'bg-blue-600 text-white font-bold'
                                      : 'bg-[#1c1c24] hover:bg-[#2a2a36] text-zinc-400'
                                  }`}
                                >
                                  {preset === -1 ? '∞' : `${preset}t`}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center gap-1">
                              <select
                                value={elem.flip || ''}
                                onChange={e => onUpdateFrameAt(idx, { flip: e.target.value })}
                                title="Flip mode"
                                className="bg-[#1c1c24] border border-[#30303b] rounded px-1 py-0.5 text-[9px] font-mono text-zinc-300 outline-none cursor-pointer"
                              >
                                <option value="">Flip: -</option>
                                <option value="H">H</option>
                                <option value="V">V</option>
                                <option value="HV">HV</option>
                              </select>
                              <select
                                value={elem.color || ''}
                                onChange={e => onUpdateFrameAt(idx, { color: e.target.value })}
                                title="Color blending"
                                className="bg-[#1c1c24] border border-[#30303b] rounded px-1 py-0.5 text-[9px] font-mono text-zinc-300 outline-none cursor-pointer"
                              >
                                <option value="">Blend: -</option>
                                <option value="A">A</option>
                                <option value="A1">A1</option>
                                <option value="S">S</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-zinc-400">
              <Film size={32} className="text-zinc-600" />
              <p className="text-sm font-medium text-zinc-300">No AIR animation actions loaded yet</p>
              <p className="text-xs text-zinc-500 max-w-md">
                Upload an .AIR file or click AIR Source / Parse above to inspect frames, reorder sequences, and sync with SFF sprites.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
