import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { 
  File as FileIcon, FolderOpen, Save, Undo, Redo, Scissors, Copy, Clipboard,
  Search, ArrowLeftRight, ZoomIn, ZoomOut, Plus, Minus, Play, Pause, AlertCircle, HelpCircle, FileText as FileTextIcon, Image as ImageIcon, PlayCircle, Settings, Trash2, Pen, Move, Hand, PaintBucket, Wand2, Crosshair,
  Volume2, Music, Download, PlusCircle, Square, Eraser, Palette, Zap, Box, Upload,
  Pipette, Crop, FlipHorizontal, FlipVertical, Layers, Film, Gamepad2, AlertTriangle, CheckCircle2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight
} from 'lucide-react';
import JSZip from 'jszip';
import { parseIniString, stringifyIni, getIniField, getSectionKeyValue, stripIniSuffix, updateIniTextField } from '../lib/mugen/defParser';
import { parseSffBinary, extractPortraits } from '../lib/mugen/sffParser';
import { generateTemplateSff, buildSffBinary } from '../lib/mugen/sffGenerator';
import { templateAir, templateCmd, templateCns, templateDef } from '../lib/mugen/templateFiles';
import { parseActBinary, applyPalette, imageToSpriteIndices, reversePalette, detectAndFixUpsideDownPalette } from '../lib/mugen/actParser';
import { parseAirString, serializeAirData } from '../lib/mugen/airParser';
import type { SffData, AirData } from '../lib/mugen/types';
import { parseSndBinary, buildSndBinary } from '../lib/mugen/sndParser';
import type { SndSound, SndData } from '../lib/mugen/sndParser';
import { LanguagePicker } from './LanguagePicker';
import { saveProject, SavedProject } from '../lib/projectStorage';
import { MugenCodeEditor, MugenCodeEditorHandle } from './MugenCodeEditor';
import { SoundWaveform } from './SoundWaveform';
import { MoveTesterModal } from './MoveTesterModal';
import { exportActionGif, exportActionSpriteSheet } from '../lib/mugen/gifEncoder';
import { validateMugenProject, MugenIssue } from '../lib/mugen/validator';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}


interface MugenStudioProps {
  initialAction?: 'new' | 'open_zip' | 'import_folder' | 'saved_project';
  initialFiles?: FileList;
  initialProject?: any;
  onBackToHome?: () => void;
  onShowDocs?: () => void;
  key?: any;
}

export default function MugenStudio({ 
  initialAction, 
  initialFiles,
  initialProject,
  onBackToHome,
  onShowDocs
}: MugenStudioProps) {
  const { t, i18n } = useTranslation();
  const [activeMode, setActiveMode] = useState<'Definitions' | 'Sprites' | 'Animations' | 'Commands' | 'States' | 'Sounds'>('Definitions');
  
  const [projectId, setProjectId] = useState<string>(() => initialProject?.id || 'proj_' + Date.now());
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<Date | null>(null);
  const [saveNotification, setSaveNotification] = useState<string | null>(null);

  // Data State
  const [iniData, setIniData] = useState<Record<string, Record<string, string>> | null>(null);
  
  interface ManagedTextFile {
    id: string;
    filename: string;
    content: string;
    parsed?: Record<string, Record<string, string>> | null;
  }

  const [cmdFiles, setCmdFiles] = useState<ManagedTextFile[]>([{ id: 'default', filename: 'player.cmd', content: templateCmd, parsed: parseIniString(templateCmd) }]);
  const [activeCmdFileId, setActiveCmdFileId] = useState('default');

  const [stFiles, setStFiles] = useState<ManagedTextFile[]>([{ id: 'default', filename: 'player.cns', content: templateCns, parsed: parseIniString(templateCns) }]);
  const [activeStFileId, setActiveStFileId] = useState('default');

  const [sffData, setSffData] = useState<SffData | null>(null);
  const [actPalette, setActPalette] = useState<Uint8Array | null>(null);
  const [airData, setAirData] = useState<AirData | null>(null);
  const [sndData, setSndData] = useState<SndData | null>(null);
  const [selectedSoundId, setSelectedSoundId] = useState<string | null>(null);
  const [soundSearch, setSoundSearch] = useState('');
  const [soundFilterGroup, setSoundFilterGroup] = useState<string>('all');
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const sffDataRef = useRef<SffData | null>(null);
  const airDataRef = useRef<AirData | null>(null);
  const spriteLayersMapRef = useRef<Record<number, DrawingLayer[]>>({});
  const hasChangedThisStroke = useRef(false);

  interface DrawingLayer {
    id: string;
    name: string;
    visible: boolean;
    pixelIndices: Uint8Array;
  }

  const [spriteLayersMap, setSpriteLayersMap] = useState<Record<number, DrawingLayer[]>>({});
  const [activeLayerIdMap, setActiveLayerIdMap] = useState<Record<number, string>>({});
  
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStartPos, setSelectionStartPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  
  const [objectClipboard, setObjectClipboard] = useState<{
    width: number;
    height: number;
    pixelIndices: Uint8Array;
  } | null>(null);
  
  const [pastedContent, setPastedContent] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    pixelIndices: Uint8Array;
    active: boolean;
  } | null>(null);

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    const results: Array<{ type: string; title: string; subtitle: string; action: () => void }> = [];

    // 1. Sprites
    if (sffData && sffData.images) {
      sffData.images.forEach((img, idx) => {
        const match = String(img.group).includes(q) || String(img.image).includes(q) || String(idx).includes(q) || `sprite ${idx}`.includes(q);
        if (match) {
          results.push({
            type: 'Sprite',
            title: `Sprite [Group ${img.group}, Image ${img.image}]`,
            subtitle: `Index #${idx} (${img.width}x${img.height})`,
            action: () => {
              setActiveMode('Sprites');
              setSelectedSpriteIdx(idx);
              setIsSearchModalOpen(false);
            }
          });
        }
      });
    }

    // 2. Animations (AIR)
    if (airData && airData.actions) {
      Object.entries(airData.actions).forEach(([actionId, act]: [string, any]) => {
        const actName = typeof act.name === 'string' ? act.name.trim() : '';
        if (
          actionId.toLowerCase().includes(q) ||
          `anim ${actionId}`.includes(q) ||
          `action ${actionId}`.includes(q) ||
          (actName && actName.toLowerCase().includes(q))
        ) {
          results.push({
            type: 'Animation',
            title: `Action ${actionId}${actName ? ` - ${actName}` : ''}`,
            subtitle: `${act.elements?.length || 0} frames`,
            action: () => {
              setActiveMode('Animations');
              setSelectedActionId(Number(actionId));
              setCurrentFrame(0);
              setIsSearchModalOpen(false);
            }
          });
        }
      });
    }

    // 3. States (CNS Files)
    stFiles.forEach(file => {
      if (file.filename.toLowerCase().includes(q)) {
        results.push({
          type: 'State File',
          title: `State File: ${file.filename}`,
          subtitle: `CNS Document`,
          action: () => {
            setActiveMode('States');
            setActiveStFileId(file.id);
            setIsSearchModalOpen(false);
          }
        });
      }
      if (file.parsed) {
        Object.entries(file.parsed).forEach(([sec, keys]) => {
          const cleanSec = stripIniSuffix(sec);
          if (cleanSec.toLowerCase().includes(q)) {
            results.push({
              type: 'State / Section',
              title: `[${cleanSec}] in ${file.filename}`,
              subtitle: `State Definition`,
              action: () => {
                const occMatch = sec.match(/\s*##(\d+)$/);
                pendingCodeJumpRef.current = {
                  mode: 'States',
                  fileId: file.id,
                  header: cleanSec,
                  occurrence: occMatch ? parseInt(occMatch[1], 10) : 1
                };
                setActiveMode('States');
                setActiveStFileId(file.id);
                setIsSearchModalOpen(false);
              }
            });
          }
          Object.entries(keys as Record<string, string>).forEach(([k, v]) => {
            const cleanKey = stripIniSuffix(k);
            if (cleanKey.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) {
              results.push({
                type: 'CNS Key',
                title: `${cleanKey} = ${v} ([${cleanSec}])`,
                subtitle: `Found in ${file.filename}`,
                action: () => {
                  const matchedLine = findLineInText(file.content, cleanKey, String(v), cleanSec);
                  pendingCodeJumpRef.current = {
                    mode: 'States',
                    fileId: file.id,
                    line: matchedLine || 1
                  };
                  setActiveMode('States');
                  setActiveStFileId(file.id);
                  setIsSearchModalOpen(false);
                }
              });
            }
          });
        });
      }
    });

    // 4. Commands (.cmd files)
    cmdFiles.forEach(file => {
      if (file.filename.toLowerCase().includes(q)) {
        results.push({
          type: 'Command File',
          title: `Command File: ${file.filename}`,
          subtitle: `CMD Document`,
          action: () => {
            setActiveMode('Commands');
            setActiveCmdFileId(file.id);
            setIsSearchModalOpen(false);
          }
        });
      }
      if (file.parsed) {
        Object.entries(file.parsed).forEach(([sec, keys]) => {
          const cleanSec = stripIniSuffix(sec);
          const cmdLabel = cleanSec.toLowerCase() === 'command' ? getSectionKeyValue(keys as Record<string, string>, 'name') : '';
          Object.entries(keys as Record<string, string>).forEach(([k, v]) => {
            const cleanKey = stripIniSuffix(k);
            if (cleanKey.toLowerCase().includes(q) || String(v).toLowerCase().includes(q) || cleanSec.toLowerCase().includes(q)) {
              results.push({
                type: 'Command Item',
                title: cmdLabel ? `[Command] ${cmdLabel}: ${cleanKey} = ${v}` : `${cleanKey} = ${v}`,
                subtitle: `Section [${cleanSec}] in ${file.filename}`,
                action: () => {
                  const matchedLine = findLineInText(file.content, cleanKey, String(v), cleanSec);
                  pendingCodeJumpRef.current = {
                    mode: 'Commands',
                    fileId: file.id,
                    line: matchedLine || 1
                  };
                  setActiveMode('Commands');
                  setActiveCmdFileId(file.id);
                  setIsSearchModalOpen(false);
                }
              });
            }
          });
        });
      }
    });

    // 5. Definitions (iniData)
    if (iniData) {
      Object.entries(iniData).forEach(([sec, keys]) => {
        const cleanSec = stripIniSuffix(sec);
        Object.entries(keys).forEach(([k, v]) => {
          const cleanKey = stripIniSuffix(k);
          if (cleanSec.toLowerCase().includes(q) || cleanKey.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) {
            results.push({
              type: 'Definition',
              title: `${cleanKey} = ${v}`,
              subtitle: `Section [${cleanSec}] (DEF)`,
              action: () => {
                const matchedLine = findLineInText(iniRawText || '', cleanKey, String(v), cleanSec);
                pendingCodeJumpRef.current = {
                  mode: 'Definitions',
                  line: matchedLine || 1
                };
                setActiveMode('Definitions');
                setIsSearchModalOpen(false);
              }
            });
          }
        });
      });
    }

    // 6. Sounds
    if (sndData && sndData.sounds) {
      sndData.sounds.forEach(snd => {
        if (String(snd.group).includes(q) || String(snd.sample).includes(q) || snd.name.toLowerCase().includes(q)) {
          results.push({
            type: 'Sound',
            title: `Sound [Group ${snd.group}, Sample ${snd.sample}] - ${snd.name}`,
            subtitle: `Audio Asset`,
            action: () => {
              setActiveMode('Sounds');
              setSelectedSoundId(snd.id);
              setIsSearchModalOpen(false);
            }
          });
        }
      });
    }

    return results.slice(0, 50);
  }, [searchQuery, sffData, airData, stFiles, cmdFiles, iniData, sndData]);

  useEffect(() => { sffDataRef.current = sffData; }, [sffData]);
  useEffect(() => { airDataRef.current = airData; }, [airData]);
  useEffect(() => { spriteLayersMapRef.current = spriteLayersMap; }, [spriteLayersMap]);

  const updateLayersForSprite = (spriteIdx: number, newLayers: DrawingLayer[], currentSff?: SffData | null) => {
    setSpriteLayersMap(prev => {
      const next = {
        ...prev,
        [spriteIdx]: newLayers
      };
      spriteLayersMapRef.current = next;
      return next;
    });
    
    const activeSff = currentSff !== undefined ? currentSff : sffDataRef.current;
    if (!activeSff) return;
    const sprite = activeSff.images[spriteIdx];
    if (!sprite) return;
    
    const expectedSize = sprite.width * sprite.height;
    const compositeIndices = new Uint8Array(expectedSize);
    
    for (let i = 0; i < expectedSize; i++) {
      let compositeVal = 0;
      for (let l = 0; l < newLayers.length; l++) {
        const layer = newLayers[l];
        if (layer.visible) {
          const val = layer.pixelIndices[i];
          if (val !== 0) {
            compositeVal = val;
          }
        }
      }
      compositeIndices[i] = compositeVal;
    }
    
    setSffData(prevSff => {
      if (!prevSff) return prevSff;
      const nextSff = { ...prevSff, images: [...prevSff.images] };
      const nextSprite = { ...nextSff.images[spriteIdx], pixelIndices: compositeIndices };
      nextSff.images[spriteIdx] = nextSprite;
      sffDataRef.current = nextSff;
      return nextSff;
    });
  };

  const getSpriteLayers = (spriteIdx: number, sprite: any): DrawingLayer[] => {
    if (!sprite) return [];
    if (spriteLayersMapRef.current[spriteIdx]) {
      const layers = spriteLayersMapRef.current[spriteIdx];
      const expectedSize = sprite.width * sprite.height;
      return layers.map(layer => {
        if (layer.pixelIndices.length !== expectedSize) {
          const nextIndices = new Uint8Array(expectedSize);
          const minLen = Math.min(layer.pixelIndices.length, expectedSize);
          nextIndices.set(layer.pixelIndices.subarray(0, minLen));
          return { ...layer, pixelIndices: nextIndices };
        }
        return layer;
      });
    }
    const initialLayer: DrawingLayer = {
      id: 'base-' + spriteIdx,
      name: 'Base Layer',
      visible: true,
      pixelIndices: new Uint8Array(sprite.pixelIndices)
    };
    return [initialLayer];
  };

  const getActiveLayerId = (spriteIdx: number, layers: DrawingLayer[]): string => {
    const customActiveId = activeLayerIdMap[spriteIdx];
    if (customActiveId && layers.some(l => l.id === customActiveId)) {
      return customActiveId;
    }
    return layers.length > 0 ? layers[layers.length - 1].id : '';
  };

  const handleCopySelection = () => {
    if (selectedSpriteIdx === null || !sffData || !selectionRect) return;
    const sprite = sffData.images[selectedSpriteIdx];
    if (!sprite) return;
    
    const lMap = getSpriteLayers(selectedSpriteIdx, sprite);
    const actId = getActiveLayerId(selectedSpriteIdx, lMap);
    const activeLayer = lMap.find(l => l.id === actId) || lMap[0];
    
    const { x, y, w, h } = selectionRect;
    const copiedPixels = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const srcI = (y + r) * sprite.width + (x + c);
        copiedPixels[r * w + c] = activeLayer.pixelIndices[srcI];
      }
    }
    
    setObjectClipboard({
      width: w,
      height: h,
      pixelIndices: copiedPixels
    });
  };

  const handlePasteSelection = () => {
    if (!objectClipboard) return;
    const startX = selectionRect ? selectionRect.x : 0;
    const startY = selectionRect ? selectionRect.y : 0;
    setPastedContent({
      x: startX,
      y: startY,
      width: objectClipboard.width,
      height: objectClipboard.height,
      pixelIndices: new Uint8Array(objectClipboard.pixelIndices),
      active: true
    });
  };

  const handleStampPasted = () => {
    if (!pastedContent || !pastedContent.active || selectedSpriteIdx === null || !sffData) return;
    const sprite = sffData.images[selectedSpriteIdx];
    if (!sprite) return;
    
    const lMap = getSpriteLayers(selectedSpriteIdx, sprite);
    const actId = getActiveLayerId(selectedSpriteIdx, lMap);
    const activeLayerIdx = lMap.findIndex(l => l.id === actId);
    if (activeLayerIdx === -1) return;
    
    const targetLayer = lMap[activeLayerIdx];
    const nextIndices = new Uint8Array(targetLayer.pixelIndices);
    
    const { x: targetX, y: targetY, width: pW, height: pH, pixelIndices: pPixels } = pastedContent;
    let changed = false;
    
    for (let r = 0; r < pH; r++) {
      for (let c = 0; c < pW; c++) {
        const px = targetX + c;
        const py = targetY + r;
        if (px >= 0 && px < sprite.width && py >= 0 && py < sprite.height) {
          const i = py * sprite.width + px;
          const val = pPixels[r * pW + c];
          if (val !== 0) {
            nextIndices[i] = val;
            changed = true;
          }
        }
      }
    }
    
    if (changed) {
      const nextLayerObj = { ...targetLayer, pixelIndices: nextIndices };
      const nextLayers = [...lMap];
      nextLayers[activeLayerIdx] = nextLayerObj;
      updateLayersForSprite(selectedSpriteIdx, nextLayers);
      pushToHistory(null, null, { ...spriteLayersMap, [selectedSpriteIdx]: nextLayers });
    }
    
    setPastedContent(null);
  };

  const handleCancelPasted = () => {
    setPastedContent(null);
  };

  const pushToHistory = (sff?: SffData | null, air?: AirData | null, layersMap?: Record<number, DrawingLayer[]> | null) => {
    const newState = {
      sff: sff !== undefined ? sff : sffDataRef.current,
      air: air !== undefined ? air : airDataRef.current,
      layersMap: layersMap !== undefined ? layersMap : spriteLayersMapRef.current,
    };
    
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(newState);
      if (newHistory.length > 50) newHistory.shift();
      return newHistory;
    });
    setHistoryIndex(prev => {
      const nextIndex = prev + 1;
      return nextIndex >= 50 ? 49 : nextIndex;
    });
  };

  const handleCopyCLSN = () => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;
    const element = action.elements[currentFrame];
    if (!element) return;

    const srcClsn1 = clsnScope === 'frame' ? (element.clsn1 || []) : (action.clsn1 || []);
    const srcClsn2 = clsnScope === 'frame' ? (element.clsn2 || []) : (action.clsn2 || []);

    setClsnClipboard({
      clsn1: JSON.parse(JSON.stringify(srcClsn1)),
      clsn2: JSON.parse(JSON.stringify(srcClsn2))
    });
  };

  const handlePasteCLSN = () => {
    if (!airData || selectedActionId === null || !clsnClipboard) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;

    const nextAir = { ...airData };
    const nextAction = { ...action };

    if (clsnScope === 'frame' && nextAction.elements[currentFrame]) {
      const nextElements = [...nextAction.elements];
      nextElements[currentFrame] = {
        ...nextElements[currentFrame],
        clsn1: JSON.parse(JSON.stringify(clsnClipboard.clsn1)),
        clsn2: JSON.parse(JSON.stringify(clsnClipboard.clsn2)),
      };
      nextAction.elements = nextElements;
    } else {
      nextAction.clsn1 = JSON.parse(JSON.stringify(clsnClipboard.clsn1));
      nextAction.clsn2 = JSON.parse(JSON.stringify(clsnClipboard.clsn2));
    }

    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    setAirData(nextAir);
    syncAirRawText(nextAir);
    pushToHistory(undefined, nextAir);
  };

  const handleCopySprite = () => {
    if (!sffData || selectedSpriteIdx === null) return;
    setSpriteClipboard(JSON.parse(JSON.stringify(sffData.images[selectedSpriteIdx])));
  };

  const handlePasteSprite = () => {
    if (!sffData || !spriteClipboard) return;
    const nextImages = [...sffData.images];
    const pasted = { 
        ...spriteClipboard, 
        image: sffData.images.length > 0 ? Math.max(...sffData.images.map(img => img.image)) + 1 : 0 
    };
    nextImages.push(pasted);
    const nextSff = { ...sffData, images: nextImages, numImages: nextImages.length };
    setSffData(nextSff);
    setSelectedSpriteIdx(nextImages.length - 1);
    pushToHistory(nextSff);
  };

  const handleDuplicateSprite = () => {
    if (!sffData || selectedSpriteIdx === null) return;
    const sprite = sffData.images[selectedSpriteIdx];
    const nextImages = [...sffData.images];
    const duplicated = { 
      ...JSON.parse(JSON.stringify(sprite)), 
      image: Math.max(...sffData.images.map(img => img.image)) + 1 
    };
    nextImages.push(duplicated);
    const nextSff = { ...sffData, images: nextImages, numImages: nextImages.length };
    setSffData(nextSff);
    setSelectedSpriteIdx(nextImages.length - 1);
    pushToHistory(nextSff);
  };
  const [iniRawText, setIniRawText] = useState<string | null>(null);
  const [airRawText, setAirRawText] = useState<string | null>(null);

  const undo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setSffData(prev.sff);
      sffDataRef.current = prev.sff;
      setAirData(prev.air);
      airDataRef.current = prev.air;
      if (prev.air) syncAirRawText(prev.air);
      if (prev.layersMap) {
        setSpriteLayersMap(prev.layersMap);
        spriteLayersMapRef.current = prev.layersMap;
      }
      setHistoryIndex(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setSffData(next.sff);
      sffDataRef.current = next.sff;
      setAirData(next.air);
      airDataRef.current = next.air;
      if (next.air) syncAirRawText(next.air);
      if (next.layersMap) {
        setSpriteLayersMap(next.layersMap);
        spriteLayersMapRef.current = next.layersMap;
      }
      setHistoryIndex(historyIndex + 1);
    }
  };
  
  // Clipboard states
  const [spriteClipboard, setSpriteClipboard] = useState<any>(null);
  const [clsnClipboard, setClsnClipboard] = useState<{clsn1: any[], clsn2: any[]} | null>(null);

  // Focus and Selection
  const [spriteSearch, setSpriteSearch] = useState('');
  const [selectedSpriteIdx, setSelectedSpriteIdx] = useState<number>(0);
  const [selectedActionId, setSelectedActionId] = useState<number | null>(null);
  const [selectedPaletteIdx, setSelectedPaletteIdx] = useState<number>(0);
  const [selectedClsn, setSelectedClsn] = useState<{type: 1 | 2, id: number} | null>(null);
  const paletteActInputRef = useRef<HTMLInputElement>(null);
  const renderAreaRef = useRef<HTMLDivElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [zoom, setZoom] = useState(2);
  const [showClsn, setShowClsn] = useState(true);
  const [showAxis, setShowAxis] = useState(true);
  const [showOnionSkin, setShowOnionSkin] = useState(true);
  const [clsnScope, setClsnScope] = useState<'action' | 'frame'>('action');

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Selected palette editing states
  const [selectedPalColorIdx, setSelectedPalColorIdx] = useState<number | null>(null);
  const [spriteSidebarTab, setSpriteSidebarTab] = useState<'gallery' | 'palettes' | 'layers'>('gallery');
  const [showPaletteOverlay, setShowPaletteOverlay] = useState(true);
  const [newActionIdText, setNewActionIdText] = useState('100');
  const [newActionNameText, setNewActionNameText] = useState('');
  const [pickerSearch, setPickerSearch] = useState('');

  // Palette Range HSL states
  const [palRangeFrom, setPalRangeFrom] = useState<number>(1);
  const [palRangeTo, setPalRangeTo] = useState<number>(255);
  const [palHue, setPalHue] = useState<number>(0);
  const [palSat, setPalSat] = useState<number>(0);
  const [palLight, setPalLight] = useState<number>(0);

  // Bottom Panel & Move Tester states
  const [activeBottomTab, setActiveBottomTab] = useState<'issues' | 'search' | 'output'>('issues');
  const [engineLogs, setEngineLogs] = useState<string[]>([]);
  const [showMoveTester, setShowMoveTester] = useState(false);

  const appendEngineLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setEngineLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 60));
  };

  // Pivot drags & Canvas interactions
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOrig, setDragOrig] = useState({ x: 0, y: 0 });
  const [previewOffset, setPreviewOffset] = useState<{x: number, y: number} | null>(null);
  
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOrig, setPanOrig] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [activeTool, setActiveTool] = useState<'move' | 'pan' | 'paint' | 'eraser' | 'eyedropper' | 'bucket' | 'wand' | 'clsn_edit' | 'select'>('move');
  const [brushSize, setBrushSize] = useState<number>(1);
  const [isPaintDragging, setIsPaintDragging] = useState(false);
  const [lastPaintPos, setLastPaintPos] = useState<{x: number, y: number} | null>(null);
  
  const [isDraggingPasted, setIsDraggingPasted] = useState(false);
  const [pastedDragStart, setPastedDragStart] = useState<{ x: number, y: number, origX: number, origY: number } | null>(null);

  const [mobileTab, setMobileTab] = useState<'left' | 'center' | 'right'>('center');
  const workspaceRef = useRef<HTMLDivElement>(null);
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartCentroidRef = useRef<{ x: number, y: number } | null>(null);
  const touchStartPanRef = useRef<{ x: number, y: number } | null>(null);
  const touchStartZoomRef = useRef<number>(zoom);

  // Sprite import states
  const [pendingImportFiles, setPendingImportFiles] = useState<{file: File, buffer: ArrayBuffer}[]>([]);
  const [showPaletteChoiceModal, setShowPaletteChoiceModal] = useState(false);
  const [importGroup, setImportGroup] = useState<number>(0);
  const [importIndex, setImportIndex] = useState<number>(0);

  // ZIP Export states
  const [showExportZipModal, setShowExportZipModal] = useState(false);
  const [exportZipIncludeAct, setExportZipIncludeAct] = useState(true);
  const [exportZipIncludeSnd, setExportZipIncludeSnd] = useState(true);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [selectedSpriteIndices, setSelectedSpriteIndices] = useState<Set<number>>(new Set());
  const [isReplacing, setIsReplacing] = useState(false);

  // Input refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spritePngInputRef = useRef<HTMLInputElement>(null);
  const batchPngInputRef = useRef<HTMLInputElement>(null);
  const replaceSpriteInputRef = useRef<HTMLInputElement>(null);
  const addSoundInputRef = useRef<HTMLInputElement>(null);
  const codeEditorRef = useRef<MugenCodeEditorHandle>(null);
  const pendingCodeJumpRef = useRef<{ mode: 'Definitions' | 'Commands' | 'States'; fileId?: string; line?: number; header?: string; occurrence?: number } | null>(null);

  const findLineInText = (text: string, key: string, val: string, secName: string): number | null => {
    const lines = text.split('\n');
    const secLow = secName.toLowerCase();
    const keyLow = key.toLowerCase();
    const valLow = val.toLowerCase();
    let currentSec = '';
    for (let i = 0; i < lines.length; i++) {
      const semi = lines[i].indexOf(';');
      const code = (semi !== -1 ? lines[i].slice(0, semi) : lines[i]).trim();
      const secM = code.match(/^\[(.*)\]$/);
      if (secM) {
        currentSec = secM[1].trim().toLowerCase();
        continue;
      }
      if (currentSec === secLow && code.toLowerCase().startsWith(keyLow) && code.toLowerCase().includes(valLow)) {
        return i + 1;
      }
    }
    return null;
  };

  const issues = useMemo<MugenIssue[]>(() => {
    return validateMugenProject({ iniData, sffData, airData, stFiles, cmdFiles });
  }, [iniData, sffData, airData, stFiles, cmdFiles]);

  useEffect(() => {
    const pending = pendingCodeJumpRef.current;
    if (!pending) return;
    if (pending.mode !== activeMode) return;
    if (pending.mode === 'States' && pending.fileId && pending.fileId !== activeStFileId) return;
    if (pending.mode === 'Commands' && pending.fileId && pending.fileId !== activeCmdFileId) return;

    const raf = requestAnimationFrame(() => {
      if (pending.line) {
        codeEditorRef.current?.jumpToLine(pending.line);
      } else if (pending.header) {
        codeEditorRef.current?.jumpToHeader(pending.header, pending.occurrence || 1);
      }
      pendingCodeJumpRef.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeMode, activeStFileId, activeCmdFileId, stFiles, cmdFiles, iniRawText]);

  useEffect(() => {
    if (initialProject) {
      try {
        const deserialized = deserializeProjectState(initialProject);
        if (deserialized.iniData) setIniData(deserialized.iniData);
        if (deserialized.iniRawText) setIniRawText(deserialized.iniRawText);
        if (deserialized.stFiles && deserialized.stFiles.length > 0) {
          setStFiles(deserialized.stFiles);
          setActiveStFileId(deserialized.stFiles[0].id);
        }
        if (deserialized.cmdFiles && deserialized.cmdFiles.length > 0) {
          setCmdFiles(deserialized.cmdFiles);
          setActiveCmdFileId(deserialized.cmdFiles[0].id);
        }
        if (deserialized.airRawText) setAirRawText(deserialized.airRawText);
        let loadedAir: AirData | null = null;
        try {
          if (deserialized.airRawText) {
            loadedAir = parseAirString(deserialized.airRawText);
            airDataRef.current = loadedAir;
            setAirData(loadedAir);
          }
        } catch(e) {}
        if (deserialized.sffData) {
          sffDataRef.current = deserialized.sffData;
          setSffData(deserialized.sffData);
          setSelectedSpriteIdx(0);
        }
        if (deserialized.sndData) setSndData(deserialized.sndData);
        if (deserialized.actPalette) setActPalette(deserialized.actPalette);
        setProjectId(deserialized.id);
        setHistory([{ sff: deserialized.sffData, air: loadedAir }]);
        setHistoryIndex(0);
        return;
      } catch (e) {
        console.error("Failed to load saved project:", e);
      }
    }

    // If we have initial files, process them immediately
    if (initialFiles && initialFiles.length > 0) {
      handleFileUpload({ target: { files: initialFiles } } as any);
      return;
    }

    // If we're opening a zip or folder, but no files yet, don't auto-populate with templates yet
    // unless it's explicitly a "new" action.
    if (initialAction === 'open_zip' || initialAction === 'import_folder') {
      // In a real app we might trigger the picker here, but for now we wait for user click
      // or we can trigger it:
      if (initialAction === 'open_zip') {
        // We'll let the user click the "Open" button in the toolbar for now 
        // to maintain standard flow, or we could trigger fileInputRef.current?.click()
      }
      return; // DON'T load templates
    }

    // Populate with template files
    setIniRawText(templateDef);
    setIniData(parseIniString(templateDef));
    setStFiles([{ id: 'default', filename: 'player.cns', content: templateCns, parsed: parseIniString(templateCns) }]);
    setActiveStFileId('default');
    setCmdFiles([{ id: 'default', filename: 'player.cmd', content: templateCmd, parsed: parseIniString(templateCmd) }]);
    setActiveCmdFileId('default');
    setAirRawText(templateAir);
    
    try {
      const initialAir = parseAirString(templateAir);
      setAirData(initialAir);
    } catch(e) {}

    // Start with empty sound bank (no template sounds)
    setSndData(null);
    setSelectedSoundId(null);

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
        
        // Seed initial history
        setHistory([{ sff: parsedSff, air: airData }]);
        setHistoryIndex(0);
      } catch (e) {
        console.error("Failed to parse start template SFF:", e);
      }
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if in a text field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (e.key === 's') {
          e.preventDefault();
          saveProjectToLocalStorage(false);
        } else if (e.key === 'y') {
          e.preventDefault();
          redo();
        } else if (e.key === 'c') {
          e.preventDefault();
          if (activeMode === 'Sprites') {
            if (activeTool === 'select' && selectionRect) {
              handleCopySelection();
            } else {
              handleCopySprite();
            }
          }
          else if (activeMode === 'Animations') {
            handleCopyCLSN();
          }
        } else if (e.key === 'v') {
          e.preventDefault();
          if (activeMode === 'Sprites') {
            if (objectClipboard) {
              handlePasteSelection();
            } else {
              handlePasteSprite();
            }
          }
          else if (activeMode === 'Animations') {
            handlePasteCLSN();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === '+') {
          e.preventDefault();
          setZoom(z => Math.min(10, z + 0.5));
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === '-') {
          e.preventDefault();
          setZoom(z => Math.max(0.25, z - 0.5));
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          setIsSearchModalOpen(prev => !prev);
        }
      } else {
        const isInputField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (!isInputField) {
          if (e.key.toLowerCase() === 'e' && activeMode === 'Sprites') {
            setActiveTool('eraser');
          } else if (e.key.toLowerCase() === 'i' && activeMode === 'Sprites') {
            setActiveTool('eyedropper');
          } else if ((e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'p') && activeMode === 'Sprites') {
            setActiveTool('paint');
          } else if (e.key.toLowerCase() === 'g' && activeMode === 'Sprites') {
            setActiveTool('bucket');
          } else if (e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'm') {
            setActiveTool('move');
          } else if (e.key.toLowerCase() === 'h') {
            setActiveTool('pan');
          }
        }
        if (e.key.toLowerCase() === 'a' && !isInputField) {
          setShowAxis(prev => !prev);
        } else if (e.key.toLowerCase() === 'c' && !isInputField) {
          setShowClsn(prev => !prev);
        } else if (e.key === 'Escape') {
          if (isSearchModalOpen) {
            setIsSearchModalOpen(false);
          } else {
            setSelectionRect(null);
            setPastedContent(null);
          }
        } else if (e.key === 'Enter') {
          if (pastedContent && pastedContent.active) {
            e.preventDefault();
            handleStampPasted();
          }
        } else if (pastedContent && pastedContent.active) {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setPastedContent(p => p ? { ...p, y: p.y - 1 } : null);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setPastedContent(p => p ? { ...p, y: p.y + 1 } : null);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setPastedContent(p => p ? { ...p, x: p.x - 1 } : null);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setPastedContent(p => p ? { ...p, x: p.x + 1 } : null);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, activeMode, activeTool, sffData, airData, spriteClipboard, clsnClipboard, selectionRect, objectClipboard, pastedContent, selectedSpriteIdx]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Close dropdown if clicking outside the menu bar
      if (activeDropdown && !target.closest('.menu-item-container')) {
        setActiveDropdown(null);
      }
    };
    
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown]);

  // Deserialization helper for loaded projects (handles both direct TypedArrays and legacy array formats)
  const deserializeProjectState = (data: any) => {
    const deserializedSff = data.sffData ? {
      ...data.sffData,
      images: data.sffData.images.map((img: any) => ({
        ...img,
        pixelIndices: img.pixelIndices instanceof Uint8Array ? img.pixelIndices : new Uint8Array(img.pixelIndices || []),
        palette: img.palette ? (img.palette instanceof Uint8Array ? img.palette : new Uint8Array(img.palette)) : undefined
      })),
      palettes: data.sffData.palettes?.map((pal: any) => ({
        ...pal,
        data: pal.data instanceof Uint8Array ? pal.data : new Uint8Array(pal.data || [])
      }))
    } : null;

    const deserializedSnd = data.sndData ? {
      ...data.sndData,
      sounds: data.sndData.sounds.map((snd: any) => ({
        ...snd,
        data: snd.data instanceof Uint8Array ? snd.data : new Uint8Array(snd.data || [])
      }))
    } : null;

    const deserializedPalette = data.actPalette ? (
      data.actPalette instanceof Uint8Array ? data.actPalette : new Uint8Array(data.actPalette)
    ) : null;

    return {
      ...data,
      sffData: deserializedSff,
      sndData: deserializedSnd,
      actPalette: deserializedPalette
    };
  };

  const generatePortraitDataUrl = (): string | null => {
    try {
      if (!sffData || sffData.images.length === 0) return null;
      const portraitSprite =
        sffData.images.find(img => img.group === 9000 && img.image === 0) ||
        sffData.images.find(img => img.group === 9000 && img.image === 1) ||
        sffData.images[0];
      if (!portraitSprite || !portraitSprite.pixelIndices || portraitSprite.width <= 0 || portraitSprite.height <= 0) {
        return null;
      }
      const pal =
        (portraitSprite.isSharedPalette === false && portraitSprite.palette)
          ? portraitSprite.palette
          : (sffData.palettes?.[0]?.data || actPalette || portraitSprite.palette);
      if (!pal) return null;

      const src = getCachedSpriteCanvas(portraitSprite, pal);
      const out = document.createElement('canvas');
      out.width = 64;
      out.height = 64;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      const scale = Math.min(60 / portraitSprite.width, 60 / portraitSprite.height);
      const dw = Math.max(1, Math.round(portraitSprite.width * scale));
      const dh = Math.max(1, Math.round(portraitSprite.height * scale));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, Math.floor((64 - dw) / 2), Math.floor((64 - dh) / 2), dw, dh);
      return out.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  const saveProjectToLocalStorage = async (isAuto: boolean = false) => {
    try {
      const projectName = getIniField(iniData, 'Info', 'name') || 'Untitled Character';
      const portraitDataUrl = generatePortraitDataUrl();
      const projectState: SavedProject = {
        id: projectId,
        name: projectName,
        updatedAt: Date.now(),
        isAutoSave: isAuto,
        portraitDataUrl,
        iniData,
        iniRawText,
        stFiles,
        cmdFiles,
        airRawText,
        sffData,
        sndData,
        actPalette
      };

      await saveProject(projectState);
      setLastAutoSavedAt(new Date());
      
      if (!isAuto) {
        appendEngineLog(`Saved project "${projectName}" to local database.`);
        setSaveNotification("Project saved to local storage successfully!");
        setTimeout(() => setSaveNotification(null), 3000);
      }
    } catch (err) {
      console.error("Failed to save project:", err);
    }
  };

  // 30-second auto-save interval
  useEffect(() => {
    const interval = setInterval(() => {
      saveProjectToLocalStorage(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [projectId, iniData, iniRawText, stFiles, cmdFiles, airRawText, sffData, sndData, actPalette]);

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

  const handleImportPaletteFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    let baseSff = sffData;
    if (!baseSff) {
        // Create a shell SFF if none exists so we can store palettes
        baseSff = {
            version: '1.1',
            numGroups: 0,
            numImages: 0,
            images: [],
            palettes: []
        };
    }

    const nextPalettes = [...(baseSff.palettes || [])];
    
    for (const file of files) {
        try {
            const buffer = await (file as any).arrayBuffer();
            const rawPaletteData = parseActBinary(buffer);
            const { palette: paletteData, wasFlipped } = detectAndFixUpsideDownPalette(rawPaletteData, baseSff.images);
            if (wasFlipped) {
                appendEngineLog(`Auto-flipped upside-down palette "${(file as any).name}" (0↔255).`);
            }
            
            // Also set as the immediate active palette for rendering
            setActPalette(paletteData);

            let nextGroup = 1;
            let nextItem = 1;
            if (nextPalettes.length > 0) {
                const lastPal = nextPalettes[nextPalettes.length - 1];
                nextGroup = lastPal.group;
                nextItem = lastPal.item + 1;
            }

            nextPalettes.push({
                group: nextGroup,
                item: nextItem,
                data: paletteData
            });
        } catch (err: any) {
            alert(`Failed to parse palette ${(file as any).name}: ${err.message}`);
        }
    }

    const nextSff = {
        ...baseSff,
        palettes: nextPalettes
    };
    setSffData(nextSff);
    setSelectedPaletteIdx(nextPalettes.length - 1);
    pushToHistory(nextSff);
    if (paletteActInputRef.current) paletteActInputRef.current.value = '';
  };

  const handleFlipActivePalette = () => {
    const sprite = sffData?.images?.[selectedSpriteIdx];
    const hasCustomSpritePal = Boolean(sprite && sprite.isSharedPalette === false && sprite.palette);
    const activePal = hasCustomSpritePal
      ? sprite?.palette
      : (sffData?.palettes?.[selectedPaletteIdx]?.data || actPalette || sprite?.palette);
    if (!activePal) return;

    const flipped = reversePalette(activePal);

    if (sffData) {
      let nextSff = { ...sffData };
      if (hasCustomSpritePal && sprite) {
        const nextImages = sffData.images.map((img, idx) =>
          idx === selectedSpriteIdx ? { ...img, palette: flipped } : img
        );
        nextSff = { ...nextSff, images: nextImages };
      } else if (sffData.palettes && sffData.palettes[selectedPaletteIdx]) {
        const nextPalettes = [...sffData.palettes];
        nextPalettes[selectedPaletteIdx] = { ...nextPalettes[selectedPaletteIdx], data: flipped };
        nextSff = { ...nextSff, palettes: nextPalettes };
      }
      sffDataRef.current = nextSff;
      setSffData(nextSff);
      pushToHistory(nextSff);
    }

    if (!hasCustomSpritePal) {
      setActPalette(flipped);
    }
    appendEngineLog('Flipped active palette index order (0↔255).');
  };

  const handleDeletePalette = (idx: number) => {
    if (!sffData || !sffData.palettes) return;
    if (!window.confirm("Are you sure you want to delete this palette?")) return;
    
    const nextPalettes = sffData.palettes.filter((_, i) => i !== idx);
    const nextSff = {
        ...sffData,
        palettes: nextPalettes
    };
    setSffData(nextSff);
    setSelectedPaletteIdx(Math.max(0, Math.min(nextPalettes.length - 1, selectedPaletteIdx)));
    pushToHistory(nextSff);
  };

  const handleUpdatePaletteMeta = (idx: number, key: 'group' | 'item', value: number) => {
    if (!sffData || !sffData.palettes) return;
    const nextPalettes = [...sffData.palettes];
    nextPalettes[idx] = { ...nextPalettes[idx], [key]: value };
    const nextSff = {
        ...sffData,
        palettes: nextPalettes
    };
    setSffData(nextSff);
    pushToHistory(nextSff);
  };

  const handleImportSpriteFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    setIsReplacing(false);
    // Read files immediately to avoid expiration of references
    const bufferedFiles = await Promise.all(
      files.map(async (f: File) => ({
        file: f,
        buffer: await f.arrayBuffer()
      }))
    );

    let nextGroup = 0;
    let nextImg = 0;
    if (sffData && sffData.images.length > 0) {
      const lastImg = sffData.images[sffData.images.length - 1];
      nextGroup = lastImg.group;
      nextImg = lastImg.image + 1;
    }
    setImportGroup(nextGroup);
    setImportIndex(nextImg);

    setPendingImportFiles(bufferedFiles);
    setShowPaletteChoiceModal(true);
    if (spritePngInputRef.current) spritePngInputRef.current.value = '';
  };

  const handleReplaceSpriteFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    if (selectedSpriteIndices.size === 0) {
        alert("Please select at least one sprite to replace.");
        return;
    }

    setIsReplacing(true);
    const bufferedFiles = await Promise.all(
      files.map(async (f: File) => ({
        file: f,
        buffer: await f.arrayBuffer()
      }))
    );

    setPendingImportFiles(bufferedFiles);
    setShowPaletteChoiceModal(true);
    if (replaceSpriteInputRef.current) replaceSpriteInputRef.current.value = '';
  };

  const processSpriteImport = async (mode: 'image_palette' | 'adapt' | 'exchange') => {
    setShowPaletteChoiceModal(false);
    if (pendingImportFiles.length === 0) return;

    let currentSff = sffData;
    let currentGlobalPal = actPalette;
    let batchPalette: Uint8Array | null = null; // Palette shared across this import batch

    // Better detection of active palette for 'adapt'
    if (!currentGlobalPal && currentSff) {
        if (currentSff.palettes && currentSff.palettes.length > 0) {
            currentGlobalPal = currentSff.palettes[selectedPaletteIdx]?.data || currentSff.palettes[0].data;
        } else if (currentSff.images.length > 0) {
            currentGlobalPal = currentSff.images[0].palette || null;
        }
    }
    
    const replacementIndices: number[] = isReplacing ? Array.from(selectedSpriteIndices).map(Number).sort((a, b) => a - b) : [];
    let replacementHead = 0;

    let currentG = importGroup;
    let currentI = importIndex;

    const newImages = currentSff ? [...currentSff.images] : [];
    const newPalettes = currentSff ? [...(currentSff.palettes || [])] : [];

    for (const item of pendingImportFiles) {
      if (isReplacing && replacementHead >= replacementIndices.length) break;

      const blob = new Blob([item.buffer]);
      const url = URL.createObjectURL(blob);
      
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const offscreen = document.createElement('canvas');
          offscreen.width = img.width;
          offscreen.height = img.height;
          const ctx = offscreen.getContext('2d');
          if (!ctx) { resolve(); return; }
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, img.width, img.height);
          
          // Active palette
          const activePal = batchPalette || currentGlobalPal;
          
          let targetPaletteForProcessing = activePal;
          if (mode === 'exchange' || mode === 'image_palette') {
             // If we already have a palette for this batch in exchange mode, use it.
             // For image_palette (Palette from Sprite), we might want each unique, but usually shared is better for batch.
             if (mode === 'exchange' && batchPalette) {
                targetPaletteForProcessing = batchPalette;
             } else {
                targetPaletteForProcessing = null; // Forces extraction of new palette
             }
          }
          
          const { indices, palette } = imageToSpriteIndices(imgData.data, img.width, img.height, targetPaletteForProcessing);

          if (!batchPalette && (mode === 'exchange' || mode === 'image_palette') && palette) {
             batchPalette = palette;
             currentGlobalPal = palette;
             setActPalette(palette);
             
             // Also add/update the SFF palette collection
             if (mode === 'exchange' && newPalettes.length > 0) {
                 newPalettes[selectedPaletteIdx] = { ...newPalettes[selectedPaletteIdx], data: palette };
             } else {
                 // For exchange or image_palette, if it's the first time or we're adding new, push it
                 let nextGroup = 1;
                 let nextItem = 1;
                 if (newPalettes.length > 0) {
                    const last = newPalettes[newPalettes.length - 1];
                    nextGroup = last.group;
                    nextItem = last.item + 1;
                 }
                 newPalettes.push({ group: nextGroup, item: nextItem, data: palette });
                 // Update selection to the newly added palette if in exchange mode
                 if (mode === 'exchange') {
                    setSelectedPaletteIdx(newPalettes.length - 1);
                 }
             }
          }

          if (isReplacing) {
            const idxToReplace = replacementIndices[replacementHead];
            const originalSprite = newImages[idxToReplace];
            
            const newSprite: any = {
              ...originalSprite,
              width: img.width,
              height: img.height,
              pixelIndices: indices,
              isSharedPalette: mode !== 'image_palette',
              comment: item.file.name,
              palette: (mode === 'image_palette' || mode === 'exchange') ? palette : null
            };
            newImages[idxToReplace] = newSprite;
            replacementHead++;
          } else {
            const newSprite: any = {
              group: currentG,
              image: currentI,
              xOffset: Math.round(img.width / 2),
              yOffset: Math.round(img.height / 2),
              width: img.width,
              height: img.height,
              pixelIndices: indices,
              isSharedPalette: mode !== 'image_palette',
              comment: item.file.name,
              palette: (mode === 'image_palette' || mode === 'exchange') ? palette : null
            };
            newImages.push(newSprite);
            currentI++;
          }
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => {
           URL.revokeObjectURL(url);
           resolve();
        };
        img.src = url;
      });
    }

    if (currentSff) {
      const nextSff = {
        ...currentSff,
        numImages: newImages.length,
        images: newImages,
        palettes: newPalettes
      };
      setSffData(nextSff);
      if (isReplacing) {
        setSelectedSpriteIdx(replacementIndices[0]);
      } else {
        setSelectedSpriteIdx(newImages.length - 1);
      }
      pushToHistory(nextSff);
    } else {
      const nextSff = {
        version: 'ElecbyteSpr\x00',
        numGroups: 1, 
        numImages: newImages.length,
        images: newImages,
        palettes: newPalettes
      } as SffData;
      setSffData(nextSff);
      setSelectedSpriteIdx(0);
      pushToHistory(nextSff);
    }

    setPendingImportFiles([]);
    setIsReplacing(false);
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

    const lMap = getSpriteLayers(selectedSpriteIdx, sprite);
    const actId = getActiveLayerId(selectedSpriteIdx, lMap);
    const activeLayerIdx = lMap.findIndex(l => l.id === actId);
    if (activeLayerIdx === -1) return;
    
    const targetLayer = lMap[activeLayerIdx];
    const nextIndices = new Uint8Array(targetLayer.pixelIndices);
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
                        if (px >= 0 && px < sprite.width && py >= 0 && py < sprite.height) {
                            const i = py * sprite.width + px;
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
        if (localX >= 0 && localX < sprite.width && localY >= 0 && localY < sprite.height) {
            const pixelIndex = localY * sprite.width + localX;
            const targetColorIdx = targetLayer.pixelIndices[pixelIndex];
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
        if (localX >= 0 && localX < sprite.width && localY >= 0 && localY < sprite.height) {
            const pixelIndex = localY * sprite.width + localX;
            const targetColorIdx = targetLayer.pixelIndices[pixelIndex];
            if (targetColorIdx !== colorIdx) {
                const stack = [[localX, localY]];
                while (stack.length > 0) {
                    const [cx, cy] = stack.pop()!;
                    if (cx < 0 || cx >= sprite.width || cy < 0 || cy >= sprite.height) continue;
                    const i = cy * sprite.width + cx;
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
        hasChangedThisStroke.current = true;
        const nextLayerObj = { ...targetLayer, pixelIndices: nextIndices };
        const nextLayers = [...lMap];
        nextLayers[activeLayerIdx] = nextLayerObj;
        updateLayersForSprite(selectedSpriteIdx, nextLayers);
    }
    
    setLastPaintPos({ x: localX, y: localY });
  };

  const handleStart = (clientX: number, clientY: number, isMiddleButton: boolean) => {
    if (isMiddleButton || activeTool === 'pan') {
        setIsPanning(true);
        setPanStart({ x: clientX, y: clientY });
        setPanOrig({ x: pan.x, y: pan.y });
        return;
    }

    hasChangedThisStroke.current = false;

    if (activeMode === 'Sprites') {
      if (!sffData) return;
      const idx = selectedSpriteIdx !== null ? selectedSpriteIdx : 0;
      const sprite = sffData.images[idx];
      if (!sprite) return;

      const rect = workspaceRef.current?.getBoundingClientRect();
      if (rect) {
          const clickX = clientX - rect.left - pan.x;
          const clickY = clientY - rect.top - pan.y;
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const drawX = centerX - sprite.xOffset * zoom;
          const drawY = centerY - sprite.yOffset * zoom;
          const localX = Math.floor((clickX - drawX) / zoom);
          const localY = Math.floor((clickY - drawY) / zoom);

          if (pastedContent && pastedContent.active) {
              if (localX >= pastedContent.x && localX < pastedContent.x + pastedContent.width &&
                  localY >= pastedContent.y && localY < pastedContent.y + pastedContent.height) {
                  setIsDraggingPasted(true);
                  setPastedDragStart({ x: clientX, y: clientY, origX: pastedContent.x, origY: pastedContent.y });
                  return;
              }
          }

          if (activeTool === 'eyedropper') {
              if (localX >= 0 && localX < sprite.width && localY >= 0 && localY < sprite.height) {
                  const picked = sprite.pixelIndices[localY * sprite.width + localX];
                  setSelectedPalColorIdx(picked);
                  setSaveNotification(`Eyedropper picked Palette Index #${picked}`);
                  setTimeout(() => setSaveNotification(null), 1500);
              }
              return;
          }

          if (activeTool === 'select') {
              setIsSelecting(true);
              setSelectionStartPos({ x: localX, y: localY });
              setSelectionRect({ x: localX, y: localY, w: 1, h: 1 });
              return;
          }
      }

      if (activeTool === 'paint' || activeTool === 'eraser' || activeTool === 'bucket' || activeTool === 'wand') {
          if (activeTool === 'paint' || activeTool === 'eraser') {
              setIsPaintDragging(true);
              setLastPaintPos(null);
          }
          applyPaint(clientX, clientY);
          return;
      }

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

    if (activeMode === 'Sprites') {
        if (!sffData) return;
        const idx = selectedSpriteIdx !== null ? selectedSpriteIdx : 0;
        const sprite = sffData.images[idx];
        if (!sprite) return;

        const rect = workspaceRef.current?.getBoundingClientRect();
        if (rect) {
            const clickX = clientX - rect.left - pan.x;
            const clickY = clientY - rect.top - pan.y;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const drawX = centerX - sprite.xOffset * zoom;
            const drawY = centerY - sprite.yOffset * zoom;
            const localX = Math.floor((clickX - drawX) / zoom);
            const localY = Math.floor((clickY - drawY) / zoom);

            if (isDraggingPasted && pastedDragStart) {
                const deltaX = Math.round((clientX - pastedDragStart.x) / zoom);
                const deltaY = Math.round((clientY - pastedDragStart.y) / zoom);
                setPastedContent(prev => prev ? {
                    ...prev,
                    x: pastedDragStart.origX + deltaX,
                    y: pastedDragStart.origY + deltaY
                } : null);
                return;
            }

            if (isSelecting && selectionStartPos) {
                const xInBounds = Math.max(0, Math.min(sprite.width - 1, localX));
                const yInBounds = Math.max(0, Math.min(sprite.height - 1, localY));
                const x = Math.min(selectionStartPos.x, xInBounds);
                const y = Math.min(selectionStartPos.y, yInBounds);
                const w = Math.max(1, Math.abs(selectionStartPos.x - xInBounds));
                const h = Math.max(1, Math.abs(selectionStartPos.y - yInBounds));
                setSelectionRect({ x, y, w, h });
                return;
            }
        }

        if ((activeTool === 'paint' || activeTool === 'eraser') && isPaintDragging) {
            applyPaint(clientX, clientY);
            return;
        }
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
    
    if (isDraggingPasted) {
        setIsDraggingPasted(false);
    }

    if (isSelecting) {
        setIsSelecting(false);
    }

    if (isDragging && previewOffset) {
        if (activeMode === 'Sprites') {
            handleUpdateSprite('xOffset', previewOffset.x);
            handleUpdateSprite('yOffset', previewOffset.y);
            hasChangedThisStroke.current = true;
        } else if (activeMode === 'Animations') {
            handleUpdateFrameField('xOffset', previewOffset.x);
            handleUpdateFrameField('yOffset', previewOffset.y);
            hasChangedThisStroke.current = true;
        }
    }

    if (hasChangedThisStroke.current) {
        pushToHistory();
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
          const loopTarget = (action.loopstartIndex !== undefined && action.loopstartIndex >= 0 && action.loopstartIndex < action.elements.length)
            ? action.loopstartIndex
            : 0;
          timer = setTimeout(() => {
            setCurrentFrame(prev => (prev + 1 >= action.elements.length ? loopTarget : prev + 1));
          }, duration);
        }
      }
    }
    return () => clearTimeout(timer);
  }, [isPlaying, currentFrame, selectedActionId, airData, playbackSpeed]);
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    interface ImportEntry {
      name: string;
      relativePath: string;
      text: () => Promise<string>;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }

    const collectedEntries: ImportEntry[] = [];
    const rawFiles = Array.from(files) as File[];

    for (const file of rawFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'zip') {
        try {
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const entries = Object.values(zip.files);
          for (const entry of entries) {
            if (entry.dir) continue;
            if (entry.name.startsWith('__MACOSX/') || entry.name.endsWith('.DS_Store')) continue;
            const baseName = entry.name.split('/').pop() || entry.name;
            collectedEntries.push({
              name: baseName,
              relativePath: entry.name,
              text: () => entry.async('string'),
              arrayBuffer: () => entry.async('arraybuffer')
            });
          }
        } catch (err: any) {
          console.error(`Error extracting ${file.name}: `, err);
          alert(`Failed to extract ZIP archive ${file.name}: ${err.message}`);
        }
      } else {
        collectedEntries.push({
          name: file.name,
          relativePath: (file as any).webkitRelativePath || file.name,
          text: () => file.text(),
          arrayBuffer: () => file.arrayBuffer()
        });
      }
    }

    if (collectedEntries.length === 0) return;

    // Parse .def first so we know target anim/sprite/sound/pal filenames, then sff before act so palettes attach cleanly
    let targetAnimFile = '';
    const defPalOrder: string[] = [];
    const defEntries = collectedEntries.filter(f => f.name.split('.').pop()?.toLowerCase() === 'def');
    const sffEntries = collectedEntries.filter(f => f.name.split('.').pop()?.toLowerCase() === 'sff');
    const actEntriesRaw = collectedEntries.filter(f => f.name.split('.').pop()?.toLowerCase() === 'act');
    const restEntries = collectedEntries.filter(f => {
      const e = f.name.split('.').pop()?.toLowerCase();
      return e !== 'def' && e !== 'sff' && e !== 'act';
    });

    if (defEntries.length > 0) {
      try {
        const previewDefText = await defEntries[0].text();
        const previewDef = parseIniString(previewDefText);
        for (let pi = 1; pi <= 12; pi++) {
          const pField = getIniField(previewDef, 'Files', `pal${pi}`);
          if (pField) {
            const pBase = pField.split(/[/\\]/).pop()?.trim().toLowerCase();
            if (pBase && !defPalOrder.includes(pBase)) defPalOrder.push(pBase);
          }
        }
      } catch {}
    }

    const actEntries = [...actEntriesRaw].sort((a, b) => {
      const aName = a.name.split(/[/\\]/).pop()?.toLowerCase() || '';
      const bName = b.name.split(/[/\\]/).pop()?.toLowerCase() || '';
      const ia = defPalOrder.indexOf(aName);
      const ib = defPalOrder.indexOf(bName);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return aName.localeCompare(bName);
    });

    const orderedEntries = [...defEntries, ...sffEntries, ...actEntries, ...restEntries];

    const hasActInSelection = collectedEntries.some(f => f.name.toLowerCase().endsWith('.act'));
    let airLoadedFromDefTarget = false;
    let actBatchIndex = 0;

    for (const file of orderedEntries) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        
        try {
            if (ext === 'def') {
                const text = await file.text();
                const parsedDef = parseIniString(text);
                setIniData(parsedDef);
                setIniRawText(text);
                const defAnim = getIniField(parsedDef, 'Files', 'anim');
                if (defAnim) {
                  targetAnimFile = defAnim.split(/[/\\]/).pop()?.trim().toLowerCase() || '';
                }
            } else if (ext === 'cns' || /^st\d*$/i.test(ext || '') || /^cns\d*$/i.test(ext || '')) {
                const text = await file.text();
                const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                setStFiles(prev => {
                  const existing = prev.find(f => f.filename === file.name);
                  if (existing) {
                    return prev.map(f => f.filename === file.name ? { ...f, content: text, parsed: parseIniString(text) } : f);
                  }
                  return [...prev, { id: fileId, filename: file.name, content: text, parsed: parseIniString(text) }];
                });
                setActiveStFileId(fileId);
            } else if (ext === 'cmd') {
                const text = await file.text();
                const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                setCmdFiles(prev => {
                  const existing = prev.find(f => f.filename === file.name);
                  if (existing) {
                    return prev.map(f => f.filename === file.name ? { ...f, content: text, parsed: parseIniString(text) } : f);
                  }
                  return [...prev, { id: fileId, filename: file.name, content: text, parsed: parseIniString(text) }];
                });
                setActiveCmdFileId(fileId);
            } else if (ext === 'sff') {
                const buffer = await file.arrayBuffer();
                let parsed = parseSffBinary(buffer);
                if (parsed.palettes && parsed.palettes.length > 0) {
                  let anyFlipped = false;
                  const fixedPalettes = parsed.palettes.map(pal => {
                    const res = detectAndFixUpsideDownPalette(pal.data, parsed.images);
                    if (res.wasFlipped) anyFlipped = true;
                    return res.wasFlipped ? { ...pal, data: res.palette } : pal;
                  });
                  if (anyFlipped) {
                    const fallbackFixed = fixedPalettes[0]?.data;
                    parsed = {
                      ...parsed,
                      palettes: fixedPalettes,
                      images: parsed.images.map(img =>
                        img.isSharedPalette && fallbackFixed ? { ...img, palette: fallbackFixed } : img
                      ),
                    };
                    appendEngineLog(`Auto-flipped upside-down SFF palette in "${file.name}" (0↔255).`);
                  }
                }
                sffDataRef.current = parsed;
                setSffData(parsed);
                setSelectedSpriteIdx(0);
                
                // Select the first available palette
                if (parsed.palettes && parsed.palettes.length > 0) {
                    setSelectedPaletteIdx(0);
                }

                // If no .act file in this batch, use the first available palette as the fallback
                if (!hasActInSelection) {
                   const firstPal = parsed.palettes && parsed.palettes.length > 0 ? parsed.palettes[0].data : null;
                   const firstPalSprite = firstPal ? { palette: firstPal } : parsed.images.find(img => img.palette);
                   if (firstPalSprite && firstPalSprite.palette) {
                      setActPalette(new Uint8Array(firstPalSprite.palette));
                   }
                }
            } else if (ext === 'act') {
                const buffer = await file.arrayBuffer();
                const rawPaletteData = parseActBinary(buffer);
                const { palette: paletteData, wasFlipped } = detectAndFixUpsideDownPalette(rawPaletteData, sffDataRef.current?.images);
                if (wasFlipped) {
                  appendEngineLog(`Auto-flipped upside-down ACT palette "${file.name}" (0↔255).`);
                }
                const curActIdx = actBatchIndex++;
                if (curActIdx === 0) {
                  setActPalette(paletteData);
                  setSelectedPaletteIdx(0);
                }

                // Add every distinct .act palette slot (1,1), (1,2), ... to SFF palettes
                setSffData(prev => {
                    if (!prev) return prev;
                    const nextPalettes = [...(prev.palettes || [])];
                    if (curActIdx === 0) {
                      const existingIdx = nextPalettes.findIndex(p => p.group === 1 && p.item === 1);
                      if (existingIdx >= 0) {
                        nextPalettes[existingIdx] = { ...nextPalettes[existingIdx], data: paletteData };
                      } else {
                        nextPalettes.unshift({ group: 1, item: 1, data: paletteData });
                      }
                    } else {
                      const targetItem = curActIdx + 1;
                      const existingIdx = nextPalettes.findIndex(p => p.group === 1 && p.item === targetItem);
                      if (existingIdx >= 0) {
                        nextPalettes[existingIdx] = { ...nextPalettes[existingIdx], data: paletteData };
                      } else {
                        nextPalettes.push({ group: 1, item: targetItem, data: paletteData });
                      }
                    }
                    return { ...prev, palettes: nextPalettes };
                });
            } else if (ext === 'air') {
                const matchesDefAnim = targetAnimFile && file.name.toLowerCase() === targetAnimFile;
                if (airLoadedFromDefTarget && !matchesDefAnim) {
                  continue;
                }
                const text = await file.text();
                const parsedAir = parseAirString(text);
                airDataRef.current = parsedAir;
                setAirData(parsedAir);
                setAirRawText(text);
                setCurrentFrame(0);
                setIsPlaying(false);
                const firstActionId = Object.keys(parsedAir.actions).map(Number).sort((a, b) => a - b)[0];
                setSelectedActionId(firstActionId !== undefined ? firstActionId : null);
                if (matchesDefAnim) {
                  airLoadedFromDefTarget = true;
                }
            } else if (ext === 'snd') {
                const buffer = await file.arrayBuffer();
                const parsedSnd = parseSndBinary(buffer);
                setSndData(parsedSnd);
                if (parsedSnd.sounds.length > 0) {
                    setSelectedSoundId(parsedSnd.sounds[0].id);
                }
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
    
    // Seed history after files are loaded
    pushToHistory();
  };

  const menuItems = ["Project", "Edit", "View", "Sprites", "Animations", "Commands", "States", "Sounds"];

  const handleMenuClick = (item: string) => {
    if (['Sprites', 'Animations', 'Commands', 'States', 'Sounds'].includes(item)) {
        setActiveMode(item as any);
        setActiveDropdown(null);
    } else if (item === 'Project') {
        setActiveMode('Definitions');
        setActiveDropdown(null);
    } else if (item === 'Edit' || item === 'View') {
        setActiveDropdown(activeDropdown === item ? null : item);
    }
  };

  const getActiveTextData = () => {
      if (activeMode === 'Definitions') return { text: iniRawText, setter: setIniRawText, parsed: iniData };
      if (activeMode === 'States') {
        const file = stFiles.find(f => f.id === activeStFileId) || stFiles[0];
        return { 
          text: file.content, 
          setter: (val: string | null) => {
            setStFiles(prev => prev.map(f => f.id === activeStFileId ? { ...f, content: val || '' } : f));
          }, 
          parsed: file.parsed 
        };
      }
      if (activeMode === 'Commands') {
        const file = cmdFiles.find(f => f.id === activeCmdFileId) || cmdFiles[0];
        return { 
          text: file.content, 
          setter: (val: string | null) => {
            setCmdFiles(prev => prev.map(f => f.id === activeCmdFileId ? { ...f, content: val || '' } : f));
          }, 
          parsed: file.parsed 
        };
      }
      return { text: null, setter: () => {}, parsed: null };
  };

  const { text: activeText, setter: setActiveText, parsed: activeParsedData } = getActiveTextData();
  const activeSound = sndData?.sounds.find(s => s.id === selectedSoundId);

  useEffect(() => {
    try {
        if (activeMode === 'Definitions' && iniRawText) setIniData(parseIniString(iniRawText));
        if (activeMode === 'States') {
          setStFiles(prev => prev.map(f => {
            if (f.id === activeStFileId) {
              return { ...f, parsed: parseIniString(f.content) };
            }
            return f;
          }));
        }
        if (activeMode === 'Commands') {
          setCmdFiles(prev => prev.map(f => {
            if (f.id === activeCmdFileId) {
              return { ...f, parsed: parseIniString(f.content) };
            }
            return f;
          }));
        }
    } catch(e) {}
  }, [iniRawText, stFiles.find(f=>f.id===activeStFileId)?.content, cmdFiles.find(f=>f.id===activeCmdFileId)?.content, activeMode]);

  const handleUpdateSprite = (key: string, value: number) => {
    setSffData(prev => {
        if (!prev || selectedSpriteIdx === null) return prev;
        const newSff = { ...prev, images: [...prev.images] };
        newSff.images[selectedSpriteIdx] = { ...newSff.images[selectedSpriteIdx], [key]: value };
        sffDataRef.current = newSff;
        return newSff;
    });
  };

  const handleUpdateDefValue = (section: string, key: string, value: string) => {
    const baseText = iniRawText ?? templateDef;
    const nextText = updateIniTextField(
      baseText,
      section,
      key,
      value,
      section.toLowerCase() === 'info'
    );
    setIniRawText(nextText);
    setIniData(parseIniString(nextText));
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

  const handleAddAnimAction = (actionId: number, actionName?: string) => {
    if (!airData) return;
    if (airData.actions[actionId]) {
      alert(`Action ${actionId} already exists!`);
      return;
    }
    const trimmedName = actionName?.trim();
    const newAction: any = {
      id: actionId,
      ...(trimmedName ? { name: trimmedName } : {}),
      elements: [
        { group: 0, image: 0, xOffset: 0, yOffset: 0, time: 5, flip: "" }
      ],
      clsn1: [],
      clsn2: []
    };
    const nextAir = { ...airData, actions: { ...airData.actions, [actionId]: newAction } };
    airDataRef.current = nextAir;
    setAirData(nextAir);
    setSelectedActionId(actionId);
    setCurrentFrame(0);
    setNewActionNameText('');
    syncAirRawText(nextAir);
  };

  const handleRenameAnimAction = (actionId: number, name: string) => {
    if (!airData) return;
    const action = airData.actions[actionId];
    if (!action) return;
    const nextAir = {
      ...airData,
      actions: {
        ...airData.actions,
        [actionId]: {
          ...action,
          name
        }
      }
    };
    airDataRef.current = nextAir;
    setAirData(nextAir);
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
    airDataRef.current = nextAir;
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

  const handleMoveFrameOrder = (direction: -1 | 1) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;
    const targetIdx = currentFrame + direction;
    if (targetIdx < 0 || targetIdx >= action.elements.length) return;

    const nextElements = [...action.elements];
    const [moved] = nextElements.splice(currentFrame, 1);
    nextElements.splice(targetIdx, 0, moved);

    let nextLoop = action.loopstartIndex;
    if (nextLoop === currentFrame) nextLoop = targetIdx;
    else if (nextLoop === targetIdx) nextLoop = currentFrame;

    const nextAction = { ...action, elements: nextElements, loopstartIndex: nextLoop };
    const nextAir = { ...airData, actions: { ...airData.actions, [selectedActionId]: nextAction } };
    airDataRef.current = nextAir;
    setAirData(nextAir);
    setCurrentFrame(targetIdx);
    syncAirRawText(nextAir);
    pushToHistory(undefined, nextAir);
  };

  const handleToggleLoopstart = () => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;
    const nextLoop = action.loopstartIndex === currentFrame ? undefined : currentFrame;
    const nextAction = { ...action, loopstartIndex: nextLoop };
    const nextAir = { ...airData, actions: { ...airData.actions, [selectedActionId]: nextAction } };
    airDataRef.current = nextAir;
    setAirData(nextAir);
    syncAirRawText(nextAir);
    pushToHistory(undefined, nextAir);
  };

  const handleApplyOffsetToAllFrames = () => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    const curr = action?.elements[currentFrame];
    if (!action || !curr) return;
    const nextElements = action.elements.map(el => ({ ...el, xOffset: curr.xOffset, yOffset: curr.yOffset }));
    const nextAction = { ...action, elements: nextElements };
    const nextAir = { ...airData, actions: { ...airData.actions, [selectedActionId]: nextAction } };
    airDataRef.current = nextAir;
    setAirData(nextAir);
    syncAirRawText(nextAir);
    pushToHistory(undefined, nextAir);
    appendEngineLog(`Applied offset (${curr.xOffset}, ${curr.yOffset}) to all ${nextElements.length} frames in Action ${selectedActionId}.`);
  };

  const handleAutoCropSprite = () => {
    if (!sffData || selectedSpriteIdx === null) return;
    const sprite = sffData.images[selectedSpriteIdx];
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) return;

    const w = sprite.width;
    const h = sprite.height;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (sprite.pixelIndices[y * w + x] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) {
      alert('Sprite is completely empty (all index 0).');
      return;
    }
    if (minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1) {
      setSaveNotification('Sprite is already tightly cropped!');
      setTimeout(() => setSaveNotification(null), 1500);
      return;
    }

    const newW = maxX - minX + 1;
    const newH = maxY - minY + 1;
    const cropPixels = (src: Uint8Array) => {
      const dst = new Uint8Array(newW * newH);
      for (let y = 0; y < newH; y++) {
        for (let x = 0; x < newW; x++) {
          dst[y * newW + x] = src[(y + minY) * w + (x + minX)];
        }
      }
      return dst;
    };

    const nextSprite = {
      ...sprite,
      width: newW,
      height: newH,
      xOffset: sprite.xOffset - minX,
      yOffset: sprite.yOffset - minY,
      pixelIndices: cropPixels(sprite.pixelIndices),
    };
    const nextImages = [...sffData.images];
    nextImages[selectedSpriteIdx] = nextSprite;
    const nextSff = { ...sffData, images: nextImages };
    sffDataRef.current = nextSff;
    setSffData(nextSff);

    const existingLayers = spriteLayersMapRef.current[selectedSpriteIdx];
    if (existingLayers) {
      const nextLayers = existingLayers.map(l => ({ ...l, pixelIndices: cropPixels(l.pixelIndices) }));
      setSpriteLayersMap(prev => {
        const nextMap = { ...prev, [selectedSpriteIdx]: nextLayers };
        spriteLayersMapRef.current = nextMap;
        return nextMap;
      });
    }
    pushToHistory(nextSff);
    appendEngineLog(`Auto-cropped sprite (${sprite.group},${sprite.image}) from ${w}x${h} to ${newW}x${newH}.`);
  };

  const handleFlipSpritePixels = (axis: 'h' | 'v') => {
    if (!sffData || selectedSpriteIdx === null) return;
    const sprite = sffData.images[selectedSpriteIdx];
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) return;

    const w = sprite.width;
    const h = sprite.height;
    const flipBuf = (src: Uint8Array) => {
      const dst = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = axis === 'h' ? w - 1 - x : x;
          const sy = axis === 'v' ? h - 1 - y : y;
          dst[y * w + x] = src[sy * w + sx];
        }
      }
      return dst;
    };

    const layers = getSpriteLayers(selectedSpriteIdx, sprite);
    const flippedLayers = layers.map(l => ({ ...l, pixelIndices: flipBuf(l.pixelIndices) }));
    updateLayersForSprite(selectedSpriteIdx, flippedLayers);
    pushToHistory();
  };

  const handleNudgeSpritePixels = (dx: number, dy: number) => {
    if (!sffData || selectedSpriteIdx === null) return;
    const sprite = sffData.images[selectedSpriteIdx];
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) return;

    const w = sprite.width;
    const h = sprite.height;
    const shiftBuf = (src: Uint8Array) => {
      const dst = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            dst[ny * w + nx] = src[y * w + x];
          }
        }
      }
      return dst;
    };

    const layers = getSpriteLayers(selectedSpriteIdx, sprite);
    const shiftedLayers = layers.map(l => ({ ...l, pixelIndices: shiftBuf(l.pixelIndices) }));
    updateLayersForSprite(selectedSpriteIdx, shiftedLayers);
    pushToHistory();
  };

  const handleBatchImportPngs = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const currentSff = sffData || {
      version: '1.1',
      numGroups: 1,
      numImages: 0,
      images: [],
      palettes: [],
    };
    const activePal =
      currentSff.palettes?.[selectedPaletteIdx]?.data ||
      currentSff.palettes?.[0]?.data ||
      actPalette ||
      currentSff.images[0]?.palette ||
      null;

    let nextG = 0;
    let nextI = 0;
    if (currentSff.images.length > 0) {
      const last = currentSff.images[currentSff.images.length - 1];
      nextG = last.group;
      nextI = last.image + 1;
    }

    const newImages = [...currentSff.images];
    let firstAddedIdx = newImages.length;

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const blob = new Blob([buffer]);
      const url = URL.createObjectURL(blob);
      await new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => {
          const off = document.createElement('canvas');
          off.width = img.width;
          off.height = img.height;
          const ctx = off.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, img.width, img.height);
            const { indices, palette } = imageToSpriteIndices(imgData.data, img.width, img.height, activePal);
            newImages.push({
              group: nextG,
              image: nextI++,
              xOffset: Math.round(img.width / 2),
              yOffset: img.height - 4,
              width: img.width,
              height: img.height,
              pixelIndices: indices,
              isSharedPalette: Boolean(activePal),
              comment: file.name,
              palette: activePal ? undefined : palette,
            });
          }
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        img.src = url;
      });
    }

    const nextSff: SffData = {
      ...currentSff,
      images: newImages,
      numImages: newImages.length,
    };
    sffDataRef.current = nextSff;
    setSffData(nextSff);
    if (firstAddedIdx < newImages.length) {
      setSelectedSpriteIdx(firstAddedIdx);
    }
    pushToHistory(nextSff);
    appendEngineLog(`Batch imported ${files.length} PNG sprite(s) quantized to active palette.`);
    if (batchPngInputRef.current) batchPngInputRef.current.value = '';
  };

  const handleApplyPaletteRangeHsl = () => {
    const activePal =
      sffData?.palettes?.[selectedPaletteIdx]?.data ||
      actPalette ||
      sffData?.images[selectedSpriteIdx]?.palette;
    if (!activePal) return;

    const from = Math.max(1, Math.min(255, palRangeFrom));
    const to = Math.max(from, Math.min(255, palRangeTo));
    const nextPal = new Uint8Array(activePal);

    for (let idx = from; idx <= to; idx++) {
      const off = idx * 4;
      const [h, s, l] = rgbToHsl(nextPal[off], nextPal[off + 1], nextPal[off + 2]);
      const [nr, ng, nb] = hslToRgb(h + palHue, s + palSat, l + palLight);
      nextPal[off] = nr;
      nextPal[off + 1] = ng;
      nextPal[off + 2] = nb;
      nextPal[off + 3] = 255;
    }

    if (sffData && sffData.palettes && sffData.palettes[selectedPaletteIdx]) {
      const nextPalettes = [...sffData.palettes];
      nextPalettes[selectedPaletteIdx] = { ...nextPalettes[selectedPaletteIdx], data: nextPal };
      const nextSff = { ...sffData, palettes: nextPalettes };
      sffDataRef.current = nextSff;
      setSffData(nextSff);
    }
    setActPalette(nextPal);
    setPalHue(0);
    setPalSat(0);
    setPalLight(0);
    pushToHistory();
    appendEngineLog(`Applied HSL shift to palette indices ${from}..${to}.`);
  };

  const handleExportStandaloneSff = () => {
    if (!sffData) return;
    const buffer = buildSffBinary(sffData);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getIniField(iniData, 'Info', 'name') || 'character'}.sff`;
    a.click();
    URL.revokeObjectURL(url);
    appendEngineLog(`Exported standalone .SFF (${sffData.images.length} sprites).`);
  };

  const handleExportStandaloneAir = () => {
    const content = airRawText || (airData ? serializeAirData(airData) : '');
    if (!content) return;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getIniField(iniData, 'Info', 'name') || 'character'}.air`;
    a.click();
    URL.revokeObjectURL(url);
    appendEngineLog('Exported standalone .AIR file.');
  };

  const handleExportActionGifFile = () => {
    if (!sffData || !airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action || action.elements.length === 0) return;
    const pal =
      sffData.palettes?.[selectedPaletteIdx]?.data ||
      sffData.palettes?.[0]?.data ||
      actPalette;
    const blob = exportActionGif(sffData, action, pal);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `action_${selectedActionId}.gif`;
    a.click();
    URL.revokeObjectURL(url);
    appendEngineLog(`Exported Action ${selectedActionId} animated GIF.`);
  };

  const handleExportActionSheetFile = async () => {
    if (!sffData || !airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action || action.elements.length === 0) return;
    const pal =
      sffData.palettes?.[selectedPaletteIdx]?.data ||
      sffData.palettes?.[0]?.data ||
      actPalette;
    const blob = await exportActionSpriteSheet(sffData, action, pal);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `action_${selectedActionId}_sheet.png`;
    a.click();
    URL.revokeObjectURL(url);
    appendEngineLog(`Exported Action ${selectedActionId} PNG sprite sheet.`);
  };

  const handleAddCollisionBox = (clsnType: 1 | 2) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;

    const boxId = Math.floor(Math.random() * 100000);
    const newBox = { id: boxId, x1: -30, y1: -60, x2: 30, y2: 10 };

    setAirData(prevAir => {
      if (!prevAir || selectedActionId === null) return prevAir;
      const act = prevAir.actions[selectedActionId];
      if (!act) return prevAir;

      const nextAir = { ...prevAir };
      const nextAction = { ...act };

      if (clsnScope === 'frame' && nextAction.elements[currentFrame]) {
        const nextElements = [...nextAction.elements];
        const el = { ...nextElements[currentFrame] };
        if (clsnType === 1) {
          el.clsn1 = [...(el.clsn1 ?? act.clsn1), newBox];
        } else {
          el.clsn2 = [...(el.clsn2 ?? act.clsn2), newBox];
        }
        nextElements[currentFrame] = el;
        nextAction.elements = nextElements;
      } else {
        if (clsnType === 1) {
          nextAction.clsn1 = [...nextAction.clsn1, newBox];
        } else {
          nextAction.clsn2 = [...nextAction.clsn2, newBox];
        }
      }

      nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
      syncAirRawText(nextAir);
      return nextAir;
    });

    setSelectedClsn({ type: clsnType, id: boxId });
  };

  const handleDeleteCollisionBox = (clsnType: 1 | 2, boxId: number) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;

    setAirData(prevAir => {
      if (!prevAir || selectedActionId === null) return prevAir;
      const act = prevAir.actions[selectedActionId];
      if (!act) return prevAir;

      const nextAir = { ...prevAir };
      const nextAction = { ...act };

      if (clsnScope === 'frame' && nextAction.elements[currentFrame]) {
        const nextElements = [...nextAction.elements];
        const el = { ...nextElements[currentFrame] };
        if (clsnType === 1) {
          el.clsn1 = (el.clsn1 || []).filter((b: any) => b.id !== boxId);
        } else {
          el.clsn2 = (el.clsn2 || []).filter((b: any) => b.id !== boxId);
        }
        nextElements[currentFrame] = el;
        nextAction.elements = nextElements;
      } else {
        if (clsnType === 1) {
          nextAction.clsn1 = nextAction.clsn1.filter((b: any) => b.id !== boxId);
        } else {
          nextAction.clsn2 = nextAction.clsn2.filter((b: any) => b.id !== boxId);
        }
      }

      nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
      syncAirRawText(nextAir);
      return nextAir;
    });

    if (selectedClsn?.type === clsnType && selectedClsn?.id === boxId) {
      setSelectedClsn(null);
    }
  };

  const handleUpdateCollisionBox = (clsnType: 1 | 2, boxId: number, fieldOrUpdates: string | Record<string, number>, value?: number) => {
    setAirData(prevAir => {
      if (!prevAir || selectedActionId === null) return prevAir;
      const act = prevAir.actions[selectedActionId];
      if (!act) return prevAir;

      const nextAir = { ...prevAir };
      const nextAction = { ...act };

      const updateBoxObj = (b: any) => {
        if (b.id !== boxId) return b;
        if (typeof fieldOrUpdates === 'object') {
          return { ...b, ...fieldOrUpdates };
        }
        if (fieldOrUpdates === 'w') {
          return { ...b, x2: b.x1 + Math.max(1, value ?? 1) };
        }
        if (fieldOrUpdates === 'h') {
          return { ...b, y2: b.y1 + Math.max(1, value ?? 1) };
        }
        return { ...b, [fieldOrUpdates]: value };
      };

      const el = nextAction.elements[currentFrame];
      const useFrameBoxes = clsnScope === 'frame' || (el && (clsnType === 1 ? el.clsn1 !== undefined : el.clsn2 !== undefined));

      if (useFrameBoxes && el) {
        const nextElements = [...nextAction.elements];
        const nextEl = { ...el };
        if (clsnType === 1) {
          nextEl.clsn1 = (nextEl.clsn1 ?? act.clsn1).map(updateBoxObj);
        } else {
          nextEl.clsn2 = (nextEl.clsn2 ?? act.clsn2).map(updateBoxObj);
        }
        nextElements[currentFrame] = nextEl;
        nextAction.elements = nextElements;
      } else {
        if (clsnType === 1) {
          nextAction.clsn1 = nextAction.clsn1.map(updateBoxObj);
        } else {
          nextAction.clsn2 = nextAction.clsn2.map(updateBoxObj);
        }
      }

      nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
      syncAirRawText(nextAir);
      return nextAir;
    });
  };

  const handleLinkSpriteToFrame = (group: number, image: number) => {
    if (!airData || selectedActionId === null) return;
    const action = airData.actions[selectedActionId];
    if (!action) return;

    const nextAir = { ...airData };
    const nextAction = { ...action };
    nextAction.elements = [...nextAction.elements];

    if (nextAction.elements[currentFrame]) {
      nextAction.elements[currentFrame] = { ...nextAction.elements[currentFrame], group, image };
    } else {
      nextAction.elements.push({ group, image, xOffset: 0, yOffset: 0, time: 5, flip: "" });
      setCurrentFrame(nextAction.elements.length - 1);
    }

    nextAir.actions = { ...nextAir.actions, [selectedActionId]: nextAction };
    airDataRef.current = nextAir;
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
    nextPal[offset + 3] = selectedPalColorIdx === 0 ? 0 : 255; // index 0 must be transparent

    if (actPalette) {
      setActPalette(nextPal);
    } else if (sffData && selectedSpriteIdx !== null) {
      const nextSff = { ...sffData, images: [...sffData.images] };
      if (nextSff.images[selectedSpriteIdx]) {
        nextSff.images[selectedSpriteIdx] = { ...nextSff.images[selectedSpriteIdx], palette: nextPal };
        setSffData(nextSff);
        sffDataRef.current = nextSff;
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
    nextPal[offset + 3] = selectedPalColorIdx === 0 ? 0 : 255;

    if (actPalette) {
      setActPalette(nextPal);
    } else if (sffData && selectedSpriteIdx !== null) {
      const nextSff = { ...sffData, images: [...sffData.images] };
      if (nextSff.images[selectedSpriteIdx]) {
        nextSff.images[selectedSpriteIdx] = { ...nextSff.images[selectedSpriteIdx], palette: nextPal };
        setSffData(nextSff);
        sffDataRef.current = nextSff;
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
    a.download = `${getIniField(iniData, 'Info', 'name') || 'character'}.act`;
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
    if (activeMode === 'States') {
      const id = `file-${Date.now()}`;
      setStFiles(prev => [...prev, { id, filename: `st${prev.length || ''}.cns`, content: templateCns, parsed: parseIniString(templateCns) }]);
      setActiveStFileId(id);
    }
    if (activeMode === 'Commands') {
      const id = `file-${Date.now()}`;
      setCmdFiles(prev => [...prev, { id, filename: `new${prev.length || ''}.cmd`, content: templateCmd, parsed: parseIniString(templateCmd) }]);
      setActiveCmdFileId(id);
    }
    if (activeMode === 'Animations') setAirRawText(templateAir);
  };

  const handleImportMoreFiles = () => {
    fileInputRef.current?.click();
  };
  
  const handleSave = () => {
    if (activeMode === 'Sounds' && sndData) {
      try {
        const buffer = buildSndBinary(sndData.sounds);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${getIniField(iniData, 'Info', 'name') || 'character'}.snd`;
        a.click();
      } catch (err: any) {
        alert("Failed to compile sound (SND) archive: " + err.message);
      }
    } else if (activeText && activeMode !== 'Sprites' && activeMode !== 'Animations') {
      let filename = `file.${activeMode === 'Definitions' ? 'def' : activeMode === 'States' ? 'cns' : 'cmd'}`;
      if (activeMode === 'States') {
        const file = stFiles.find(f => f.id === activeStFileId);
        if (file) filename = file.filename;
      } else if (activeMode === 'Commands') {
        const file = cmdFiles.find(f => f.id === activeCmdFileId);
        if (file) filename = file.filename;
      }

      const blob = new Blob([activeText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    }
  };

  const handleExportZip = async () => {
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      
      const charName = getIniField(iniData, 'Info', 'name') || 'character';
      const charNameClean = charName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'character';
      
      // Filename mappings
      const cmdFile = getIniField(iniData, 'Files', 'cmd') || "player.cmd";
      const cnsFile = getIniField(iniData, 'Files', 'cns') || "player.cns";
      const sffFile = getIniField(iniData, 'Files', 'sprite') || "player.sff";
      const airFile = getIniField(iniData, 'Files', 'anim') || "player.air";
      const sndFile = getIniField(iniData, 'Files', 'sound') || "player.snd";
      const actFile = getIniField(iniData, 'Files', 'pal1') || "player.act";
      const defFile = `${charNameClean}.def`;

      // 1. Definition File (.def)
      const defContent = iniRawText || (iniData ? stringifyIni(iniData) : templateDef);
      zip.file(`${charNameClean}/${defFile}`, defContent);

      // 2. Constants & States Files (.cns / .st)
      stFiles.forEach(file => {
        zip.file(`${charNameClean}/${file.filename}`, file.content);
      });

      // 3. Command Configs (.cmd)
      cmdFiles.forEach(file => {
        zip.file(`${charNameClean}/${file.filename}`, file.content);
      });

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

  const handleExportSpritePng = async (idx: number) => {
    if (!sffData) return;
    const img = sffData.images[idx];
    if (!img) return;

    // Determine the relevant palette (use provided sprite palette or global actPalette)
    const palette = actPalette || img.palette || sffData.images[0]?.palette;
    if (!palette) {
        alert("No palette found for this sprite. Please load an .ACT file first.");
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = applyPalette(img.pixelIndices, img.width, img.height, palette);
    ctx.putImageData(imageData, 0, 0);

    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sprite_${img.group}_${img.image}_${idx}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportAllSpritesZip = async () => {
    if (!sffData || sffData.images.length === 0) return;
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < sffData.images.length; i++) {
        const img = sffData.images[i];
        const palette = actPalette || img.palette || sffData.images[0]?.palette;
        if (!palette) continue;

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const imageData = applyPalette(img.pixelIndices, img.width, img.height, palette);
        ctx.putImageData(imageData, 0, 0);

        // Convert canvas to data URL then to base64 for JSZip
        const dataUrl = canvas.toDataURL('image/png');
        const b64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        zip.file(`sprite_${img.group}_${img.image}_${i}.png`, b64Data, { base64: true });
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all_sprites_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Failed to export sprites ZIP: " + err.message);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleExportSelectedSpritesZip = async () => {
    if (!sffData || selectedSpriteIndices.size === 0) return;
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      const indices = Array.from(selectedSpriteIndices).sort((a: number, b: number) => a - b);
      
      for (const i of indices) {
        const img = sffData.images[i];
        if (!img) continue;
        const palette = actPalette || img.palette || sffData.images[0]?.palette;
        if (!palette) continue;

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const imageData = applyPalette(img.pixelIndices, img.width, img.height, palette);
        ctx.putImageData(imageData, 0, 0);

        const dataUrl = canvas.toDataURL('image/png');
        const b64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        zip.file(`sprite_${img.group}_${img.image}_${i}.png`, b64Data, { base64: true });
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `selected_sprites_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Failed to export selected sprites ZIP: " + err.message);
    } finally {
      setIsExportingZip(false);
    }
  };

  const toggleSpriteSelection = (idx: number) => {
    setSelectedSpriteIndices(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
    });
  };

  const selectAllSprites = () => {
    if (!sffData) return;
    const all = new Set<number>();
    for (let i = 0; i < sffData.images.length; i++) all.add(i);
    setSelectedSpriteIndices(all);
  };

  const deselectAllSprites = () => {
    setSelectedSpriteIndices(new Set());
  };

  return (
    <div className="flex h-screen w-full flex-col font-sans text-white text-xs select-none" style={{ backgroundColor: '#2a2a2a' }}>
      <input type="file" ref={fileInputRef} multiple accept=".zip,.def,.cns,.st,.cmd,.sff,.act,.air,.snd,.wav,.mp3" onChange={handleFileUpload} className="hidden" />

      {/* Menu Bar */}
      <div className="flex items-center px-1 bg-[#1a1a1a] border-b border-[#3a3a3a] whitespace-nowrap shrink-0 max-w-[100vw] relative z-[1000]">
         <div 
           className="px-2 py-1 cursor-pointer hover:bg-white/5 opacity-90 flex items-center gap-2 group shrink-0 transition-colors"
           onClick={onBackToHome}
           title="Go back to Home Screen"
         >
             <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-blue-600 rounded flex items-center justify-center shadow shadow-blue-500/20 group-hover:scale-110 transition-transform">
                <Box className="w-3.5 h-3.5 text-white" />
             </div>
             <span className="font-bold tracking-tight text-zinc-300 group-hover:text-white transition-colors">MUGENStudio</span>
         </div>
         <div className="w-[1px] h-4 bg-zinc-800 mx-2" />
         <div className="flex items-center">
           {menuItems.map(item => (
              <div key={item} className="relative menu-item-container">
                  <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMenuClick(item);
                      }}
                      onMouseEnter={() => {
                        if (activeDropdown && activeDropdown !== item) {
                          setActiveDropdown(item);
                        }
                      }}
                      className={`px-3 py-1 cursor-pointer transition-colors ${activeMode === item || (item === 'Project' && activeMode === 'Definitions') ? 'bg-[#333] text-blue-400' : 'text-gray-300 hover:bg-[#333]'}`}
                  >
                      {t(`studio.modes.${item.toLowerCase()}`)}
                  </div>
                  {item === 'Edit' && activeDropdown === 'Edit' && (
                    <div 
                      className="absolute top-full left-0 mt-0 w-48 bg-[#2a2a2a] border border-[#444] shadow-2xl z-[1001] py-1 rounded-b text-zinc-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={(e) => { e.stopPropagation(); undo(); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{t('studio.toolbar.undo')}</span><span className="text-gray-500 text-[10px]">Ctrl+Z</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); redo(); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{t('studio.toolbar.redo')}</span><span className="text-gray-500 text-[10px]">Ctrl+Y</span>
                      </button>
                      <div className="h-px bg-[#444] my-1" />
                      <button onClick={(e) => { e.stopPropagation(); if (activeMode === 'Sprites') handleCopySprite(); if (activeMode === 'Animations') handleCopyCLSN(); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{t('studio.toolbar.copy')}</span><span className="text-gray-500 text-[10px]">Ctrl+C</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); if (activeMode === 'Sprites') handlePasteSprite(); if (activeMode === 'Animations') handlePasteCLSN(); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{t('studio.toolbar.paste')}</span><span className="text-gray-500 text-[10px]">Ctrl+V</span>
                      </button>
                      <div className="h-px bg-[#444] my-1" />
                      <button onClick={(e) => { e.stopPropagation(); if (activeMode==='Sprites') handleDuplicateSprite(); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600">Duplicate</button>
                    </div>
                  )}
                  {item === 'View' && activeDropdown === 'View' && (
                    <div 
                      className="absolute top-full left-0 mt-0 w-48 bg-[#2a2a2a] border border-[#444] shadow-2xl z-[1001] py-1 rounded-b text-zinc-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(10, z + 0.5)); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{t('studio.modes.zoomIn')}</span><span className="text-gray-500 text-[10px]">Ctrl++</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.25, z - 0.5)); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{t('studio.modes.zoomOut')}</span><span className="text-gray-500 text-[10px]">Ctrl+-</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setZoom(2); setPan({x:0, y:0}); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600">{t('studio.modes.resetView')}</button>
                      <div className="h-px bg-[#444] my-1" />
                      <button onClick={(e) => { e.stopPropagation(); setShowAxis(prev => !prev); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{showAxis ? t('studio.modes.hideAxis') : t('studio.modes.showAxis')}</span><span className="text-gray-500 text-[10px]">A</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setShowClsn(prev => !prev); setActiveDropdown(null); }} className="w-full text-left px-4 py-1.5 hover:bg-blue-600 flex justify-between">
                        <span>{showClsn ? t('studio.modes.hideHitboxes') : t('studio.modes.showHitboxes')}</span><span className="text-gray-500 text-[10px]">C</span>
                      </button>
                    </div>
                  )}
              </div>
           ))}
         </div>
         <div className="w-[1px] h-4 bg-zinc-800 mx-1" />
         <button 
           onClick={() => saveProjectToLocalStorage(false)}
           className="px-2 py-0.5 cursor-pointer transition-colors text-xs text-purple-300 hover:text-white bg-purple-950/40 hover:bg-purple-900/60 border border-purple-700/50 rounded flex items-center gap-1.5 font-medium shrink-0"
           title="Save project state (Home Screen)"
         >
           <Save size={12} className="text-purple-400" />
           <span>Save Project</span>
         </button>
         {lastAutoSavedAt && (
           <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline px-1">
             Auto-saved {lastAutoSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
           </span>
         )}
         <div className="w-[1px] h-4 bg-zinc-800 mx-1" />
         <button 
           onClick={onShowDocs}
           className="px-2 py-1 cursor-pointer transition-colors text-zinc-400 hover:text-white hover:bg-white/5 rounded flex items-center justify-center"
           title="Help & Documentation"
         >
           <HelpCircle size={14} />
         </button>
         <LanguagePicker />
      </div>

      {/* Main Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#111111] overflow-x-auto whitespace-nowrap shrink-0 max-w-[100vw]" style={{ background: 'linear-gradient(to bottom, #4a4a4a, #2f2f2f)' }}>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.new') || 'New'} onClick={handleCreateNew}><FileIcon size={16} color="#4ade80" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.open') || 'Open'} onClick={() => fileInputRef.current?.click()}><FolderOpen size={16} color="#60a5fa" /></button>
        <button 
          className="p-1.5 hover:bg-white/10 rounded shrink-0" 
          title="Save Project & Export (Ctrl+S)" 
          onClick={() => {
            saveProjectToLocalStorage(false);
            handleSave();
          }}
        >
          <Save size={16} color="#c084fc" />
        </button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('common.export') || 'Export Character to ZIP'} onClick={() => setShowExportZipModal(true)}><Download size={16} color="#4ade80" /></button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.undo') || 'Undo'} onClick={undo}><Undo size={16} color="#f87171" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.redo') || 'Redo'} onClick={redo}><Redo size={16} color="#f87171" /></button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.cut') || 'Cut'}><Scissors size={16} color="#9ca3af" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.copy') || 'Copy'} onClick={() => { if(activeMode==='Sprites') handleCopySprite(); else if(activeMode==='Animations') handleCopyCLSN(); }}><Copy size={16} color="#9ca3af" /></button>
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.paste') || 'Paste'} onClick={() => { if(activeMode==='Sprites') handlePasteSprite(); else if(activeMode==='Animations') handlePasteCLSN(); }}><Clipboard size={16} color="#9ca3af" /></button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <button className="p-1.5 hover:bg-white/10 rounded shrink-0" title={t('studio.toolbar.search') || 'Search'} onClick={() => setIsSearchModalOpen(true)}><Search size={16} color="#9ca3af" /></button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <button
          className="px-2 py-1 hover:bg-emerald-600/30 bg-emerald-950/50 border border-emerald-700/60 rounded shrink-0 flex items-center gap-1 text-[10px] font-bold text-emerald-300 transition-colors"
          title="Open Mini Playable Move Tester Sandbox"
          onClick={() => setShowMoveTester(true)}
        >
          <Gamepad2 size={14} />
          <span>Test Moves</span>
        </button>
        <div className="w-px h-6 bg-[#1a1a1a] mx-1 shrink-0" />
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="px-2 py-1 bg-[#252525] hover:bg-[#353535] border border-[#3e3e3e] rounded text-[10px] font-mono text-zinc-200 flex items-center gap-1 transition-colors"
            title="Quick Export Standalone .SFF"
            onClick={handleExportStandaloneSff}
          >
            <Download size={11} className="text-blue-400" />
            <span>.SFF</span>
          </button>
          <button
            className="px-2 py-1 bg-[#252525] hover:bg-[#353535] border border-[#3e3e3e] rounded text-[10px] font-mono text-zinc-200 flex items-center gap-1 transition-colors"
            title="Quick Export Standalone .AIR"
            onClick={handleExportStandaloneAir}
          >
            <Download size={11} className="text-teal-400" />
            <span>.AIR</span>
          </button>
          <button
            className="px-2 py-1 bg-[#252525] hover:bg-[#353535] border border-[#3e3e3e] rounded text-[10px] font-mono text-zinc-200 flex items-center gap-1 transition-colors"
            title="Quick Export Active .ACT Palette"
            onClick={handleSavePalette}
          >
            <Download size={11} className="text-purple-400" />
            <span>.ACT</span>
          </button>
          {activeMode === 'Animations' && selectedActionId !== null && (
            <>
              <button
                className="px-2 py-1 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-700/60 rounded text-[10px] font-mono text-amber-300 flex items-center gap-1 transition-colors"
                title="Export Current Action as Animated .GIF"
                onClick={handleExportActionGifFile}
              >
                <Film size={11} />
                <span>GIF</span>
              </button>
              <button
                className="px-2 py-1 bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-700/60 rounded text-[10px] font-mono text-cyan-300 flex items-center gap-1 transition-colors"
                title="Export Current Action as Horizontal Sprite Sheet (.PNG)"
                onClick={handleExportActionSheetFile}
              >
                <Layers size={11} />
                <span>Sheet</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mobile Tabs */}
      <div className="md:hidden flex bg-[#1a1a1a] border-b border-[#333] select-none text-[10px] font-bold shrink-0">
         <div 
             className={`flex-1 text-center py-2 border-r border-[#333] cursor-pointer ${mobileTab === 'left' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/20' : 'text-gray-400'}`}
             onClick={() => setMobileTab('left')}
         >
             {t('studio.properties')}
         </div>
         <div 
             className={`flex-1 text-center py-2 border-r border-[#333] cursor-pointer ${mobileTab === 'center' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/20' : 'text-gray-400'}`}
             onClick={() => setMobileTab('center')}
         >
             {t('studio.canvas')}
         </div>
         {(activeMode === 'Sprites' || activeMode === 'Animations') && (
             <div 
                 className={`flex-1 text-center py-2 cursor-pointer ${mobileTab === 'right' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-900/20' : 'text-gray-400'}`}
                 onClick={() => setMobileTab('right')}
             >
                 {activeMode === 'Animations' ? 'Sprites' : 'Palette'}
             </div>
         )}
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
         {/* Left Panel */}
         <div 
             onMouseDown={e => e.stopPropagation()}
             onMouseMove={e => e.stopPropagation()}
             onMouseUp={e => e.stopPropagation()}
             onTouchStart={e => e.stopPropagation()}
             onTouchMove={e => e.stopPropagation()}
             onTouchEnd={e => e.stopPropagation()}
             onClick={e => e.stopPropagation()}
             className={`md:w-72 w-full min-h-0 border-r border-[#111111] bg-[#1e1e1e] flex-col select-none ${mobileTab === 'left' ? 'flex absolute inset-0 z-30 md:relative' : 'hidden md:flex'}`}
         >
            <div className="bg-[#111111] text-gray-300 font-bold py-2 px-3 flex justify-between items-center border-b border-[#333333]">
                <span className="uppercase text-[10px] tracking-wider">{t(`studio.modes.${activeMode.toLowerCase()}`)} {t('studio.properties')}</span>
                {(activeMode === 'Sprites' || activeMode === 'Animations') && (
                    <span className="text-[9px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded font-mono">
                        ID: {activeMode === 'Sprites' ? (selectedSpriteIdx !== null ? selectedSpriteIdx : '0') : (selectedActionId !== null ? selectedActionId : '0')}
                    </span>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
                {activeMode === 'Definitions' && (
                    <div className="flex flex-col gap-3">
                        <div className="text-xs font-semibold text-gray-400 border-b border-[#333333] pb-1">{t('studio.visualMetadata')}</div>
                        
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">{t('studio.charName')}</label>
                            <input 
                                type="text"
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={getIniField(iniData, 'Info', 'name')}
                                onChange={e => handleUpdateDefValue('Info', 'name', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">{t('studio.displayName')}</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={getIniField(iniData, 'Info', 'displayname')}
                                onChange={e => handleUpdateDefValue('Info', 'displayname', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">{t('studio.author')}</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={getIniField(iniData, 'Info', 'author')}
                                onChange={e => handleUpdateDefValue('Info', 'author', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">{t('studio.mugenVersion')}</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded"
                                value={getIniField(iniData, 'Info', 'mugenversion') || '1.0'}
                                onChange={e => handleUpdateDefValue('Info', 'mugenversion', e.target.value)}
                            />
                        </div>

                        <div className="text-xs font-semibold text-gray-400 border-b border-[#333333] pt-2 pb-1">{t('studio.assetReferences')}</div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">{t('studio.statesFile')}</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={getIniField(iniData, 'Files', 'cns')}
                                onChange={e => handleUpdateDefValue('Files', 'cns', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">Commands File (.cmd)</label>
                            <input 
                                type="text"
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={getIniField(iniData, 'Files', 'cmd')}
                                onChange={e => handleUpdateDefValue('Files', 'cmd', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">{t('studio.spritesFile')}</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={getIniField(iniData, 'Files', 'sprite')}
                                onChange={e => handleUpdateDefValue('Files', 'sprite', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">{t('studio.animationsFile')}</label>
                            <input 
                                type="text" 
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={getIniField(iniData, 'Files', 'anim')} 
                                onChange={e => handleUpdateDefValue('Files', 'anim', e.target.value)}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-gray-400">Sounds File (.snd)</label>
                            <input 
                                type="text"
                                className="bg-[#2a2a2a] border border-[#3a3a3a] px-2 py-1 outline-none text-gray-200 text-xs rounded font-mono"
                                value={getIniField(iniData, 'Files', 'sound')}
                                onChange={e => handleUpdateDefValue('Files', 'sound', e.target.value)}
                            />
                        </div>

                        <div className="text-[10px] text-gray-500 italic mt-2 text-center">
                            {t('studio.syncedBack')}
                        </div>
                    </div>
                )}

                {activeMode === 'Sprites' && sffData && (
                    <div className="flex flex-col gap-4">
                        {/* Tab Switcher */}
                        <div className="flex bg-[#1a1a1a] p-1 rounded-lg border border-[#333] shrink-0">
                            <button 
                                onClick={() => setSpriteSidebarTab('gallery')}
                                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${spriteSidebarTab === 'gallery' ? 'bg-[#333] text-blue-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                <ImageIcon size={12} />
                                {t('studio.gallery')}
                            </button>
                            <button 
                                onClick={() => setSpriteSidebarTab('palettes')}
                                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${spriteSidebarTab === 'palettes' ? 'bg-[#333] text-purple-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                <Palette size={12} />
                                {t('studio.palettes')}
                            </button>
                            <button 
                                onClick={() => setSpriteSidebarTab('layers')}
                                className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${spriteSidebarTab === 'layers' ? 'bg-[#333] text-green-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                            >
                                <Box size={12} />
                                {t('studio.layers')}
                            </button>
                        </div>

                        {spriteSidebarTab === 'gallery' && (
                            <div className="flex flex-col gap-4">
                                {/* Sprite Selector */}
                                <div className="flex justify-between items-center text-gray-300 bg-[#252525] p-2 border border-[#333] rounded shrink-0">
                                     <div className="flex items-center gap-1">
                                        <button className="px-2 py-0.5 hover:bg-[#444] rounded text-blue-400 font-bold" onClick={() => setSelectedSpriteIdx(Math.max(0, (selectedSpriteIdx || 0) - 1))}>&larr;</button>
                                        <span className="font-mono text-[11px]">No. {selectedSpriteIdx !== null ? selectedSpriteIdx + 1 : 0} / {sffData.numImages}</span>
                                        <button className="px-2 py-0.5 hover:bg-[#444] rounded text-blue-400 font-bold" onClick={() => setSelectedSpriteIdx(Math.min(sffData.numImages - 1, (selectedSpriteIdx || 0) + 1))}>&rarr;</button>
                                     </div>
                                     <button 
                                        className="p-1 hover:bg-[#444] rounded text-emerald-400" 
                                        onClick={() => selectedSpriteIdx !== null && handleExportSpritePng(selectedSpriteIdx)}
                                        title="Export selected sprite as PNG"
                                     >
                                        <Download size={14} />
                                     </button>
                                </div>

                                {/* Import/Delete/Duplicate Tools */}
                                <div className="flex flex-col gap-2 pb-2 border-b border-[#333] shrink-0">
                                    <div className="grid grid-cols-2 gap-2">
                                        <button 
                                            onClick={() => spritePngInputRef.current?.click()}
                                            className="px-3 py-1.5 bg-green-900/40 border border-green-700/80 rounded hover:bg-green-900/60 text-green-400 font-bold text-center flex items-center justify-center gap-1.5"
                                            title="Import custom PNG/JPG file"
                                        >
                                            <Plus size={12} />
                                            {t('common.import')}
                                        </button>
                                        <button 
                                            onClick={() => replaceSpriteInputRef.current?.click()}
                                            disabled={selectedSpriteIndices.size === 0}
                                            className={`px-3 py-1.5 border rounded font-bold text-center flex items-center justify-center gap-1.5 transition-all ${
                                                selectedSpriteIndices.size > 0 
                                                ? 'bg-amber-900/40 border-amber-700/80 text-amber-400 hover:bg-amber-900/60' 
                                                : 'bg-zinc-900/40 border-zinc-800 text-zinc-600 grayscale cursor-not-allowed'
                                            }`}
                                            title="Replace selected sprites with new images (keeps group/index)"
                                        >
                                            <Upload size={12} />
                                            {t('common.replace')}
                                        </button>
                                        <button 
                                            onClick={handleDeleteSprite}
                                            className="px-3 py-1.5 bg-red-955/40 border border-red-800/80 rounded hover:bg-red-955/60 text-red-400 font-bold text-center flex items-center justify-center gap-1.5"
                                            title="Delete active sprite from sheet"
                                        >
                                            <Minus size={12} />
                                            {t('common.delete')}
                                        </button>
                                        <button 
                                            onClick={handleDuplicateSprite}
                                            className="px-3 py-1.5 bg-blue-900/40 border border-blue-700/80 rounded hover:bg-blue-900/60 text-blue-400 font-bold text-center flex items-center justify-center gap-1.5"
                                            title="Duplicate active sprite (Index + 1)"
                                        >
                                            <Copy size={12} />
                                            {t('common.clone')}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button 
                                            onClick={handleExportAllSpritesZip}
                                            className="px-2 py-1.5 bg-zinc-800 border border-[#444] rounded hover:bg-zinc-700 text-zinc-300 font-bold text-center flex items-center justify-center gap-1 text-[10px]"
                                            title="Export all sprites as a ZIP package of PNGs"
                                        >
                                            <Download size={11} />
                                            {t('common.exportAll')}
                                        </button>
                                        <button 
                                            onClick={() => batchPngInputRef.current?.click()}
                                            className="px-2 py-1.5 bg-emerald-950/40 border border-emerald-700/70 rounded hover:bg-emerald-900/60 text-emerald-300 font-bold text-center flex items-center justify-center gap-1 text-[10px]"
                                            title="Batch import multiple PNGs auto-quantized to the active palette"
                                        >
                                            <Upload size={11} />
                                            Batch PNGs
                                        </button>
                                    </div>
                                    <button 
                                        onClick={handleExportSelectedSpritesZip}
                                        disabled={selectedSpriteIndices.size === 0}
                                        className={`px-3 py-1.5 border rounded font-bold text-center flex items-center justify-center gap-1.5 transition-all ${
                                            selectedSpriteIndices.size > 0 
                                            ? 'bg-blue-900/40 border-blue-700/80 text-blue-400 hover:bg-blue-900/60' 
                                            : 'bg-zinc-900/40 border-zinc-800 text-zinc-600 grayscale cursor-not-allowed'
                                        }`}
                                        title="Export only selected sprites as a ZIP package of PNGs"
                                    >
                                        <Download size={12} />
                                        {t('common.exportSelected', { count: selectedSpriteIndices.size })}
                                    </button>
                                    <input 
                                        type="file" 
                                        ref={spritePngInputRef} 
                                        onChange={handleImportSpriteFile} 
                                        accept="image/png, image/jpeg" 
                                        className="hidden" 
                                    />
                                    <input 
                                        type="file" 
                                        ref={batchPngInputRef} 
                                        onChange={handleBatchImportPngs} 
                                        multiple
                                        accept="image/png, image/jpeg" 
                                        className="hidden" 
                                    />
                                    <input 
                                        type="file" 
                                        ref={replaceSpriteInputRef} 
                                        onChange={handleReplaceSpriteFiles} 
                                        multiple
                                        accept="image/png, image/jpeg" 
                                        className="hidden" 
                                    />
                                </div>

                                {/* Group / Image Inputs */}
                                <div className="bg-[#242424] p-3 border border-[#333] rounded flex flex-col gap-3 shrink-0">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[10px] text-gray-400">{t('studio.groupNo')}</span>
                                            <div className="flex bg-[#1e1e1e] border border-[#3a3a3a] items-center rounded overflow-hidden">
                                                <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('group', (sffData.images[selectedSpriteIdx]?.group ?? 0) - 1)}>-</button>
                                                <input type="number" className="bg-transparent w-full text-center outline-none text-xs" value={sffData.images[selectedSpriteIdx]?.group ?? 0} onChange={e => handleUpdateSprite('group', parseInt(e.target.value) || 0)} />
                                                <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('group', (sffData.images[selectedSpriteIdx]?.group ?? 0) + 1)}>+</button>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[10px] text-gray-400">{t('studio.imageNo')}</span>
                                            <div className="flex bg-[#1e1e1e] border border-[#3a3a3a] items-center rounded overflow-hidden">
                                                <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('image', (sffData.images[selectedSpriteIdx]?.image ?? 0) - 1)}>-</button>
                                                <input type="number" className="bg-transparent w-full text-center outline-none text-xs" value={sffData.images[selectedSpriteIdx]?.image ?? 0} onChange={e => handleUpdateSprite('image', parseInt(e.target.value) || 0)} />
                                                <button className="text-blue-500 hover:bg-[#333] px-2 py-0.5" onClick={() => handleUpdateSprite('image', (sffData.images[selectedSpriteIdx]?.image ?? 0) + 1)}>+</button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Pivot axis settings */}
                                    <div className="text-[10px] font-semibold text-gray-400 border-b border-[#333] pb-1 mt-1">{t('studio.pivotOffset')}</div>
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
                                    <div className="text-[9px] text-gray-500 text-center italic pb-1">
                                        Drag the image on the canvas to adjust visually
                                    </div>

                                    {/* Auto-Crop & Pixel Transforms */}
                                    <div className="text-[10px] font-semibold text-gray-400 border-b border-[#333] pb-1">Sprite Pixel Transforms</div>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        <button
                                            type="button"
                                            onClick={handleAutoCropSprite}
                                            className="px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-700/60 rounded text-[10px] text-amber-300 font-semibold flex items-center justify-center gap-1"
                                            title="Trim transparent borders and preserve pivot alignment"
                                        >
                                            <Crop size={11} />
                                            <span>Crop</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleFlipSpritePixels('h')}
                                            className="px-2 py-1 bg-[#1e1e1e] hover:bg-[#333] border border-[#3a3a3a] rounded text-[10px] text-gray-200 font-semibold flex items-center justify-center gap-1"
                                            title="Flip sprite pixels horizontally"
                                        >
                                            <FlipHorizontal size={11} />
                                            <span>Flip H</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleFlipSpritePixels('v')}
                                            className="px-2 py-1 bg-[#1e1e1e] hover:bg-[#333] border border-[#3a3a3a] rounded text-[10px] text-gray-200 font-semibold flex items-center justify-center gap-1"
                                            title="Flip sprite pixels vertically"
                                        >
                                            <FlipVertical size={11} />
                                            <span>Flip V</span>
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between gap-1 bg-[#1a1a1a] border border-[#333] rounded px-2 py-1">
                                        <span className="text-[9px] text-gray-400 font-semibold">1px Nudge:</span>
                                        <div className="flex items-center gap-1">
                                            <button type="button" onClick={() => handleNudgeSpritePixels(-1, 0)} className="p-1 bg-[#2a2a2a] hover:bg-[#3a3a3a] rounded text-gray-200" title="Nudge Left 1px"><ArrowLeft size={10} /></button>
                                            <button type="button" onClick={() => handleNudgeSpritePixels(0, -1)} className="p-1 bg-[#2a2a2a] hover:bg-[#3a3a3a] rounded text-gray-200" title="Nudge Up 1px"><ArrowUp size={10} /></button>
                                            <button type="button" onClick={() => handleNudgeSpritePixels(0, 1)} className="p-1 bg-[#2a2a2a] hover:bg-[#3a3a3a] rounded text-gray-200" title="Nudge Down 1px"><ArrowDown size={10} /></button>
                                            <button type="button" onClick={() => handleNudgeSpritePixels(1, 0)} className="p-1 bg-[#2a2a2a] hover:bg-[#3a3a3a] rounded text-gray-200" title="Nudge Right 1px"><ArrowRight size={10} /></button>
                                        </div>
                                    </div>
                                </div>

                                 {/* Search and Gallery */}
                                 <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between border-b border-[#333] pb-1">
                                        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Sprite Library</span>
                                        <div className="flex gap-2">
                                            <button onClick={selectAllSprites} className="text-[9px] text-blue-400 hover:underline">All</button>
                                            <button onClick={deselectAllSprites} className="text-[9px] text-gray-500 hover:underline">None</button>
                                        </div>
                                    </div>
                                    <input 
                                        type="text"
                                        placeholder="Search by group index..."
                                        className="bg-[#2a2a2a] border border-[#3a3a3a] w-full px-2 py-1 outline-none text-gray-300 rounded text-xs"
                                        value={spriteSearch}
                                        onChange={e => setSpriteSearch(e.target.value)}
                                    />

                                    {/* Mini Sprite grid list */}
                                    <div className="h-48 overflow-y-auto border border-[#333] bg-[#1a1a1a] rounded p-1 flex flex-col gap-1 text-[11px]">
                                        {sffData.images.map((img, i) => {
                                            const searchMatches = spriteSearch === '' || img.group.toString().includes(spriteSearch);
                                            if (!searchMatches) return null;
                                            const isSelected = selectedSpriteIndices.has(i);
                                            return (
                                                <div 
                                                    key={i}
                                                    onClick={() => setSelectedSpriteIdx(i)}
                                                    className={`flex items-center justify-between p-1 rounded cursor-pointer hover:bg-[#333] group transition-all ${selectedSpriteIdx === i ? 'bg-blue-900/40 text-blue-400 text-bold border-l-2 border-blue-500' : 'text-gray-400'}`}
                                                >
                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                        <div 
                                                            onClick={(e) => { e.stopPropagation(); toggleSpriteSelection(i); }}
                                                            className={`w-3 h-3 border rounded-sm flex items-center justify-center transition-colors shrink-0 ${isSelected ? 'bg-blue-500 border-blue-400' : 'border-gray-600 bg-black/20 group-hover:border-gray-400'}`}
                                                        >
                                                            {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                                        </div>
                                                        <span className="truncate">SFF Image index {i}</span>
                                                        <span className="font-mono text-[10px] opacity-70 shrink-0">({img.group},{img.image})</span>
                                                    </div>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleExportSpritePng(i); }}
                                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-emerald-400 transition-opacity shrink-0"
                                                        title="Export as PNG"
                                                    >
                                                        <Download size={10} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {spriteSidebarTab === 'palettes' && (
                            <div className="flex flex-col gap-4">
                                {/* Palette Selector Header */}
                                <div className="flex flex-col gap-2 shrink-0">
                                    <button 
                                        onClick={() => paletteActInputRef.current?.click()}
                                        className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold text-[10px] flex items-center justify-center gap-1.5 shadow-md transition-all"
                                    >
                                        <Plus size={12} />
                                        Import .ACT Palette
                                    </button>
                                    <input type="file" ref={paletteActInputRef} className="hidden" accept=".act" onChange={handleImportPaletteFile} />
                                </div>

                                {/* Palette List */}
                                <div className="flex flex-col gap-2">
                                     <div className="flex items-center justify-between border-b border-[#333] pb-1">
                                         <span className="text-[10px] text-gray-400 font-semibold">Character Palettes:</span>
                                         <button 
                                            onClick={() => setShowPaletteOverlay(!showPaletteOverlay)}
                                            className={`text-[9px] font-bold px-2 py-0.5 rounded border transition-all ${showPaletteOverlay ? 'bg-purple-900/30 text-purple-400 border-purple-500/30' : 'bg-[#333] text-gray-500 border-[#444] hover:text-gray-300'}`}
                                         >
                                             {showPaletteOverlay ? 'HIDE OVERLAY' : 'SHOW OVERLAY'}
                                         </button>
                                     </div>
                                     <div className="h-48 overflow-y-auto border border-[#333] bg-[#1a1a1a] rounded p-1 flex flex-col gap-1 text-[11px]">
                                         {(sffData.palettes || []).map((pal, i) => (
                                             <div 
                                                 key={i}
                                                 onClick={() => setSelectedPaletteIdx(i)}
                                                 className={`flex items-center justify-between p-2 rounded cursor-pointer hover:bg-[#333] transition-all ${selectedPaletteIdx === i ? 'bg-purple-900/40 text-purple-400 font-bold border-l-2 border-purple-500' : 'text-gray-400'}`}
                                             >
                                                 <div className="flex items-center gap-2">
                                                     <Palette size={12} className={selectedPaletteIdx === i ? 'text-purple-400' : 'text-gray-600'} />
                                                     <span>{pal.group}, {pal.item}</span>
                                                 </div>
                                                 {selectedPaletteIdx === i && <span className="text-[8px] bg-purple-500 text-white px-1 rounded">ACTIVE</span>}
                                             </div>
                                         ))}
                                         {(!sffData.palettes || sffData.palettes.length === 0) && (
                                             <div className="p-4 text-center text-gray-500 italic text-[10px]">
                                                 No palettes detected in SFF. Import an .act file to begin.
                                             </div>
                                         )}
                                     </div>

                                     {/* Quick Palette Preset Switcher */}
                                     {sffData.palettes && sffData.palettes.length > 1 && (
                                         <div className="flex flex-wrap gap-1 pt-1">
                                             {sffData.palettes.map((pal, i) => (
                                                 <button
                                                     key={`pill-${i}`}
                                                     type="button"
                                                     onClick={() => setSelectedPaletteIdx(i)}
                                                     className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-colors ${selectedPaletteIdx === i ? 'bg-purple-600 text-white border-purple-400 font-bold' : 'bg-[#222] text-gray-400 border-[#3a3a3a] hover:text-white'}`}
                                                 >
                                                     Pal {pal.group},{pal.item}
                                                 </button>
                                             ))}
                                         </div>
                                     )}

                                     {/* FF3-style Palette Range HSL Editor */}
                                     <div className="bg-[#212121] border border-[#333] rounded p-2.5 flex flex-col gap-2 mt-1">
                                         <div className="text-[10px] font-bold text-purple-300 uppercase tracking-wide border-b border-[#333] pb-1">
                                             Palette Range HSL Shift
                                         </div>
                                         <div className="grid grid-cols-2 gap-2">
                                             <div className="flex flex-col gap-0.5">
                                                 <span className="text-[9px] text-gray-400">From Idx (1-255)</span>
                                                 <input
                                                     type="number"
                                                     min={1}
                                                     max={255}
                                                     value={palRangeFrom}
                                                     onChange={e => setPalRangeFrom(Math.max(1, Math.min(255, parseInt(e.target.value) || 1)))}
                                                     className="bg-[#141414] border border-[#3a3a3a] rounded px-1.5 py-0.5 text-[10px] font-mono text-center text-gray-200"
                                                 />
                                             </div>
                                             <div className="flex flex-col gap-0.5">
                                                 <span className="text-[9px] text-gray-400">To Idx (1-255)</span>
                                                 <input
                                                     type="number"
                                                     min={1}
                                                     max={255}
                                                     value={palRangeTo}
                                                     onChange={e => setPalRangeTo(Math.max(1, Math.min(255, parseInt(e.target.value) || 255)))}
                                                     className="bg-[#141414] border border-[#3a3a3a] rounded px-1.5 py-0.5 text-[10px] font-mono text-center text-gray-200"
                                                 />
                                             </div>
                                         </div>
                                         <div className="flex flex-col gap-1 text-[9px] text-gray-400">
                                             <label className="flex justify-between">
                                                 <span>Hue Shift</span>
                                                 <span className="font-mono text-purple-300">{palHue}°</span>
                                             </label>
                                             <input type="range" min={-180} max={180} value={palHue} onChange={e => setPalHue(parseInt(e.target.value, 10))} className="accent-purple-500 h-1.5" />
                                             <label className="flex justify-between">
                                                 <span>Saturation</span>
                                                 <span className="font-mono text-purple-300">{palSat > 0 ? `+${palSat}` : palSat}%</span>
                                             </label>
                                             <input type="range" min={-100} max={100} value={palSat} onChange={e => setPalSat(parseInt(e.target.value, 10))} className="accent-purple-500 h-1.5" />
                                             <label className="flex justify-between">
                                                 <span>Lightness</span>
                                                 <span className="font-mono text-purple-300">{palLight > 0 ? `+${palLight}` : palLight}%</span>
                                             </label>
                                             <input type="range" min={-100} max={100} value={palLight} onChange={e => setPalLight(parseInt(e.target.value, 10))} className="accent-purple-500 h-1.5" />
                                         </div>
                                         <button
                                             type="button"
                                             onClick={handleApplyPaletteRangeHsl}
                                             className="w-full py-1.5 bg-purple-700/80 hover:bg-purple-600 text-white rounded text-[10px] font-bold transition-colors"
                                         >
                                             Apply HSL Shift
                                         </button>
                                     </div>

                                     {/* Export current */}
                                     {((sffData.palettes && sffData.palettes[selectedPaletteIdx]) || actPalette) && (
                                         <button 
                                            onClick={() => {
                                                const pal = sffData?.palettes?.[selectedPaletteIdx]?.data || actPalette;
                                                if (!pal) return;
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
                                                const palMeta = sffData?.palettes?.[selectedPaletteIdx];
                                                const fileName = palMeta ? `pal_${palMeta.group}_${palMeta.item}.act` : 'palette_export.act';
                                                a.download = fileName;
                                                a.click();
                                            }}
                                            className="mt-2 w-full py-1.5 bg-[#222] border border-[#333] text-gray-300 rounded text-[9px] hover:bg-[#2a2a2a] flex items-center justify-center gap-2"
                                         >
                                             <Download size={11} />
                                             Export Current .ACT
                                         </button>
                                     )}
                                </div>
                            </div>
                        )}

                        {spriteSidebarTab === 'layers' && (
                            <div className="flex flex-col gap-4 animate-fadeIn">
                                {/* Layer Controls */}
                                <div className="flex flex-col gap-2 bg-[#1a1a1a] border border-[#333] rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Drawing Layers</span>
                                        <button
                                            onClick={() => {
                                                if (selectedSpriteIdx === null || !sffData) return;
                                                const sprite = sffData.images[selectedSpriteIdx];
                                                if (!sprite) return;
                                                const currentL = getSpriteLayers(selectedSpriteIdx, sprite);
                                                const newLayer: DrawingLayer = {
                                                    id: 'layer-' + Date.now(),
                                                    name: 'Layer ' + (currentL.length + 1),
                                                    visible: true,
                                                    pixelIndices: new Uint8Array(sprite.width * sprite.height)
                                                };
                                                const nextL = [...currentL, newLayer];
                                                updateLayersForSprite(selectedSpriteIdx, nextL);
                                                setActiveLayerIdMap(prev => ({ ...prev, [selectedSpriteIdx]: newLayer.id }));
                                                pushToHistory();
                                            }}
                                            className="px-2 py-1 bg-green-900/40 border border-green-700/80 text-green-400 font-mono text-[10px] font-bold flex items-center gap-1 hover:bg-green-900/60 rounded"
                                            title="Add New Layer"
                                        >
                                            <Plus size={10} /> Add Layer
                                        </button>
                                    </div>

                                    {/* Layers List (Top to Bottom rendering) */}
                                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                                        {(() => {
                                            if (selectedSpriteIdx === null) return <span className="text-[10px] text-gray-500">Select a sprite.</span>;
                                            const sprite = sffData?.images[selectedSpriteIdx];
                                            if (!sprite) return <span className="text-[10px] text-gray-500">No active sprite selected.</span>;
                                            const layers = getSpriteLayers(selectedSpriteIdx, sprite);
                                            const activeLayerId = getActiveLayerId(selectedSpriteIdx, layers);

                                            return [...layers].reverse().map((layer, reverseIdx) => {
                                                const actualIdx = layers.length - 1 - reverseIdx;
                                                const isActive = layer.id === activeLayerId;
                                                return (
                                                    <div
                                                        key={layer.id}
                                                        onClick={() => {
                                                            setActiveLayerIdMap(prev => ({ ...prev, [selectedSpriteIdx]: layer.id }));
                                                        }}
                                                        className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-[11px] font-mono border ${
                                                            isActive
                                                                ? 'bg-blue-950/40 border-blue-800/80 text-blue-300'
                                                                : 'bg-[#222] border-[#333] text-gray-400 hover:bg-[#2a2a2a]'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 truncate">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const nextL = [...layers];
                                                                    nextL[actualIdx] = { ...layer, visible: !layer.visible };
                                                                    updateLayersForSprite(selectedSpriteIdx, nextL);
                                                                    pushToHistory();
                                                                }}
                                                                className="text-gray-400 hover:text-white"
                                                                title={layer.visible ? "Hide" : "Show"}
                                                            >
                                                                <span className="font-sans text-xs">
                                                                    {layer.visible ? '👁️' : '❌'}
                                                                </span>
                                                            </button>
                                                            <span className="truncate font-semibold">{layer.name}</span>
                                                        </div>

                                                        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                                            {/* Merge Down */}
                                                            {actualIdx > 0 && (
                                                                <button
                                                                    onClick={() => {
                                                                        const prevLayer = layers[actualIdx - 1];
                                                                        const mergedIndices = new Uint8Array(prevLayer.pixelIndices);
                                                                        for (let i = 0; i < mergedIndices.length; i++) {
                                                                            if (layer.pixelIndices[i] !== 0) {
                                                                                mergedIndices[i] = layer.pixelIndices[i];
                                                                            }
                                                                        }
                                                                        const nextL = layers.filter((_, idx) => idx !== actualIdx);
                                                                        nextL[actualIdx - 1] = {
                                                                            ...prevLayer,
                                                                            pixelIndices: mergedIndices,
                                                                            name: prevLayer.name + ' (Merged)'
                                                                        };
                                                                        updateLayersForSprite(selectedSpriteIdx, nextL);
                                                                        setActiveLayerIdMap(prev => ({ ...prev, [selectedSpriteIdx]: prevLayer.id }));
                                                                        pushToHistory();
                                                                    }}
                                                                    className="px-1 py-0.5 bg-yellow-905/30 text-yellow-400 rounded border border-yellow-700/40 hover:bg-yellow-905/50 text-[9px] font-bold"
                                                                    title="Merge into layer below"
                                                                >
                                                                    Merge
                                                                </button>
                                                            )}
                                                            {/* Duplicate */}
                                                            <button
                                                                onClick={() => {
                                                                    const dupLayer: DrawingLayer = {
                                                                        id: 'layer-' + Date.now(),
                                                                        name: layer.name + ' Copy',
                                                                        visible: true,
                                                                        pixelIndices: new Uint8Array(layer.pixelIndices)
                                                                    };
                                                                    const nextL = [...layers];
                                                                    nextL.splice(actualIdx + 1, 0, dupLayer);
                                                                    updateLayersForSprite(selectedSpriteIdx, nextL);
                                                                    setActiveLayerIdMap(prev => ({ ...prev, [selectedSpriteIdx]: dupLayer.id }));
                                                                    pushToHistory();
                                                                }}
                                                                className="px-1 py-0.5 bg-blue-900/30 text-blue-400 rounded border border-blue-700/40 hover:bg-blue-900/50 text-[9px] font-bold"
                                                                title="Duplicate Layer"
                                                            >
                                                                Copy
                                                            </button>
                                                            {/* Delete */}
                                                            {layers.length > 1 && (
                                                                <button
                                                                    onClick={() => {
                                                                        if (!window.confirm(`Delete layer "${layer.name}"?`)) return;
                                                                        const nextL = layers.filter((_, idx) => idx !== actualIdx);
                                                                        const nextActiveId = nextL[Math.max(0, actualIdx - 1)].id;
                                                                        updateLayersForSprite(selectedSpriteIdx, nextL);
                                                                        setActiveLayerIdMap(prev => ({ ...prev, [selectedSpriteIdx]: nextActiveId }));
                                                                        pushToHistory();
                                                                    }}
                                                                    className="text-red-400 hover:text-red-300 p-0.5"
                                                                    title="Delete Layer"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>

                                {/* Object Selector & Copy-Paste Tool Box */}
                                <div className="flex flex-col gap-2.5 bg-[#1a1a1a] border border-[#333] rounded-lg p-3">
                                    <div className="flex items-center justify-between border-b border-[#333] pb-1.5 mb-1">
                                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Object Selector & Clipboard</span>
                                        {activeTool === 'select' && (
                                            <span className="text-[10px] text-blue-400 font-semibold animate-pulse">Select Active</span>
                                        )}
                                    </div>

                                    <p className="text-[10px] text-gray-400 leading-relaxed">
                                        Activate the <strong className="text-blue-400">Select Object Tool</strong> below, then click and drag a rectangle on the sprite canvas to select.
                                    </p>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setActiveTool('select')}
                                            className={`flex-1 px-3 py-1.5 border rounded text-[11px] font-bold text-center flex items-center justify-center gap-1.5 transition-colors ${
                                                activeTool === 'select'
                                                    ? 'bg-blue-900/40 border-blue-700/80 text-blue-400'
                                                    : 'bg-[#222] border-[#333] text-gray-300 hover:bg-[#2a2a2a]'
                                            }`}
                                        >
                                            <Square size={12} className={activeTool === 'select' ? "stroke-blue-400" : "stroke-gray-400"} />
                                            Use Select Tool
                                        </button>
                                        
                                        {selectionRect && (
                                            <button
                                                onClick={() => {
                                                    setSelectionRect(null);
                                                    setSelectionStartPos(null);
                                                }}
                                                className="px-2.5 py-1.5 bg-[#222] border border-[#333] hover:bg-[#2c2c2c] text-gray-400 hover:text-white rounded text-[11px]"
                                                title="Deselect"
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>

                                    <div className="bg-[#242424] rounded border border-[#333] p-2 flex flex-col gap-2 mt-1">
                                        <div className="flex justify-between items-center text-[10px] font-mono text-gray-400">
                                            <span>Selected Box:</span>
                                            <span className="text-blue-400 font-semibold">
                                                {selectionRect
                                                    ? `${selectionRect.w}x${selectionRect.h} @ (${selectionRect.x}, ${selectionRect.y})`
                                                    : 'No selection'}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={handleCopySelection}
                                                disabled={!selectionRect}
                                                className={`px-2 py-1 border rounded text-[11px] font-bold text-center flex items-center justify-center gap-1 transition-all ${
                                                    selectionRect
                                                        ? 'bg-blue-900/30 border-blue-800 text-blue-300 hover:bg-blue-900/50'
                                                        : 'bg-gray-800/10 border-gray-800 text-gray-600 cursor-not-allowed'
                                                }`}
                                                title="Copy object in selection to private clipboard (Ctrl+C)"
                                            >
                                                <Copy size={11} /> Copy Object
                                            </button>
                                            <button
                                                onClick={handlePasteSelection}
                                                disabled={!objectClipboard}
                                                className={`px-2 py-1 border rounded text-[11px] font-bold text-center flex items-center justify-center gap-1 transition-all ${
                                                    objectClipboard
                                                        ? 'bg-green-900/30 border-green-800 text-green-300 hover:bg-green-900/50 font-semibold'
                                                        : 'bg-gray-800/10 border-gray-800 text-gray-600 cursor-not-allowed'
                                                }`}
                                                title="Paste copied object onto current active layer (Ctrl+V)"
                                            >
                                                <Clipboard size={11} /> Paste Object
                                            </button>
                                        </div>
                                    </div>

                                    {pastedContent && pastedContent.active && (
                                        <div className="bg-[#1a2d21] border border-[#2d5c3f] rounded p-2.5 flex flex-col gap-2 animate-fadeIn mt-1">
                                            <div className="flex justify-between items-center text-[10px] text-green-400 font-bold uppercase font-mono">
                                                <span>🟢 Floating Paste Object</span>
                                                <span>{pastedContent.width}x{pastedContent.height}</span>
                                            </div>
                                            <p className="text-[10px] text-green-300 leading-normal">
                                                Drag the object with your mouse on the canvas, or use the nudge buttons below to position!
                                            </p>
                                            
                                            <div className="flex flex-col items-center gap-1">
                                                <button
                                                    onClick={() => setPastedContent(p => p ? { ...p, y: p.y - 1 } : null)}
                                                    className="w-8 h-6 bg-[#20402b] hover:bg-[#2a5439] border border-[#3e7d54] rounded text-emerald-300 text-xs font-bold font-mono"
                                                    title="Nudge Up or ArrowUp"
                                                >
                                                    &uarr;
                                                </button>
                                                <div className="flex gap-4">
                                                    <button
                                                        onClick={() => setPastedContent(p => p ? { ...p, x: p.x - 1 } : null)}
                                                        className="w-8 h-6 bg-[#20402b] hover:bg-[#2a5439] border border-[#3e7d54] rounded text-emerald-300 text-xs font-bold font-mono"
                                                        title="Nudge Left or ArrowLeft"
                                                    >
                                                        &larr;
                                                    </button>
                                                    <span className="text-[10px] text-emerald-400 font-mono flex items-center justify-center min-w-16 font-semibold bg-[#0f1d14] rounded px-1">
                                                        ({pastedContent.x}, {pastedContent.y})
                                                    </span>
                                                    <button
                                                        onClick={() => setPastedContent(p => p ? { ...p, x: p.x + 1 } : null)}
                                                        className="w-8 h-6 bg-[#20402b] hover:bg-[#2a5439] border border-[#3e7d54] rounded text-emerald-300 text-xs font-bold font-mono"
                                                        title="Nudge Right or ArrowRight"
                                                    >
                                                        &rarr;
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={() => setPastedContent(p => p ? { ...p, y: p.y + 1 } : null)}
                                                    className="w-8 h-6 bg-[#20402b] hover:bg-[#2a5439] border border-[#3e7d54] rounded text-emerald-300 text-xs font-bold font-mono"
                                                    title="Nudge Down or ArrowDown"
                                                >
                                                    &darr;
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 mt-1">
                                                <button
                                                    onClick={handleStampPasted}
                                                    className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-[11px] font-bold text-center border border-green-500 shadow-sm"
                                                    title="Commit pixels down onto active layer (Enter)"
                                                >
                                                    Stamp Down
                                                </button>
                                                <button
                                                    onClick={handleCancelPasted}
                                                    className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] text-center border border-gray-600"
                                                    title="Cancel Paste (Esc)"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeMode === 'Animations' && airData && (
                    <div className="flex flex-col gap-3">
                        {/* Action select header & FF3-style Act Name */}
                        <div className="bg-[#242424] p-2 border border-[#333] rounded flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-1">
                                <label className="text-[10px] text-gray-400 font-bold uppercase shrink-0">Act:</label>
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <button
                                        type="button"
                                        title="Previous Action"
                                        onClick={() => {
                                            const ids = Object.keys(airData.actions).map(Number).sort((a, b) => a - b);
                                            if (!ids.length) return;
                                            const idx = selectedActionId !== null ? ids.indexOf(selectedActionId) : 0;
                                            const prevIdx = idx > 0 ? idx - 1 : ids.length - 1;
                                            setIsPlaying(false);
                                            setSelectedActionId(ids[prevIdx]);
                                            setCurrentFrame(0);
                                        }}
                                        className="px-1.5 py-0.5 bg-[#1e1e1e] hover:bg-[#333] border border-[#3c3c3c] rounded text-[10px] text-gray-300 font-bold cursor-pointer shrink-0"
                                    >
                                        &lt;
                                    </button>
                                    <select 
                                        className="flex-1 min-w-0 bg-[#1e1e1e] border border-[#3c3c3c] text-xs outline-none px-1.5 py-0.5 rounded text-blue-400 font-mono truncate"
                                        value={selectedActionId ?? ''}
                                        onChange={e => {
                                            setIsPlaying(false);
                                            setSelectedActionId(parseInt(e.target.value));
                                            setCurrentFrame(0);
                                        }}
                                    >
                                        {Object.keys(airData.actions).sort((a,b)=>Number(a)-Number(b)).map(actId => {
                                            const actObj = airData.actions[Number(actId)];
                                            const actLabel = actObj?.name?.trim() ? `${actId} - ${actObj.name.trim()}` : `Action ${actId}`;
                                            return (
                                                <option key={actId} value={actId}>{actLabel}</option>
                                            );
                                        })}
                                    </select>
                                    <button
                                        type="button"
                                        title="Next Action"
                                        onClick={() => {
                                            const ids = Object.keys(airData.actions).map(Number).sort((a, b) => a - b);
                                            if (!ids.length) return;
                                            const idx = selectedActionId !== null ? ids.indexOf(selectedActionId) : -1;
                                            const nextIdx = idx < ids.length - 1 ? idx + 1 : 0;
                                            setIsPlaying(false);
                                            setSelectedActionId(ids[nextIdx]);
                                            setCurrentFrame(0);
                                        }}
                                        className="px-1.5 py-0.5 bg-[#1e1e1e] hover:bg-[#333] border border-[#3c3c3c] rounded text-[10px] text-gray-300 font-bold cursor-pointer shrink-0"
                                    >
                                        &gt;
                                    </button>
                                </div>
                            </div>
                            {selectedActionId !== null && airData.actions[selectedActionId] && (
                                <div className="flex items-center gap-1.5">
                                    <label className="text-[10px] text-gray-400 font-semibold shrink-0">Name:</label>
                                    <input
                                        type="text"
                                        value={airData.actions[selectedActionId].name || ''}
                                        onChange={e => handleRenameAnimAction(selectedActionId, e.target.value)}
                                        placeholder={getStandardMugenActionHint(selectedActionId)}
                                        className="flex-1 min-w-0 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-blue-500 text-xs px-2 py-0.5 rounded text-gray-200 outline-none placeholder:text-gray-600"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Add/Delete Action Sequence */}
                        <div className="bg-[#212121] p-2 border border-[#333] rounded flex flex-col gap-1.5">
                             <div className="text-[10px] text-gray-400 font-semibold">Sequence Actions Builder</div>
                             <div className="flex gap-1.5">
                                 <input 
                                     type="number"
                                     className="bg-[#1e1e1e] border border-[#3a3a3a] text-xs text-center w-14 px-1 py-0.5 rounded outline-none font-mono"
                                     value={newActionIdText}
                                     onChange={e => setNewActionIdText(e.target.value)}
                                     placeholder="ID"
                                     title="New Action Number"
                                 />
                                 <input 
                                     type="text"
                                     className="flex-1 min-w-0 bg-[#1e1e1e] border border-[#3a3a3a] focus:border-green-600 text-xs px-1.5 py-0.5 rounded outline-none text-gray-200 placeholder:text-gray-600"
                                     value={newActionNameText}
                                     onChange={e => setNewActionNameText(e.target.value)}
                                     placeholder="Act name (optional)"
                                     onKeyDown={e => {
                                         if (e.key === 'Enter') {
                                             handleAddAnimAction(parseInt(newActionIdText) || 0, newActionNameText);
                                         }
                                     }}
                                 />
                             </div>
                             <div className="flex gap-1.5">
                                 <button 
                                     onClick={() => handleAddAnimAction(parseInt(newActionIdText) || 0, newActionNameText)}
                                     className="flex-1 bg-green-900/40 border border-green-700/80 hover:bg-green-900/60 px-2 py-0.5 rounded text-[10px] font-bold text-green-400 cursor-pointer"
                                 >
                                      + Add Act
                                 </button>
                                 <button 
                                     onClick={() => selectedActionId !== null && handleDeleteAnimAction(selectedActionId)}
                                     className="bg-red-955/40 border border-red-800/80 hover:bg-red-955/60 px-2 py-0.5 rounded text-[10px] font-bold text-red-400 cursor-pointer"
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

                                <div className="flex flex-col gap-0.5 mt-1">
                                    <span className="text-[9px] text-gray-400">Transparency / Blending:</span>
                                    <select 
                                        className="bg-[#1a1a1a] border border-[#3a3a3a] text-xs p-1 rounded outline-none"
                                        value={airData.actions[selectedActionId].elements[currentFrame]?.color || ""}
                                        onChange={e => handleUpdateFrameField('color', e.target.value)}
                                    >
                                        <option value="">Opaque (Default)</option>
                                        <option value="A">Additive Alpha (A)</option>
                                        <option value="A1">Additive 50% (A1)</option>
                                        <option value="S">Subtractive (S)</option>
                                    </select>
                                </div>

                                {/* Frame Reorder, Loopstart & Batch Offset */}
                                <div className="grid grid-cols-2 gap-1.5 mt-1 pt-1.5 border-t border-[#333]">
                                    <button
                                        type="button"
                                        onClick={() => handleMoveFrameOrder(-1)}
                                        disabled={currentFrame <= 0}
                                        className="bg-[#1e1e1e] border border-[#3a3a3a] hover:bg-[#333] disabled:opacity-40 p-1 text-[9px] font-bold text-gray-200 rounded"
                                    >
                                        &larr; Move Left
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleMoveFrameOrder(1)}
                                        disabled={currentFrame >= airData.actions[selectedActionId].elements.length - 1}
                                        className="bg-[#1e1e1e] border border-[#3a3a3a] hover:bg-[#333] disabled:opacity-40 p-1 text-[9px] font-bold text-gray-200 rounded"
                                    >
                                        Move Right &rarr;
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleToggleLoopstart}
                                        className={`p-1 text-[9px] font-bold rounded border transition-colors ${
                                            airData.actions[selectedActionId].loopstartIndex === currentFrame
                                                ? 'bg-emerald-700/60 border-emerald-500 text-white'
                                                : 'bg-[#1e1e1e] border-[#3a3a3a] text-emerald-400 hover:bg-[#333]'
                                        }`}
                                    >
                                        {airData.actions[selectedActionId].loopstartIndex === currentFrame ? 'Loopstart ✓' : 'Set Loopstart'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleApplyOffsetToAllFrames}
                                        className="bg-indigo-950/50 border border-indigo-700/70 hover:bg-indigo-900/60 p-1 text-[9px] font-bold text-indigo-300 rounded"
                                        title="Copy this frame's X/Y offset to all frames in this action"
                                    >
                                        Offset to All
                                    </button>
                                </div>

                                {/* Frame Sequence Multipliers */}
                                <div className="grid grid-cols-3 gap-1 mt-1 pt-1.5 border-t border-[#333]">
                                     <button onClick={handleAddFrame} className="bg-blue-900/30 border border-blue-700/80 hover:bg-blue-900/50 p-1 text-[9px] font-bold text-blue-400 rounded">Add Frame</button>
                                     <button onClick={handleDuplicateFrame} className="bg-yellow-950/30 border border-yellow-800 hover:bg-yellow-950/50 p-1 text-[9px] font-bold text-yellow-500 rounded">Duplicate</button>
                                     <button onClick={handleDeleteFrame} className="bg-red-955/30 border border-red-800 hover:bg-red-955/50 p-1 text-[9px] font-bold text-red-500 rounded">Del Frame</button>
                                </div>
                            </div>
                        )}

                        {/* Collision Box (CLSN) Designer block */}
                        {selectedActionId !== null && airData.actions[selectedActionId] && (() => {
                            const activeAct = airData.actions[selectedActionId];
                            const activeEl = activeAct.elements[currentFrame];
                            const hasPerFrameOverride = Boolean(activeEl && (activeEl.clsn1 !== undefined || activeEl.clsn2 !== undefined));
                            const displayedClsn2 = clsnScope === 'frame' ? (activeEl?.clsn2 ?? []) : activeAct.clsn2;
                            const displayedClsn1 = clsnScope === 'frame' ? (activeEl?.clsn1 ?? []) : activeAct.clsn1;

                            return (
                            <div className="bg-[#242424] p-3 border border-[#333] rounded flex flex-col gap-2">
                                <div className="flex items-center justify-between border-b border-[#333] pb-1">
                                    <span className="text-[10px] text-gray-400 font-semibold">Collision Boxes Designer</span>
                                    {hasPerFrameOverride && (
                                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-700/50 font-bold">
                                            PER-FRAME
                                        </span>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-1 bg-[#181818] p-1 rounded border border-[#333]">
                                    <button
                                        type="button"
                                        onClick={() => setClsnScope('action')}
                                        className={`py-1 rounded text-[9px] font-bold transition-colors ${clsnScope === 'action' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        Action Default
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setClsnScope('frame')}
                                        className={`py-1 rounded text-[9px] font-bold transition-colors ${clsnScope === 'frame' ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        Frame #{currentFrame + 1}
                                    </button>
                                </div>
                                {clsnScope === 'frame' && hasPerFrameOverride && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAirData(prevAir => {
                                                if (!prevAir || selectedActionId === null) return prevAir;
                                                const act = prevAir.actions[selectedActionId];
                                                if (!act || !act.elements[currentFrame]) return prevAir;
                                                const nextElements = [...act.elements];
                                                const nextEl = { ...nextElements[currentFrame] };
                                                delete nextEl.clsn1;
                                                delete nextEl.clsn2;
                                                nextElements[currentFrame] = nextEl;
                                                const nextAir = { ...prevAir, actions: { ...prevAir.actions, [selectedActionId]: { ...act, elements: nextElements } } };
                                                syncAirRawText(nextAir);
                                                return nextAir;
                                            });
                                        }}
                                        className="w-full py-1 bg-[#1e1e1e] hover:bg-[#2c2c2c] border border-[#3a3a3a] rounded text-[9px] text-gray-300 font-semibold"
                                    >
                                        Clear Frame Override (Use Action Default)
                                    </button>
                                )}
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

                                <div className="max-h-56 overflow-y-auto border border-[#333] bg-[#1a1a1a] rounded p-1 text-[10px] mt-1 flex flex-col gap-2 font-mono">
                                    {/* Defensive Box rows */}
                                    {displayedClsn2.map((box, idx) => {
                                        const isSelected = selectedClsn?.type === 2 && selectedClsn?.id === box.id;
                                        const boxW = Math.abs(box.x2 - box.x1);
                                        const boxH = Math.abs(box.y2 - box.y1);
                                        return (
                                            <div 
                                                key={`c2-${idx}`} 
                                                onClick={() => setSelectedClsn({ type: 2, id: box.id })}
                                                className={`flex flex-col bg-blue-950/20 p-1.5 rounded border transition-all cursor-pointer ${
                                                    isSelected ? 'border-blue-500 shadow-md shadow-blue-500/20 bg-blue-900/30 ring-1 ring-blue-500/50' : 'border-blue-900/30 hover:border-blue-800'
                                                } gap-1.5`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-blue-400 font-bold flex items-center gap-1">
                                                        <span>🛡️ Defensive Box #{idx}</span>
                                                        {isSelected && <span className="text-[8px] bg-blue-500 text-white px-1 py-0.2 rounded font-sans font-semibold">SELECTED</span>}
                                                    </span>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteCollisionBox(2, box.id); }} 
                                                        className="text-red-500 hover:text-red-400 font-bold bg-[#222] px-1.5 rounded hover:bg-[#333] transition-colors"
                                                    >
                                                        DELETE
                                                    </button>
                                                </div>

                                                {/* Coordinates: X1, Y1, X2, Y2 */}
                                                <div className="grid grid-cols-2 gap-1.5" onClick={e => e.stopPropagation()}>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">X1 (Left)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.x1}
                                                            onChange={e => handleUpdateCollisionBox(2, box.id, 'x1', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">Y1 (Top)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.y1}
                                                            onChange={e => handleUpdateCollisionBox(2, box.id, 'y1', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">X2 (Right)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.x2}
                                                            onChange={e => handleUpdateCollisionBox(2, box.id, 'x2', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">Y2 (Bottom)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-blue-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.y2}
                                                            onChange={e => handleUpdateCollisionBox(2, box.id, 'y2', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Width alongside Height Resize Controls */}
                                                <div className="grid grid-cols-2 gap-1.5 pt-1 mt-0.5 border-t border-blue-900/30 bg-black/40 p-1.5 rounded" onClick={e => e.stopPropagation()}>
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center justify-between text-[8px] text-blue-300 font-bold">
                                                            <span>Width (W)</span>
                                                            <span className="font-mono text-gray-400">{boxW}px</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(2, box.id, 'w', Math.max(1, boxW - 5))}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-blue-400 rounded text-[9px] border border-[#444]"
                                                                title="Decrease width by 5px"
                                                            >-5</button>
                                                            <input 
                                                                type="number" 
                                                                className="w-full bg-black border border-blue-800/50 text-blue-300 px-1 py-0.5 text-[9px] rounded font-mono text-center focus:border-blue-400"
                                                                value={boxW}
                                                                min="1"
                                                                onChange={e => handleUpdateCollisionBox(2, box.id, 'w', Math.max(1, parseInt(e.target.value) || 1))}
                                                            />
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(2, box.id, 'w', boxW + 5)}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-blue-400 rounded text-[9px] border border-[#444]"
                                                                title="Increase width by 5px"
                                                            >+5</button>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center justify-between text-[8px] text-blue-300 font-bold">
                                                            <span>Height (H)</span>
                                                            <span className="font-mono text-gray-400">{boxH}px</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(2, box.id, 'h', Math.max(1, boxH - 5))}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-blue-400 rounded text-[9px] border border-[#444]"
                                                                title="Decrease height by 5px"
                                                            >-5</button>
                                                            <input 
                                                                type="number" 
                                                                className="w-full bg-black border border-blue-800/50 text-blue-300 px-1 py-0.5 text-[9px] rounded font-mono text-center focus:border-blue-400"
                                                                value={boxH}
                                                                min="1"
                                                                onChange={e => handleUpdateCollisionBox(2, box.id, 'h', Math.max(1, parseInt(e.target.value) || 1))}
                                                            />
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(2, box.id, 'h', boxH + 5)}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-blue-400 rounded text-[9px] border border-[#444]"
                                                                title="Increase height by 5px"
                                                            >+5</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Attack Box rows */}
                                    {displayedClsn1.map((box, idx) => {
                                        const isSelected = selectedClsn?.type === 1 && selectedClsn?.id === box.id;
                                        const boxW = Math.abs(box.x2 - box.x1);
                                        const boxH = Math.abs(box.y2 - box.y1);
                                        return (
                                            <div 
                                                key={`c1-${idx}`} 
                                                onClick={() => setSelectedClsn({ type: 1, id: box.id })}
                                                className={`flex flex-col bg-red-955/10 p-1.5 rounded border transition-all cursor-pointer ${
                                                    isSelected ? 'border-red-500 shadow-md shadow-red-500/20 bg-red-900/25 ring-1 ring-red-500/50' : 'border-red-900/30 hover:border-red-800'
                                                } gap-1.5`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-red-400 font-bold flex items-center gap-1">
                                                        <span>⚔️ Attack Box #{idx}</span>
                                                        {isSelected && <span className="text-[8px] bg-red-600 text-white px-1 py-0.2 rounded font-sans font-semibold">SELECTED</span>}
                                                    </span>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteCollisionBox(1, box.id); }} 
                                                        className="text-red-500 hover:text-red-400 font-bold bg-[#222] px-1.5 rounded hover:bg-[#333] transition-colors"
                                                    >
                                                        DELETE
                                                    </button>
                                                </div>

                                                {/* Coordinates: X1, Y1, X2, Y2 */}
                                                <div className="grid grid-cols-2 gap-1.5" onClick={e => e.stopPropagation()}>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">X1 (Left)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.x1}
                                                            onChange={e => handleUpdateCollisionBox(1, box.id, 'x1', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">Y1 (Top)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.y1}
                                                            onChange={e => handleUpdateCollisionBox(1, box.id, 'y1', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">X2 (Right)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.x2}
                                                            onChange={e => handleUpdateCollisionBox(1, box.id, 'x2', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] text-gray-500">Y2 (Bottom)</span>
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-black border border-[#333] text-red-400 px-1 py-0.5 text-[9px] rounded font-mono"
                                                            value={box.y2}
                                                            onChange={e => handleUpdateCollisionBox(1, box.id, 'y2', parseInt(e.target.value) || 0)}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Width alongside Height Resize Controls */}
                                                <div className="grid grid-cols-2 gap-1.5 pt-1 mt-0.5 border-t border-red-900/30 bg-black/40 p-1.5 rounded" onClick={e => e.stopPropagation()}>
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center justify-between text-[8px] text-red-300 font-bold">
                                                            <span>Width (W)</span>
                                                            <span className="font-mono text-gray-400">{boxW}px</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(1, box.id, 'w', Math.max(1, boxW - 5))}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-red-400 rounded text-[9px] border border-[#444]"
                                                                title="Decrease width by 5px"
                                                            >-5</button>
                                                            <input 
                                                                type="number" 
                                                                className="w-full bg-black border border-red-800/50 text-red-300 px-1 py-0.5 text-[9px] rounded font-mono text-center focus:border-red-400"
                                                                value={boxW}
                                                                min="1"
                                                                onChange={e => handleUpdateCollisionBox(1, box.id, 'w', Math.max(1, parseInt(e.target.value) || 1))}
                                                            />
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(1, box.id, 'w', boxW + 5)}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-red-400 rounded text-[9px] border border-[#444]"
                                                                title="Increase width by 5px"
                                                            >+5</button>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center justify-between text-[8px] text-red-300 font-bold">
                                                            <span>Height (H)</span>
                                                            <span className="font-mono text-gray-400">{boxH}px</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(1, box.id, 'h', Math.max(1, boxH - 5))}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-red-400 rounded text-[9px] border border-[#444]"
                                                                title="Decrease height by 5px"
                                                            >-5</button>
                                                            <input 
                                                                type="number" 
                                                                className="w-full bg-black border border-red-800/50 text-red-300 px-1 py-0.5 text-[9px] rounded font-mono text-center focus:border-red-400"
                                                                value={boxH}
                                                                min="1"
                                                                onChange={e => handleUpdateCollisionBox(1, box.id, 'h', Math.max(1, parseInt(e.target.value) || 1))}
                                                            />
                                                            <button 
                                                                type="button" 
                                                                onClick={() => handleUpdateCollisionBox(1, box.id, 'h', boxH + 5)}
                                                                className="px-1 py-0.5 bg-[#222] hover:bg-[#333] text-red-400 rounded text-[9px] border border-[#444]"
                                                                title="Increase height by 5px"
                                                            >+5</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {displayedClsn1.length === 0 && displayedClsn2.length === 0 && (
                                        <span className="text-gray-500 italic text-[9px] block text-center p-1">
                                            {clsnScope === 'frame' ? 'Inheriting Action Defaults (add box to override this frame)' : 'No custom boxes'}
                                        </span>
                                    )}
                                </div>
                            </div>
                            );
                        })()}
                    </div>
                )}

                {(activeMode === 'Commands' || activeMode === 'States') && activeParsedData && (
                    <div className="flex-1 overflow-y-auto">
                        <div className="text-gray-400 mb-2 font-bold px-1 uppercase text-[10px]">{activeMode} Explorer</div>
                        {Object.keys(activeParsedData).map((group, idx) => {
                            const occMatch = group.match(/\s*##(\d+)$/);
                            const targetOccurrence = occMatch ? parseInt(occMatch[1], 10) : 1;
                            const cleanGroup = stripIniSuffix(group);
                            const isCommandBlock = cleanGroup.toLowerCase() === 'command';
                            const isStateDef = cleanGroup.toLowerCase().startsWith('statedef');
                            const isStateBlock = cleanGroup.toLowerCase().startsWith('state ');
                            const sectionData = activeParsedData[group];
                            const cmdName = isCommandBlock ? getSectionKeyValue(sectionData, 'name') : '';
                            const cmdKeys = isCommandBlock ? getSectionKeyValue(sectionData, 'command') : '';
                            const displayGroup = isCommandBlock
                                ? (cmdName || `Command${targetOccurrence > 1 ? ` #${targetOccurrence}` : ''}`)
                                : group.replace(/\s*##\d+$/, (match) => {
                                    const num = match.trim().replace('##', '');
                                    return num !== '1' ? ` #${num}` : '';
                                });

                            return (
                                <div 
                                    key={idx} 
                                    onClick={() => {
                                        codeEditorRef.current?.jumpToHeader(cleanGroup, targetOccurrence);
                                    }}
                                    className={`flex items-center justify-between gap-1.5 px-1.5 py-1 hover:bg-[#333333] cursor-pointer rounded-sm ${isStateBlock ? 'pl-4' : ''}`}
                                    title={isCommandBlock && cmdKeys ? `${displayGroup}: ${cmdKeys}` : displayGroup}
                                >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        {isCommandBlock ? (
                                            <span className="text-[8px] font-mono uppercase px-1 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/50 shrink-0">CMD</span>
                                        ) : (
                                            <span className="text-gray-500 font-mono text-[9px] shrink-0">{'>'}</span>
                                        )}
                                        <span className={`truncate ${isStateDef ? 'text-blue-400 font-semibold' : isCommandBlock ? 'text-gray-200 font-mono' : 'text-gray-300'}`}>
                                            {displayGroup}
                                        </span>
                                    </div>
                                    {isCommandBlock && cmdKeys && (
                                        <span className="text-[9px] font-mono text-gray-500 truncate max-w-[85px] shrink-0">
                                            {cmdKeys}
                                        </span>
                                    )}
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

                {activeMode === 'Palettes' && sffData && (
                    <div className="flex flex-col gap-4">
                        <div className="text-xs font-semibold text-gray-400 border-b border-[#333333] pb-1 uppercase">Palette Manager</div>
                        
                        <div className="flex flex-col gap-2">
                            <button 
                                onClick={() => paletteActInputRef.current?.click()}
                                className="px-3 py-2 bg-blue-900/40 border border-blue-700/80 rounded hover:bg-blue-900/60 text-blue-400 font-bold text-center flex items-center justify-center gap-2"
                            >
                                <Plus size={14} />
                                Import Palette (.act)
                            </button>
                            <input 
                                type="file" 
                                ref={paletteActInputRef} 
                                onChange={handleImportPaletteFile} 
                                accept=".act" 
                                multiple
                                className="hidden" 
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className="text-[10px] text-gray-400 font-semibold uppercase">Included Palettes</div>
                            <div className="max-h-96 overflow-y-auto border border-[#333] bg-[#1a1a1a] rounded p-1 flex flex-col gap-1 text-[11px] custom-scrollbar">
                                {(sffData.palettes || []).map((pal, i) => (
                                    <div 
                                        key={i}
                                        onClick={() => setSelectedPaletteIdx(i)}
                                        className={`flex flex-col p-2 rounded border cursor-pointer transition-all ${selectedPaletteIdx === i ? 'bg-blue-900/30 border-blue-600/80' : 'bg-[#222] border-transparent hover:border-[#444]'}`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`font-bold font-mono ${selectedPaletteIdx === i ? 'text-blue-400' : 'text-gray-300'}`}>Pal No. {i + 1}</span>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeletePalette(i); }}
                                                className="text-red-500 hover:bg-red-955/20 p-1 rounded transition-colors"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-1">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[9px] text-gray-500 uppercase font-bold">Group</span>
                                                <input 
                                                    type="number"
                                                    value={pal.group}
                                                    onChange={(e) => handleUpdatePaletteMeta(i, 'group', parseInt(e.target.value) || 0)}
                                                    className="bg-[#111] border border-[#333] rounded px-1.5 py-1 text-[10px] outline-none text-blue-400 font-mono focus:border-blue-500"
                                                    onClick={e => e.stopPropagation()}
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[9px] text-gray-500 uppercase font-bold">Item No</span>
                                                <input 
                                                    type="number"
                                                    value={pal.item}
                                                    onChange={(e) => handleUpdatePaletteMeta(i, 'item', parseInt(e.target.value) || 0)}
                                                    className="bg-[#111] border border-[#333] rounded px-1.5 py-1 text-[10px] outline-none text-blue-400 font-mono focus:border-blue-500"
                                                    onClick={e => e.stopPropagation()}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {(!sffData.palettes || sffData.palettes.length === 0) && (
                                    <div className="text-center py-6 text-gray-500 italic text-[10px]">No internal palettes in SFF.</div>
                                )}
                            </div>
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
                            className={`p-1.5 rounded transition-colors ${activeTool === 'eraser' ? 'bg-amber-600 shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                            title="Eraser Tool (E) - Erase Pixels"
                        >
                            <Eraser size={16} />
                        </button>
                        <button 
                            onClick={() => setActiveTool('eyedropper')} 
                            className={`p-1.5 rounded transition-colors ${activeTool === 'eyedropper' ? 'bg-cyan-600 shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                            title="Eyedropper Tool (I) - Pick Color Index"
                        >
                            <Pipette size={16} />
                        </button>
                        <button 
                            onClick={() => setActiveTool('select')} 
                            className={`p-1.5 rounded transition-colors ${activeTool === 'select' ? 'bg-blue-600 shadow-inner text-white' : 'text-gray-400 hover:bg-[#333]'}`}
                            title="Select Rectangle Area (Ctrl+C to Copy)"
                        >
                            <Square size={16} />
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
         <div ref={renderAreaRef} className={`flex-1 min-h-0 overflow-hidden flex-col relative bg-[#333333] ${mobileTab === 'center' ? 'flex' : 'hidden md:flex'}`}>
             {/* Text Editor Layout */}
             {(activeMode === 'Definitions' || activeMode === 'Commands' || activeMode === 'States') && (
                  <div className="flex-1 min-h-0 bg-[#1e1e1e] flex flex-col font-mono text-[11px] overflow-hidden">
                      {activeText !== null ? (
                         <div className="flex flex-1 min-h-0 overflow-hidden relative flex-col">
                             <div className="bg-[#151515] flex items-center border-b border-[#2b2b2b] shrink-0">
                                  {activeMode === 'States' && (
                                    <div className="flex flex-1 overflow-x-auto scrollbar-hide">
                                      {stFiles.map(file => (
                                        <div 
                                          key={file.id}
                                          onClick={() => setActiveStFileId(file.id)}
                                          className={`px-3 py-2 border-r border-[#2b2b2b] cursor-pointer flex items-center gap-2 group transition-colors shrink-0 ${activeStFileId === file.id ? 'bg-[#1e1e1e] text-blue-400' : 'text-gray-400 hover:text-gray-300 hover:bg-[#222]'}`}
                                        >
                                          <FileTextIcon size={12} className={activeStFileId === file.id ? 'text-blue-500' : 'text-gray-500'} />
                                          <input 
                                            className="bg-transparent border-none outline-none max-w-[120px] truncate cursor-pointer focus:bg-[#333] px-1 rounded"
                                            value={file.filename}
                                            onChange={(e) => {
                                              setStFiles(prev => prev.map(f => f.id === file.id ? { ...f, filename: e.target.value } : f));
                                            }}
                                            onClick={(e) => {
                                              if (activeStFileId === file.id) e.stopPropagation();
                                            }}
                                          />
                                          {stFiles.length > 1 && (
                                            <Trash2 
                                              size={10} 
                                              className="opacity-0 group-hover:opacity-100 hover:text-red-500 ml-1 transition-opacity shrink-0" 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (window.confirm(`Remove ${file.filename}?`)) {
                                                  const next = stFiles.filter(f => f.id !== file.id);
                                                  setStFiles(next);
                                                  if (activeStFileId === file.id && next.length > 0) setActiveStFileId(next[0].id);
                                                }
                                              }}
                                            />
                                          )}
                                        </div>
                                      ))}
                                      <button 
                                        onClick={() => handleCreateNew()}
                                        className="px-3 py-2 text-gray-500 hover:text-blue-400 border-r border-[#2b2b2b] transition-colors shrink-0"
                                        title="Add New Empty State File"
                                      >
                                        <Plus size={14} />
                                      </button>
                                      <button 
                                        onClick={() => handleImportMoreFiles()}
                                        className="px-3 py-2 text-gray-500 hover:text-green-400 transition-colors shrink-0"
                                        title="Import / Load Existing .CNS or .ST Files"
                                      >
                                        <Upload size={14} />
                                      </button>
                                    </div>
                                  )}
                                  {activeMode === 'Commands' && (
                                    <div className="flex flex-1 overflow-x-auto scrollbar-hide">
                                      {cmdFiles.map(file => (
                                        <div 
                                          key={file.id}
                                          onClick={() => setActiveCmdFileId(file.id)}
                                          className={`px-3 py-2 border-r border-[#2b2b2b] cursor-pointer flex items-center gap-2 group transition-colors shrink-0 ${activeCmdFileId === file.id ? 'bg-[#1e1e1e] text-blue-400' : 'text-gray-400 hover:text-gray-300 hover:bg-[#222]'}`}
                                        >
                                          <FileTextIcon size={12} className={activeCmdFileId === file.id ? 'text-blue-500' : 'text-gray-500'} />
                                          <input 
                                            className="bg-transparent border-none outline-none max-w-[120px] truncate cursor-pointer focus:bg-[#333] px-1 rounded"
                                            value={file.filename}
                                            onChange={(e) => {
                                              setCmdFiles(prev => prev.map(f => f.id === file.id ? { ...f, filename: e.target.value } : f));
                                            }}
                                            onClick={(e) => {
                                              if (activeCmdFileId === file.id) e.stopPropagation();
                                            }}
                                          />
                                          {cmdFiles.length > 1 && (
                                            <Trash2 
                                              size={10} 
                                              className="opacity-0 group-hover:opacity-100 hover:text-red-500 ml-1 transition-opacity shrink-0" 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (window.confirm(`Remove ${file.filename}?`)) {
                                                  const next = cmdFiles.filter(f => f.id !== file.id);
                                                  setCmdFiles(next);
                                                  if (activeCmdFileId === file.id && next.length > 0) setActiveCmdFileId(next[0].id);
                                                }
                                              }}
                                            />
                                          )}
                                        </div>
                                      ))}
                                      <button 
                                        onClick={() => handleCreateNew()}
                                        className="px-3 py-2 text-gray-500 hover:text-blue-400 border-r border-[#2b2b2b] transition-colors shrink-0"
                                        title="Add New Empty Command File"
                                      >
                                        <Plus size={14} />
                                      </button>
                                      <button 
                                        onClick={() => handleImportMoreFiles()}
                                        className="px-3 py-2 text-gray-500 hover:text-green-400 transition-colors shrink-0"
                                        title="Import / Load Existing .CMD Files"
                                      >
                                        <Upload size={14} />
                                      </button>
                                    </div>
                                  )}
                                  {activeMode === 'Definitions' && (
                                    <div className="px-4 py-2 border-r border-[#2b2b2b] bg-[#1e1e1e] text-zinc-300">
                                      character.def
                                    </div>
                                  )}
                                  <div className="ml-auto px-4 py-1.5 text-[10px] text-gray-500 font-sans hidden sm:block shrink-0">
                                     <span className="text-blue-500">Dual Sync Form Mode</span>
                                  </div>
                             </div>
                             <MugenCodeEditor
                                 ref={codeEditorRef}
                                 value={activeText || ''}
                                 onChange={(val) => setActiveText?.(val)}
                                 mode={activeMode as 'Definitions' | 'Commands' | 'States'}
                                 issues={issues}
                                 fileId={activeMode === 'States' ? activeStFileId : activeMode === 'Commands' ? activeCmdFileId : 'def'}
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
                                  
                                  {/* Real Decoded Audio Waveform Visualizer */}
                                  <SoundWaveform
                                      sound={activeSound}
                                      isPlaying={playingSoundId === activeSound.id}
                                  />
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

                    {/* Overlay info tooltip */}
                    <div className="absolute top-7 left-10 bg-[#151515]/95 border border-[#444] px-3 py-1.5 rounded shadow-lg text-[10px] text-gray-300 pointer-events-none flex flex-col gap-0.5 z-50">
                        <span className="font-bold text-blue-400">
                            {activeMode === 'Sprites' && activeTool === 'eraser'
                                ? '🧹 Interactive Pixel Eraser'
                                : activeMode === 'Sprites' && activeTool !== 'move'
                                ? '🖌️ Interactive Pixel Drawing'
                                : '💡 Interactive Canvas Pivot Calibration'}
                        </span>
                        <span>
                            {activeMode === 'Sprites' && activeTool === 'eraser'
                                ? 'Click and drag on the sprite to erase pixels back to transparent background (Color Index 0).'
                                : activeMode === 'Sprites' && activeTool !== 'move' 
                                ? 'Click on the sprite to paint pixels using the active palette color. Index 0 is transparent.' 
                                : 'Click and drag the sprite image with your mouse on the stage wrapper to adjust pivot alignment offsets seamlessly in real time!'}
                        </span>
                    </div>

                    {/* Floating brush & eraser size settings card */}
                    {activeMode === 'Sprites' && (activeTool === 'paint' || activeTool === 'eraser') && (
                        <div className="absolute bottom-6 right-6 bg-[#1a1a1a]/95 border border-[#444] rounded-lg p-3 shadow-2xl z-20 flex flex-col gap-2 w-52 text-gray-300" onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 font-bold text-xs">
                                    {activeTool === 'eraser' ? <Eraser size={14} className="text-amber-400" /> : <Pen size={14} className="text-blue-400" />}
                                    <span className="text-gray-200">{activeTool === 'eraser' ? 'Eraser Tool' : 'Brush Settings'}</span>
                                </div>
                                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border ${activeTool === 'eraser' ? 'bg-amber-600/30 text-amber-400 border-amber-500/20' : 'bg-blue-600/30 text-blue-400 border-blue-500/20'}`}>
                                    {brushSize}px
                                </span>
                            </div>

                            {/* Quick tool switcher between Pen and Eraser */}
                            <div className="flex gap-1 bg-[#111] p-0.5 rounded border border-[#333]">
                                <button
                                    onClick={() => setActiveTool('paint')}
                                    className={`flex-1 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-all ${
                                        activeTool === 'paint' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
                                    }`}
                                >
                                    <Pen size={10} /> Pen (B)
                                </button>
                                <button
                                    onClick={() => setActiveTool('eraser')}
                                    className={`flex-1 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-all ${
                                        activeTool === 'eraser' ? 'bg-amber-600 text-white shadow' : 'text-gray-400 hover:text-white'
                                    }`}
                                >
                                    <Eraser size={10} /> Eraser (E)
                                </button>
                            </div>

                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[9px] text-gray-400">
                                    <span>Size:</span>
                                    <span className="font-mono text-gray-300">{brushSize}px</span>
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
                            </div>
                            <div className="flex gap-1 justify-between pt-1 border-t border-[#333]">
                                {[1, 2, 3, 5, 8, 12].map(sz => (
                                    <button
                                        key={sz}
                                        onClick={() => setBrushSize(sz)}
                                        className={`flex-1 text-[9px] py-1 rounded border transition-all ${brushSize === sz ? (activeTool === 'eraser' ? 'bg-amber-600 text-white border-amber-500 font-bold' : 'bg-blue-600 text-white border-blue-500 font-bold') : 'bg-[#333] hover:bg-[#444] border-[#444] text-gray-400'}`}
                                    >
                                        {sz}px
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Interactive Palette Overlay (Floating Viewer) */}
                    {activeMode === 'Sprites' && showPaletteOverlay && (
                        <motion.div 
                            drag
                            dragConstraints={renderAreaRef}
                            dragMomentum={false}
                            dragElastic={0}
                            initial={{ x: 0, y: 0 }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="absolute bottom-6 left-10 bg-[#151515]/95 border border-[#444] rounded-xl p-4 shadow-2xl z-30 flex flex-col gap-3 min-w-[240px] select-none cursor-default"
                            style={{ touchAction: 'none' }}
                        >
                            {(() => {
                                const sprite = sffData?.images[selectedSpriteIdx];
                                
                                // Hierarchy: Selection > First SFF Pal > loaded ACT > Sprite Local
                                const selectionPal = sffData?.palettes?.[selectedPaletteIdx];
                                const firstSffPal = sffData?.palettes && sffData.palettes.length > 0 ? sffData.palettes[0] : null;
                                
                                // Source identification
                                let palSource = "External/Default";
                                if (selectionPal) palSource = `Selected (${selectionPal.group},${selectionPal.item})`;
                                else if (firstSffPal) palSource = `First SFF (${firstSffPal.group},${firstSffPal.item})`;
                                else if (actPalette) palSource = "Loaded .ACT";
                                else if (sprite?.palette) palSource = `Sprite ${sprite.group},${sprite.image}`;

                                const effectivePalette = selectionPal?.data || firstSffPal?.data || actPalette || sprite?.palette;
                                
                                const isPortraitSpecial = sprite?.group >= 9000 || sprite?.isSharedPalette === false;
                                
                                return (
                                    <>
                                        <div className="flex items-center justify-between border-b border-[#333] pb-2 cursor-move group">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1 bg-purple-900/20 rounded group-hover:bg-purple-900/40 transition-colors">
                                                    <Palette size={14} className="text-purple-400" />
                                                </div>
                                                <span className="text-[10px] font-bold text-gray-200 uppercase tracking-wider">Palette Viewer</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[9px] font-mono bg-purple-900/10 px-2 rounded border border-purple-500/10 text-purple-400">
                                                {palSource}
                                            </div>
                                        </div>
                                        
                                        <div 
                                            className="bg-[#0c0c0c] p-2 rounded-lg border border-[#222]"
                                            onPointerDown={e => e.stopPropagation()}
                                        >
                                            <PaletteRenderer 
                                                act={effectivePalette} 
                                                selectedColorIdx={selectedPalColorIdx}
                                                onColorClick={(idx) => setSelectedPalColorIdx(idx)}
                                            />
                                        </div>

                                        <div className="flex justify-between items-center px-1" onPointerDown={e => e.stopPropagation()}>
                                            <div className="flex flex-col">
                                                <span className="text-[8px] text-gray-500 uppercase font-bold tracking-tighter">Selected Index</span>
                                                <span className="text-sm font-mono text-blue-400 font-bold leading-none">{selectedPalColorIdx ?? 0}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {sprite?.palette && (
                                                    <button 
                                                        onClick={() => {
                                                            if (!sffData || !sprite.palette) return;
                                                            const confirm = window.confirm("Use THIS sprite's local palette as the new master palette for the entire SFF? All other palettes will be deleted.");
                                                            if (!confirm) return;

                                                            const targetPaletteData = new Uint8Array(sprite.palette);

                                                            const updatedImages = sffData.images.map((img, idx) => {
                                                                const isPortrait = img.group >= 9000;
                                                                return {
                                                                    ...img,
                                                                    // Use target palette for character sprites, 
                                                                    palette: (idx === 0 || !isPortrait) ? targetPaletteData : (img.palette || targetPaletteData),
                                                                    isSharedPalette: (idx === 0 || isPortrait) ? false : true
                                                                };
                                                            });

                                                            const unifiedPalettes = [{
                                                                group: 1,
                                                                item: 1,
                                                                data: targetPaletteData
                                                            }];

                                                            setSffData({
                                                                ...sffData,
                                                                images: updatedImages,
                                                                palettes: unifiedPalettes
                                                            });
                                                            setActPalette(new Uint8Array(targetPaletteData));
                                                            setSelectedPaletteIdx(0);
                                                        }}
                                                        className="p-1 px-2 bg-blue-900/30 border border-blue-500/30 hover:bg-blue-900/50 rounded text-[9px] text-blue-200 flex items-center gap-1 transition-all"
                                                        title="Set this specific sprite's palette as master"
                                                    >
                                                        <Zap size={10} />
                                                        Use Sprite Pal
                                                    </button>
                                                )}
                                                <button 
                                                    onClick={() => {
                                                        if (!sffData) return;
                                                        const confirm = window.confirm("This will apply the current ACTIVE palette (the one you see right now) to ALL sprites and delete all other palettes from the SFF. Proceed?");
                                                        if (!confirm) return;

                                                        const targetPaletteData = new Uint8Array(effectivePalette);

                                                        const updatedImages = sffData.images.map((img, idx) => {
                                                            return {
                                                                ...img,
                                                                palette: (idx === 0) ? targetPaletteData : undefined,
                                                                isSharedPalette: (idx === 0) ? false : true
                                                            };
                                                        });

                                                        const unifiedPalettes = [{
                                                            group: 1,
                                                            item: 1,
                                                            data: targetPaletteData
                                                        }];

                                                        setSffData({
                                                            ...sffData,
                                                            images: updatedImages,
                                                            palettes: unifiedPalettes
                                                        });
                                                        setActPalette(new Uint8Array(targetPaletteData));
                                                        setSelectedPaletteIdx(0);
                                                    }}
                                                    className="p-1 px-2 bg-purple-900/30 border border-purple-500/30 hover:bg-purple-900/50 rounded text-[9px] text-purple-200 flex items-center gap-1 transition-all"
                                                    title="Apply currently visible palette to all sprites and remove others"
                                                >
                                                    <Zap size={10} />
                                                    Unify SFF
                                                </button>
                                                <button 
                                                    onClick={handleFlipActivePalette}
                                                    className="p-1 px-2 bg-amber-900/30 border border-amber-500/30 hover:bg-amber-900/50 rounded text-[9px] text-amber-200 flex items-center gap-1 transition-all"
                                                    title="Flip upside-down palette order (0↔255)"
                                                >
                                                    <FlipVertical size={10} />
                                                    Flip 0↔255
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        const pal = effectivePalette;
                                                        if (!pal) return;
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
                                                        
                                                        // Filename logic
                                                        let fileName = 'palette_export.act';
                                                        if (selectionPal) {
                                                            fileName = `pal_${selectionPal.group}_${selectionPal.item}_select.act`;
                                                        } else if (firstSffPal) {
                                                            fileName = `pal_${firstSffPal.group}_${firstSffPal.item}_first.act`;
                                                        } else if (isPortraitSpecial) {
                                                            fileName = `pal_${sprite?.group}_${sprite?.image}.act`;
                                                        }
                                                        
                                                        a.download = fileName;
                                                        a.click();
                                                    }}
                                                    className="p-1 px-2 bg-[#222] border border-[#333] hover:bg-[#2a2a2a] rounded text-[9px] text-gray-400 flex items-center gap-1 transition-all"
                                                >
                                                    <Download size={10} />
                                                    Export .act
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                        </motion.div>
                    )}

                    {sffData ? (
                        activeMode === 'Sprites' ? (() => {
                            const sprite = sffData.images[selectedSpriteIdx];
                            
                            // Hierarchy: 
                            // 1. If sprite has its own private palette, use it.
                            // 2. Otherwise: Selection > First > External
                            const selectionPal = sffData.palettes ? sffData.palettes[selectedPaletteIdx] : null;
                            const firstSffPal = (sffData.palettes && sffData.palettes.length > 0) ? sffData.palettes[0] : null;
                            
                            let effectivePalette = actPalette || sprite?.palette || firstSffPal?.data;

                            if (sprite && sprite.isSharedPalette === false && sprite.palette) {
                                effectivePalette = sprite.palette;
                            } else {
                                effectivePalette = selectionPal?.data || firstSffPal?.data || actPalette || sprite?.palette;
                            }
                            
                            return (
                                <FF3SpriteRenderer 
                                    sprite={sprite} 
                                    act={effectivePalette} 
                                    zoom={zoom}
                                    showAxis={showAxis}
                                    pan={pan}
                                    previewOffset={previewOffset}
                                    selectionRect={selectionRect}
                                    pastedContent={pastedContent}
                                />
                            );
                        })() : (
                            <AnimationStage 
                                sff={sffData} 
                                act={(sffData.palettes && sffData.palettes[selectedPaletteIdx]) ? sffData.palettes[selectedPaletteIdx].data : (sffData.palettes && sffData.palettes[0]) ? sffData.palettes[0].data : actPalette} 
                                action={selectedActionId !== null ? airData?.actions[selectedActionId] : null} 
                                frameIndex={currentFrame}
                                zoom={zoom}
                                showClsn={showClsn}
                                showAxis={showAxis}
                                showOnionSkin={showOnionSkin}
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

                    {/* Tool panel right overlay - MOVED HERE TO BE ON TOP */}
                    <div className="absolute top-6 right-6 flex flex-col gap-1.5 z-50" onMouseDown={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
                        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(10, z + 0.5)); }} title="Zoom In" className="w-7 h-7 bg-[#3a3a3a] border border-[#111111] flex items-center justify-center hover:bg-[#555] rounded text-gray-300 shadow-lg cursor-pointer"><ZoomIn size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.25, z - 0.5)); }} title="Zoom Out" className="w-7 h-7 bg-[#3a3a3a] border border-[#111111] flex items-center justify-center hover:bg-[#555] rounded text-gray-300 shadow-lg cursor-pointer"><ZoomOut size={14} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setShowAxis(a => !a); }} title="Toggle Axis Grid" className={`w-7 h-7 border border-[#111111] flex items-center justify-center hover:bg-[#555] rounded shadow-lg cursor-pointer ${showAxis ? 'bg-blue-600 text-white' : 'bg-[#3a3a3a] text-gray-300'}`}><Plus size={14} /></button>
                        {activeMode === 'Animations' && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowOnionSkin(o => !o); }}
                                title="Toggle Onion Skinning (Previous Frame Ghost)"
                                className={`w-7 h-7 border border-[#111111] flex items-center justify-center hover:bg-[#555] rounded shadow-lg cursor-pointer ${showOnionSkin ? 'bg-amber-600 text-white' : 'bg-[#3a3a3a] text-gray-300'}`}
                            >
                                <Layers size={14} />
                            </button>
                        )}
                    </div>
                </div>
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
                                            const isLoopStart = action && action.loopstartIndex === idx;
                                            const duration = elem.time;
                                            const effClsn1 = elem.clsn1 ?? action?.clsn1 ?? [];
                                            const effClsn2 = elem.clsn2 ?? action?.clsn2 ?? [];
                                            const hasClsn1 = effClsn1.length > 0;
                                            const hasClsn2 = effClsn2.length > 0;
                                            
                                            return (
                                                <div 
                                                    key={idx}
                                                    onClick={() => { setIsPlaying(false); setCurrentFrame(idx); }}
                                                    className={`w-24 flex-shrink-0 cursor-pointer p-1.5 rounded border text-left flex flex-col justify-between h-[56px] transition-all select-none ${isActive ? 'bg-blue-950/40 border-blue-500 text-white shadow font-bold' : 'bg-[#121212] border-[#2c2c2c] text-zinc-400 hover:border-zinc-500'}`}
                                                >
                                                    <div className="flex justify-between items-center text-[9px] gap-1">
                                                        <span className={isActive ? "text-blue-300 font-bold" : "text-zinc-500"}>#{idx + 1}</span>
                                                        {isLoopStart && (
                                                            <span className="text-[7px] font-bold px-1 rounded bg-emerald-700/80 text-white" title="Loopstart Marker">LOOP</span>
                                                        )}
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
                                act={sffData?.palettes?.[selectedPaletteIdx]?.data || actPalette || sffData?.images[selectedSpriteIdx]?.palette} 
                                selectedColorIdx={selectedPalColorIdx}
                                onColorClick={(idx) => setSelectedPalColorIdx(idx)}
                            />

                            {selectedPalColorIdx !== null && (sffData?.palettes?.[selectedPaletteIdx]?.data || actPalette || sffData?.images[selectedSpriteIdx]?.palette) && (
                                <div className="bg-[#242424] p-3 border border-[#3a3a3a] rounded flex flex-col gap-2.5 mt-2 shadow-md">
                                    <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wide border-b border-[#333] pb-1 flex justify-between">
                                        <span>Color Index: #{selectedPalColorIdx}</span>
                                        <span className="font-mono text-gray-500">HEX: {colorIndexToHex(sffData?.palettes?.[selectedPaletteIdx]?.data || actPalette || sffData?.images[selectedSpriteIdx]?.palette, selectedPalColorIdx)}</span>
                                    </div>

                                    {/* Color Picker */}
                                    <input
                                        type="color"
                                        value={colorIndexToHex(sffData?.palettes?.[selectedPaletteIdx]?.data || actPalette || sffData?.images[selectedSpriteIdx]?.palette, selectedPalColorIdx)}
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
                                    onClick={() => paletteActInputRef.current?.click()}
                                    className="p-1 px-2.5 bg-[#2a2a2a] border border-[#3a3a3a] hover:bg-[#333] rounded text-[10px] text-gray-300 font-bold flex items-center justify-center gap-1.5"
                                    title="Load .ACT binary file from disk"
                                >
                                    <FolderOpen size={11} />
                                    Load ACT
                                </button>
                                <button
                                    onClick={handleFlipActivePalette}
                                    className="col-span-2 p-1.5 px-2.5 bg-amber-950/30 border border-amber-700/60 hover:bg-amber-900/40 rounded text-[10px] text-amber-300 font-bold flex items-center justify-center gap-1.5"
                                    title="Flip upside-down palette indices (0↔255) if character appears completely black"
                                >
                                    <FlipVertical size={11} />
                                    Flip Upside-Down Palette (0↔255)
                                </button>
                            </div>
                        </div>
                    </>
                )}
                {activeMode === 'Animations' && (
                    <>
                        <div className="bg-[#111111] text-white font-bold py-2 px-3 text-center border-b border-[#333333] uppercase text-[10px] tracking-wider">
                            Visual Sprite Picker
                        </div>
                        <div className="px-2 pt-2 pb-1 border-b border-[#2b2b2b] bg-[#1a1a1a]">
                            <input
                                type="text"
                                value={pickerSearch}
                                onChange={e => setPickerSearch(e.target.value)}
                                placeholder="Filter group, image (e.g. 0,0)..."
                                className="w-full bg-[#121212] border border-[#333333] focus:border-blue-500 rounded px-2 py-1 text-[10px] text-gray-200 outline-none font-mono placeholder:text-gray-600"
                            />
                        </div>
                        <div className="flex-1 p-2 overflow-y-auto flex flex-col gap-2">
                           <div className="text-[9px] text-gray-400 italic leading-snug px-1 border-l-2 border-[#555]">
                               Clicking any sprite below assigns its (group, image) to the active animation frame.
                           </div>
                           
                           {sffData ? (() => {
                               const activeEl = selectedActionId !== null ? airData?.actions[selectedActionId]?.elements[currentFrame] : null;
                               const selectionPal = sffData.palettes ? sffData.palettes[selectedPaletteIdx] : null;
                               const firstSffPal = (sffData.palettes && sffData.palettes.length > 0) ? sffData.palettes[0] : null;
                               const q = pickerSearch.trim().toLowerCase();
                               const filteredImages = sffData.images.filter(img => {
                                   if (!q) return true;
                                   const pair = `${img.group},${img.image}`;
                                   const pairSpaced = `${img.group}, ${img.image}`;
                                   return (
                                       String(img.group).includes(q) ||
                                       String(img.image).includes(q) ||
                                       pair.includes(q) ||
                                       pairSpaced.includes(q)
                                   );
                               });

                               if (filteredImages.length === 0) {
                                   return (
                                       <div className="text-gray-500 italic text-center p-4 text-[10px]">
                                           No sprites match &quot;{pickerSearch}&quot;
                                       </div>
                                   );
                               }

                               return (
                                   <div className="grid grid-cols-3 gap-1.5">
                                        {filteredImages.map((img, i) => {
                                            const effectivePalette = (img.isSharedPalette === false && img.palette)
                                                ? img.palette
                                                : (selectionPal?.data || firstSffPal?.data || actPalette || img.palette);
                                            const isAssigned = Boolean(activeEl && activeEl.group === img.group && activeEl.image === img.image);

                                            return (
                                                <button
                                                    key={`${img.group}-${img.image}-${i}`}
                                                    type="button"
                                                    onClick={() => handleLinkSpriteToFrame(img.group, img.image)}
                                                    className={`group flex flex-col overflow-hidden rounded border transition-all cursor-pointer text-left ${
                                                        isAssigned
                                                            ? 'border-blue-500 ring-1 ring-blue-500/70 bg-blue-950/30'
                                                            : 'border-[#333333] bg-[#222222] hover:border-blue-400 hover:bg-[#282d38]'
                                                    }`}
                                                    title={`Group ${img.group}, Image ${img.image} (${img.width}x${img.height})`}
                                                >
                                                    <div
                                                        className="w-full aspect-square flex items-center justify-center overflow-hidden bg-[#181818]"
                                                        style={{
                                                            backgroundImage:
                                                                'linear-gradient(45deg, #202020 25%, transparent 25%), linear-gradient(-45deg, #202020 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #202020 75%), linear-gradient(-45deg, transparent 75%, #202020 75%)',
                                                            backgroundSize: '12px 12px',
                                                            backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px'
                                                        }}
                                                    >
                                                        <SpriteThumbnail sprite={img} palette={effectivePalette} />
                                                    </div>
                                                    <div className={`w-full px-1 py-0.5 text-center font-mono text-[9px] truncate border-t ${
                                                        isAssigned
                                                            ? 'bg-blue-900/50 border-blue-500/40 text-blue-200 font-bold'
                                                            : 'bg-[#161616] border-[#2c2c2c] text-gray-300 group-hover:text-white'
                                                    }`}>
                                                        {img.group},{img.image}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                   </div>
                               );
                           })() : (
                               <div className="text-gray-500 italic text-center p-4">No character sprites loaded in memory...</div>
                           )}
                        </div>
                    </>
                )}
            </div>
         )}
      </div>

      {/* Bottom Status / Issues Tab Panel */}
      <div className="h-32 hidden md:flex bg-[#1e1e1e] border-t border-[#111111] flex-col">
          <div className="flex bg-[#2a2a2a] border-b border-[#111111] text-[11px] select-none">
              <div className="px-4 py-1 text-gray-300 bg-[#1e1e1e] border-r border-[#111111] border-t-2 border-t-[#3b82f6] font-semibold">Diagnostics</div>
              <div className="flex-1" />
              <button
                  type="button"
                  onClick={() => setActiveBottomTab('issues')}
                  className={`flex items-center gap-1.5 px-4 py-1 border-x border-[#111111] cursor-pointer transition-colors ${activeBottomTab === 'issues' ? 'bg-[#1e1e1e] text-white font-semibold' : 'bg-[#2a2a2a] text-gray-400 hover:bg-[#333]'}`}
              >
                  {issues.some(i => i.severity === 'error') ? (
                      <AlertCircle size={12} className="text-red-400" />
                  ) : issues.length > 0 ? (
                      <AlertTriangle size={12} className="text-amber-400" />
                  ) : (
                      <CheckCircle2 size={12} className="text-emerald-400" />
                  )}
                  <span>Issues ({issues.length})</span>
              </button>
              <button
                  type="button"
                  onClick={() => setActiveBottomTab('search')}
                  className={`px-4 py-1 border-r border-[#111111] cursor-pointer transition-colors ${activeBottomTab === 'search' ? 'bg-[#1e1e1e] text-white font-semibold' : 'bg-[#2a2a2a] text-gray-400 hover:bg-[#333]'}`}
              >
                  Advanced Search
              </button>
              <button
                  type="button"
                  onClick={() => setActiveBottomTab('output')}
                  className={`px-4 py-1 border-r border-[#111111] cursor-pointer transition-colors ${activeBottomTab === 'output' ? 'bg-[#1e1e1e] text-white font-semibold' : 'bg-[#2a2a2a] text-gray-400 hover:bg-[#333]'}`}
              >
                  Engine Output ({engineLogs.length})
              </button>
          </div>

          <div className="flex-1 p-1.5 overflow-y-auto text-gray-300 text-xs bg-[#18181b]">
              {activeBottomTab === 'issues' && (
                  issues.length === 0 ? (
                      <div className="h-full flex items-center gap-2 px-3 text-emerald-400/90 text-[11px]">
                          <CheckCircle2 size={13} />
                          <span>0 issues found. All states, commands, and AIR sprite references are valid.</span>
                      </div>
                  ) : (
                      <div className="flex flex-col gap-1">
                          {issues.map(issue => (
                              <button
                                  key={issue.id}
                                  type="button"
                                  onClick={() => {
                                      if (issue.source === 'AIR' && issue.actionId !== undefined) {
                                          setActiveMode('Animations');
                                          setSelectedActionId(issue.actionId);
                                          setCurrentFrame(issue.frameIndex ?? 0);
                                      } else if (issue.source === 'CNS') {
                                          pendingCodeJumpRef.current = {
                                              mode: 'States',
                                              fileId: issue.fileId,
                                              line: issue.line || 1,
                                          };
                                          setActiveMode('States');
                                          if (issue.fileId) setActiveStFileId(issue.fileId);
                                      } else if (issue.source === 'CMD') {
                                          pendingCodeJumpRef.current = {
                                              mode: 'Commands',
                                              fileId: issue.fileId,
                                              line: issue.line || 1,
                                          };
                                          setActiveMode('Commands');
                                          if (issue.fileId) setActiveCmdFileId(issue.fileId);
                                      } else if (issue.source === 'DEF') {
                                          pendingCodeJumpRef.current = {
                                              mode: 'Definitions',
                                              line: issue.line || 1,
                                          };
                                          setActiveMode('Definitions');
                                      }
                                  }}
                                  className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 transition-colors cursor-pointer"
                              >
                                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
                                      issue.severity === 'error'
                                          ? 'bg-red-950 text-red-300 border border-red-700/60'
                                          : issue.severity === 'warning'
                                              ? 'bg-amber-950 text-amber-300 border border-amber-700/60'
                                              : 'bg-blue-950 text-blue-300 border border-blue-700/60'
                                  }`}>
                                      {issue.severity}
                                  </span>
                                  <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                                      [{issue.source}{issue.fileName ? `:${issue.fileName}` : ''}{issue.line ? `:${issue.line}` : ''}]
                                  </span>
                                  <span className="text-[11px] text-zinc-200 truncate">{issue.message}</span>
                              </button>
                          ))}
                      </div>
                  )
              )}

              {activeBottomTab === 'search' && (
                  <div className="flex flex-col gap-1.5 h-full">
                      <div className="flex items-center gap-2 px-1">
                          <Search size={12} className="text-zinc-500" />
                          <input
                              type="text"
                              value={searchQuery}
                              onChange={e => setSearchQuery(e.target.value)}
                              placeholder="Quick filter across States, Commands, Definitions, Sprites, Animations, Sounds..."
                              className="flex-1 bg-[#121215] border border-[#2f2f35] rounded px-2 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-blue-500"
                          />
                      </div>
                      <div className="flex-1 overflow-y-auto flex flex-col gap-0.5">
                          {searchResults.slice(0, 15).map((res, idx) => (
                              <button
                                  key={idx}
                                  type="button"
                                  onClick={res.action}
                                  className="w-full text-left flex items-center justify-between px-2 py-0.5 rounded hover:bg-blue-600/20 text-[11px]"
                              >
                                  <span className="truncate text-zinc-200">
                                      <span className="text-[9px] font-mono text-blue-400 mr-2">[{res.type}]</span>
                                      {res.title}
                                  </span>
                                  <span className="text-[10px] text-zinc-500 font-mono shrink-0">{res.subtitle}</span>
                              </button>
                          ))}
                          {searchQuery.trim() && searchResults.length === 0 && (
                              <span className="text-[10px] text-zinc-500 italic px-2">No matches found.</span>
                          )}
                      </div>
                  </div>
              )}

              {activeBottomTab === 'output' && (
                  engineLogs.length === 0 ? (
                      <div className="text-[11px] text-zinc-500 italic px-2 py-1">No engine operations logged yet.</div>
                  ) : (
                      <div className="flex flex-col gap-0.5 font-mono text-[10px] text-zinc-300 px-1">
                          {engineLogs.map((log, idx) => (
                              <div key={idx} className="truncate">{log}</div>
                          ))}
                      </div>
                  )
              )}
          </div>
          {/* Status Bar */}
          <div className="h-6 bg-[#2a2a2a] border-t border-[#111111] flex items-center px-2 text-[10px] text-gray-500 justify-between">
              <div>Tool: {activeTool.toUpperCase()}</div>
              <div>Project: {getIniField(iniData, 'Info', 'name') || 'Character, Unknown / not set'}</div>
              <div>Zoom: {zoom * 100}% | Pan: {Math.round(pan.x)}, {Math.round(pan.y)}</div>
          </div>
      </div>

      {/* Global Search Modal */}
      {isSearchModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={() => setIsSearchModalOpen(false)}>
          <div className="bg-[#1e1e1e] border border-[#3a3a3a] rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 bg-[#161616] border-b border-[#333] flex items-center gap-3">
              <Search className="w-5 h-5 text-blue-400 shrink-0" />
              <input
                type="text"
                autoFocus
                placeholder="Search words, numbers, states (e.g. 200), sprites, sounds, commands..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-white text-sm outline-none placeholder-zinc-500 font-sans"
              />
              <button 
                onClick={() => setIsSearchModalOpen(false)}
                className="text-zinc-400 hover:text-white px-2 py-1 text-xs bg-zinc-800 rounded hover:bg-zinc-700 transition-colors"
              >
                ESC
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 divide-y divide-[#2a2a2a]">
              {searchResults.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 text-xs italic">
                  {searchQuery.trim() ? "No matching words, numbers, or states found." : "Type a keyword, state number (e.g. 200), sprite group, or sound name to search..."}
                </div>
              ) : (
                searchResults.map((res, i) => (
                  <div
                    key={i}
                    onClick={res.action}
                    className="pt-2 pb-1 px-3 hover:bg-blue-600/20 hover:border-blue-500/50 border border-transparent rounded cursor-pointer transition-all flex items-center justify-between group"
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="font-medium text-zinc-200 group-hover:text-blue-300 text-xs flex items-center gap-2">
                        <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[9px] font-mono">{res.type}</span>
                        {res.title}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">{res.subtitle}</div>
                    </div>
                    <span className="text-[10px] text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity font-semibold">Jump to →</span>
                  </div>
                ))
              )}
            </div>
            
            <div className="px-4 py-2 bg-[#161616] border-t border-[#333] text-[10px] text-zinc-500 flex justify-between items-center">
              <span>Showing up to 50 results</span>
              <span>Press <kbd className="px-1 bg-zinc-800 rounded text-zinc-300">Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}


      {/* Palette Import Modal */}
      {showPaletteChoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-[#2a2a2a] border border-[#444] rounded-lg shadow-xl w-96 p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-200">{isReplacing ? 'Replace Sprites' : 'Import Sprite'}</h2>
                    <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-1 rounded border border-blue-800">
                        {pendingImportFiles.length} file(s)
                    </span>
                </div>

                {!isReplacing && (
                    <div className="grid grid-cols-2 gap-4 p-3 bg-[#1e1e1e] rounded border border-[#333]">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] uppercase font-bold text-gray-500">Group</label>
                            <input 
                                type="number"
                                value={importGroup}
                                onChange={(e) => setImportGroup(parseInt(e.target.value) || 0)}
                                className="bg-[#252525] border border-[#444] rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] uppercase font-bold text-gray-500">Index</label>
                            <input 
                                type="number"
                                value={importIndex}
                                onChange={(e) => setImportIndex(parseInt(e.target.value) || 0)}
                                className="bg-[#252525] border border-[#444] rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>
                )}
                
                {isReplacing && (
                    <p className="text-amber-400/90 text-[11px] bg-amber-900/20 p-2 rounded border border-amber-800/30">
                        Replacing {Math.min(pendingImportFiles.length, selectedSpriteIndices.size)} selected sprite(s). Original Group/Index/Offsets will be preserved.
                    </p>
                )}
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

      {/* Mini Playable Move Tester Modal */}
      <MoveTesterModal
        isOpen={showMoveTester}
        onClose={() => setShowMoveTester(false)}
        sffData={sffData}
        airData={airData}
        actPalette={
          sffData?.palettes?.[selectedPaletteIdx]?.data ||
          sffData?.palettes?.[0]?.data ||
          actPalette
        }
        selectedPaletteIdx={selectedPaletteIdx}
        characterName={getIniField(iniData, 'Info', 'displayname') || getIniField(iniData, 'Info', 'name') || 'Character'}
        cmdFiles={cmdFiles}
        stFiles={stFiles}
        sndData={sndData}
      />

      {/* Save Notification Toast */}
      {saveNotification && (
        <div className="fixed bottom-4 right-4 z-[9999] bg-green-600 text-white px-4 py-2 rounded-lg shadow-xl text-xs font-medium animate-in fade-in slide-in-from-bottom-2">
          {saveNotification}
        </div>
      )}

    </div>
  );
}

function FF3SpriteRenderer({ sprite, act, zoom, showAxis, pan, previewOffset, selectionRect, pastedContent }: { sprite: any, act: Uint8Array | null, zoom: number, showAxis: boolean, pan?: {x: number, y: number}, previewOffset?: {x: number, y: number} | null, selectionRect?: { x: number, y: number, w: number, h: number } | null, pastedContent?: { x: number, y: number, width: number, height: number, pixelIndices: Uint8Array, active: boolean } | null }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Priority:
    // 1. If 'act' is provided (which we've already optimized in the parent to prefer 1,1), use it.
    // 2. Otherwise use the sprite's own palette.
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
                    const drawX = centerX - (xOff * zoom) + panX;
                    const drawY = centerY - (yOff * zoom) + panY;
                    const drawW = sprite.width * zoom;
                    const drawH = sprite.height * zoom;
                    
                    ctx.drawImage(offscreen, drawX, drawY, drawW, drawH);
                    
                    // Canvas Border around the sprite
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                    ctx.setLineDash([2, 4]);
                    ctx.lineWidth = 1;
                    ctx.strokeRect(drawX, drawY, drawW, drawH);
                    ctx.restore();
                } catch(e) {}
            }

            if (sprite && selectionRect) {
                const xOff = previewOffset ? previewOffset.x : sprite.xOffset;
                const yOff = previewOffset ? previewOffset.y : sprite.yOffset;
                const recX = centerX - (xOff * zoom) + (selectionRect.x * zoom) + panX;
                const recY = centerY - (yOff * zoom) + (selectionRect.y * zoom) + panY;
                const recW = selectionRect.w * zoom;
                const recH = selectionRect.h * zoom;
                
                ctx.save();
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(recX, recY, recW, recH);
                ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
                ctx.fillRect(recX, recY, recW, recH);
                ctx.restore();
            }

            if (sprite && pastedContent && pastedContent.active && resolvedPalette) {
                try {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = pastedContent.width;
                    tempCanvas.height = pastedContent.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    if (tempCtx) {
                        const imgData = applyPalette(pastedContent.pixelIndices, pastedContent.width, pastedContent.height, resolvedPalette);
                        tempCtx.putImageData(imgData, 0, 0);
                        
                        const xOff = previewOffset ? previewOffset.x : sprite.xOffset;
                        const yOff = previewOffset ? previewOffset.y : sprite.yOffset;
                        const pX = centerX - (xOff * zoom) + (pastedContent.x * zoom) + panX;
                        const pY = centerY - (yOff * zoom) + (pastedContent.y * zoom) + panY;
                        const pW = pastedContent.width * zoom;
                        const pH = pastedContent.height * zoom;
                        
                        ctx.imageSmoothingEnabled = false;
                        ctx.drawImage(tempCanvas, pX, pY, pW, pH);
                        
                        ctx.save();
                        ctx.strokeStyle = '#10b981';
                        ctx.lineWidth = 1.5;
                        ctx.setLineDash([4, 4]);
                        ctx.strokeRect(pX, pY, pW, pH);
                        ctx.fillStyle = 'rgba(16, 185, 129, 0.05)';
                        ctx.fillRect(pX, pY, pW, pH);
                        ctx.restore();
                    }
                } catch(e) {}
            }

            if (showAxis) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
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

    }, [sprite, resolvedPalette, zoom, showAxis, pan, previewOffset, selectionRect, pastedContent]);

    return (
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    );
}

const STANDARD_MUGEN_ACTION_NAMES: Record<number, string> = {
  0: 'Standing',
  5: 'Turning',
  6: 'Crouch Turning',
  10: 'Stand to Crouch',
  11: 'Crouching',
  12: 'Crouch to Stand',
  20: 'Walk Forward',
  21: 'Walk Backward',
  40: 'Jump Start',
  41: 'Jump Up',
  42: 'Jump Forward',
  43: 'Jump Backward',
  44: 'Jump Up (Down)',
  45: 'Jump Forward (Down)',
  46: 'Jump Backward (Down)',
  47: 'Jump Land',
  100: 'Run Forward',
  105: 'Hop Backward',
  120: 'Guard Start (Stand)',
  121: 'Guard Start (Crouch)',
  122: 'Guard Start (Air)',
  130: 'Guard (Stand)',
  131: 'Guard (Crouch)',
  132: 'Guard (Air)',
  140: 'Guard End (Stand)',
  141: 'Guard End (Crouch)',
  142: 'Guard End (Air)',
  150: 'Guard Hit (Stand)',
  151: 'Guard Hit (Crouch)',
  152: 'Guard Hit (Air)',
  170: 'Lose',
  180: 'Win',
  190: 'Intro',
  195: 'Taunt',
  200: 'Stand Light Punch',
  210: 'Stand Medium Punch',
  220: 'Stand Strong Punch',
  230: 'Stand Light Kick',
  240: 'Stand Medium Kick',
  250: 'Stand Strong Kick',
  400: 'Crouch Light Punch',
  410: 'Crouch Medium Punch',
  420: 'Crouch Strong Punch',
  430: 'Crouch Light Kick',
  440: 'Crouch Medium Kick',
  450: 'Crouch Strong Kick',
  600: 'Jump Light Punch',
  610: 'Jump Medium Punch',
  620: 'Jump Strong Punch',
  630: 'Jump Light Kick',
  640: 'Jump Medium Kick',
  650: 'Jump Strong Kick',
  800: 'Throw Attempt',
  5000: 'Stand Hit (Light)',
  5001: 'Stand Hit (Medium)',
  5002: 'Stand Hit (Hard)',
  5010: 'Stand Hit Low (Light)',
  5020: 'Crouch Hit (Light)',
  5030: 'Air Hit / Knockback',
  5050: 'Falling',
  5070: 'Tripped',
  5080: 'Liedown',
  5100: 'Bounce on Ground',
  5110: 'Lie Dead / Down',
  5120: 'Get Up',
  5150: 'Defeated',
  5200: 'Air Recover (Near Ground)',
  5210: 'Air Recover (Midair)',
  5300: 'Dizzy'
};

function getStandardMugenActionHint(actionId: number): string {
  const std = STANDARD_MUGEN_ACTION_NAMES[actionId];
  return std ? `e.g. ${std}` : 'e.g. Standing, Light Punch...';
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

function SpriteThumbnail({ sprite, palette }: { sprite: any; palette: Uint8Array | null | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprite || !sprite.pixelIndices || !palette || sprite.width <= 0 || sprite.height <= 0) return;

    const srcCanvas = getCachedSpriteCanvas(sprite, palette);
    const pad = 4;
    const availW = canvas.width - pad * 2;
    const availH = canvas.height - pad * 2;
    const scale = Math.min(availW / sprite.width, availH / sprite.height, 2);
    const drawW = Math.max(1, Math.round(sprite.width * scale));
    const drawH = Math.max(1, Math.round(sprite.height * scale));
    const dx = Math.floor((canvas.width - drawW) / 2);
    const dy = Math.floor((canvas.height - drawH) / 2);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(srcCanvas, dx, dy, drawW, drawH);
  }, [sprite, palette, sprite?.pixelIndices, sprite?.width, sprite?.height]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={64}
      className="w-full h-full object-contain pointer-events-none"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function AnimationStage({ sff, act, action, frameIndex, zoom, showClsn, showAxis, showOnionSkin = false, pan, previewOffset, activeTool, selectedClsn, setSelectedClsn, onUpdateBox }: { 
    sff: SffData, 
    act: Uint8Array | null, 
    action: any | null, 
    frameIndex: number, 
    zoom: number, 
    showClsn: boolean, 
    showAxis: boolean, 
    showOnionSkin?: boolean,
    pan?: {x: number, y: number}, 
    previewOffset?: {x: number, y: number} | null,
    activeTool: string,
    selectedClsn: { type: 1 | 2; id: number } | null,
    setSelectedClsn: (val: { type: 1 | 2; id: number } | null) => void,
    onUpdateBox: (type: 1 | 2, id: number, fieldOrUpdates: string | Record<string, number>, value?: number) => void
}) {
    type ClsnDragType = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [dragState, setDragState] = useState<{ type: ClsnDragType; boxId: number; clsnType: 1|2; startX: number; startY: number; initialBox: any } | null>(null);
    const [hoverHandle, setHoverHandle] = useState<ClsnDragType | null>(null);

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
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0, centerY + panY); ctx.lineTo(canvas.width, centerY + panY); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(centerX + panX, 0); ctx.lineTo(centerX + panX, canvas.height); ctx.stroke();
            }

            if (action && action.elements[frameIndex]) {
                // Onion skin: render previous frame sprite ghost underneath
                if (showOnionSkin && frameIndex > 0 && action.elements[frameIndex - 1]) {
                    const prevEl = action.elements[frameIndex - 1];
                    const prevSprite = sff.images.find(i => i.group === prevEl.group && i.image === prevEl.image);
                    if (prevSprite) {
                        const prevPal = act || prevSprite.palette;
                        if (prevPal) {
                            try {
                                const prevOff = getCachedSpriteCanvas(prevSprite, prevPal);
                                const prevFlip = (prevEl.flip || "").toUpperCase();
                                ctx.save();
                                ctx.globalAlpha = 0.28;
                                ctx.translate(centerX + panX, centerY + panY);
                                if (prevFlip.includes('H')) ctx.scale(-1, 1);
                                if (prevFlip.includes('V')) ctx.scale(1, -1);
                                ctx.imageSmoothingEnabled = false;
                                ctx.drawImage(
                                    prevOff,
                                    (prevEl.xOffset - prevSprite.xOffset) * zoom,
                                    (prevEl.yOffset - prevSprite.yOffset) * zoom,
                                    prevSprite.width * zoom,
                                    prevSprite.height * zoom
                                );
                                ctx.restore();
                            } catch {}
                        }
                    }
                }

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
                            const colorMode = (element.color || "").toUpperCase();

                            ctx.save();
                            if (colorMode === 'A' || colorMode === 'A1') {
                                ctx.globalAlpha = colorMode === 'A1' ? 0.55 : 0.78;
                                ctx.globalCompositeOperation = 'lighter';
                            } else if (colorMode === 'S') {
                                ctx.globalAlpha = 0.65;
                                ctx.globalCompositeOperation = 'difference';
                            }
                            ctx.translate(centerX + panX, centerY + panY);
                            if (flipH) ctx.scale(-1, 1);
                            if (flipV) ctx.scale(1, -1);

                            const drawX = (elXOff - sprite.xOffset) * zoom;
                            const drawY = (elYOff - sprite.yOffset) * zoom;
                            const drawW = sprite.width * zoom;
                            const drawH = sprite.height * zoom;
                            
                            ctx.imageSmoothingEnabled = false;
                            ctx.drawImage(offscreen, drawX, drawY, drawW, drawH);

                            // Canvas Border around the sprite
                            ctx.save();
                            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                            ctx.setLineDash([2, 4]);
                            ctx.lineWidth = 1;
                            ctx.strokeRect(drawX, drawY, drawW, drawH);
                            ctx.restore();

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
                            ctx.strokeStyle = type === 1 ? '#ff4d4d' : '#4da6ff';
                        } else {
                            ctx.lineWidth = 1;
                        }

                        const minX = Math.min(box.x1, box.x2);
                        const maxX = Math.max(box.x1, box.x2);
                        const minY = Math.min(box.y1, box.y2);
                        const maxY = Math.max(box.y1, box.y2);

                        const bX = minX * zoom;
                        const bY = minY * zoom;
                        const bW = Math.max(1, (maxX - minX) * zoom);
                        const bH = Math.max(1, (maxY - minY) * zoom);
                        
                        ctx.fillRect(bX, bY, bW, bH);
                        ctx.strokeRect(bX, bY, bW, bH);

                        if (isSelected && activeTool === 'clsn_edit') {
                            const hS = 4;
                            const midBX = bX + bW / 2;
                            const midBY = bY + bH / 2;

                            const renderHandle = (x: number, y: number, isCorner = true) => {
                                ctx.save();
                                ctx.fillStyle = isCorner ? '#ffffff' : '#fbbf24';
                                ctx.strokeStyle = '#000000';
                                ctx.lineWidth = 1;
                                ctx.fillRect(x - hS, y - hS, hS * 2, hS * 2);
                                ctx.strokeRect(x - hS, y - hS, hS * 2, hS * 2);
                                ctx.restore();
                            };

                            // 4 corner handles (resizes width and height together)
                            renderHandle(bX, bY, true);              // NW
                            renderHandle(bX + bW, bY, true);         // NE
                            renderHandle(bX, bY + bH, true);         // SW
                            renderHandle(bX + bW, bY + bH, true);    // SE

                            // 4 edge handles (W/E for width, N/S for height)
                            renderHandle(midBX, bY, false);          // N (Height)
                            renderHandle(midBX, bY + bH, false);     // S (Height)
                            renderHandle(bX, midBY, false);          // W (Width)
                            renderHandle(bX + bW, midBY, false);     // E (Width)

                            // Clean dimension badge displayed right above the box
                            ctx.save();
                            const widthPx = Math.abs(box.x2 - box.x1);
                            const heightPx = Math.abs(box.y2 - box.y1);
                            const labelText = `W: ${widthPx}px × H: ${heightPx}px`;
                            ctx.font = 'bold 9px monospace';
                            const textMetrics = ctx.measureText(labelText);
                            const tagW = textMetrics.width + 10;
                            const tagH = 15;
                            const tagX = bX;
                            const tagY = bY - tagH - 4;

                            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
                            ctx.fillRect(tagX, tagY, tagW, tagH);
                            ctx.strokeStyle = type === 1 ? '#ff4d4d' : '#4da6ff';
                            ctx.lineWidth = 1;
                            ctx.strokeRect(tagX, tagY, tagW, tagH);

                            ctx.fillStyle = '#ffffff';
                            ctx.fillText(labelText, tagX + 5, tagY + 11);
                            ctx.restore();
                        }
                    };

                    const activeClsn2 = element.clsn2 ?? action.clsn2;
                    const activeClsn1 = element.clsn1 ?? action.clsn1;
                    activeClsn2.forEach((box: any) => drawBox(box, 2));
                    activeClsn1.forEach((box: any) => drawBox(box, 1));
                    ctx.restore();
                }
            }
        };

        resize();
        render();
        const handleResize = () => { resize(); render(); };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [sff, act, action, frameIndex, zoom, showClsn, showAxis, showOnionSkin, pan, previewOffset, selectedClsn, activeTool]);

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

    const checkHit = (wx: number, wy: number) => {
        if (!action) return null;
        const handleSize = 12 / zoom;
        const selectionPadding = 8 / zoom;

        const checkBoxes = (boxes: any[], type: 1 | 2) => {
            for (let i = boxes.length - 1; i >= 0; i--) {
                const box = boxes[i];
                const isSelected = selectedClsn?.type === type && selectedClsn?.id === box.id;
                
                const minX = Math.min(box.x1, box.x2);
                const maxX = Math.max(box.x1, box.x2);
                const minY = Math.min(box.y1, box.y2);
                const maxY = Math.max(box.y1, box.y2);
                const midX = (minX + maxX) / 2;
                const midY = (minY + maxY) / 2;

                if (isSelected) {
                    // Corner handles: Resize Width AND Height simultaneously
                    if (Math.abs(wx - minX) < handleSize && Math.abs(wy - minY) < handleSize) 
                        return { type: 'nw' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - maxX) < handleSize && Math.abs(wy - minY) < handleSize) 
                        return { type: 'ne' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - minX) < handleSize && Math.abs(wy - maxY) < handleSize) 
                        return { type: 'sw' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - maxX) < handleSize && Math.abs(wy - maxY) < handleSize) 
                        return { type: 'se' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };

                    // Mid-edge handles: Height (N/S) or Width (W/E)
                    if (Math.abs(wx - midX) < handleSize && Math.abs(wy - minY) < handleSize) 
                        return { type: 'n' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - midX) < handleSize && Math.abs(wy - maxY) < handleSize) 
                        return { type: 's' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - minX) < handleSize && Math.abs(wy - midY) < handleSize) 
                        return { type: 'w' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                    if (Math.abs(wx - maxX) < handleSize && Math.abs(wy - midY) < handleSize) 
                        return { type: 'e' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                }
                
                if (wx >= minX - selectionPadding && wx <= maxX + selectionPadding && 
                    wy >= minY - selectionPadding && wy <= maxY + selectionPadding) {
                    return { type: 'move' as const, boxId: box.id, clsnType: type, initialBox: { ...box } };
                }
            }
            return null;
        };

        const el = action.elements[frameIndex];
        const activeClsn1 = el?.clsn1 ?? action.clsn1;
        const activeClsn2 = el?.clsn2 ?? action.clsn2;
        return checkBoxes(activeClsn1, 1) || checkBoxes(activeClsn2, 2);
    };

    const startDrag = (clientX: number, clientY: number) => {
        if (activeTool !== 'clsn_edit' || !action) return;
        const coords = getWorkspaceCoords(clientX, clientY);
        if (!coords) return;
        const { wx, wy } = coords;

        const result = checkHit(wx, wy);
        
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
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                x1: b.x1 + dx,
                y1: b.y1 + dy,
                x2: b.x2 + dx,
                y2: b.y2 + dy
            });
        } else if (dragState.type === 'nw') {
            // Resizes width (x1) and height (y1)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                x1: b.x1 + dx,
                y1: b.y1 + dy
            });
        } else if (dragState.type === 'ne') {
            // Resizes width (x2) and height (y1)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                x2: b.x2 + dx,
                y1: b.y1 + dy
            });
        } else if (dragState.type === 'sw') {
            // Resizes width (x1) and height (y2)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                x1: b.x1 + dx,
                y2: b.y2 + dy
            });
        } else if (dragState.type === 'se') {
            // Resizes width (x2) and height (y2)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                x2: b.x2 + dx,
                y2: b.y2 + dy
            });
        } else if (dragState.type === 'n') {
            // Resizes height (y1)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                y1: b.y1 + dy
            });
        } else if (dragState.type === 's') {
            // Resizes height (y2)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                y2: b.y2 + dy
            });
        } else if (dragState.type === 'w') {
            // Resizes width (x1)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                x1: b.x1 + dx
            });
        } else if (dragState.type === 'e') {
            // Resizes width (x2)
            onUpdateBox(dragState.clsnType, dragState.boxId, {
                x2: b.x2 + dx
            });
        }
    };

    const getCursorStyle = () => {
        if (activeTool !== 'clsn_edit') return 'default';
        const active = dragState ? dragState.type : hoverHandle;
        switch (active) {
            case 'nw':
            case 'se':
                return 'nwse-resize';
            case 'ne':
            case 'sw':
                return 'nesw-resize';
            case 'n':
            case 's':
                return 'ns-resize';
            case 'w':
            case 'e':
                return 'ew-resize';
            case 'move':
                return 'move';
            default:
                return 'crosshair';
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
        } else if (activeTool === 'clsn_edit') {
            const coords = getWorkspaceCoords(e.clientX, e.clientY);
            if (coords) {
                const hit = checkHit(coords.wx, coords.wy);
                setHoverHandle(hit ? hit.type : null);
            } else {
                setHoverHandle(null);
            }
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
             style={{ cursor: getCursorStyle() }}
             onMouseDown={handleMouseDown}
             onMouseMove={handleMouseMove}
             onMouseUp={() => setDragState(null)}
             onMouseLeave={() => { setDragState(null); setHoverHandle(null); }}
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
