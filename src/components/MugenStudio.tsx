import React, { useState, useRef, useEffect } from 'react';
import { 
  File, FolderOpen, Save, Undo, Redo, Scissors, Copy, Clipboard,
  Search, ArrowLeftRight, ZoomIn, ZoomOut, Plus, Minus, Play, Pause, AlertCircle, FileText, Image, PlayCircle, Settings, Trash2, Pen, Move, Hand, PaintBucket, Wand2, Crosshair,
  Volume2, Music, Download, PlusCircle, Square, Eraser
} from 'lucide-react';
import JSZip from 'jszip';
import { parseIniString, stringifyIni } from '../lib/mugen/defParser';
import { parseSffBinary, extractPortraits } from '../lib/mugen/sffParser';
import { generateTemplateSff, buildSffBinary } from '../lib/mugen/sffGenerator';
import { templateAir, templateCmd, templateCns, templateDef } from '../lib/mugen/templateFiles';
import { parseActBinary, applyPalette, imageToSpriteIndices } from '../lib/mugen/actParser';
import { parseAirString, serializeAirData } from '../lib/mugen/airParser';
import type { SffData, AirData } from '../lib/mugen/types';
import { parseSndBinary, buildSndBinary } from '../lib/mugen/sndParser';
import type { SndSound, SndData } from '../lib/mugen/sndParser';

function generateBeepWav(freq: number, durationMs: number, type: 'sine' | 'square' | 'noise' = 'sine'): Uint8Array {
  const sampleRate = 11025;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const headerSize = 44;
  const totalSize = headerSize + numSamples;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  
  buffer[0] = 0x52; // R
  buffer[1] = 0x49; // I
  buffer[2] = 0x46; // F
  buffer[3] = 0x46; // F
  
  view.setUint32(4, totalSize - 8, true);
  
  buffer[8] = 0x57; // W
  buffer[9] = 0x41; // A
  buffer[10] = 0x56; // V
  buffer[11] = 0x45; // E
  
  buffer[12] = 0x66; // f
  buffer[13] = 0x6d; // m
  buffer[14] = 0x74; // t
  buffer[15] = 0x20; // ' '
  
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  
  buffer[36] = 0x64; // d
  buffer[37] = 0x61; // a
  buffer[38] = 0x74; // t
  buffer[39] = 0x61; // a
  
  view.setUint32(40, numSamples, true);
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sampleVal = 127;
    
    if (type === 'sine') {
      sampleVal = Math.round(127 + 120 * Math.sin(2 * Math.PI * freq * t));
    } else if (type === 'square') {
      sampleVal = Math.round(127 + 120 * (Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1));
    } else if (type === 'noise') {
      sampleVal = Math.round(127 + 120 * (Math.random() * 2 - 1));
    }
    
    buffer[headerSize + i] = Math.max(0, Math.min(255, sampleVal));
  }
  
  return buffer;
}

export default function MugenStudio() {
  const [activeMode, setActiveMode] = useState<'Definitions' | 'Sprites' | 'Animations' | 'Commands' | 'States' | 'Sounds'>('Definitions');
  
  // Data State
  const [iniData, setIniData] = useState<Record<string, Record<string, string>> | null>(null);
  const [cnsData, setCnsData] = useState<Record<string, Record<string, string>> | null>(null);
  const [cmdData, setCmdData] = useState<Record<string, Record<string, string>> | null>(null);
  const [sffData, setSffData] = useState<SffData | null>(null);
  const [actPalette, setActPalette] = useState<Uint8Array | null>(null);
  const [airData, setAirData] = useState<AirData | null>(null);
  const [sndData, setSndData] = useState<SndData | null>(null);
  const [selectedSoundId, setSelectedSoundId] = useState<string | null>(null);
  const [soundSearch, setSoundSearch] = useState('');
  const [soundFilterGroup, setSoundFilterGroup] = useState<string>('all');
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Raw text states for editing
  const [iniRawText, setIniRawText] = useState<string | null>(null);
  const [cnsRawText, setCnsRawText] = useState<string | null>(null);
  const [cmdRawText, setCmdRawText] = useState<string | null>(null);
  const [airRawText, setAirRawText] = useState<string | null>(null);

  // Undo/Redo Stacks
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Viewer States
  const [spriteSearch, setSpriteSearch] = useState('');
  const [selectedSpriteIdx, setSelectedSpriteIdx] = useState<number>(0);
  const [selectedActionId, setSelectedActionId] = useState<number | null>(null);
  const [selectedClsn, setSelectedClsn] = useState<{ type: 1 | 2; id: number } | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [zoom, setZoom] = useState(2);
  const [showClsn, setShowClsn] = useState(true);
  const [showAxis, setShowAxis] = useState(true);

  // Selected palette editing states
  const [selectedPalColorIdx, setSelectedPalColorIdx] = useState<number | null>(null);
  const [newActionIdText, setNewActionIdText] = useState('100');

  // Pivot drags & Canvas interactions
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOrig, setDragOrig] = useState({ x: 0, y: 0 });
  const [previewOffset, setPreviewOffset] = useState<{x: number, y: number} | null>(null);
  
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOrig, setPanOrig] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [activeTool, setActiveTool] = useState<'move' | 'pan' | 'paint' | 'eraser' | 'bucket' | 'wand' | 'clsn_edit'>('move');
  const [brushSize, setBrushSize] = useState<number>(1);
  const [isPaintDragging, setIsPaintDragging] = useState(false);
  const [lastPaintPos, setLastPaintPos] = useState<{x: number, y: number} | null>(null);
  const [mobileTab, setMobileTab] = useState<'left' | 'center' | 'right'>('center');
  const workspaceRef = useRef<HTMLDivElement>(null);
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartCentroidRef = useRef<{ x: number, y: number } | null>(null);
  const touchStartPanRef = useRef<{ x: number, y: number } | null>(null);
  const touchStartZoomRef = useRef<number>(zoom);

  // Sprite import states
  const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
  const [showPaletteChoiceModal, setShowPaletteChoiceModal] = useState(false);

  // ZIP Export states
  const [showExportZipModal, setShowExportZipModal] = useState(false);
  const [exportZipIncludeAct, setExportZipIncludeAct] = useState(true);
  const [exportZipIncludeSnd, setExportZipIncludeSnd] = useState(true);
  const [isExportingZip, setIsExportingZip] = useState(false);

  // Input refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spritePngInputRef = useRef<HTMLInputElement>(null);
  const addSoundInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Populate with template files on mount so application loads fully on startup
    setIniRawText(templateDef);
    setIniData(parseIniString(templateDef));
    setCnsRawText(templateCns);
    setCnsData(parseIniString(templateCns));
    setCmdRawText(templateCmd);
    setCmdData(parseIniString(templateCmd));
    setAirRawText(templateAir);
    
    try {
      setAirData(parseAirString(templateAir));
    } catch(e) {}

    // Populate with template sounds
    try {
      const s1 = generateBeepWav(440, 250, 'sine'); // Jump beep
      const s2 = generateBeepWav(180, 200, 'square'); // Punch
      const s3 = generateBeepWav(100, 400, 'noise'); // Hit noise
      
      const defaultSounds: SndSound[] = [
        { id: 'snd-0-1', group: 0, sample: 1, data: s1, format: 'wav', name: 'snd_jump' },
        { id: 'snd-20-1', group: 20, sample: 1, data: s2, format: 'wav', name: 'snd_punch' },
        { id: 'snd-20-2', group: 20, sample: 2, data: s3, format: 'wav', name: 'snd_hit' }
      ];
      setSndData({ version: '1.0', sounds: defaultSounds });
      setSelectedSoundId('snd-0-1');
    } catch (e) {
      console.error("Failed to generate default template sounds:", e);
    }

    // Also populate with template sprite sheet so studio is fully configured with character assets
    const tBlob = generateTemplateSff();
    tBlob.arrayBuffer().then(buf => {
      try {
        const parsedSff = parseSffBinary(buf);
        setSffData(parsedSff);
        setSelectedSpriteIdx(0);
        // Set fallback actPalette from template SFF
        if (parsedSff.images.length > 0 && parsedSff.images[0].palette) {
          setActPalette(new Uint8Array(parsedSff.images[0].palette));
        }
      } catch (e) {
        console.error("Failed to parse start template SFF:", e);
      }
    });
  }, []);

  useEffect(() => {
    if (airData && Object.keys(airData.actions).length > 0) {
      const sortedKeys = Object.keys(airData.actions).map(Number).sort((a,b)=>a-b);
      // Try to select an existing action
      if (selectedActionId === null || !airData.actions[selectedActionId]) {
        setSelectedActionId(sortedKeys[0]);
        setCurrentFrame(0);
        setIsPlaying(false);
      } else {
        const elementsCount = airData.actions[selectedActionId].elements.length;
        if (currentFrame >= elementsCount) {
          setCurrentFrame(Math.max(0, elementsCount - 1));
        }
      }
    } else {
      setSelectedActionId(null);
      setCurrentFrame(0);
      setIsPlaying(false);
    }
  }, [airData]);

  // Sync back to AIR text representations when state changes
  const syncAirRawText = (newAir: AirData) => {
    try {
      const text = serializeAirData(newAir);
      setAirRawText(text);
    } catch (e) {
      console.error(e);
    }
  };

  const handleImportSpriteFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPendingImportFiles(files);
    setShowPaletteChoiceModal(true);
    if (spritePngInputRef.current) spritePngInputRef.current.value = '';
  };

  const processSpriteImport = (mode: 'image_palette' | 'adapt' | 'exchange') => {
    setShowPaletteChoiceModal(false);
    
    // Process only first file for simplicity in this snippet, can easily be extended to all
    const file = pendingImportFiles[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const img = new Image();
      img.onload = () => {
        const offscreen = document.createElement('canvas');
        offscreen.width = img.width;
        offscreen.height = img.height;
        const ctx = offscreen.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        
        // Active palette
        const currentPal = actPalette || sffData?.images[selectedSpriteIdx || 0]?.palette || null;
        
        let targetPaletteForProcessing = currentPal;
        if (mode === 'image_palette') {
           targetPaletteForProcessing = null; // Forces parser to extract new palette from image
        }
        
        const { indices, palette } = imageToSpriteIndices(imgData.data, img.width, img.height, targetPaletteForProcessing);

        // For 'exchange', we take the newfound/extracted palette and push it to the main state
        if (mode === 'exchange') {
           if (palette) {
              setActPalette(palette);
           }
        }

        let nextGroup = 0;
        let nextImg = 0;
        if (sffData && sffData.images.length > 0) {
          const lastImg = sffData.images[sffData.images.length - 1];
          nextGroup = lastImg.group;
          nextImg = lastImg.image + 1;
        }

        const newSprite: any = {
          group: nextGroup,
          image: nextImg,
          xOffset: Math.round(img.width / 2),
          yOffset: Math.round(img.height / 2),
          width: img.width,
          height: img.height,
          pixelIndices: indices,
          isSharedPalette: mode !== 'image_palette',
          comment: file.name,
          palette: palette
        };

        if (sffData) {
          const updatedImages = [...sffData.images, newSprite];
          setSffData({
            ...sffData,
            numImages: updatedImages.length,
            images: updatedImages
          });
          setSelectedSpriteIdx(updatedImages.length - 1);
        } else {
          setSffData({
            version: 'ElecbyteSpr\x00',
            numGroups: 1,
            numImages: 1,
            images: [newSprite]
          });
          setSelectedSpriteIdx(0);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    setPendingImportFiles([]);
  };

  const applyPaint = (clientX: number, clientY: number) => {
    if (selectedSpriteIdx === null || !workspaceRef.current || !sffData) return;
    const sprite = sffData.images[selectedSpriteIdx];
    if (!sprite) return;
    
    // We only need the rect, clickX, clickY for calculating offset
    const rect = workspaceRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left - pan.x;
    const clickY = clientY - rect.top - pan.y;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const drawX = centerX - sprite.xOffset * zoom;
    const drawY = centerY - sprite.yOffset * zoom;
    
    const localX = Math.floor((clickX - drawX) / zoom);
    const localY = Math.floor((clickY - drawY) / zoom);
    
    const x0 = lastPaintPos ? lastPaintPos.x : localX;
    const y0 = lastPaintPos ? lastPaintPos.y : localY;
    const x1 = localX;
    const y1 = localY;
    
    const colorIdx = activeTool === 'eraser' ? 0 : (selectedPalColorIdx ?? 0);
    
    setSffData(prevSff => {
        if (!prevSff) return prevSff;
        const currentSprite = prevSff.images[selectedSpriteIdx];
        if (!currentSprite) return prevSff;
        
        const nextSff = { ...prevSff };
        const nextSprite = { ...currentSprite };
        const nextIndices = new Uint8Array(currentSprite.pixelIndices);
        let changed = false;
        
        if (activeTool === 'paint' || activeTool === 'eraser') {
            let cx = x0;
            let cy = y0;
            const dx = Math.abs(x1 - cx);
            const dy = -Math.abs(y1 - cy);
            const sx = cx < x1 ? 1 : -1;
            const sy = cy < y1 ? 1 : -1;
            let err = dx + dy;
            
            while (true) {
                const halfSize = brushSize / 2;
                const r = Math.floor(halfSize);
                for (let bdy = -r; bdy <= r; bdy++) {
                    for (let bdx = -r; bdx <= r; bdx++) {
                        const distSq = bdx * bdx + bdy * bdy;
                        if (distSq <= halfSize * halfSize || brushSize === 1) {
                            const px = cx + bdx;
                            const py = cy + bdy;
                            if (px >= 0 && px < currentSprite.width && py >= 0 && py < currentSprite.height) {
                                const i = py * currentSprite.width + px;
                                if (nextIndices[i] !== colorIdx) {
                                    nextIndices[i] = colorIdx;
                                    changed = true;
                                }
                            }
                        }
                    }
                }
                if (cx === x1 && cy === y1) break;
                const e2 = 2 * err;
                if (e2 >= dy) { err += dy; cx += sx; }
                if (e2 <= dx) { err += dx; cy += sy; }
            }
        } else if (activeTool === 'wand') {
            if (localX >= 0 && localX < currentSprite.width && localY >= 0 && localY < currentSprite.height) {
                const pixelIndex = localY * currentSprite.width + localX;
                const targetColorIdx = currentSprite.pixelIndices[pixelIndex];
                if (targetColorIdx !== colorIdx) {
                    for (let i = 0; i < nextIndices.length; i++) {
                        if (nextIndices[i] === targetColorIdx) {
                            nextIndices[i] = colorIdx;
                            changed = true;
                        }
                    }
                }
            }
        } else if (activeTool === 'bucket') {
            if (localX >= 0 && localX < currentSprite.width && localY >= 0 && localY < currentSprite.height) {
                const pixelIndex = localY * currentSprite.width + localX;
                const targetColorIdx = currentSprite.pixelIndices[pixelIndex];
                if (targetColorIdx !== colorIdx) {
                    const stack = [[localX, localY]];
                    while (stack.length > 0) {
                        const [cx, cy] = stack.pop()!;
                        if (cx < 0 || cx >= currentSprite.width || cy < 0 || cy >= currentSprite.height) continue;
                        const i = cy * currentSprite.width + cx;
                        if (nextIndices[i] === targetColorIdx) {
                            nextIndices[i] = colorIdx;
                            stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
                            changed = true;
                        }
                    }
                }
            }
        }
        
        if (changed) {
            nextSprite.pixelIndices = nextIndices;
            nextSff.images[selectedSpriteIdx] = nextSprite;
            return nextSff;
        }
        return prevSff;
    });
    
    setLastPaintPos({ x: localX, y: localY });
  };

  const handleStart = (clientX: number, clientY: number, isMiddleButton: boolean) => {
    if (isMiddleButton || activeTool === 'pan') {
        setIsPanning(true);
        setPanStart({ x: clientX, y: clientY });
        setPanOrig({ x: pan.x, y: pan.y });
        return;
    }

    if (activeMode === 'Sprites') {
      if (activeTool === 'paint' || activeTool === 'eraser' || activeTool === 'bucket' || activeTool === 'wand') {
          if (activeTool === 'paint' || activeTool === 'eraser') {
              setIsPaintDragging(true);
              setLastPaintPos(null);
          }
          applyPaint(clientX, clientY);
          return;
      }
      if (!sffData) return;
      const idx = selectedSpriteIdx !== null ? selectedSpriteIdx : 0;
      const sprite = sffData.images[idx];
      if (!sprite) return;
      setIsDragging(true);
      setDragStart({ x: clientX, y: clientY });
      setDragOrig({ x: sprite.xOffset, y: sprite.yOffset });
      setPreviewOffset({ x: sprite.xOffset, y: sprite.yOffset });
    } else if (activeMode === 'Animations') {
      if (activeTool === 'clsn_edit') return; // Don't move sprite while editing CLSN
      if (!airData || selectedActionId === null) return;
      const action = airData.actions[selectedActionId];
      if (!action) return;
      const element = action.elements[currentFrame];
      if (!element) return;
      setIsDragging(true);
      setDragStart({ x: clientX, y: clientY });
      setDragOrig({ x: element.xOffset, y: element.yOffset });
      setPreviewOffset({ x: element.xOffset, y: element.yOffset });
    }
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (isPanning) {
        setPan({
            x: panOrig.x + (clientX - panStart.x),
            y: panOrig.y + (clientY - panStart.y)
        });
        return;
    }

    if (activeMode === 'Sprites' && (activeTool === 'paint' || activeTool === 'eraser') && isPaintDragging) {
        applyPaint(clientX, clientY);
        return;
    }
    if (!isDragging) return;
    if (activeMode === 'Animations' && activeTool === 'clsn_edit') return;

    const dx = clientX - dragStart.x;
    const dy = clientY - dragStart.y;
    
    const deltaX = Math.round(dx / zoom);
    const deltaY = Math.round(dy / zoom);

    if (activeMode === 'Sprites') {
      if (!sffData) return;
      const targetX = dragOrig.x - deltaX;
      const targetY = dragOrig.y - deltaY;
      setPreviewOffset({ x: targetX, y: targetY });
    } else if (activeMode === 'Animations') {
      if (!airData || selectedActionId === null) return;
      const action = airData.actions[selectedActionId];
      if (!action) return;
      const targetX = dragOrig.x + deltaX;
      const targetY = dragOrig.y + deltaY;
      setPreviewOffset({ x: targetX, y: targetY });
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX, e.clientY, e.button === 1);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  const handleCanvasTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY, false);
    } else if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const centroidX = (t1.clientX + t2.clientX) / 2;
        const centroidY = (t1.clientY + t2.clientY) / 2;
        touchStartDistRef.current = dist;
        touchStartCentroidRef.current = { x: centroidX, y: centroidY };
        touchStartPanRef.current = { ...pan };
        touchStartZoomRef.current = zoom;
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
    } else if (e.touches.length === 2) {
        e.preventDefault();
        const distRef = touchStartDistRef.current;
        const centroidRef = touchStartCentroidRef.current;
        const panRef = touchStartPanRef.current;
        const zoomRef = touchStartZoomRef.current;
        
        if (distRef !== null && centroidRef !== null && panRef !== null) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
          const currentCentroidX = (t1.clientX + t2.clientX) / 2;
          const currentCentroidY = (t1.clientY + t2.clientY) / 2;
          
          const scale = currentDist / distRef;
          const nextZoom = Math.min(10, Math.max(0.25, zoomRef * scale));
          setZoom(nextZoom);
          
          const dx = currentCentroidX - centroidRef.x;
          const dy = currentCentroidY - centroidRef.y;
          setPan({
            x: panRef.x + dx,
            y: panRef.y + dy
          });
        }
    }
  };

  const handleCanvasTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    touchStartDistRef.current = null;
    touchStartCentroidRef.current = null;
    touchStartPanRef.current = null;
    handleCanvasMouseUp();
  };

  const handleCanvasMouseUp = () => {
    if (isPanning) {
        setIsPanning(false);
    }
    
    if (isDragging && previewOffset) {
        if (activeMode === 'Sprites') {
            handleUpdateSprite('xOffset', previewOffset.x);
            handleUpdateSprite('yOffset', previewOffset.y);
        } else if (activeMode === 'Animations') {
            handleUpdateFrameField('xOffset', previewOffset.x);
            handleUpdateFrameField('yOffset', previewOffset.y);
        }
    }

    setIsDragging(false);
    setIsPaintDragging(false);
    setPreviewOffset(null);
    setLastPaintPos(null);
  };

  useEffect(() => {
    let timer: any;
    if (isPlaying && selectedActionId !== null && airData) {
      const action = airData.actions[selectedActionId];
      if (action && action.elements.length > 0) {
        // Ensure currentFrame is within bounds
        const frameIdx = currentFrame >= action.elements.length ? 0 : currentFrame;
        if (frameIdx !== currentFrame) {
          setCurrentFrame(frameIdx);
        }
        const currentElement = action.elements[frameIdx];
        if (currentElement) {
          const rawTime = currentElement.time;
          const parsedTime = typeof rawTime === 'number' ? rawTime : (parseInt(rawTime) || 1);
          
          // Treat <= 0 (such as -1 infinite holds) as 30 ticks (0.5s) for editing visual preview looping,
          // so playing doesn't just halt instantly and works for all MUGEN animations!
          const ticks = parsedTime <= 0 ? 30 : parsedTime;
          const baseDuration = ticks * (1000 / 60);
          const duration = baseDuration / playbackSpeed;
          timer = setTimeout(() => {
            setCurrentFrame(prev => (prev + 1) % action.elements.length);
          }, duration);
        }
      }
    }
    return () => clearTimeout(timer);
  }, [isPlaying, currentFrame, selectedActionId, airData, playbackSpeed]);
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const filesArray = Array.from(files) as File[];
    const hasActInSelection = filesArray.some(f => f.name.toLowerCase().endsWith('.act'));

    let initialCns = null;
    let initialCmd = null;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop()?.toLowerCase();
        
        try {
            if (ext === 'def') {
                const text = await file.text();
                setIniData(parseIniString(text));
                setIniRawText(text);
            } else if (ext === 'cns' || ext === 'st') {
                const text = await file.text();
                setCnsData(parseIniString(text));
                setCnsRawText(text);
            } else if (ext === 'cmd') {
                const text = await file.text();
                setCmdData(parseIniString(text));
                setCmdRawText(text);
            } else if (ext === 'sff') {
                const buffer = await file.arrayBuffer();
                const parsed = parseSffBinary(buffer);
                setSffData(parsed);
                // If no .act file in this batch, use first available palette from the SFF as default
                if (!hasActInSelection) {
                   const firstPalSprite = parsed.images.find(img => img.palette);
                   if (firstPalSprite && firstPalSprite.palette) {
                      setActPalette(new Uint8Array(firstPalSprite.palette));
                   }
                }
            } else if (ext === 'act') {
                const buffer = await file.arrayBuffer();
                setActPalette(parseActBinary(buffer));
            } else if (ext === 'air') {
                const text = await file.text();
                setAirData(parseAirString(text));
                setAirRawText(text);
            } else if (ext === 'snd') {
                const buffer = await file.arrayBuffer();
                const parsedSnd = parseSndBinary(buffer);
                setSndData(parsedSnd);
                if (parsedSnd.sounds.length > 0) {
                    setSelectedSoundId(parsedSnd.sounds[0].id);
                }
                setActiveMode('Sounds');
            } else if (['wav', 'mp3', 'ogg', 'm4a', 'aac'].includes(ext || '')) {
                const buffer = await file.arrayBuffer();
                const uint8data = new Uint8Array(buffer);
                const newSnd: SndSound = {
                    id: `snd-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    group: 0,
                    sample: (sndData?.sounds.filter(s => s.group === 0).length || 0) + 1,
                    data: uint8data,
                    format: ext || 'wav',
                    name: file.name.split('.')[0]
                };
                setSndData(prev => {
                    const nextSounds = prev ? [...prev.sounds, newSnd] : [newSnd];
                    return {
                        version: prev?.version || '1.0',
                        sounds: nextSounds
                    };
                });
                setSelectedSoundId(newSnd.id);
                setActiveMode('Sounds');
            }
        } catch (err: any) {
            console.error(`Error parsing ${file.name}: `, err);
            alert(`Failed parser check for ${file.name}: ${err.message}`);
        }
    }
  };

  const menuItems = ["Project", "Edit", "View", "Debug", "Palettes", "Backgrounds", "Sprites", "Animations", "Commands", "States", "Sounds", "Tools", "Help"];

  const handleMenuClick = (item: string) => {
    if (['Sprites', 'Animations', 'Commands', 'States', 'Sounds'].includes(item)) {
        setActiveMode(item as any);
    } else if (item === 'Project') {
        setActiveMode('Definitions');
    }
  };

  const getActiveTextData = () => {
      if (activeMode === 'Definitions') return { text: iniRawText, setter: setIniRawText, parsed: iniData };
      if (activeMode === 'States') return { text: cnsRawText, setter: setCnsRawText, parsed: cnsData };
      if (activeMode === 'Commands') return { text: cmdRawText, setter: setCmdRawText, parsed: cmdData };
      return { text: null, setter: null, parsed: null };
  };

  const { text: activeText, setter: setActiveText, parsed: activeParsedData } = getActiveTextData();
  const activeSound = sndData?.sounds.find(s => s.id === selectedSoundId);

  useEffect(() => {
    try {
        if (activeMode === 'Definitions' && iniRawText) setIniData(parseIniString(iniRawText));
        if (activeMode === 'States' && cnsRawText) setCnsData(parseIniString(cnsRawText));
        if (activeMode === 'Commands' && cmdRawText) setCmdData(parseIniString(cmdRawText));
    } catch(e) {}
  }, [iniRawText, cnsRawText, cmdRawText, activeMode]);

  const handleUpdateSprite = (key: string, value: number) => {
    setSffData(prev => {
        if (!prev || selectedSpriteIdx === null) return prev;
        const newSff = { ...prev };
        newSff.images[selectedSpriteIdx] = { ...newSff.images[selectedSpriteIdx], [key]: value };
        return newSff;
    });
  };

  const handleUpdateDefValue = (section: string, key: string, value: string) => {
    if (!iniData) return;
    const nextData = { ...iniData };
    if (!nextData[section]) nextData[section] = {};
    nextData[section][key] = value;
    setIniData(nextData);
    const text = stringifyIni(nextData);
    setIniRawText(text);
  };

  const handleDeleteSprite = () => {
    if (!sffData || selectedSpriteIdx === null) return;
    if (!window.confirm("Are you sure you want to delete this sprite image?")) return;
    const nextImages = sffData.images.filter((_, idx) => idx !== selectedSpriteIdx);
    setSffData({
      ...sffData,
      numImages: nextImages.length,
      images: nextImages
    });
    setSelectedSpriteIdx(nextImages.length > 0 ? 0 : 0);
  };

  const handleDuplicateSprite = () => {
    if (!sffData || selectedSpriteIdx === null) return;
    const spriteToClone = sffData.images[selectedSpriteIdx];
    if (!spriteToClone) return;

    const newSprite = {
      ...spriteToClone,
      image: spriteToClone.image + 1,
      pixelIndices: new Uint8Array(spriteToClone.pixelIndices),
      palette: spriteToClone.palette ? new Uint8Array(spriteToClone.palette) : undefined
    };

    const nextImages = [...sffData.images];
    nextImages.splice(selectedSpriteIdx + 1, 0, newSprite);

    setSffData({
      ...sffData,
      numImages: nextImages.length,
      images: nextImages
    });
    setSelectedSpriteIdx(selectedSpriteIdx + 1);
  };

  const handleAddAnimAction = (actionId: number) => {
    if (!airData) return;
    if (airData.actions[actionId]) {
      alert(`Action ${actionId} already exists!`);
      return;
    }
    const newAction: any = {
      id: actionId,
      elements: [
        { group: 0, image: 0, xOffset: 0, yOffset: 0, time: 5, flip: "" }
      ],
      clsn1: [],
      clsn2: []
    };
    const nextAir = { ...airData, actions: { ...airData.actions, [actionId]: newAction } };
    setAirData(nextAir);
    setSelectedActionId(actionId);
    setCurrentFrame(0);
    syncAirRawText(nextAir);
  };

  const handleDeleteAnimAction = (actionId: number) => {
    if (!airData) return;
    if (!window.confirm(`Are you sure you want to delete Action ${actionId}?`)) return;
    const nextAir = { ...airData };
    delete nextAir.actions[actionId];
    setAirData(nextAir);
    syncAirRawText(nextAir);
    const remainingIds = Object.keys(nextAir.actions).map(Number).sort((a,b)=>a-b);
    setSelectedActionId(remainingIds.length > 0 ? remainingIds[0] : null);
    setCurrentFrame(0);
  };

  const handleUpdateFrameField = (key: string, value: any) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;
    const element = action.elements[currentFrame];
    if (!element) return;
    
    const nextAir = { ...airData };
    const nextAction = { ...action };
    nextAction.elements = [...nextAction.elements];
    nextAction.elements[currentFrame] = { ...element, [key]: value };
    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    syncAirRawText(nextAir);
  };

  const handleAddFrame = () => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;
    
    const nextAir = { ...airData };
    const nextAction = { ...action };
    nextAction.elements = [...nextAction.elements, { group: 0, image: 0, xOffset: 0, yOffset: 0, time: 5, flip: "" }];
    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    setCurrentFrame(nextAction.elements.length - 1);
    syncAirRawText(nextAir);
  };

  const handleDuplicateFrame = () => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;
    const element = action.elements[currentFrame];
    if (!element) return;

    const nextAir = { ...airData };
    const nextAction = { ...action };
    nextAction.elements = [...nextAction.elements];
    nextAction.elements.splice(currentFrame + 1, 0, { ...element });
    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    setCurrentFrame(currentFrame + 1);
    syncAirRawText(nextAir);
  };

  const handleDeleteFrame = () => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action || action.elements.length <= 1) {
      alert("An animation action must contain at least 1 frame element!");
      return;
    }

    const nextAir = { ...airData };
    const nextAction = { ...action };
    nextAction.elements = nextAction.elements.filter((_, idx) => idx !== currentFrame);
    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    setCurrentFrame(Math.max(0, currentFrame - 1));
    syncAirRawText(nextAir);
  };

  const handleAddCollisionBox = (clsnType: 1 | 2) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;

    const nextAir = { ...airData };
    const nextAction = { ...action };
    const boxId = Math.floor(Math.random() * 100000);
    const newBox = { id: boxId, x1: -30, y1: -60, x2: 30, y2: 10 };
    
    if (clsnType === 1) {
      nextAction.clsn1 = [...nextAction.clsn1, newBox];
    } else {
      nextAction.clsn2 = [...nextAction.clsn2, newBox];
    }

    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    syncAirRawText(nextAir);
  };

  const handleDeleteCollisionBox = (clsnType: 1 | 2, boxId: number) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;

    const nextAir = { ...airData };
    const nextAction = { ...action };

    if (clsnType === 1) {
      nextAction.clsn1 = nextAction.clsn1.filter((b: any) => b.id !== boxId);
    } else {
      nextAction.clsn2 = nextAction.clsn2.filter((b: any) => b.id !== boxId);
    }

    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    syncAirRawText(nextAir);
  };

  const handleUpdateCollisionBox = (clsnType: 1 | 2, boxId: number, field: string, value: number) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;

    const nextAir = { ...airData };
    const nextAction = { ...action };

    if (clsnType === 1) {
      nextAction.clsn1 = nextAction.clsn1.map((b: any) => b.id === boxId ? { ...b, [field]: value } : b);
    } else {
      nextAction.clsn2 = nextAction.clsn2.map((b: any) => b.id === boxId ? { ...b, [field]: value } : b);
    }

    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    syncAirRawText(nextAir);
  };

  const handleLinkSpriteToFrame = (group: number, image: number) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;
    const element = action.elements[currentFrame];
    if (!element) return;

    const nextAir = { ...airData };
    const nextAction = { ...action };
    nextAction.elements = [...nextAction.elements];
    nextAction.elements[currentFrame] = { ...element, group, image };
    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    syncAirRawText(nextAir);
  };

  const colorIndexToHex = (act: Uint8Array | null | undefined, index: number): string => {
    if (!act) return "#000000";
    const offset = index * 4;
    const r = act[offset];
    const g = act[offset + 1];
    const b = act[offset + 2];
    const toHexVal = (v: number) => {
      const h = v.toString(16);
      return h.length === 1 ? '0' + h : h;
    };
    return `#${toHexVal(r)}${toHexVal(g)}${toHexVal(b)}`.toUpperCase();
  };

  const getChannelValue = (channel: 'r' | 'g' | 'b'): number => {
    if (selectedPalColorIdx === null) return 0;
    const pal = actPalette || sffData?.images[selectedSpriteIdx]?.palette;
    if (!pal) return 0;
    const offset = selectedPalColorIdx * 4;
    if (channel === 'r') return pal[offset];
    if (channel === 'g') return pal[offset + 1];
    if (channel === 'b') return pal[offset + 2];
    return 0;
  };

  const handleModifyPaletteColor = (channel: 'r' | 'g' | 'b', value: number) => {
    if (selectedPalColorIdx === null) return;
    const currentPal = actPalette || sffData?.images[selectedSpriteIdx]?.palette;
    if (!currentPal) return;

    const nextPal = new Uint8Array(currentPal);
    const offset = selectedPalColorIdx * 4;
    if (channel === 'r') nextPal[offset] = value;
    if (channel === 'g') nextPal[offset + 1] = value;
    if (channel === 'b') nextPal[offset + 2] = value;
    nextPal[offset + 3] = 255; // solid alpha

    if (actPalette) {
      setActPalette(nextPal);
    } else if (sffData && selectedSpriteIdx !== null) {
      const nextSff = { ...sffData };
      if (nextSff.images[selectedSpriteIdx]) {
        nextSff.images[selectedSpriteIdx].palette = nextPal;
        setSffData(nextSff);
      }
    }
  };

  const handleModifyHexColor = (hex: string) => {
    if (selectedPalColorIdx === null) return;
    const currentPal = actPalette || sffData?.images[selectedSpriteIdx]?.palette;
    if (!currentPal) return;

    let raw = hex.replace('#', '');
    if (raw.length === 3) raw = raw.split('').map(c => c+c).join('');
    const val = parseInt(raw, 16);
    const r = (val >> 16) & 255;
    const g = (val >> 8) & 255;
    const b = val & 255;

    const nextPal = new Uint8Array(currentPal);
    const offset = selectedPalColorIdx * 4;
    nextPal[offset] = r;
    nextPal[offset + 1] = g;
    nextPal[offset + 2] = b;
    nextPal[offset + 3] = 255;

    if (actPalette) {
      setActPalette(nextPal);
    } else if (sffData && selectedSpriteIdx !== null) {
      const nextSff = { ...sffData };
      if (nextSff.images[selectedSpriteIdx]) {
        nextSff.images[selectedSpriteIdx].palette = nextPal;
        setSffData(nextSff);
      }
    }
  };

  const handleSavePalette = () => {
    const pal = actPalette || sffData?.images[selectedSpriteIdx]?.palette;
    if (!pal) {
      alert("No active palette to download!");
      return;
    }
    const actBuffer = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      actBuffer[i * 3] = pal[i * 4];
      actBuffer[i * 3 + 1] = pal[i * 4 + 1];
      actBuffer[i * 3 + 2] = pal[i * 4 + 2];
    }
    const blob = new Blob([actBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${iniData?.Info?.name || 'character'}.act`;
    a.click();
  };

  const playSound = (sound: SndSound) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    
    let url = sound.blobUrl;
    if (!url) {
      const blob = new Blob([sound.data], { type: 'audio/wav' });
      url = URL.createObjectURL(blob);
      sound.blobUrl = url;
    }
    
    if (playingSoundId === sound.id) {
      audioRef.current.pause();
      setPlayingSoundId(null);
    } else {
      audioRef.current.src = url;
      audioRef.current.loop = false;
      audioRef.current.onended = () => {
        setPlayingSoundId(null);
      };
      audioRef.current.play().catch(e => console.error("Audio playback error:", e));
      setPlayingSoundId(sound.id);
    }
  };

  const handleDeleteSound = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingSoundId === id) {
      audioRef.current?.pause();
      setPlayingSoundId(null);
    }
    setSndData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        sounds: prev.sounds.filter(s => s.id !== id)
      };
    });
    if (selectedSoundId === id) {
      setSelectedSoundId(null);
    }
  };

  const handleUpdateSoundProperty = (id: string, property: 'group' | 'sample' | 'name', value: any) => {
    setSndData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        sounds: prev.sounds.map(s => s.id === id ? { ...s, [property]: value } : s)
      };
    });
  };

  const handleAddSoundFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase() || 'wav';
      try {
        const buffer = await file.arrayBuffer();
        const uint8data = new Uint8Array(buffer);
        
        let lastGroup = 0;
        let lastSample = 0;
        if (sndData && sndData.sounds.length > 0) {
          const sorted = [...sndData.sounds].sort((a,b) => b.group - a.group || b.sample - a.sample);
          lastGroup = sorted[sorted.length - 1].group;
          lastSample = sorted[sorted.length - 1].sample;
        }
        
        const newSnd: SndSound = {
          id: `snd-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          group: lastGroup,
          sample: lastSample + 1,
          data: uint8data,
          format: ext,
          name: file.name.split('.')[0]
        };
        
        setSndData(prev => {
          const nextSounds = prev ? [...prev.sounds, newSnd] : [newSnd];
          return {
            version: prev?.version || '1.0',
            sounds: nextSounds
          };
        });
        setSelectedSoundId(newSnd.id);
      } catch (err: any) {
        alert("Failed to load audio file: " + err.message);
      }
    }
    if (e.target) e.target.value = '';
  };

  const handleCreateNew = () => {
    if (activeMode === 'Definitions') setIniRawText(templateDef);
    if (activeMode === 'States') setCnsRawText(templateCns);
    if (activeMode === 'Commands') setCmdRawText(templateCmd);
    if (activeMode === 'Animations') setAirRawText(templateAir);
  };
  
  const handleSave = () => {
    if (activeMode === 'Sounds' && sndData) {
      try {
        const buffer = buildSndBinary(sndData.sounds);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${iniData?.Info?.name || 'character'}.snd`;
        a.click();
      } catch (err: any) {
        alert("Failed to compile sound (SND) archive: " + err.message);
      }
    } else if (activeText && activeMode !== 'Sprites' && activeMode !== 'Animations') {
      const blob = new Blob([activeText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `file.${activeMode === 'Definitions' ? 'def' : activeMode === 'States' ? 'cns' : 'cmd'}`;
      a.click();
    }
  };

  const handleExportZip = async () => {
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      
      const charName = iniData?.Info?.name || 'character';
      const charNameClean = charName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'character';
      
      // Filename mappings
      const cmdFile = iniData?.Files?.cmd || "player.cmd";
      const cnsFile = iniData?.Files?.cns || "player.cns";
      const sffFile = iniData?.Files?.sprite || "player.sff";
      const airFile = iniData?.Files?.anim || "player.air";
      const sndFile = iniData?.Files?.sound || "player.snd";
      const actFile = iniData?.Files?.pal1 || "player.act";
      const defFile = `${charNameClean}.def`;

      // 1. Definition File (.def)
      const defContent = iniRawText || (iniData ? stringifyIni(iniData) : templateDef);
      zip.file(`${charNameClean}/${defFile}`, defContent);

      // 2. Constants & States File (.cns)
      const cnsContent = cnsRawText || (cnsData ? stringifyIni(cnsData) : templateCns);
      zip.file(`${charNameClean}/${cnsFile}`, cnsContent);

      // 3. Command Config (.cmd)
      const cmdContent = cmdRawText || (cmdData ? stringifyIni(cmdData) : templateCmd);
      zip.file(`${charNameClean}/${cmdFile}`, cmdContent);

      // 4. Animation Config (.air)
      const airContent = airRawText || (airData ? serializeAirData(airData) : templateAir);
      zip.file(`${charNameClean}/${airFile}`, airContent);

      // 5. Sprite File (.sff)
      if (sffData) {
        const sffBuffer = buildSffBinary(sffData);
        zip.file(`${charNameClean}/${sffFile}`, sffBuffer);
      } else {
        const tBlob = generateTemplateSff();
        const buf = await tBlob.arrayBuffer();
        zip.file(`${charNameClean}/${sffFile}`, buf);
      }

      // 6. Act Palette (.act - Optional)
      if (exportZipIncludeAct) {
        const pal = actPalette || sffData?.images[selectedSpriteIdx]?.palette;
        if (pal) {
          const actBuffer = new Uint8Array(768);
          for (let i = 0; i < 256; i++) {
            actBuffer[i * 3] = pal[i * 4];
            actBuffer[i * 3 + 1] = pal[i * 4 + 1];
            actBuffer[i * 3 + 2] = pal[i * 4 + 2];
          }
          zip.file(`${charNameClean}/${actFile}`, actBuffer);
        }
      }

      // 7. Sound Archive (.snd - Optional)
      if (exportZipIncludeSnd && sndData && sndData.sounds && sndData.sounds.length > 0) {
        const sndBuffer = buildSndBinary(sndData.sounds);
        zip.file(`${charNameClean}/${sndFile}`, sndBuffer);
      }

      // Generate the ZIP Blob
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${charNameClean}_character.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setShowExportZipModal(false);
    } catch (err: any) {
      alert("Failed to export character ZIP archive: " + err.message);
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col font-sans text-white text-xs select-none" style={{ backgroundColor: '#2a2a2a' }}>
      <input type="file" ref={fileInputRef} multiple accept=".def,.cns,.st,.cmd,.sff,.act,.air,.snd,.wav,.mp3" onChange={handleFileUpload} className="hidden" />

      {/* Menu Bar */}
      <div className="flex items-center px-1 bg-[#1a1a1a] border-b border-[#3a3a3a] overflow-x-auto whitespace-nowrap shrink-0 max-w-[100vw] custom-scrollbar">
         <div className="px-2 py-1 cursor-default opacity-80 flex items-center gap-1 shrink-0">
             <div className="w-3 h-3 bg-blue-500 rounded-full" />
             MUGENStudio
         </div>
         {menuItems.map(item => (
            <div 
                key={item} 
                onClick={() => handleMenuClick(item)}
                className={`px-3 py-1 cursor-pointer hover:bg-[#333333] ${activeMode === item || (item === 'Project' && activeMode === 'Definitions') ? 'text-blue-400' : 'text-gray-300'}`}
            >
                {item}
            </div>
         ))}
      </div>

      {/* Main Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#111111] overflow-x-auto whitespace-nowrap shrink-0 max-w-[100vw]" style={{ background: 'linear-gradient(to bottom, #4a4a4a, #2f2f2f)' }}>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="New" onClick={handleCreateNew}><File size={16} color="#4ade80" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Open" onClick={() => fileInputRef.current?.click()}><FolderOpen size={16} color="#60a5fa" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Save" onClick={handleSave}><Save size={16} color="#60a5fa" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Export Character to ZIP" onClick={() => setShowExportZipModal(true)}><Download size={16} color="#4ade80" /></button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Undo" onClick={() => document.execCommand('undo')}><Undo size={16} color="#f87171" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Redo" onClick={() => document.execCommand('redo')}><Redo size={16} color="#f87171" /></button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Cut" onClick={() => document.execCommand('cut')}><Scissors size={16} color="#9ca3af" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Copy" onClick={() => document.execCommand('copy')}><Copy size={16} color="#9ca3af" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Paste" onClick={() => navigator.clipboard.readText().then(t => document.execCommand('insertText', false, t))}><Clipboard size={16} color="#9ca3af" /></button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title="Search"><Search size={16} color="#9ca3af" /></button>
      </div>

      {/* Mobile Tabs */}
      <div className="md:hidden flex bg-[#1a1a1a] border-b border-[#333] select-none text-[10px] font-bold shrink-0">
         <div 
             className={`flex-1 text-center py-2 border-r border-[#333] cursor-pointer ${mobileTab === 'left' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/20' : 'text-gray-400'}`}
             onClick={() => setMobileTab('left')}
         >
             Properties
         </div>
         <div 
             className={`flex-1 text-center py-2 border-r border-[#333] cursor-pointer ${mobileTab === 'center' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/20' : 'text-gray-400'}`}
             onClick={() => setMobileTab('center')}
         >
             Canvas
         </div>
         {(activeMode === 'Sprites' || activeMode === 'Animations') && (
             <div 
                 className={`flex-1 text-center py-2 cursor-pointer ${mobileTab === 'right' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/20' : 'text-gray-400'}`}
                 onClick={() => setMobileTab('right')}
             >
                 Palette
             </div>
         )}
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
         {/* Left Panel */}
         <div 
             onMouseDown={e => e.stopPropagation()}
             onMouseMove={e => e.stopPropagation()}
             onMouseUp={e => e.stopPropagation()}
             onTouchStart={e => e.stopPropagation()}
             onTouchMove={e => e.stopPropagation()}
             onTouchEnd={e => e.stopPropagation()}
             onClick={e => e.stopPropagation()}
             className={`md:w-72 w-full border-r border-[#111111] bg-[#1e1e1e] flex-col select-none ${mobileTab === 'left' ? 'flex absolute inset-0 z-30 md:relative' : 'hidden md:flex'}`}
         >
            <div className="bg-[#111111] text-gray-300 font-bold py-2 px-3 flex justify-between items-center border-b border-[#333333]">
                <span className="uppercase text-[10px] tracking-wider">{activeMode} properties</span>
                <span className="text-[9px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded font-mono">
                    ID: {activeMode === 'Sprites' ? (selectedSpriteIdx !== null ? selectedSpriteIdx : '0') : (selectedActionId !== null ? selectedActionId : '0')}
                </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
                {activeMode === 'Definitions' && (
                    <div className="flex flex-col gap-3">
                        <div className="text-xs font-semibold text-gray-400 border-b border-[#333333] pb-1">Visual Metadata Form</div>
                        
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">Character Name</label>
                            <input 
                                type="text"
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={iniData?.Info?.name || ''} 
                                onChange={e => handleUpdateDefValue('Info', 'name', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">Display Name</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={iniData?.Info?.displayname || ''} 
                                onChange={e => handleUpdateDefValue('Info', 'displayname', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">Author</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={iniData?.Info?.author || ''} 
                                onChange={e => handleUpdateDefValue('Info', 'author', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">M.U.G.E.N Version</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={iniData?.Info?.mugenversion || '1.0'} 
                                onChange={e => handleUpdateDefValue('Info', 'mugenversion', e.target.value)}
                            />
                        </div>

                        <div className="text-xs font-semibold text-gray-400 border-b border-[#333333] pt-2 pb-1">Asset References</div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">States File (CNS)</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={iniData?.Files?.cns || ''}
                                onChange={e => handleUpdateDefValue('Files', 'cns', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">Sprites (SFF)</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={iniData?.Files?.sprite || ''} 
                                onChange={e => handleUpdateDefValue('Files', 'sprite', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">Animations (AIR)</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={iniData?.Files?.anim || ''} 
                                onChange={e => handleUpdateDefValue('Files', 'anim', e.target.value)}
                            />
                        </div>

                        <div className="text-[10px] text-gray-500 italic mt-2 text-center">
                            Changes visually synced back to DEF editor panel instantly.
                        </div>
                    </div>
                )}

                {activeMode === 'Sprites' && sffData && (
                    <div className="flex flex-col gap-4">
                        {/* Sprite Selector */}
                        <div className="flex justify-between items-center text-gray-300 bg-[#252525] p-2 border border-[#333] rounded">
                             <button className="px-2 py-0.5 hover:bg-[#444] rounded text-blue-400 font-bold" onClick={() => setSelectedSpriteIdx(Math.max(0, (selectedSpriteIdx || 0) - 1))}>&larr;</button>
                             <span className="font-mono text-[11px]">No. {selectedSpriteIdx !== null ? selectedSpriteIdx + 1 : 0} / {sffData.numImages}</span>
                             <button className="px-2 py-0.5 hover:bg-[#444] rounded text-blue-400 font-bold" onClick={() => setSelectedSpriteIdx(Math.min(sffData.numImages - 1, (selectedSpriteIdx || 0) + 1))}>&rarr;</button>
                        </div>

                        {/* Import/Delete/Duplicate Tools */}
                        <div className="flex flex-col gap-2 pb-2 border-b border-[#333]">
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => spritePngInputRef.current?.click()}
                                    className="px-3 py-1.5 bg-green-900/40 border border-green-700/80 rounded hover:bg-green-900/60 text-green-400 font-bold text-center flex items-center justify-center gap-1.5"
                                    title="Import custom PNG/JPG file"
                                >
                                    <Plus size={12} />
                                    Import
                                </button>
                                <button 
                                    onClick={handleDeleteSprite}
                                    className="px-3 py-1.5 bg-red-955/40 border border-red-800/80 rounded hover:bg-red-955/60 text-red-400 font-bold text-center flex items-center justify-center gap-1.5"
                                    title="Delete active sprite from sheet"
                                >
                                    <Minus size={12} />
                                    Delete
                                </button>
                            </div>
                            <button 
                                onClick={handleDuplicateSprite}
                                className="px-3 py-1.5 bg-blue-900/40 border border-blue-700/80 rounded hover:bg-blue-900/60 text-blue-400 font-bold text-center flex items-center justify-center gap-1.5"
                                title="Duplicate active sprite (Index + 1)"
                            >
                                <Copy size={12} />
                                Duplicate Sprite
                            </button>
                            <input 
                                type="file" 
                                ref={spritePngInputRef} 
                                onChange={handleImportSpriteFile} 
                                accept="image/png, image/jpeg" 
                                className="hidden" 
                            />
                        </div>

                        {/* Group / Image Inputs */}
                        <div className="bg-[#242424] p-3 border border-[#333] rounded flex flex-col gap-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] text-gray-400">Group No.</span>
                                    <div className="flex bg-[#1e1e1e] border border-[#3a3a3a] items-center rounded overflow-hidden">
                                        <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('group', (sffData.images[selectedSpriteIdx]?.group ?? 0) - 1)}>-</button>
                                        <input type="number" className="bg-transparent w-full text-center outline-none text-xs" value={sffData.images[selectedSpriteIdx]?.group ?? 0} onChange={e => handleUpdateSprite('group', parseInt(e.target.value) || 0)} />
                                        <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('group', (sffData.images[selectedSpriteIdx]?.group ?? 0) + 1)}>+</button>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] text-gray-400">Image No.</span>
                                    <div className="flex bg-[#1e1e1e] border border-[#3a3a3a] items-center rounded overflow-hidden">
                                        <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('image', (sffData.images[selectedSpriteIdx]?.image ?? 0) - 1)}>-</button>
                                        <input type="number" className="bg-transparent w-full text-center outline-none text-xs" value={sffData.images[selectedSpriteIdx]?.image ?? 0} onChange={e => handleUpdateSprite('image', parseInt(e.target.value) || 0)} />
                                        <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('image', (sffData.images[selectedSpriteIdx]?.image ?? 0) + 1)}>+</button>
                                    </div>
                                </div>
                            </div>

                            {/* Pivot axis settings */}
                            <div className="text-[10px] font-semibold text-gray-400 border-b border-[#333] pb-1 mt-1">Pivot Offset (Coordinates)</div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] text-gray-400">X Offset:</span>
                                    <input type="number" className="bg-[#1e1e1e] border border-[#3a3a3a] px-2 py-1 text-center outline-none text-xs rounded" value={sffData.images[selectedSpriteIdx]?.xOffset ?? 0} onChange={e => handleUpdateSprite('xOffset', parseInt(e.target.value) || 0)} />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] text-gray-400">Y Offset:</span>
                                    <input type="number" className="bg-[#1e1e1e] border border-[#3a3a3a] px-2 py-1 text-center outline-none text-xs rounded" value={sffData.images[selectedSpriteIdx]?.yOffset ?? 0} onChange={e => handleUpdateSprite('yOffset', parseInt(e.target.value) || 0)} />
                                </div>
                            </div>
                            <div className="text-[9px] text-gray-500 text-center italic mt-1 pb-1">
                                Drag the image on the canvas to adjust visually
                            </div>
                        </div>

                        {/* Search and Gallery */}
                        <div className="flex flex-col gap-2 flex-1">
                            <span className="text-[10px] text-gray-400 font-semibold border-b border-[#333] pb-1">Filter / Find Sprite:</span>
                            <input 
                                type="text"
                                placeholder="Search by group indices..."
                                className="bg-[#2a2a2a] border border-[#3a3a3a] w-full px-2 py-1 outline-none text-gray-300 rounded text-xs"
                                value={spriteSearch}
                                onChange={e => setSpriteSearch(e.target.value)}
                            />

                            {/* Mini Sprite grid list */}
                            <div className="max-h-52 overflow-y-auto border border-[#333] bg-[#1a1a1a] rounded p-1 flex flex-col gap-1 text-[11px]">
                                {sffData.images.map((img, i) => {
                                    const searchMatches = spriteSearch === '' || img.group.toString().includes(spriteSearch);
                                    if (!searchMatches) return null;
                                    return (
                                        <div 
                                            key={i}
                                            onClick={() => setSelectedSpriteIdx(i)}
                                            className={`flex items-center justify-between p-1 rounded cursor-pointer hover:bg-[#333] ${selectedSpriteIdx === i ? 'bg-blue-900/40 text-blue-400 text-bold border-l-2 border-blue-500' : 'text-gray-400'}`}
                                        >
                                            <span>SFF Image index {i}</span>
                                            <span className="font-mono text-[10px]">{img.group},{img.image}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {activeMode === 'Animations' && airData && (
                    <div className="flex flex-col gap-3 h-full">
                        {/* Action select header */}
                        <div className="bg-[#242424] px-2 py-1.5 border border-[#333] rounded flex items-center justify-between">
                            <label className="text-[10px] text-gray-400 font-bold uppercase">Anim ID:</label>
                            <select 
                                className="bg-[#1e1e1e] border border-[#3c3c3c] text-xs outline-none px-1 rounded text-blue-400 font-mono"
                                value={selectedActionId ?? ''}
                                onChange={e => {
                                    setSelectedActionId(parseInt(e.target.value));
                                    setCurrentFrame(0);
                                }}
                            >
                                {Object.keys(airData.actions).sort((a,b)=>Number(a)-Number(b)).map(actId => (
                                    <option key={actId} value={actId}>Action {actId}</option>
                                ))}
                            </select>
                        </div>

                        {/* Add/Delete Action Sequence */}
                        <div className="bg-[#212121] p-2 border border-[#333] rounded flex flex-col gap-2">
                             <div className="text-[10px] text-gray-400 font-semibold">Sequence Actions Builder</div>
                             <div className="flex gap-1.5">
                                 <input 
                                     type="number"
                                     className="bg-[#1e1e1e] border border-[#3a3a3a] text-xs text-center w-16 px-1 rounded outline-none"
                                     value={newActionIdText}
                                     onChange={e => setNewActionIdText(e.target.value)}
                                     placeholder="Hex/No"
                                 />
                                 <button 
                                     onClick={() => handleAddAnimAction(parseInt(newActionIdText) || 0)}
                                     className="flex-1 bg-green-900/40 border border-green-700/80 hover:bg-green-900/60 px-2 py-0.5 rounded text-[10px] font-bold text-green-400"
                                 >
                                      + Add Act
                                 </button>
                                 <button 
                                     onClick={() => selectedActionId !== null && handleDeleteAnimAction(selectedActionId)}
                                     className="bg-red-955/40 border border-red-800/80 hover:bg-red-955/60 px-2 py-0.5 rounded text-[10px] font-bold text-red-400"
                                 >
                                      Rem Act
                                 </button>
                             </div>
                        </div>

                        {/* Elements / Frame Sequence edit */}
                        {selectedActionId !== null && airData.actions[selectedActionId] && (
                            <div className="flex flex-col gap-2 bg-[#242424] p-3 border border-[#333] rounded">
                                <div className="flex justify-between items-center text-[10px] font-semibold text-gray-300 border-b border-[#3a3a3a] pb-1">
                                    <span>Frame {currentFrame + 1} / {airData.actions[selectedActionId].elements.length}</span>
                                    <div className="flex gap-1">
                                         <button className="px-1 hover:bg-[#333] rounded text-blue-400 font-bold" onClick={() => { setIsPlaying(false); setCurrentFrame(prev => Math.max(0, prev - 1)); }}>&larr;</button>
                                         <button className="px-1 hover:bg-[#333] rounded text-blue-400 font-bold" onClick={() => { setIsPlaying(false); setCurrentFrame(prev => Math.min((airData.actions[selectedActionId]?.elements.length || 1) - 1, prev + 1)); }}>&rarr;</button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] text-gray-400">Sprite Group:</span>
                                        <input 
                                            type="number" 
                                            className="bg-[#1a1a1a] border border-[#3a3a3a] text-center text-xs p-1 rounded font-mono"
                                            value={airData.actions[selectedActionId].elements[currentFrame]?.group ?? 0}
                                            onChange={e => handleUpdateFrameField('group', parseInt(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] text-gray-400">Sprite Image:</span>
                                        <input 
                                            type="number" 
                                            className="bg-[#1a1a1a] border border-[#3a3a3a] text-center text-xs p-1 rounded font-mono"
                                            value={airData.actions[selectedActionId].elements[currentFrame]?.image ?? 0}
                                            onChange={e => handleUpdateFrameField('image', parseInt(e.target.value) || 0)}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] text-gray-400">Frame Time (ticks):</span>
                                        <input 
                                            type="number" 
                                            className="bg-[#1a1a1a] border border-[#3a3a3a] text-center text-xs p-1 rounded font-mono"
                                            value={airData.actions[selectedActionId].elements[currentFrame]?.time ?? 1}
                                            onChange={e => handleUpdateFrameField('time', parseInt(e.target.value) || 1)}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] text-gray-400">Mirror / Flip:</span>
                                        <select 
                                            className="bg-[#1a1a1a] border border-[#3a3a3a] text-xs p-1 rounded outline-none"
                                            value={airData.actions[selectedActionId].elements[currentFrame]?.flip || ""}
                                            onChange={e => handleUpdateFrameField('flip', e.target.value)}
                                        >
                                            <option value="">None</option>
                                            <option value="H">Horizontal Flip (H)</option>
                                            <option value="V">Vertical Flip (V)</option>
                                            <option value="HV">Diagonal Flip (HV)</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] text-gray-400">Offset Delta X:</span>
                                        <input 
                                            type="number" 
                                            className="bg-[#1a1a1a] border border-[#3a3a3a] text-center text-xs p-1 rounded font-mono"
                                            value={airData.actions[selectedActionId].elements[currentFrame]?.xOffset ?? 0}
                                            onChange={e => handleUpdateFrameField('xOffset', parseInt(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[9px] text-gray-400">Offset Delta Y:</span>
                                        <input 
                                            type="number" 
                                            className="bg-[#1a1a1a] border border-[#3a3a3a] text-center text-xs p-1 rounded font-mono"
                                            value={airData.actions[selectedActionId].elements[currentFrame]?.yOffset ?? 0}
                                            onChange={e => handleUpdateFrameField('yOffset', parseInt(e.target.value) || 0)}
                                        />
                                    </div>
                                </div>

                                {/* Frame Sequence Multipliers */}
                                <div className="grid grid-cols-3 gap-1 mt-2 Pt-1 border-t border-[#333]">
                                     <button onClick={handleAddFrame} className="bg-blue-900/30 border border-blue-700/80 hover:bg-blue-900/50 p-1 text-[9px] font-bold text-blue-400 rounded">Add Frame</button>
                                     <button onClick={handleDuplicateFrame} className="bg-yellow-950/30 border border-yellow-800 hover:bg-yellow-950/50 p-1 text-[9px] font-bold text-yellow-500 rounded">Duplicate</button>
                                     <button onClick={handleDeleteFrame} className="bg-red-955/30 border border-red-800 hover:bg-red-955/50 p-1 text-[9px] font-bold text-red-500 rounded">Del Frame</button>
                                </div>
                            </div>
                        )}

                        {/* Collision Box (CLSN) Designer block */}
                        {selectedActionId !== null && airData.actions[selectedActionId] && (
                            <div className="bg-[#242424] p-3 border border-[#333] rounded flex flex-col gap-2">
                                <div className="text-[10px] text-gray-400 font-semibold border-b border-[#333] pb-1">Collision Boxes Designer</div>
                                <div className="grid grid-cols-2 gap-1.5 mt-1">
                                    <button 
                                        onClick={() => handleAddCollisionBox(2)}
                                        className="bg-blue-900/30 border border-blue-700/80 rounded py-1 px-1.5 text-[9px] font-bold text-blue-400 text-center hover:bg-blue-900/50"
                                        title="Create normal Blue hit points box"
                                    >
                                        + Defensive (Clsn2)
                                    </button>
                                    <button 
                                        onClick={() => handleAddCollisionBox(1)}
                                        className="bg-red-955/30 border border-red-800/80 rounded py-1 px-1.5 text-[9px] font-bold text-red-400 text-center hover:bg-red-955/50 font-sans"
                                        title="Create red attack strike box"
                                    >
                                        + Attack (Clsn1)
                                    </button>
                                </div>

                                <div className="max-h-48 overflow-y-auto border border-[#333] bg-[#1a1a1a] rounded p-1 text-[10px] mt-1 flex flex-col gap-2 font-mono">
                                    {/* Defensive Box rows */}
                                    {airData.actions[selectedActionId].clsn2.map((box, idx) => (
                                        <div key={`c2-${idx}`} className="flex flex-col bg-blue-950/20 p-1.5 rounded border border-blue-900/30 gap-1.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-blue-400 font-bold">🛡️ Defensive Box #{idx}</span>
                                                <button onClick={() => handleDeleteCollisionBox(2, box.id)} className="text-red-500 hover:text-red-400 font-bold bg-[#222] px-1.5 rounded">DELETE</button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">X1 (Left)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.x1}
                                                        onChange={e => handleUpdateCollisionBox(2, box.id, 'x1', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">Y1 (Top)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.y1}
                                                        onChange={e => handleUpdateCollisionBox(2, box.id, 'y1', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">X2 (Right)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.x2}
                                                        onChange={e => handleUpdateCollisionBox(2, box.id, 'x2', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">Y2 (Bottom)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.y2}
                                                        onChange={e => handleUpdateCollisionBox(2, box.id, 'y2', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {/* Attack Box rows */}
                                    {airData.actions[selectedActionId].clsn1.map((box, idx) => (
                                        <div key={`c1-${idx}`} className="flex flex-col bg-red-955/10 p-1.5 rounded border border-red-900/30 gap-1.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-red-400 font-bold">⚔️ Attack Box #{idx}</span>
                                                <button onClick={() => handleDeleteCollisionBox(1, box.id)} className="text-red-500 hover:text-red-400 font-bold bg-[#222] px-1.5 rounded">DELETE</button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">X1 (Left)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.x1}
                                                        onChange={e => handleUpdateCollisionBox(1, box.id, 'x1', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">Y1 (Top)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.y1}
                                                        onChange={e => handleUpdateCollisionBox(1, box.id, 'y1', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">X2 (Right)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.x2}
                                                        onChange={e => handleUpdateCollisionBox(1, box.id, 'x2', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[8px] text-gray-500">Y2 (Bottom)</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded"
                                                        value={box.y2}
                                                        onChange={e => handleUpdateCollisionBox(1, box.id, 'y2', parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {airData.actions[selectedActionId].clsn1.length === 0 && airData.actions[selectedActionId].clsn2.length === 0 && (
                                        <span className="text-gray-500 italic text-[9px] block text-center p-1">No custom boxes</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {(activeMode === 'Commands' || activeMode === 'States') && activeParsedData && (
                    <div className="flex-1 overflow-y-auto">
                        <div className="text-gray-400 mb-2 font-bold px-1 uppercase text-[10px]">{activeMode} Explorer</div>
                        {Object.keys(activeParsedData).map((group, idx) => {
                            const displayGroup = group.replace(/\s*##\d+$/, (match) => {
                                const num = match.trim().replace('##', '');
                                return num !== '1' ? ` #${num}` : '';
                            });
                            return (
                                <div 
                                    key={idx} 
                                    onClick={() => {
                                        const cleanGroup = group.replace(/\s*##\d+$/, '');
                                        const textarea = document.querySelector('textarea');
                                        if (textarea) {
                                            const text = textarea.value;
                                            const index = text.toLowerCase().indexOf(`[${cleanGroup.toLowerCase()}]`);
                                            if (index !== -1) {
                                                textarea.focus();
                                                textarea.setSelectionRange(index, index + cleanGroup.length + 2);
                                                const linesCount = text.substring(0, index).split('\n').length;
                                                textarea.scrollTop = (linesCount - 3) * 18;
                                            }
                                        }
                                    }}
                                    className="flex items-center gap-2 px-1 py-1 hover:bg-[#333333] cursor-pointer"
                                >
                                    <span className="text-gray-500 font-mono text-[9px]">{'>'}</span>
                                    <span className="text-gray-300 truncate" title={displayGroup}>{displayGroup}</span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeMode === 'Sounds' && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Add track button */}
                        <button 
                            onClick={() => addSoundInputRef.current?.click()} 
                            className="flex items-center justify-center gap-1.5 w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold text-[10px] transition-all mb-3 border border-blue-500 shadow-md cursor-pointer shrink-0"
                        >
                            <PlusCircle size={13} />
                            Add Audio File (.wav, .mp3)
                        </button>
                        <input 
                            type="file" 
                            ref={addSoundInputRef} 
                            onChange={handleAddSoundFile} 
                            accept=".wav,.mp3,.ogg,.m4a,.aac" 
                            className="hidden" 
                        />

                        {/* Filter & Search */}
                        <div className="flex flex-col gap-2 mb-3 shrink-0">
                            <div className="relative">
                                <Search size={11} className="absolute left-2.5 top-2 text-gray-500" />
                                <input 
                                    type="text" 
                                    placeholder="Search group, sample, name..." 
                                    className="w-full bg-[#111] border border-[#333] pl-7 pr-2 py-1.5 rounded text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                                    value={soundSearch}
                                    onChange={e => setSoundSearch(e.target.value)}
                                />
                            </div>
                            
                            <div className="flex items-center gap-1 leading-none">
                                <span className="text-[9px] text-gray-500 uppercase font-bold shrink-0">Filter Group:</span>
                                <select 
                                    className="flex-1 bg-[#111] border border-[#333] rounded px-1.5 py-1 text-[10px] text-gray-300 outline-none"
                                    value={soundFilterGroup}
                                    onChange={e => setSoundFilterGroup(e.target.value)}
                                >
                                    <option value="all">All Groups</option>
                                    {Array.from(new Set((sndData?.sounds || []).map(s => s.group))).sort((a,b)=>Number(a)-Number(b)).map(grp => (
                                        <option key={grp} value={grp.toString()}>Group {grp}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Sounds list */}
                        <div className="text-gray-400 mb-1 font-bold px-1 uppercase text-[10px] shrink-0">Sounds Explorer</div>
                        <div className="flex-1 overflow-y-auto pr-0.5 flex flex-col gap-1 custom-scrollbar">
                            {sndData?.sounds && sndData.sounds.length > 0 ? (
                                sndData.sounds.filter(snd => {
                                    const matchesSearch = soundSearch ? (snd.name?.toLowerCase().includes(soundSearch.toLowerCase()) || snd.group.toString().includes(soundSearch) || snd.sample.toString().includes(soundSearch)) : true;
                                    const matchesGroup = soundFilterGroup === 'all' ? true : snd.group.toString() === soundFilterGroup;
                                    return matchesSearch && matchesGroup;
                                }).map((sound) => {
                                    const isSelected = selectedSoundId === sound.id;
                                    const isCurrentlyPlaying = playingSoundId === sound.id;
                                    return (
                                        <div 
                                            key={sound.id}
                                            onClick={() => setSelectedSoundId(sound.id)}
                                            className={`flex items-center justify-between group/item p-2 rounded border cursor-pointer transition-all ${isSelected ? 'bg-blue-600/25 border-blue-500/80 text-white shadow-inner shadow-blue-500/10' : 'bg-[#1a1a1a] hover:bg-[#252525] border-[#333] text-gray-300'}`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0 pr-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); playSound(sound); }}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${isCurrentlyPlaying ? 'bg-emerald-500 text-white animate-pulse shadow-md shadow-emerald-500/20' : 'bg-[#2a2a2a] group-hover/item:bg-[#333] text-gray-400 hover:text-white'}`}
                                                >
                                                    {isCurrentlyPlaying ? (
                                                        <span className="text-[6px] font-bold">■</span>
                                                    ) : (
                                                        <span className="text-[8px] pl-0.5">▶</span>
                                                    )}
                                                </button>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[10px] font-bold font-mono text-gray-200">
                                                        g: {sound.group}, s: {sound.sample}
                                                    </span>
                                                    <span className="text-[9px] text-gray-400 truncate font-mono">
                                                        {sound.name || `sound_${sound.group}_${sound.sample}`}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover/item:opacity-100 transition-all">
                                                <button 
                                                    onClick={(e) => handleDeleteSound(sound.id, e)}
                                                    className="p-1 hover:bg-red-955/20 hover:text-red-400 rounded text-gray-500 transition-colors"
                                                    title="Delete Sound"
                                                >
                                                    <Trash2 size={11} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-center py-6 text-gray-500 italic text-[10px]">No sounds in project.</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
         </div>

         {/* Vertical Toolbar for Sprites & Animations */}
         {(activeMode === 'Sprites' || activeMode === 'Animations') && (
             <div className={`w-10 bg-[#252525] border-r border-[#111] flex-col items-center py-2 gap-2 shadow-[2px_0_5px_rgba(0,0,0,0.5)] z-20 overflow-y-auto shrink-0 ${mobileTab === 'center' ? 'flex' : 'hidden md:flex'}`}>
                 <button 
                     onClick={() => setActiveTool('pan')} 
                     className={`p-1.5 rounded ${activeTool === 'pan' ? 'bg-[#444] shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                     title="Pan Camera"
                 >
                     <Hand size={16} />
                 </button>
                 <button 
                     onClick={() => setActiveTool('move')} 
                     className={`p-1.5 rounded ${activeTool === 'move' ? 'bg-[#444] shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                     title={activeMode === 'Sprites' ? "Pivot Align Edit" : "Offset Align Edit"}
                 >
                     <Crosshair size={16} />
                 </button>
                 {activeMode === 'Sprites' && (
                     <>
                        <button 
                            onClick={() => setActiveTool('paint')} 
                            className={`p-1.5 rounded ${activeTool === 'paint' ? 'bg-[#444] shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                            title="Pixel Draw"
                        >
                            <Pen size={16} />
                        </button>
                        <button 
                            onClick={() => setActiveTool('bucket')} 
                            className={`p-1.5 rounded ${activeTool === 'bucket' ? 'bg-[#444] shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                            title="Bucket Fill (Connected Pixels)"
                        >
                            <PaintBucket size={16} />
                        </button>
                        <button 
                            onClick={() => setActiveTool('wand')} 
                            className={`p-1.5 rounded ${activeTool === 'wand' ? 'bg-[#444] shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                            title="Magic Wand (Recolor All)"
                        >
                            <Wand2 size={16} />
                        </button>
                        <button 
                            onClick={() => setActiveTool('eraser')} 
                            className={`p-1.5 rounded ${activeTool === 'eraser' ? 'bg-[#444] shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                            title="Erase (Draw Index 0)"
                        >
                            <div className="w-4 h-4 rounded-sm outline outline-1 outline-current flex items-center justify-center opacity-80" style={{ backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)', backgroundSize: '4px 4px', backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px' }} />
                        </button>
                     </>
                 )}
                 {activeMode === 'Animations' && (
                     <button 
                        onClick={() => setActiveTool('clsn_edit')} 
                        className={`p-1.5 rounded ${activeTool === 'clsn_edit' ? 'bg-[#444] shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                        title="CLSN Visual Edit"
                    >
                        <Square size={16} />
                    </button>
                 )}
             </div>
         )}

         {/* Center Render Area */}
         <div className={`flex-1 flex-col relative bg-[#333333] ${mobileTab === 'center' ? 'flex' : 'hidden md:flex'}`}>
             {/* Text Editor Layout */}
             {(activeMode === 'Definitions' || activeMode === 'Commands' || activeMode === 'States') && (
                  <div className="flex-1 bg-[#1e1e1e] flex flex-col font-mono text-[11px] overflow-hidden">
                      {activeText !== null ? (
                         <div className="flex flex-1 relative flex-col">
                             <div className="bg-[#151515] text-[10px] text-gray-500 px-4 py-1.5 flex justify-between border-b border-[#2b2b2b]">
                                  <span>Editing raw source file: {activeMode === 'Definitions' ? 'character.def' : activeMode === 'States' ? 'states.cns' : 'commands.cmd'}</span>
                                  <span className="text-blue-500">Dual Sync Form Mode enabled</span>
                             </div>
                             <textarea 
                                 className="w-full flex-1 bg-[#1e1e1e] text-[#d4d4d4] font-mono p-4 outline-none resize-none border-none whitespace-pre-wrap leading-relaxed"
                                 value={activeText || ''}
                                 onChange={(e) => setActiveText?.(e.target.value)}
                                 spellCheck="false"
                             />
                         </div>
                      ) : (
                          <div className="m-auto text-gray-500 italic font-mono text-center">
                              No active text code buffers loaded. Click "New" or load custom folders.
                          </div>
                      )}
                  </div>
             )}

             {activeMode === 'Sounds' && (
                  <div className="flex-1 bg-[#1e1e1e] flex flex-col overflow-hidden p-6 select-none leading-relaxed">
                      {activeSound ? (
                          <div className="max-w-xl w-full mx-auto my-auto bg-[#181818] rounded-xl border border-[#333] p-6 shadow-2xl flex flex-col gap-6">
                              {/* Visualizer and Title */}
                              <div className="flex flex-col gap-3">
                                  <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                          <Volume2 className="text-blue-500 animate-pulse animate-duration-1000" size={18} />
                                          <h2 className="text-sm font-bold tracking-wide uppercase text-gray-200">MUGEN Sound Deck</h2>
                                      </div>
                                      <span className="font-mono text-[9px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
                                          {activeSound.format} asset
                                      </span>
                                  </div>
                                  
                                  {/* Simulated Waveform screen */}
                                  <div className="h-28 bg-[#0d0d0d] rounded-lg border border-[#252525] relative overflow-hidden flex items-center justify-center">
                                      {/* Glowing grid */}
                                      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(#33b5e5 1px, transparent 1px), linear-gradient(90deg, #33b5e5 1px, transparent 1px)', backgroundSize: '10px 10px' }} />
                                      
                                      {/* Dynamic sine/wave display */}
                                      <div className="absolute inset-0 flex items-center justify-center">
                                          <svg className="w-full h-16 stroke-blue-400 opacity-80" viewBox="0 0 400 100" preserveAspectRatio="none">
                                              <path 
                                                  d={Array.from({ length: 40 }).map((_, i) => {
                                                      const x = (i / 39) * 400;
                                                      let y = 50;
                                                      if (playingSoundId === activeSound.id) {
                                                          y = 50 + 35 * Math.sin(i * 0.8) * Math.sin(Date.now() / 150 + i * 0.2);
                                                      } else {
                                                          y = 50 + 8 * Math.sin(i * 0.4);
                                                      }
                                                      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                                                  }).join(' ')} 
                                                  fill="transparent" 
                                                  strokeWidth="2" 
                                                  strokeLinecap="round"
                                              />
                                          </svg>
                                      </div>
                                      
                                      {/* LED labels */}
                                      <div className="absolute top-2 left-3 font-mono text-[8px] text-emerald-500/70 flex gap-2">
                                          <span>CH 1: ACTIVE</span>
                                          <span>PEAK: -3.5dB</span>
                                      </div>
                                      <div className="absolute bottom-2 right-3 font-mono text-[8px] text-blue-500/70">
                                          11.025 KHz 8-bit Mono
                                      </div>
                                  </div>
                              </div>

                              {/* Primary Metadata Controller (Break & Group Sound) */}
                              <div className="grid grid-cols-2 gap-4 bg-[#212121] p-4 rounded-lg border border-[#2e2e2e]">
                                  <div className="flex flex-col gap-1.5 col-span-2">
                                      <label className="text-[9px] uppercase font-bold text-gray-400">Sound Asset Label / Identifier</label>
                                      <input 
                                          type="text" 
                                          className="bg-[#151515] border border-[#3e3e3e] hover:border-blue-500 focus:border-blue-500 text-gray-200 text-xs px-3 py-2 rounded outline-none transition-colors font-mono"
                                          value={activeSound.name || ''}
                                          onChange={(e) => handleUpdateSoundProperty(activeSound.id, 'name', e.target.value)}
                                      />
                                  </div>

                                  <div className="flex flex-col gap-1.5">
                                      <label className="text-[9px] uppercase font-bold text-gray-400">Group ID (snd.group)</label>
                                      <input 
                                          type="number" 
                                          className="bg-[#151515] border border-[#3e3e3e] hover:border-blue-500 focus:border-blue-500 text-gray-200 text-xs px-3 py-2 rounded outline-none text-center transition-colors font-mono"
                                          value={activeSound.group}
                                          onChange={(e) => handleUpdateSoundProperty(activeSound.id, 'group', parseInt(e.target.value) || 0)}
                                      />
                                      <span className="text-[8px] text-gray-500 leading-tight">Common: 0 (System/UI), 20 (Punch/Hit), 100 (Combo)</span>
                                  </div>

                                  <div className="flex flex-col gap-1.5">
                                      <label className="text-[9px] uppercase font-bold text-gray-400">Sample ID (snd.sample)</label>
                                      <input 
                                          type="number" 
                                          className="bg-[#151515] border border-[#3e3e3e] hover:border-blue-500 focus:border-blue-500 text-gray-200 text-xs px-3 py-2 rounded outline-none text-center transition-colors font-mono"
                                          value={activeSound.sample}
                                          onChange={(e) => handleUpdateSoundProperty(activeSound.id, 'sample', parseInt(e.target.value) || 0)}
                                      />
                                      <span className="text-[8px] text-gray-500 leading-tight">Sequential sample indicator index for grouping</span>
                                  </div>
                              </div>

                              {/* Playback & Meta details */}
                              <div className="flex items-center justify-between border-t border-[#333] pt-4 shrink-0">
                                  <button
                                      onClick={() => playSound(activeSound)}
                                      className={`px-8 py-2.5 rounded-lg border font-bold text-xs uppercase flex items-center justify-center gap-2 transition-all cursor-pointer ${playingSoundId === activeSound.id ? 'bg-[#1b3a24] border-emerald-500 text-emerald-300 shadow-md shadow-emerald-500/20' : 'bg-blue-600 border-blue-500 hover:bg-blue-500 text-white shadow-md'}`}
                                  >
                                      {playingSoundId === activeSound.id ? (
                                          <>
                                              <span className="inline-block w-2.5 h-2.5 bg-red-400 rounded-full animate-ping shrink-0" />
                                              STOP SAMPLE
                                          </>
                                      ) : (
                                          <>
                                              <span className="inline-block w-2 h-2 border-y-4 border-l-8 border-y-transparent border-l-white shrink-0" />
                                              PLAY SAMPLE
                                          </>
                                      )}
                                  </button>
                                  
                                  <div className="flex flex-col items-end font-mono text-[9px] text-gray-500">
                                      <span>Binary Size: {(activeSound.data.length / 1024).toFixed(1)} KB</span>
                                      <span>MUGEN SND Format v1.0 compatible</span>
                                  </div>
                              </div>
                          </div>
                      ) : (
                          <div className="m-auto flex flex-col items-center gap-3 text-gray-500">
                              <Music size={32} className="opacity-40 animate-pulse text-blue-500/70" />
                              <span className="italic text-center text-xs">No sound selected. Choose/upload a track from the sidebar.</span>
                          </div>
                      )}
                  </div>
              )}

             {/* Sprite/Video Canvas Layout */}
             {(activeMode === 'Sprites' || activeMode === 'Animations') && (
                <div 
                     ref={workspaceRef}
                     onMouseDown={handleCanvasMouseDown}
                     onMouseMove={handleCanvasMouseMove}
                     onMouseUp={handleCanvasMouseUp}
                     onMouseLeave={handleCanvasMouseUp}
                     onTouchStart={handleCanvasTouchStart}
                     onTouchMove={handleCanvasTouchMove}
                     onTouchEnd={handleCanvasTouchEnd}
                     onTouchCancel={handleCanvasTouchEnd}
                     className={`flex-1 flex items-center justify-center relative overflow-hidden select-none ${(activeTool === 'paint' || activeTool === 'eraser' || activeTool === 'bucket' || activeTool === 'wand') ? 'cursor-crosshair' : 'cursor-move'}`} 
                     style={{ backgroundColor: '#2e2e2e', backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundPosition: 'center center', touchAction: 'none' }}
                >
                     
                    {/* Top Ruler Dummy */}
                    <div className="absolute top-0 left-0 right-0 h-5 bg-[#222222] border-b border-[#111111] text-[9px] text-gray-500 flex items-end px-2" style={{ clipPath: 'inset(0)' }}>
                         -500 ... -400 ... -300 ... -200 ... -100 ... 0 ... 100 ... 200 ... 300 ... 400 ... 500
                    </div>

                    {/* Left Ruler Dummy */}
                    <div className="absolute top-0 left-0 bottom-0 w-8 bg-[#222222] border-r border-[#111111] text-[9px] text-gray-500 flex flex-col items-center justify-around py-5">
                         <span>-300</span><span>-200</span><span>-100</span><span>0</span><span>100</span><span>200</span><span>300</span>
                    </div>

                    {/* Tool panel right overlay */}
                    <div className="absolute top-6 right-6 flex flex-col gap-1.5 z-10" onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
                        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(10, z + 0.5)); }} title="Zoom In" className="w-7 h-7 bg-[#3a3a3a] border border-[#111111] flex items-center justify-center hover:bg-[#555] rounded text-gray-300 shadow-lg cursor-pointer"><ZoomIn size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.25, z - 0.5)); }} title="Zoom Out" className="w-7 h-7 bg-[#3a3a3a] border border-[#111111] flex items-center justify-center hover:bg-[#555] rounded text-gray-300 shadow-lg cursor-pointer"><ZoomOut size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setShowAxis(a => !a); }} title="Toggle Axis Grid" className={`w-7 h-7 border border-[#111111] flex items-center justify-center hover:bg-[#555] rounded shadow-lg cursor-pointer ${showAxis ? 'bg-blue-600 text-white' : 'bg-[#3a3a3a] text-gray-300'}`}><Plus size={14} /></button>
                    </div>

                    {/* Overlay info tooltip */}
                    <div className="absolute top-7 left-10 bg-[#151515]/95 border border-[#444] px-3 py-1.5 rounded shadow-lg text-[10px] text-gray-300 pointer-events-none flex flex-col gap-0.5 z-20">
                        <span className="font-bold text-blue-400">
                            {activeMode === 'Sprites' && activeTool !== 'move' ? '🖌️ Interactive Pixel Drawing' : '💡 Interactive Canvas Pivot Calibration'}
                        </span>
                        <span>
                            {activeMode === 'Sprites' && activeTool !== 'move' 
                                ? 'Click on the sprite to paint pixels using the active palette color. Index 0 is transparent.' 
                                : 'Click and drag the sprite image with your mouse on the stage wrapper to adjust pivot alignment offsets seamlessly in real time!'}
                        </span>
                    </div>

                    {/* Floating brush size settings card */}
                    {activeMode === 'Sprites' && (activeTool === 'paint' || activeTool === 'eraser') && (
                        <div className="absolute bottom-6 right-6 bg-[#1a1a1a]/95 border border-[#444] rounded-lg p-3 shadow-2xl z-20 flex flex-col gap-2 w-48 text-gray-300" onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-gray-200">Brush Settings</span>
                                <span className="text-[10px] bg-blue-600/30 text-blue-400 font-mono px-1.5 py-0.5 rounded font-bold border border-blue-500/20">{brushSize}px</span>
                            </div>
                            <input 
                                type="range" 
                                min="1" 
                                max="20" 
                                value={brushSize} 
                                onChange={(e) => setBrushSize(parseInt(e.target.value) || 1)}
                                className="w-full h-1.5 bg-[#444] rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                            <div className="flex justify-between text-[9px] text-gray-400">
                                <span>1px</span>
                                <span>10px</span>
                                <span>20px</span>
                            </div>
                            <div className="flex gap-1 justify-between mt-1 pt-1.5 border-t border-[#333]">
                                {[1, 2, 3, 5, 8].map(sz => (
                                    <button
                                        key={sz}
                                        onClick={() => setBrushSize(sz)}
                                        className={`flex-1 text-[9px] py-1 rounded border transition-all ${brushSize === sz ? 'bg-blue-600 text-white border-blue-500 font-bold' : 'bg-[#333] hover:bg-[#444] border-[#444] text-gray-400'}`}
                                    >
                                        {sz}px
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {sffData ? (
                        activeMode === 'Sprites' ? (
                            <FF3SpriteRenderer 
                                sprite={sffData.images[selectedSpriteIdx]} 
                                act={actPalette} 
                                zoom={zoom}
                                showAxis={showAxis}
                                pan={pan}
                                previewOffset={previewOffset}
                            />
                        ) : (
                            <AnimationStage 
                                sff={sffData} 
                                act={actPalette} 
                                action={selectedActionId !== null ? airData?.actions[selectedActionId] : null}
                                frameIndex={currentFrame}
                                zoom={zoom}
                                showClsn={showClsn}
                                showAxis={showAxis}
                                pan={pan}
                                previewOffset={previewOffset}
                                activeTool={activeTool}
                                selectedClsn={selectedClsn}
                                setSelectedClsn={setSelectedClsn}
                                onUpdateBox={handleUpdateCollisionBox}
                            />
                        )
                    ) : ( 
                        <div className="text-gray-500 italic">No sprites loaded in memory...</div>
                    )}

                    {activeMode === 'Animations' && (
                        (() => {
                            const action = selectedActionId !== null && airData ? airData.actions[selectedActionId] : null;
                            const elements = action ? action.elements : [];
                            const currentElement = elements[currentFrame] || null;
                            const totalFrames = elements.length; return (
                            
                                                <div 
                                    onMouseDown={e => e.stopPropagation()}
                                    onMouseMove={e => e.stopPropagation()}
                                    onMouseUp={e => e.stopPropagation()}
                                    onTouchStart={e => e.stopPropagation()}
                                    onTouchMove={e => e.stopPropagation()}
                                    onTouchEnd={e => e.stopPropagation()}
                                    onClick={e => e.stopPropagation()}
                                    className="absolute bottom-0 left-0 md:left-8 right-0 h-40 md:h-36 bg-[#1a1a1a] border-t border-[#333333] p-2 flex flex-col gap-1.5 shadow-2xl z-20 select-none"
                                >
                                    {/* Timeline Toolbar Row */}
                                    <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-1.5 border-b border-[#2d2d2d] pb-1.5 overflow-x-auto scrollbar-none">
                                        {/* Playback & Speed */}
                                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                                            <button 
                                                onClick={() => setIsPlaying(!isPlaying)} 
                                                className={`px-2.5 py-1 md:px-3 md:py-1 rounded border border-[#3a3a3a] flex items-center gap-1 font-bold text-[10px] md:text-[11px] transition-colors ${isPlaying ? 'bg-red-950/50 text-red-400 border-red-800' : 'bg-green-950/50 text-green-400 border-green-800'}`}
                                                title={isPlaying ? "Pause Anim Playback" : "Play Anim Sequence"}
                                            >
                                                {isPlaying ? <Pause size={10} /> : <Play size={10} />}
                                                {isPlaying ? 'PAUSE' : 'PLAY'}
                                            </button>
                                            
                                            <button 
                                                onClick={() => { setIsPlaying(false); setCurrentFrame(0); }}
                                                className="px-2 py-1 rounded bg-[#2a2a2a] hover:bg-[#333] border border-[#3a3a3a] text-gray-300 text-[10px] font-bold"
                                                title="Reset current playhead to Frame 1"
                                            >
                                                STOP
                                            </button>

                                            {/* Speed controls */}
                                            <span className="text-[10px] text-gray-500 font-bold ml-1 md:ml-2">SPEED:</span>
                                            <div className="flex bg-[#262626] rounded border border-[#3a3a3a] p-0.5">
                                                {[0.5, 1, 2].map(sp => (
                                                    <button 
                                                        key={sp}
                                                        onClick={() => setPlaybackSpeed(sp)}
                                                        className={`px-1.5 py-0.5 text-[9px] font-mono rounded font-medium transition-all ${playbackSpeed === sp ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:text-white hover:bg-[#333]'}`}
                                                    >
                                                        {sp}x
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Frame Info & Duration Quick-Edit on Timeline */}
                                        <div className="flex items-center gap-1.5 md:gap-3 shrink-0 flex-wrap">
                                            {currentElement && (
                                                <div className="flex items-center gap-1.5 text-[10px] md:text-[11px] bg-[#242424] border border-[#3a3a3a] px-2 py-0.5 rounded text-gray-300">
                                                    <span className="text-gray-500 font-bold max-md:hidden">DELAY:</span>
                                                    <input 
                                                        type="number" 
                                                        className="w-10 md:w-12 bg-black text-center text-[10px] text-blue-400 font-mono font-bold rounded border border-[#444] px-0.5 focus:border-blue-500 outline-none"
                                                        value={currentElement.time ?? 1}
                                                        title="Ticks delay for the active frame. Enter -1 for infinite hold!"
                                                        onChange={e => handleUpdateFrameField('time', parseInt(e.target.value) || 0)}
                                                    />
                                                    <span className="text-gray-500 text-[9px]">ticks</span>
                                                    {currentElement.time <= 0 && (
                                                        <span className="bg-amber-950 text-amber-400 border border-amber-800 text-[8px] font-bold px-1.5 rounded leading-none py-0.5 max-md:hidden">
                                                            INF
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {action && (
                                                <div className="flex gap-1 text-[9px] md:text-xs">
                                                    <button onClick={handleAddFrame} className="bg-blue-950/20 border border-blue-900 hover:bg-blue-900/40 px-2 py-1 md:px-1.5 md:py-0.5 font-bold text-blue-400 rounded transition-all">+ Frame</button>
                                                    <button onClick={handleDuplicateFrame} className="bg-yellow-950/20 border border-yellow-900 hover:bg-yellow-950/40 px-2 py-1 md:px-1.5 md:py-0.5 font-bold text-yellow-500 rounded transition-all">Dup</button>
                                                    <button 
                                                        onClick={handleDeleteFrame} 
                                                        className="bg-red-950/20 border border-red-900 hover:bg-red-900/40 px-2 py-1 md:px-1.5 md:py-0.5 font-bold text-red-500 rounded transition-all"
                                                        disabled={totalFrames <= 1}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Scrollable Frame Strip view */}
                                    <div className="flex-1 flex gap-2 overflow-x-auto overflow-y-hidden py-1 items-center px-1 select-none scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                                        {elements.map((elem, idx) => {
                                            const isActive = idx === currentFrame;
                                            const duration = elem.time;
                                            const hasClsn1 = action && action.clsn1 && action.clsn1.length > 0;
                                            const hasClsn2 = action && action.clsn2 && action.clsn2.length > 0;
                                            
                                            return (
                                                <div 
                                                    key={idx}
                                                    onClick={() => { setIsPlaying(false); setCurrentFrame(idx); }}
                                                    className={`w-24 flex-shrink-0 cursor-pointer p-1.5 rounded border text-left flex flex-col justify-between h-[56px] transition-all select-none ${isActive ? 'bg-blue-950/40 border-blue-500 text-white shadow font-bold' : 'bg-[#121212] border-[#2c2c2c] text-zinc-400 hover:border-zinc-500'}`}
                                                >
                                                    <div className="flex justify-between items-center text-[9px]">
                                                        <span className={isActive ? "text-blue-300 font-bold" : "text-zinc-500"}>#{idx + 1}</span>
                                                        <span className="font-mono text-[8px] bg-[#222] px-1 rounded border border-[#333]">S: {elem.group}, {elem.image}</span>
                                                    </div>
                                                    
                                                    <div className="flex justify-between items-center mt-1">
                                                        <div className="flex gap-1.5 items-center">
                                                            <span className={`text-[9px] font-mono ${duration <= 0 ? 'text-amber-500 font-bold' : 'text-zinc-300'}`}>
                                                                {duration <= 0 ? '∞ ticks' : `${duration}t`}
                                                            </span>
                                                        </div>
                                                        {/* Collision info */}
                                                        <div className="flex gap-0.5 items-center">
                                                            {hasClsn1 && (
                                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Attack Collision Box Present" />
                                                            )}
                                                            {hasClsn2 && (
                                                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Defense Collision Box Present" />
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Progress playhead bar on the card */}
                                                    {isActive && (
                                                        <div className="h-0.5 bg-blue-500 w-full mt-1 rounded-full animate-pulse" />
                                                    )}
                                                </div>
                                            );
                                        })}
                                        
                                        {elements.length === 0 && (
                                            <div className="text-zinc-500 text-[10px] italic text-center w-full py-2">
                                                No animation frames in sequence. Click "+ Frame" or select from the Visual Sprite Picker to assign frames!
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()
                    )}
                </div>
             )}
         </div>

         {/* Right Panel */}
         {(activeMode === 'Sprites' || activeMode === 'Animations') && (
            <div 
                onMouseDown={e => e.stopPropagation()}
                onMouseMove={e => e.stopPropagation()}
                onMouseUp={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                onTouchMove={e => e.stopPropagation()}
                onTouchEnd={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                className={`md:w-72 w-full border-l border-[#111111] bg-[#1e1e1e] flex-col select-none ${mobileTab === 'right' ? 'flex absolute inset-0 z-30 md:relative' : 'hidden md:flex'}`}
            >
                {activeMode === 'Sprites' && (
                    <>
                        <div className="bg-[#111111] text-white font-bold py-2 px-3 text-center border-b border-[#333333] uppercase text-[10px] tracking-wider mb-2">
                            Palette Color modifier
                        </div>
                        <div className="px-3 py-1 flex flex-col flex-1 overflow-y-auto gap-3 text-xs">
                            <PaletteRenderer 
                                act={actPalette || sffData?.images[selectedSpriteIdx]?.palette} 
                                selectedColorIdx={selectedPalColorIdx}
                                onColorClick={(idx) => setSelectedPalColorIdx(idx)}
                            />

                            {selectedPalColorIdx !== null && (actPalette || sffData?.images[selectedSpriteIdx]?.palette) && (
                                <div className="bg-[#242424] p-3 border border-[#3a3a3a] rounded flex flex-col gap-2.5 mt-2 shadow-md">
                                    <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wide border-b border-[#333] pb-1 flex justify-between">
                                        <span>Color Index: #{selectedPalColorIdx}</span>
                                        <span className="font-mono text-gray-500">HEX: {colorIndexToHex(actPalette || sffData?.images[selectedSpriteIdx]?.palette, selectedPalColorIdx)}</span>
                                    </div>

                                    {/* Color Picker */}
                                    <input
                                        type="color"
                                        value={colorIndexToHex(actPalette || sffData?.images[selectedSpriteIdx]?.palette, selectedPalColorIdx)}
                                        onChange={(e) => handleModifyHexColor(e.target.value)}
                                        className="w-full h-10 rounded cursor-pointer"
                                    />
                                    
                                    <div className="text-[9px] text-gray-500 italic text-center leading-normal">
                                        Pick a color to watch character palette swap render on stage dynamically with absolute precision.
                                    </div>
                                </div>
                            )}

                            <div className="text-xs font-semibold text-gray-400 border-b border-[#333] pt-2 pb-1">Export / Load Palettes</div>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                <button 
                                    onClick={handleSavePalette}
                                    className="p-1 px-2.5 bg-blue-900/30 border border-blue-800/80 hover:bg-blue-900/50 rounded text-[10px] text-blue-400 font-bold flex items-center justify-center gap-1.5"
                                    title="Export correctly formatted 768-byte file"
                                >
                                    <Save size={11} />
                                    Download ACT
                                </button>
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-1 px-2.5 bg-[#2a2a2a] border border-[#3a3a3a] hover:bg-[#333] rounded text-[10px] text-gray-300 font-bold flex items-center justify-center gap-1.5"
                                    title="Load .ACT binary file from disk"
                                >
                                    <FolderOpen size={11} />
                                    Load ACT
                                </button>
                            </div>
                        </div>
                    </>
                )}
                {activeMode === 'Animations' && (
                    <>
                        <div className="bg-[#111111] text-white font-bold py-2 px-3 text-center border-b border-[#333333] uppercase text-[10px] tracking-wider mb-2">
                            Visual Sprite Picker
                        </div>
                        <div className="flex-1 p-2 overflow-y-auto flex flex-col gap-2">
                           <div className="text-[9px] text-gray-400 italic leading-snug px-1 border-l-2 border-[#555]">
                               💡 Clicking any sprite block below instantly assigns that (group, image) index to the active animation frame sequence!
                           </div>
                           
                           {sffData ? (
                               <div className="grid grid-cols-3 gap-1">
                                    {sffData.images.map((img, i) => (
                                        <div 
                                             key={i} 
                                             onClick={() => handleLinkSpriteToFrame(img.group, img.image)}
                                             className="aspect-square bg-[#222222] border border-[#333333] hover:border-blue-500 hover:bg-blue-900/10 cursor-pointer flex flex-col items-center justify-center text-[10px] p-1 rounded transition-all"
                                             title={`Select Sprite - Group: ${img.group} Image: ${img.image}`}
                                        >
                                            <span className="font-mono text-gray-400">{img.group}</span>
                                            <span className="font-mono text-blue-400">,{img.image}</span>
                                        </div>
                                    ))}
                               </div>
                           ) : (
                               <div className="text-gray-500 italic text-center p-4">No character sprites loaded in memory...</div>
                           )}
                        </div>
                    </>
                )}
            </div>
         )}
      </div>

      {/* Bottom Status / Issues Tab Panel */}
      <div className="h-28 hidden md:flex bg-[#1e1e1e] border-t border-[#111111] flex-col">
          <div className="flex bg-[#2a2a2a] border-b border-[#111111]">
              <div className="px-5 py-1 text-gray-400 bg-[#1e1e1e] border-r border-[#111111] border-t-2 border-t-[#333333]">Editor</div>
              <div className="px-5 py-1 text-gray-400 bg-[#2a2a2a] border-r border-[#111111] hover:bg-[#333] cursor-pointer">Project explorer</div>
              <div className="flex-1" />
              <div className="flex items-center gap-1 bg-[#1e1e1e] px-4 py-1 border-x border-[#111111] cursor-pointer hover:bg-[#252525]">
                  <AlertCircle size={12} color="#ef4444" />
                  <span className="text-gray-300">Issues</span>
              </div>
              <div className="px-4 py-1 text-gray-400 hover:bg-[#333] bg-[#2a2a2a] border-r border-[#111111] cursor-pointer">Advanced Search</div>
              <div className="px-4 py-1 text-gray-400 hover:bg-[#333] bg-[#2a2a2a] border-r border-[#111111] cursor-pointer">Engine Output</div>
              <div className="px-4 py-1 text-gray-400 hover:bg-[#333] bg-[#2a2a2a] border-r border-[#111111] cursor-pointer">Debugger</div>
              <div className="px-4 py-1 text-gray-400 hover:bg-[#333] bg-[#2a2a2a] border-r border-[#111111] cursor-pointer">Watch</div>
          </div>
          <div className="flex-1 p-2 overflow-auto text-gray-400 text-xs">
              0 issues found.
          </div>
          {/* Status Bar */}
          <div className="h-6 bg-[#2a2a2a] border-t border-[#111111] flex items-center px-2 text-[10px] text-gray-500 justify-between">
              <div>Position: 0, 0</div>
              <div>Project: {iniData?.Info?.name || 'Character, Unknown / not set'}</div>
              <div>Zoom: {zoom * 100}% | Hover to see coordinates</div>
          </div>
      </div>


      {/* Palette Import Modal */}
      {showPaletteChoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl w-96 p-6 flex flex-col gap-4">
                <h2 className="text-lg font-bold text-gray-200">Import Sprite Palette Processing</h2>
                <p className="text-gray-400 text-sm">
                    How would you like to handle the color palette for the imported sprite(s)?
                </p>
                <div className="flex flex-col gap-3 mt-2">
                    <button 
                        onClick={() => processSpriteImport('image_palette')}
                        className="px-4 py-3 bg-[#333] hover:bg-[#444] border border-[#555] rounded text-left transition-colors"
                    >
                        <div className="font-semibold text-blue-400">Keep Image Palette</div>
                        <div className="text-gray-400 text-xs mt-1">Extracts a custom palette directly from the PNG. The sprite will have its own unshared palette data.</div>
                    </button>
                    
                    <button 
                         onClick={() => processSpriteImport('adapt')}
                        className="px-4 py-3 bg-[#333] hover:bg-[#444] border border-[#555] rounded text-left transition-colors"
                    >
                        <div className="font-semibold text-green-400">Adapt to Active Palette</div>
                        <div className="text-gray-400 text-xs mt-1">Forces the image to use the character's currently active palette by matching nearest colors.</div>
                    </button>

                    <button 
                         onClick={() => processSpriteImport('exchange')}
                        className="px-4 py-3 bg-[#333] hover:bg-[#444] border border-[#555] rounded text-left transition-colors"
                    >
                        <div className="font-semibold text-purple-400">Exchange Global Palette</div>
                        <div className="text-gray-400 text-xs mt-1">Overrides the current active palette with the new one extracted from this image.</div>
                    </button>
                </div>
                <div className="flex justify-end mt-2">
                    <button 
                        onClick={() => {
                            setShowPaletteChoiceModal(false);
                            setPendingImportFiles([]);
                        }} 
                        className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-gray-200"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
      )}

      {showExportZipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
            <div className="bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl w-96 p-6 flex flex-col gap-4">
                <h2 className="text-lg font-bold text-gray-200">Export Character Package</h2>
                <p className="text-gray-400 text-sm">
                    Configure the components you want to include in your final ZIP archive package.
                </p>
                
                <div className="flex flex-col gap-3 my-2 bg-[#1e1e1e] p-3 rounded border border-[#333]">
                    <label className="flex items-center gap-3 cursor-pointer text-gray-300 hover:text-white">
                        <input 
                            type="checkbox" 
                            className="accent-blue-500 w-4 h-4 rounded cursor-pointer"
                            checked={exportZipIncludeAct} 
                            onChange={e => setExportZipIncludeAct(e.target.checked)}
                        />
                        <div className="flex flex-col">
                            <span className="font-semibold text-xs">Include Palette File (.act)</span>
                            <span className="text-[10px] text-gray-500">Includes character palette parameters for standard games.</span>
                        </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer text-gray-300 hover:text-white mt-1">
                        <input 
                            type="checkbox" 
                            className="accent-blue-500 w-4 h-4 rounded cursor-pointer"
                            checked={exportZipIncludeSnd} 
                            onChange={e => setExportZipIncludeSnd(e.target.checked)}
                            disabled={!sndData || !sndData.sounds || sndData.sounds.length === 0}
                        />
                        <div className="flex flex-col">
                            <span className="font-semibold text-xs">Include Sound Archive (.snd)</span>
                            <span className="text-[10px] text-gray-500">
                                {sndData && sndData.sounds && sndData.sounds.length > 0 
                                  ? `${sndData.sounds.length} sound wave(s) compiled inside.` 
                                  : "No sounds loaded in current project to export."}
                            </span>
                        </div>
                    </label>
                </div>

                <div className="flex justify-end gap-2 mt-2">
                    <button 
                        onClick={() => setShowExportZipModal(false)}
                        className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-gray-200 text-xs font-semibold"
                        disabled={isExportingZip}
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleExportZip}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs font-semibold flex items-center gap-1.5"
                        disabled={isExportingZip}
                    >
                        {isExportingZip ? (
                           <>
                             <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></span>
                             <span>Exporting...</span>
                           </>
                        ) : (
                           <span>Download ZIP</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}

function FF3SpriteRenderer({ sprite, act, zoom, showAxis, pan, previewOffset }: { sprite: any, act: Uint8Array | null, zoom: number, showAxis: boolean, pan?: {x: number, y: number}, previewOffset?: {x: number, y: number} | null }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const resolvedPalette = act || sprite?.palette;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            const rect = canvas.parentElement?.getBoundingClientRect();
            if (rect) {
                canvas.width = rect.width;
                canvas.height = rect.height;
            }
        };

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const panX = pan ? pan.x : 0;
            const panY = pan ? pan.y : 0;

            if (sprite && sprite.pixelIndices && sprite.width > 0 && sprite.height > 0 && resolvedPalette) {
                try {
                    const offscreen = getCachedSpriteCanvas(sprite, resolvedPalette);
                    ctx.imageSmoothingEnabled = false;
                    const xOff = previewOffset ? previewOffset.x : sprite.xOffset;
                    const yOff = previewOffset ? previewOffset.y : sprite.yOffset;
                    ctx.drawImage(offscreen, centerX - (xOff * zoom) + panX, centerY - (yOff * zoom) + panY, sprite.width * zoom, sprite.height * zoom);
                } catch(e) {}
            }

            if (showAxis) {
                ctx.strokeStyle = '#555';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(centerX + panX, 0); ctx.lineTo(centerX + panX, canvas.height); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, centerY + panY); ctx.lineTo(canvas.width, centerY + panY); ctx.stroke();
                ctx.strokeStyle = '#4ea8de'; ctx.strokeRect(centerX + panX - 4, centerY + panY - 4, 8, 8);
            }
        };

        resize();
        render();
        
        const handleResize = () => { resize(); render(); };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);

    }, [sprite, resolvedPalette, zoom, showAxis, pan, previewOffset]);

    return (
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    );
}

const spriteCanvasCache = new WeakMap<any, Map<any, HTMLCanvasElement>>();

function getCachedSpriteCanvas(sprite: any, palette: Uint8Array): HTMLCanvasElement {
  if (!sprite || !sprite.pixelIndices || !palette || sprite.width <= 0 || sprite.height <= 0) {
    const empty = document.createElement('canvas');
    empty.width = 1;
    empty.height = 1;
    return empty;
  }
  
  let paletteMap = spriteCanvasCache.get(sprite.pixelIndices);
  if (!paletteMap) {
    paletteMap = new Map();
    spriteCanvasCache.set(sprite.pixelIndices, paletteMap);
  }
  
  let cachedCanvas = paletteMap.get(palette);
  if (!cachedCanvas) {
    const imageData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, palette);
    cachedCanvas = document.createElement('canvas');
    cachedCanvas.width = sprite.width;
    cachedCanvas.height = sprite.height;
    const ctx = cachedCanvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(imageData, 0, 0);
    }
    paletteMap.set(palette, cachedCanvas);
  }
  
  return cachedCanvas;
}

function AnimationStage({ sff, act, action, frameIndex, zoom, showClsn, showAxis, pan, previewOffset, activeTool, selectedClsn, setSelectedClsn, onUpdateBox }: { 
    sff: SffData, 
    act: Uint8Array | null, 
    action: any | null, 
    frameIndex: number, 
    zoom: number, 
    showClsn: boolean, 
    showAxis: boolean, 
    pan?: {x: number, y: number}, 
    previewOffset?: {x: number, y: number} | null,
    activeTool: string,
    selectedClsn: { type: 1 | 2; id: number } | null,
    setSelectedClsn: (val: { type: 1 | 2; id: number } | null) => void,
    onUpdateBox: (type: 1 | 2, id: number, field: string, value: number) => void
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [dragState, setDragState] = useState<{ type: 'move' | 'nw' | 'ne' | 'sw' | 'se'; boxId: number; clsnType: 1|2; startX: number; startY: number; initialBox: any } | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            const rect = canvas.parentElement?.getBoundingClientRect();
            if (rect) {
                canvas.width = rect.width;
                canvas.height = rect.height;
            }
        };

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const centerX = canvas.width / 2;
            const centerY = canvas.height * 0.7; 
            const panX = pan ? pan.x : 0;
            const panY = pan ? pan.y : 0;

            if (showAxis) {
                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0, centerY + panY); ctx.lineTo(canvas.width, centerY + panY); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(centerX + panX, 0); ctx.lineTo(centerX + panX, canvas.height); ctx.stroke();
            }

            if (action && action.elements[frameIndex]) {
                const element = action.elements[frameIndex];
                const sprite = sff.images.find(i => i.group === element.group && i.image === element.image);
                
                if (sprite) {
                    const resolvedPal = act || sprite.palette;
                    if (resolvedPal) {
                        try {
                            const offscreen = getCachedSpriteCanvas(sprite, resolvedPal);
                            
                            const elXOff = previewOffset ? previewOffset.x : element.xOffset;
                            const elYOff = previewOffset ? previewOffset.y : element.yOffset;
                            
                            const flip = (element.flip || "").toUpperCase();
                            const flipH = flip.includes('H');
                            const flipV = flip.includes('V');

                            ctx.save();
                            ctx.translate(centerX + panX, centerY + panY);
                            if (flipH) ctx.scale(-1, 1);
                            if (flipV) ctx.scale(1, -1);

                            const drawX = (elXOff - sprite.xOffset) * zoom;
                            const drawY = (elYOff - sprite.yOffset) * zoom;
                            
                            ctx.imageSmoothingEnabled = false;
                            ctx.drawImage(offscreen, drawX, drawY, sprite.width * zoom, sprite.height * zoom);
                            ctx.restore();
                        } catch(e) {}
                    }
                }

                if (showClsn) {
                    const flip = (element.flip || "").toUpperCase();
                    const flipH = flip.includes('H');
                    const flipV = flip.includes('V');

                    ctx.save();
                    ctx.translate(centerX + panX, centerY + panY);
                    if (flipH) ctx.scale(-1, 1);
                    if (flipV) ctx.scale(1, -1);

                    const drawBox = (box: any, type: 1 | 2) => {
                        const isSelected = selectedClsn?.type === type && selectedClsn?.id === box.id;
                        ctx.strokeStyle = type === 1 ? 'rgba(255, 0, 0, 0.8)' : 'rgba(0, 100, 255, 0.8)';
                        ctx.fillStyle = type === 1 ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 100, 255, 0.2)';
                        if (isSelected) {
                            ctx.lineWidth = 2;
                            ctx.strokeStyle = type === 1 ? '#ff5555' : '#55aaff';
                        } else {
                            ctx.lineWidth = 1;
                        }

                        const bX = box.x1 * zoom;
                        const bY = box.y1 * zoom;
                        const bW = (box.x2 - box.x1) * zoom;
                        const bH = (box.y2 - box.y1) * zoom;
                        
                        ctx.fillRect(bX, bY, bW, bH);
                        ctx.strokeRect(bX, bY, bW, bH);

                        if (isSelected && activeTool === 'clsn_edit') {
                            const hS = 4;
                            ctx.fillStyle = '#fff';
                            ctx.fillRect(bX - hS, bY - hS, hS*2, hS*2);
                            ctx.fillRect(bX + bW - hS, bY - hS, hS*2, hS*2);
                            ctx.fillRect(bX - hS, bY + bH - hS, hS*2, hS*2);
                            ctx.fillRect(bX + bW - hS, bY + bH - hS, hS*2, hS*2);
                        }
                    };

                    action.clsn2.forEach((box: any) => drawBox(box, 2));
                    action.clsn1.forEach((box: any) => drawBox(box, 1));
                    ctx.restore();
                }
            }
        };

        resize();
        render();
        const handleResize = () => { resize(); render(); };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [sff, act, action, frameIndex, zoom, showClsn, showAxis, pan, previewOffset, selectedClsn, activeTool]);

    const getWorkspaceCoords = (clientX: number, clientY: number) => {
        if (!canvasRef.current || !action) return null;
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        
        const centerX = canvasRef.current.width / 2;
        const centerY = canvasRef.current.height * 0.7;
        const panX = pan?.x || 0;
        const panY = pan?.y || 0;

        const element = action.elements[frameIndex];
        const flip = (element?.flip || "").toUpperCase();
        const flipH = flip.includes('H');
        const flipV = flip.includes('V');

        let wx = (mx - (centerX + panX));
        let wy = (my - (centerY + panY));
        if (flipH) wx = -wx;
        if (flipV) wy = -wy;
        return { wx: wx / zoom, wy: wy / zoom };
    };

    const startDrag = (clientX: number, clientY: number) => {
        if (activeTool !== 'clsn_edit' || !action) return;
        const coords = getWorkspaceCoords(clientX, clientY);
        if (!coords) return;
        const { wx, wy } = coords;

        const handleSize = 12 / zoom;
        const selectionPadding = 8 / zoom;
        
        const checkBoxes = (boxes: any[], type: 1 | 2) => {
            for (let i = boxes.length - 1; i >= 0; i--) {
                const box = boxes[i];
                const isSelected = selectedClsn?.type === type && selectedClsn?.id === box.id;
                
                if (isSelected) {
                    if (Math.abs(wx - box.x1) < handleSize && Math.abs(wy - box.y1) < handleSize) return { type: 'nw' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - box.x2) < handleSize && Math.abs(wy - box.y1) < handleSize) return { type: 'ne' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - box.x1) < handleSize && Math.abs(wy - box.y2) < handleSize) return { type: 'sw' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - box.x2) < handleSize && Math.abs(wy - box.y2) < handleSize) return { type: 'se' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                }
                
                const minX = Math.min(box.x1, box.x2) - selectionPadding;
                const maxX = Math.max(box.x1, box.x2) + selectionPadding;
                const minY = Math.min(box.y1, box.y2) - selectionPadding;
                const maxY = Math.max(box.y1, box.y2) + selectionPadding;

                if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) {
                    return { type: 'move' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                }
            }
            return null;
        };

        const result = checkBoxes(action.clsn1, 1) || checkBoxes(action.clsn2, 2);
        
        if (result) {
            setSelectedClsn({ type: result.clsnType, id: result.boxId });
            setDragState({ ...result, startX: wx, startY: wy });
        } else {
            setSelectedClsn(null);
        }
    };

    const doDrag = (clientX: number, clientY: number) => {
        if (!dragState || !action) return;
        const coords = getWorkspaceCoords(clientX, clientY);
        if (!coords) return;
        const { wx, wy } = coords;

        const dx = Math.round(wx - dragState.startX);
        const dy = Math.round(wy - dragState.startY);
        const b = dragState.initialBox;

        if (dragState.type === 'move') {
            onUpdateBox(dragState.clsnType, dragState.boxId, 'x1', b.x1 + dx);
            onUpdateBox(dragState.clsnType, dragState.boxId, 'y1', b.y1 + dy);
            onUpdateBox(dragState.clsnType, dragState.boxId, 'x2', b.x2 + dx);
            onUpdateBox(dragState.clsnType, dragState.boxId, 'y2', b.y2 + dy);
        } else if (dragState.type === 'nw') {
            onUpdateBox(dragState.clsnType, dragState.boxId, 'x1', b.x1 + dx);
            onUpdateBox(dragState.clsnType, dragState.boxId, 'y1', b.y1 + dy);
        } else if (dragState.type === 'ne') {
            onUpdateBox(dragState.clsnType, dragState.boxId, 'x2', b.x2 + dx);
            onUpdateBox(dragState.clsnType, dragState.boxId, 'y1', b.y1 + dy);
        } else if (dragState.type === 'sw') {
            onUpdateBox(dragState.clsnType, dragState.boxId, 'x1', b.x1 + dx);
            onUpdateBox(dragState.clsnType, dragState.boxId, 'y2', b.y2 + dy);
        } else if (dragState.type === 'se') {
            onUpdateBox(dragState.clsnType, dragState.boxId, 'x2', b.x2 + dx);
            onUpdateBox(dragState.clsnType, dragState.boxId, 'y2', b.y2 + dy);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (activeTool === 'clsn_edit') {
            e.stopPropagation();
            startDrag(e.clientX, e.clientY);
        }
    };
    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState) {
            e.stopPropagation();
            doDrag(e.clientX, e.clientY);
        }
    };
    const handleTouchStart = (e: React.TouchEvent) => {
        if (activeTool === 'clsn_edit') {
            e.stopPropagation();
            e.preventDefault();
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
    };
    const handleTouchMove = (e: React.TouchEvent) => {
        if (dragState) {
            e.stopPropagation();
            e.preventDefault();
            doDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
    };

    return (
        <div className="w-full h-full relative overflow-hidden touch-none" 
             onMouseDown={handleMouseDown}
             onMouseMove={handleMouseMove}
             onMouseUp={() => setDragState(null)}
             onMouseLeave={() => setDragState(null)}
             onTouchStart={handleTouchStart}
             onTouchMove={handleTouchMove}
             onTouchEnd={() => setDragState(null)}>
            <canvas ref={canvasRef} className="w-full h-full pointer-events-none" />
        </div>
    );
}

function PaletteRenderer({ act, selectedColorIdx, onColorClick }: { act: Uint8Array | null | undefined, selectedColorIdx?: number | null, onColorClick?: (index: number) => void }) {
    if (!act) return <div className="text-[#555] text-xs italic text-center mt-10">No Palette Data</div>;

    const colors = [];
    for (let i = 0; i < 256; i++) {
        colors.push({ color: `rgb(${act[i*4]}, ${act[i*4+1]}, ${act[i*4+2]})`, index: i });
    }

    return (
        <div className="grid grid-cols-16 border border-[#111111] bg-black mx-auto w-fit" style={{ gridTemplateColumns: 'repeat(16, 12px)', gap: '1px' }}>
            {colors.map((c, i) => (
                <div 
                    key={i} 
                    className={`w-[12px] h-[12px] cursor-pointer hover:scale-125 transition-transform relative ${selectedColorIdx === c.index ? 'outline outline-2 outline-blue-500 z-10 scale-110' : ''}`} 
                    style={{ 
                        backgroundColor: c.color,
                        ...(i === 0 ? { backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)', backgroundSize: '4px 4px', backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px' } : {})
                    }} 
                    title={i === 0 ? `Index 0 (Transparent/Erase)` : `Index: ${c.index} (${c.color})`}
                    onClick={() => onColorClick?.(c.index)}
                />
            ))}
        </div>
    );
}
