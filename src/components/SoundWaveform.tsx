import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { SndSound } from '../lib/mugen/sndParser';

interface SoundWaveformProps {
  sound: SndSound;
  isPlaying: boolean;
}

interface DecodedMeta {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  duration: number;
  peakDb: string;
}

/**
 * Fallback raw WAV parser for 8-bit / 16-bit PCM MUGEN WAVs that older browsers
 * occasionally reject via AudioContext.decodeAudioData (e.g. 11025Hz / 22050Hz edge headers).
 */
function fallbackParseWav(data: Uint8Array): DecodedMeta | null {
  if (data.length < 44) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
  const wave = String.fromCharCode(data[8], data[9], data[10], data[11]);
  if (riff !== 'RIFF' || wave !== 'WAVE') return null;

  let offset = 12;
  let channels = 1;
  let sampleRate = 22050;
  let bitsPerSample = 8;
  let audioDataOffset = -1;
  let audioDataSize = 0;

  while (offset + 8 <= data.length) {
    const chunkId = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ' && offset + 24 <= data.length) {
      channels = Math.max(1, view.getUint16(offset + 10, true));
      sampleRate = Math.max(4000, view.getUint32(offset + 12, true));
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      audioDataOffset = offset + 8;
      audioDataSize = Math.min(chunkSize, data.length - audioDataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (audioDataOffset === -1 || audioDataSize <= 0) return null;

  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const totalFrames = Math.floor(audioDataSize / (bytesPerSample * channels));
  const samples = new Float32Array(totalFrames);
  let maxAbs = 0;

  for (let i = 0; i < totalFrames; i++) {
    const pos = audioDataOffset + i * bytesPerSample * channels;
    let v = 0;
    if (bitsPerSample === 8) {
      v = (data[pos] - 128) / 128;
    } else if (bitsPerSample === 16 && pos + 1 < data.length) {
      v = view.getInt16(pos, true) / 32768;
    }
    samples[i] = v;
    const av = Math.abs(v);
    if (av > maxAbs) maxAbs = av;
  }

  const peakDb = maxAbs > 0.0001 ? (20 * Math.log10(maxAbs)).toFixed(1) : '-∞';
  return {
    samples,
    sampleRate,
    channels,
    duration: totalFrames / sampleRate,
    peakDb,
  };
}

export const SoundWaveform: React.FC<SoundWaveformProps> = ({ sound, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [meta, setMeta] = useState<DecodedMeta | null>(null);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);

  // Decode audio bytes into waveform samples whenever active sound changes
  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setProgress(0);

    const decode = async () => {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        try {
          const copy = sound.data.slice().buffer;
          const decoded = await ctx.decodeAudioData(copy);
          if (cancelled) return;
          const ch0 = decoded.getChannelData(0);
          let maxAbs = 0;
          for (let i = 0; i < ch0.length; i++) {
            const av = Math.abs(ch0[i]);
            if (av > maxAbs) maxAbs = av;
          }
          setMeta({
            samples: ch0,
            sampleRate: decoded.sampleRate,
            channels: decoded.numberOfChannels,
            duration: decoded.duration,
            peakDb: maxAbs > 0.0001 ? (20 * Math.log10(maxAbs)).toFixed(1) : '-∞',
          });
          return;
        } catch {
          // Fall through to raw WAV parser
        } finally {
          ctx.close().catch(() => {});
        }
      }

      const wav = fallbackParseWav(sound.data);
      if (!cancelled && wav) {
        setMeta(wav);
      }
    };

    decode();
    return () => {
      cancelled = true;
    };
  }, [sound.id, sound.data]);

  // Animate progress playhead while playing
  useEffect(() => {
    if (!isPlaying || !meta || meta.duration <= 0) {
      setProgress(0);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsedSec = (now - start) / 1000;
      const p = Math.min(1, elapsedSec / meta.duration);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, meta]);

  // Draw real waveform peaks onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;
    ctx.clearRect(0, 0, w, h);

    // Center axis
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (!meta || meta.samples.length === 0) return;

    const barCount = 120;
    const barStep = w / barCount;
    const barW = Math.max(1.5, barStep - 1.5);
    const samplesPerBar = Math.max(1, Math.floor(meta.samples.length / barCount));

    for (let i = 0; i < barCount; i++) {
      const startIdx = i * samplesPerBar;
      const endIdx = Math.min(meta.samples.length, startIdx + samplesPerBar);
      let peak = 0;
      for (let j = startIdx; j < endIdx; j++) {
        const av = Math.abs(meta.samples[j]);
        if (av > peak) peak = av;
      }

      const barH = Math.max(2, peak * (h * 0.82));
      const x = i * barStep;
      const barRatio = i / barCount;
      const played = isPlaying && barRatio <= progress;

      ctx.fillStyle = played ? '#34d399' : '#60a5fa';
      ctx.fillRect(x, midY - barH / 2, barW, barH);
    }

    if (isPlaying && progress > 0) {
      const headX = progress * w;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(headX, 0);
      ctx.lineTo(headX, h);
      ctx.stroke();
    }
  }, [meta, isPlaying, progress]);

  const handleCopyPlaySnd = async () => {
    const snippet = `[State , PlaySnd]\ntype = PlaySnd\ntrigger1 = Time = 0\nvalue = ${sound.group}, ${sound.sample}\n`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="h-32 bg-[#0d0d0d] rounded-lg border border-[#252525] relative overflow-hidden flex items-center justify-center">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'linear-gradient(#33b5e5 1px, transparent 1px), linear-gradient(90deg, #33b5e5 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }}
        />
        <canvas ref={canvasRef} width={540} height={128} className="w-full h-full relative z-10" />

        <div className="absolute top-2 left-3 z-20 font-mono text-[9px] text-emerald-400/90 flex gap-3 bg-black/50 px-2 py-0.5 rounded">
          <span>PEAK: {meta ? `${meta.peakDb} dB` : '...'}</span>
          <span>DUR: {meta ? `${meta.duration.toFixed(2)}s` : '...'}</span>
        </div>

        <div className="absolute bottom-2 right-3 z-20 font-mono text-[9px] text-blue-400/90 bg-black/50 px-2 py-0.5 rounded">
          {meta ? `${(meta.sampleRate / 1000).toFixed(2)} kHz · ${meta.channels === 1 ? 'Mono' : 'Stereo'}` : 'Decoding PCM...'}
        </div>
      </div>

      <div className="flex items-center justify-between bg-[#141417] border border-[#2a2a30] rounded-lg px-3 py-1.5">
        <span className="font-mono text-[10px] text-zinc-400">
          CNS Snippet: <span className="text-blue-300">value = {sound.group}, {sound.sample}</span>
        </span>
        <button
          type="button"
          onClick={handleCopyPlaySnd}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/35 border border-blue-500/40 text-blue-300 text-[10px] font-semibold transition-colors cursor-pointer"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          <span>{copied ? 'Copied PlaySnd!' : 'Copy PlaySnd'}</span>
        </button>
      </div>
    </div>
  );
};
