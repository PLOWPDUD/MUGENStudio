import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Gamepad2, Eye, RotateCcw, Volume2, Search, Zap, Move, ArrowDown, CornerUpLeft, SlidersHorizontal, Keyboard, Swords, Shield, Cpu, Trophy, ChevronDown, ChevronUp, Palette, Sparkles } from 'lucide-react';
import { applyPalette } from '../lib/mugen/actParser';
import {
  getKeymapButtonsForPaletteIndex,
  PALETTE_KEYMAP_KEYS,
  PaletteKeyName,
  parsePalDefaults,
  parsePaletteKeymap,
  resolvePaletteSlotIndex,
} from '../lib/mugen/defParser';
import { getPaletteSwatchColor } from '../lib/mugen/characterLoader';
import type { AirData, AirElement, ClsnBox, SffData, SffImage } from '../lib/mugen/types';
import type { SndData } from '../lib/mugen/sndParser';

interface TextFileLike {
  id: string;
  filename: string;
  content: string;
}

interface MoveTesterModalProps {
  isOpen: boolean;
  onClose: () => void;
  sffData: SffData | null;
  airData: AirData | null;
  actPalette: Uint8Array | null;
  selectedPaletteIdx?: number;
  onSelectPaletteIdx?: (idx: number) => void;
  iniData?: Record<string, Record<string, string>> | null;
  characterName?: string;
  cmdFiles: TextFileLike[];
  stFiles: TextFileLike[];
  sndData: SndData | null;
}

interface ParsedCommandDef {
  name: string;
  pattern: string;
  cleanTokens: string[];
  tokenCount: number;
  chordWeight: number;
}

interface ParsedHitDef {
  attr: 'S' | 'C' | 'A';
  attrMove: 'N' | 'S' | 'H';
  hitFlag: string;
  guardFlag: string;
  damage: number;
  guardDamage: number;
  getPowerHit: number;
  getPowerGuard: number;
  givePowerHit: number;
  givePowerGuard: number;
  pauseP1: number;
  pauseP2: number;
  groundVelX: number;
  groundVelY: number;
  airVelX: number;
  airVelY: number;
  guardVelX: number;
  groundHittime: number;
  airHittime: number;
  guardHittime: number;
  fall: boolean;
  hitSound?: { group: number; sample: number };
  guardSound?: { group: number; sample: number };
}

interface ParsedChangeStateRule {
  commandName: string;
  matchedCommands: string[];
  requiredCommands: string[];
  requiredAllCommands: string[];
  requiredAllOrSets: string[][][];
  commandOrGroups: string[][];
  forbiddenCommands: string[];
  allowedStateTypes: ('S' | 'C' | 'A')[];
  targetState: number;
  requireCtrl: boolean;
  requiresP2Close?: boolean;
  minPowerRequired: number;
  label?: string;
}

type ControllerType =
  | 'velset'
  | 'veladd'
  | 'velmul'
  | 'posadd'
  | 'posset'
  | 'gravity'
  | 'superpause'
  | 'poweradd'
  | 'hitdef'
  | 'changestate'
  | 'changeanim'
  | 'playsnd'
  | 'statetypeset'
  | 'ctrlset'
  | 'projectile'
  | 'helper'
  | 'explod'
  | 'removeexplod'
  | 'modifyexplod'
  | 'destroyself';

interface ParsedController {
  id: string;
  type: ControllerType;
  triggerAll: string[];
  triggerGroups: Record<number, string[]>;
  persistent: number;
  xExpr?: string;
  yExpr?: string;
  valueExpr?: string;
  sndValue?: { group: number; sample: number };
  superTime?: number;
  superMoveTime?: number;
  superPowerAdd?: number;
  hitDef?: ParsedHitDef;
  stateTypeVal?: 'S' | 'C' | 'A' | 'L';
  moveTypeVal?: 'I' | 'A' | 'H';
  physicsVal?: 'S' | 'C' | 'A' | 'N';
  ctrlVal?: number;

  // Projectile fields
  projId?: number;
  projAnim?: number;
  projHitAnim?: number;
  projRemAnim?: number;
  projCancelAnim?: number;
  projVelX?: number;
  projVelY?: number;
  projOffsetX?: number;
  projOffsetY?: number;
  projRemoveTime?: number;

  // Helper fields
  helperType?: 'normal' | 'player';
  helperName?: string;
  helperId?: number;
  helperStateNo?: number;
  helperOffsetX?: number;
  helperOffsetY?: number;
  helperPosType?: 'p1' | 'p2' | 'front' | 'back' | 'left' | 'right';
  helperFacing?: 1 | -1;
  helperKeyCtrl?: number;
  helperOwnPal?: number;

  // Explod fields
  explodAnim?: number;
  explodId?: number;
  explodOffsetX?: number;
  explodOffsetY?: number;
  explodPosType?: 'p1' | 'p2' | 'front' | 'back' | 'left' | 'right';
  explodFacing?: 1 | -1;
  explodVFacing?: 1 | -1;
  explodBindTime?: number;
  explodVelX?: number;
  explodVelY?: number;
  explodRemoveTime?: number;
  explodScaleX?: number;
  explodScaleY?: number;
  explodSprPriority?: number;
  explodOwnPal?: number;
}

interface ParsedStateInfo {
  stateNo: number;
  label: string;
  stateType: 'S' | 'C' | 'A' | 'L';
  moveType: 'I' | 'A' | 'H';
  physics: 'S' | 'C' | 'A' | 'N';
  ctrlVal?: 0 | 1;
  hitDefPersist?: boolean;
  moveHitPersist?: boolean;
  anim?: number;
  velSetX?: number;
  velSetY?: number;
  powerAdd?: number;
  moveX: number;
  moveY: number;
  hasExplicitVel: boolean;
  isHyper: boolean;
  isCrouch: boolean;
  isHopBack: boolean;
  category: 'hyper' | 'special' | 'crouch_hop' | 'normal' | 'other';
  endToState: number;
  sounds: { group: number; sample: number }[];
  controllers: ParsedController[];
  rawText: string;
  matchedSnippet?: string;
}

interface CharacterPhysicsConstants {
  life: number;
  power: number;
  attack: number;
  defence: number;
  walkFwd: number;
  walkBack: number;
  runFwdX: number;
  runFwdY: number;
  runBackX: number;
  runBackY: number;
  jumpNeuX: number;
  jumpNeuY: number;
  jumpFwdX: number;
  jumpBackX: number;
  airJumpY: number;
  yaccel: number;
  standFriction: number;
  crouchFriction: number;
}

const DEFAULT_CONSTANTS: CharacterPhysicsConstants = {
  life: 1000,
  power: 3000,
  attack: 100,
  defence: 100,
  walkFwd: 2.8,
  walkBack: -2.4,
  runFwdX: 5.0,
  runFwdY: 0,
  runBackX: -4.8,
  runBackY: -3.8,
  jumpNeuX: 0,
  jumpNeuY: -9.0,
  jumpFwdX: 2.6,
  jumpBackX: -2.6,
  airJumpY: -8.1,
  yaccel: 0.45,
  standFriction: 0.85,
  crouchFriction: 0.82,
};

function palettesAreSame(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const len = Math.min(a.length, b.length, 1024);
  if (len < 12) return false;
  for (let i = 4; i < len; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      return false;
    }
  }
  return true;
}

function defaultLabelForState(stateNo: number): string {
  const known: Record<number, string> = {
    0: 'Stand (Idle)',
    10: 'Stand to Crouch',
    11: 'Crouching',
    12: 'Crouch to Stand',
    20: 'Walk Forward',
    21: 'Walk Backward',
    40: 'Jump Start',
    41: 'Jump Air',
    45: 'Air Jump',
    50: 'Jump Up',
    52: 'Jump Land',
    100: 'Run Forward',
    105: 'Hop Back',
    106: 'Hop Back Land',
    120: 'Guard Start',
    150: 'Stand Guard',
    152: 'Crouch Guard',
    154: 'Air Guard',
    170: 'Lose Pose',
    180: 'Win Decider',
    181: 'Win Pose',
    190: 'Intro',
    195: 'Taunt',
    200: 'Stand Light Punch (X)',
    210: 'Stand Medium Punch (Y)',
    220: 'Stand Strong Punch (Z)',
    230: 'Stand Light Kick (A)',
    240: 'Stand Medium Kick (B)',
    250: 'Stand Strong Kick (C)',
    400: 'Crouch Light Punch (D+X)',
    410: 'Crouch Medium Punch (D+Y)',
    420: 'Crouch Strong Punch (D+Z)',
    430: 'Crouch Light Kick (D+A)',
    440: 'Crouch Medium Kick (D+B)',
    450: 'Crouch Strong Kick (D+C)',
    600: 'Air Light Punch (J.X)',
    610: 'Air Medium Punch (J.Y)',
    620: 'Air Strong Punch (J.Z)',
    630: 'Air Light Kick (J.A)',
    640: 'Air Medium Kick (J.B)',
    650: 'Air Strong Kick (J.C)',
    800: 'Throw Attempt',
    5000: 'Stand Hit',
    5010: 'Crouch Hit',
    5050: 'Air Hit / Fall',
    5100: 'Hit Ground Bounce',
    5110: 'Lie Down',
    5120: 'Get Up',
    5150: 'K.O. Lie Down',
  };
  return known[stateNo] || `State ${stateNo}`;
}

function parseNumberPair(val: string): [number | undefined, number | undefined] {
  const parts = val.split(',').map(p => parseFloat(p.trim()));
  const x = parts.length >= 1 && !Number.isNaN(parts[0]) ? parts[0] : undefined;
  const y = parts.length >= 2 && !Number.isNaN(parts[1]) ? parts[1] : undefined;
  return [x, y];
}

function parseSoundPair(val: string): { group: number; sample: number } | undefined {
  const parts = val.split(',').map(p => parseInt(p.trim().replace(/^[sSfF]/, ''), 10));
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    return { group: parts[0], sample: parts[1] };
  }
  return undefined;
}

interface ProjectileRuntime {
  id: string;
  projId: number;
  ownerId: string;
  team: 1 | 2;
  posX: number;
  posY: number; // 270 = ground
  velX: number; // facing-relative
  velY: number;
  facing: 1 | -1;
  animId: number;
  hitAnimId?: number;
  remAnimId?: number;
  cancelAnimId?: number;
  frameIdx: number;
  tickInFrame: number;
  lifeTicks: number;
  maxTicks: number;
  hitDef: ParsedHitDef;
  isHitOrDying: boolean;
  hitTargets: Set<string>;
}

interface ExplodRuntime {
  id: string;
  explodId: number;
  ownerId: string;
  team: 1 | 2;
  animId: number;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  facing: 1 | -1;
  vfacing: 1 | -1;
  bindTime: number;
  removeTime: number;
  scaleX: number;
  scaleY: number;
  sprPriority: number;
  frameIdx: number;
  tickInFrame: number;
  ageTicks: number;
  ownerLastX?: number;
  ownerLastY?: number;
}

interface EvalContext {
  stateTime: number;
  animElem: number;
  animElemTick: number;
  animId: number;
  animTime: number; // <= 0 on final tick of animation
  posX: number;
  posY: number; // MUGEN coord: 0 = ground, <0 = air
  velX: number; // local facing-relative Vel X
  velY: number;
  stateType: 'S' | 'C' | 'A' | 'L';
  moveType: 'I' | 'A' | 'H';
  physics: 'S' | 'C' | 'A' | 'N';
  stateNo: number;
  prevStateNo: number;
  ctrl: number;
  life: number;
  maxLife: number;
  power: number;
  maxPower: number;
  moveContact: number;
  moveHit: number;
  moveGuarded: number;
  mode: 'practice' | 'fight';
  p2BodyDistX?: number;
  p2PosY?: number;
  p2StateType?: 'S' | 'C' | 'A' | 'L';
  p2MoveType?: 'I' | 'A' | 'H';
  p2StateNo?: number;
  p2Life?: number;
  actElements?: AirElement[];
  constants: CharacterPhysicsConstants;
  heldCmds?: Set<string>;
  pressedCmds?: Set<string>;
  isHelper?: boolean;
  helperId?: number;
  ownerId?: string;
  helpers?: FighterRuntime[];
  explods?: ExplodRuntime[];
  projectiles?: ProjectileRuntime[];
  parentLife?: number;
  facing?: 1 | -1;
}

function resolveConstValue(name: string, c: CharacterPhysicsConstants): number {
  const n = name.trim().toLowerCase();
  if (n.includes('data.life') || n === 'life') return c.life;
  if (n.includes('data.power') || n === 'power') return c.power;
  if (n.includes('data.attack')) return c.attack;
  if (n.includes('data.defence') || n.includes('data.defense')) return c.defence;
  if (n.includes('walk.fwd')) return c.walkFwd;
  if (n.includes('walk.back')) return c.walkBack;
  if (n.includes('run.fwd.y')) return c.runFwdY;
  if (n.includes('run.fwd')) return c.runFwdX;
  if (n.includes('run.back.y')) return c.runBackY;
  if (n.includes('run.back')) return c.runBackX;
  if (n.includes('jump.neu.y') || n === 'velocity.jump.y') return c.jumpNeuY;
  if (n.includes('jump.neu.x')) return c.jumpNeuX;
  if (n.includes('jump.fwd')) return c.jumpFwdX;
  if (n.includes('jump.back')) return c.jumpBackX;
  if (n.includes('airjump.y')) return c.airJumpY;
  if (n.includes('yaccel')) return c.yaccel;
  if (n.includes('stand.friction')) return c.standFriction;
  if (n.includes('crouch.friction')) return c.crouchFriction;
  return 0;
}

function evalMugenNumber(expr: string | undefined, ctx: EvalContext): number | null {
  if (!expr) return null;
  let s = expr.trim();
  if (!s) return null;

  s = s.replace(/const\s*\(\s*([^)]+)\s*\)/gi, (_, inner) => String(resolveConstValue(inner, ctx.constants)));
  s = s.replace(/\bvel\s+x\b/gi, String(ctx.velX));
  s = s.replace(/\bvel\s+y\b/gi, String(ctx.velY));
  s = s.replace(/\bpos\s+x\b/gi, String(ctx.posX));
  s = s.replace(/\bpos\s+y\b/gi, String(ctx.posY));
  s = s.replace(/\bpower\b/gi, String(ctx.mode === 'fight' ? ctx.power : ctx.maxPower));
  s = s.replace(/\blife\b/gi, String(ctx.life));
  s = s.replace(/\btime\b/gi, String(ctx.stateTime));
  s = s.replace(/\banimelem\b/gi, String(ctx.animElem));
  s = s.replace(/\bfvar\s*\([^)]*\)/gi, '0');
  s = s.replace(/\bvar\s*\([^)]*\)/gi, '0');

  if (/^[+\-*/().\s\d]+$/.test(s)) {
    try {
      const fn = new Function(`return (${s});`);
      const res = fn();
      if (typeof res === 'number' && Number.isFinite(res)) return res;
    } catch {
      return null;
    }
  }
  const leadNum = parseFloat(s);
  return Number.isNaN(leadNum) ? null : leadNum;
}

function compareOp(lhs: number, op: string, rhs: number): boolean {
  switch (op) {
    case '=':
      return Math.abs(lhs - rhs) < 0.0001;
    case '!=':
      return Math.abs(lhs - rhs) >= 0.0001;
    case '<':
      return lhs < rhs;
    case '<=':
      return lhs <= rhs;
    case '>':
      return lhs > rhs;
    case '>=':
      return lhs >= rhs;
    default:
      return false;
  }
}

function evalSingleClause(rawClause: string, ctx: EvalContext): boolean {
  let clause = rawClause.trim();
  while (clause.startsWith('(') && clause.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < clause.length - 1; i++) {
      if (clause[i] === '(') depth++;
      else if (clause[i] === ')') depth--;
      if (depth === 0) {
        wrapsWhole = false;
        break;
      }
    }
    if (wrapsWhole) clause = clause.slice(1, -1).trim();
    else break;
  }

  if (!clause || clause === '1' || clause.toLowerCase() === 'true') return true;
  if (clause === '0' || clause.toLowerCase() === 'false') return false;

  // Negation like !Time or !(...)
  if (clause.startsWith('!')) {
    const inner = clause.slice(1).trim();
    if (/^time$/i.test(inner)) return ctx.stateTime === 0;
    if (/^animtime$/i.test(inner)) return ctx.animTime === 0;
    if (/^ailevel\b/i.test(inner)) return true;
    if (/^ctrl$/i.test(inner)) return ctx.ctrl === 0;
    if (/^movecontact$/i.test(inner)) return ctx.mode === 'fight' ? ctx.moveContact === 0 : true;
    if (/^movehit$/i.test(inner)) return ctx.mode === 'fight' ? ctx.moveHit === 0 : true;
    if (/^moveguarded$/i.test(inner)) return ctx.mode === 'fight' ? ctx.moveGuarded === 0 : true;
    return !evalSingleClause(inner, ctx);
  }

  // Hit confirms (real tracking in Fight Mode; inactive in Practice sandbox)
  const hitConfirmMatch = clause.match(/^(movecontact|movehit|moveguarded)(?:\s*(=|!=|<|<=|>|>=)\s*(-?\d+))?$/i);
  if (hitConfirmMatch) {
    const kind = hitConfirmMatch[1].toLowerCase();
    const val =
      ctx.mode === 'fight'
        ? kind === 'movecontact'
          ? ctx.moveContact
          : kind === 'movehit'
            ? ctx.moveHit
            : ctx.moveGuarded
        : 0;
    if (!hitConfirmMatch[2]) return val > 0;
    return compareOp(val, hitConfirmMatch[2], parseInt(hitConfirmMatch[3], 10));
  }

  // Player / Environment guards
  const isHelperMatch = clause.match(/^ishelper(?:\s*\(\s*(\d+)\s*\))?(?:\s*(=|!=)\s*(\d+))?$/i);
  if (isHelperMatch) {
    const reqId = isHelperMatch[1] ? parseInt(isHelperMatch[1], 10) : undefined;
    const isH = ctx.isHelper && (reqId === undefined || ctx.helperId === reqId) ? 1 : 0;
    if (!isHelperMatch[2]) return isH === 1;
    const rhs = parseInt(isHelperMatch[3], 10);
    return isHelperMatch[2] === '=' ? isH === rhs : isH !== rhs;
  }
  const parentAliveMatch = clause.match(/^parent\s*,\s*alive(?:\s*(=|!=)\s*(\d+))?$/i);
  if (parentAliveMatch) {
    const pAlive = (ctx.parentLife ?? 1) > 0 ? 1 : 0;
    if (!parentAliveMatch[1]) return pAlive === 1;
    const rhs = parseInt(parentAliveMatch[2], 10);
    return parentAliveMatch[1] === '=' ? pAlive === rhs : pAlive !== rhs;
  }
  if (/^ailevel\b/i.test(clause)) return /=\s*0|<=\s*0|<\s*1/.test(clause);
  const aliveMatch = clause.match(/^alive(?:\s*(=|!=)\s*(\d+))?$/i);
  if (aliveMatch) {
    const isAlive = ctx.life > 0 ? 1 : 0;
    if (!aliveMatch[1]) return isAlive === 1;
    const rhs = parseInt(aliveMatch[2], 10);
    return aliveMatch[1] === '=' ? (rhs !== 0 ? isAlive === 1 : isAlive === 0) : (rhs !== 0 ? isAlive === 0 : isAlive === 1);
  }
  const numPartnerMatch = clause.match(/^numpartner\s*(=|!=|<|<=|>|>=)\s*(\d+)$/i);
  if (numPartnerMatch) {
    return compareOp(0, numPartnerMatch[1], parseInt(numPartnerMatch[2], 10));
  }
  const teamModeMatch = clause.match(/^teammode\s*(=|!=)\s*(\w+)$/i);
  if (teamModeMatch) {
    const mode = teamModeMatch[2].toLowerCase();
    const isSingle = mode === 'single' || mode === 'arcade';
    return teamModeMatch[1] === '=' ? isSingle : !isSingle;
  }
  if (/^ctrl$/i.test(clause)) return ctx.ctrl !== 0;

  const ctrlMatch = clause.match(/^ctrl\s*(=|!=)\s*(\d+)$/i);
  if (ctrlMatch) {
    return ctrlMatch[1] === '=' ? ctx.ctrl === parseInt(ctrlMatch[2], 10) : ctx.ctrl !== parseInt(ctrlMatch[2], 10);
  }

  const rsMatch = clause.match(/^roundstate\s*(=|!=|<|<=|>|>=)\s*(\d+)$/i);
  if (rsMatch) {
    return compareOp(2, rsMatch[1], parseInt(rsMatch[2], 10));
  }

  const powerMatch = clause.match(/^power\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (powerMatch) {
    // Fight mode checks real power meter; Practice mode lets user test hypers freely
    const effPower = ctx.mode === 'fight' ? ctx.power : Math.max(3000, ctx.maxPower);
    return compareOp(effPower, powerMatch[1], parseInt(powerMatch[2], 10));
  }

  const lifeMatch = clause.match(/^life\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (lifeMatch) {
    return compareOp(ctx.life, lifeMatch[1], parseInt(lifeMatch[2], 10));
  }

  const stateNoMatch = clause.match(/^stateno\s*(=|!=)\s*(-?\d+)$/i);
  if (stateNoMatch) {
    const t = parseInt(stateNoMatch[2], 10);
    return stateNoMatch[1] === '=' ? ctx.stateNo === t : ctx.stateNo !== t;
  }

  const prevStateNoMatch = clause.match(/^prevstateno\s*(=|!=)\s*(-?\d+)$/i);
  if (prevStateNoMatch) {
    const t = parseInt(prevStateNoMatch[2], 10);
    return prevStateNoMatch[1] === '=' ? ctx.prevStateNo === t : ctx.prevStateNo !== t;
  }

  // Time % M = R or Time % M != R
  const modMatch = clause.match(/^time\s*%\s*(\d+)\s*(=|!=|<|<=|>|>=)\s*(-?\d+(?:\.\d+)?)$/i);
  if (modMatch) {
    const mod = parseInt(modMatch[1], 10);
    const rhs = parseFloat(modMatch[3]);
    return mod > 0 ? compareOp(ctx.stateTime % mod, modMatch[2], rhs) : false;
  }

  // Time = [A, B] range check
  const rangeMatch = clause.match(/^time\s*(!?=)\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]$/i);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[2], 10);
    const hi = parseInt(rangeMatch[3], 10);
    const inRange = ctx.stateTime >= lo && ctx.stateTime <= hi;
    return rangeMatch[1] === '!=' ? !inRange : inRange;
  }

  // AnimElem = N, >= M (or AnimElem = N)
  const animElemOpMatch = clause.match(/^animelem\s*(=|!=|<|<=|>|>=)\s*(\d+)(?:\s*,\s*(=|!=|<|<=|>|>=)\s*(-?\d+))?$/i);
  if (animElemOpMatch) {
    const targetElem = parseInt(animElemOpMatch[2], 10);
    const op = animElemOpMatch[1];
    if (animElemOpMatch[3] && animElemOpMatch[4]) {
      return ctx.animElem === targetElem && compareOp(ctx.animElemTick, animElemOpMatch[3], parseInt(animElemOpMatch[4], 10));
    }
    if (op === '=') {
      return ctx.animElem === targetElem && ctx.animElemTick === 0;
    }
    return compareOp(ctx.animElem, op, targetElem);
  }

  // AnimElemTime(N) <op> M (across entire animation timeline)
  const animElemTimeMatch = clause.match(/^animelemtime\s*\(\s*(\d+)\s*\)\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (animElemTimeMatch) {
    const targetElem = parseInt(animElemTimeMatch[1], 10);
    const op = animElemTimeMatch[2];
    const rhs = parseInt(animElemTimeMatch[3], 10);
    if (ctx.actElements && ctx.actElements.length > 0) {
      if (targetElem < 1 || targetElem > ctx.actElements.length) return false;
      const curIdx = ctx.animElem - 1;
      const tgtIdx = targetElem - 1;
      let elemTimeVal = ctx.animElemTick;
      if (tgtIdx < curIdx) {
        let elapsed = ctx.animElemTick;
        for (let i = tgtIdx; i < curIdx; i++) {
          const d = ctx.actElements[i]?.time ?? 1;
          elapsed += d < 0 ? 999999 : Math.max(1, d);
        }
        elemTimeVal = elapsed;
      } else if (tgtIdx > curIdx) {
        const curDur = ctx.actElements[curIdx]?.time ?? 1;
        let rem = curDur < 0 ? 999999 : Math.max(1, curDur - ctx.animElemTick);
        for (let i = curIdx + 1; i < tgtIdx; i++) {
          const d = ctx.actElements[i]?.time ?? 1;
          rem += d < 0 ? 999999 : Math.max(1, d);
        }
        elemTimeVal = -rem;
      }
      return compareOp(elemTimeVal, op, rhs);
    }
    if (ctx.animElem !== targetElem) return false;
    return compareOp(ctx.animElemTick, op, rhs);
  }

  // AnimElem = [A, B]
  const animElemRangeMatch = clause.match(/^animelem\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]$/i);
  if (animElemRangeMatch) {
    const lo = parseInt(animElemRangeMatch[1], 10);
    const hi = parseInt(animElemRangeMatch[2], 10);
    return ctx.animElem >= lo && ctx.animElem <= hi;
  }

  // AnimTime <op> N
  const animTimeMatch = clause.match(/^animtime\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (animTimeMatch) {
    return compareOp(ctx.animTime, animTimeMatch[1], parseInt(animTimeMatch[2], 10));
  }

  // Time / StateTime <op> N
  const timeMatch = clause.match(/^(?:state)?time\s*(=|!=|<|<=|>|>=)\s*(-?\d+(?:\.\d+)?)$/i);
  if (timeMatch) {
    return compareOp(ctx.stateTime, timeMatch[1], parseFloat(timeMatch[2]));
  }

  // Anim <op> N
  const animMatch = clause.match(/^anim\s*(=|!=)\s*(\d+)$/i);
  if (animMatch) {
    return animMatch[1] === '=' ? ctx.animId === parseInt(animMatch[2], 10) : ctx.animId !== parseInt(animMatch[2], 10);
  }

  // Pos Y / Vel Y / Vel X
  const posYMatch = clause.match(/^pos\s+y\s*(=|!=|<|<=|>|>=)\s*(.+)$/i);
  if (posYMatch) {
    const rhs = evalMugenNumber(posYMatch[2], ctx);
    return rhs !== null ? compareOp(ctx.posY, posYMatch[1], rhs) : false;
  }
  const velYMatch = clause.match(/^vel\s+y\s*(=|!=|<|<=|>|>=)\s*(.+)$/i);
  if (velYMatch) {
    const rhs = evalMugenNumber(velYMatch[2], ctx);
    return rhs !== null ? compareOp(ctx.velY, velYMatch[1], rhs) : false;
  }
  const velXMatch = clause.match(/^vel\s+x\s*(=|!=|<|<=|>|>=)\s*(.+)$/i);
  if (velXMatch) {
    const rhs = evalMugenNumber(velXMatch[2], ctx);
    return rhs !== null ? compareOp(ctx.velX, velXMatch[1], rhs) : false;
  }

  // AnimElemNo(0) <op> N
  const animElemNoMatch = clause.match(/^animelemno\s*\([^)]*\)\s*(=|!=|<|<=|>|>=)\s*(\d+)$/i);
  if (animElemNoMatch) {
    return compareOp(ctx.animElem, animElemNoMatch[1], parseInt(animElemNoMatch[2], 10));
  }

  // StateType / MoveType / Physics
  const stMatch = clause.match(/^statetype\s*(=|!=)\s*([SCAL])$/i);
  if (stMatch) {
    const target = stMatch[2].toUpperCase();
    return stMatch[1] === '=' ? ctx.stateType === target : ctx.stateType !== target;
  }
  const mtMatch = clause.match(/^movetype\s*(=|!=)\s*([IAH])$/i);
  if (mtMatch) {
    const target = mtMatch[2].toUpperCase();
    return mtMatch[1] === '=' ? ctx.moveType === target : ctx.moveType !== target;
  }
  const phMatch = clause.match(/^physics\s*(=|!=)\s*([SCAN])$/i);
  if (phMatch) {
    const target = phMatch[2].toUpperCase();
    return phMatch[1] === '=' ? ctx.physics === target : ctx.physics !== target;
  }

  // numhelper(ID) or numhelper
  const numHelperMatch = clause.match(/^numhelper(?:\s*\(\s*(\d+)\s*\))?(?:\s*(=|!=|<|<=|>|>=)\s*(-?\d+))?$/i);
  if (numHelperMatch) {
    const targetHId = numHelperMatch[1] ? parseInt(numHelperMatch[1], 10) : undefined;
    const activeHelpers = ctx.helpers || [];
    const count = activeHelpers.filter(h =>
      (ctx.ownerId ? h.ownerId === ctx.ownerId : true) &&
      (targetHId !== undefined ? h.helperId === targetHId : true) &&
      h.life > 0
    ).length;
    if (!numHelperMatch[2]) return count > 0;
    return compareOp(count, numHelperMatch[2], parseInt(numHelperMatch[3], 10));
  }

  // numexplod(ID) or numexplod
  const numExplodMatch = clause.match(/^numexplod(?:\s*\(\s*(\d+)\s*\))?(?:\s*(=|!=|<|<=|>|>=)\s*(-?\d+))?$/i);
  if (numExplodMatch) {
    const targetEId = numExplodMatch[1] ? parseInt(numExplodMatch[1], 10) : undefined;
    const activeExplods = ctx.explods || [];
    const count = activeExplods.filter(e =>
      (ctx.ownerId ? e.ownerId === ctx.ownerId : true) &&
      (targetEId !== undefined ? e.explodId === targetEId : true)
    ).length;
    if (!numExplodMatch[2]) return count > 0;
    return compareOp(count, numExplodMatch[2], parseInt(numExplodMatch[3], 10));
  }

  // numproj / numprojid(ID)
  const numProjMatch = clause.match(/^numproj(?:id)?(?:\s*\(\s*(\d+)\s*\))?(?:\s*(=|!=|<|<=|>|>=)\s*(-?\d+))?$/i);
  if (numProjMatch) {
    const targetPId = numProjMatch[1] ? parseInt(numProjMatch[1], 10) : undefined;
    const activeProj = ctx.projectiles || [];
    const count = activeProj.filter(p =>
      (ctx.ownerId ? p.ownerId === ctx.ownerId : true) &&
      (targetPId !== undefined ? p.projId === targetPId : true) &&
      !p.isHitOrDying
    ).length;
    if (!numProjMatch[2]) return count > 0;
    return compareOp(count, numProjMatch[2], parseInt(numProjMatch[3], 10));
  }

  // FrontEdgeBodyDist / FrontEdgeDist / BackEdgeBodyDist
  const frontDistMatch = clause.match(/^(?:frontedgebodydist|frontedgedist)\s*(=|!=|<|<=|>|>=)\s*(-?\d+(?:\.\d+)?)$/i);
  if (frontDistMatch) {
    const facing = ctx.facing ?? 1;
    const edgeX = facing === 1 ? 520 : -520;
    const distToEdge = (edgeX - ctx.posX) * facing;
    return compareOp(distToEdge, frontDistMatch[1], parseFloat(frontDistMatch[2]));
  }

  const backDistMatch = clause.match(/^(?:backedgebodydist|backedgedist)\s*(=|!=|<|<=|>|>=)\s*(-?\d+(?:\.\d+)?)$/i);
  if (backDistMatch) {
    const facing = ctx.facing ?? 1;
    const edgeX = facing === 1 ? -520 : 520;
    const distToEdge = (ctx.posX - edgeX) * facing;
    return compareOp(distToEdge, backDistMatch[1], parseFloat(backDistMatch[2]));
  }

  // Character vars default to 0 at move start
  const varCompareMatch = clause.match(/^(?:var|fvar|sysvar)\s*\([^)]*\)\s*(=|!=|<|<=|>|>=)\s*(-?\d+(?:\.\d+)?)$/i);
  if (varCompareMatch) {
    return compareOp(0, varCompareMatch[1], parseFloat(varCompareMatch[2]));
  }
  if (/^(?:var|fvar|sysvar)\s*\(/i.test(clause)) {
    return false;
  }

  const cmdHoldMatch = clause.match(/^command\s*(=|!=)\s*"([^"]+)"$/i);
  if (cmdHoldMatch) {
    const rawCmd = cmdHoldMatch[2].trim().toLowerCase();
    const dirCmd = rawCmd.replace(/_/g, '');
    if (dirCmd === 'holdfwd' || dirCmd === 'holdback' || dirCmd === 'holdup' || dirCmd === 'holddown') {
      const isHeld = Boolean(ctx.heldCmds?.has(dirCmd));
      return cmdHoldMatch[1] === '=' ? isHeld : !isHeld;
    }
    const isPressed = Boolean(ctx.pressedCmds?.has(rawCmd) || ctx.pressedCmds?.has(dirCmd));
    return cmdHoldMatch[1] === '=' ? isPressed : !isPressed;
  }

  if (ctx.mode === 'fight' && ctx.p2BodyDistX !== undefined) {
    const p2DistMatch = clause.match(/^p2(?:body)?dist\s+x\s*(=|!=|<|<=|>|>=)\s*(-?\d+(?:\.\d+)?)$/i);
    if (p2DistMatch) {
      return compareOp(ctx.p2BodyDistX, p2DistMatch[1], parseFloat(p2DistMatch[2]));
    }
    const p2DistYMatch = clause.match(/^p2(?:body)?dist\s+y\s*(=|!=|<|<=|>|>=)\s*(-?\d+(?:\.\d+)?)$/i);
    if (p2DistYMatch && ctx.p2PosY !== undefined) {
      return compareOp(ctx.p2PosY - ctx.posY, p2DistYMatch[1], parseFloat(p2DistYMatch[2]));
    }
  }

  // Opponent / hit-counter triggers commonly used in HitDef controllers
  const p2StMatch = clause.match(/^(?:p2statetype|enemy(?:near)?\s*,\s*statetype)\s*(=|!=)\s*([SCAL])$/i);
  if (p2StMatch && ctx.p2StateType) {
    const target = p2StMatch[2].toUpperCase();
    return p2StMatch[1] === '=' ? ctx.p2StateType === target : ctx.p2StateType !== target;
  }
  const p2MtMatch = clause.match(/^(?:p2movetype|enemy(?:near)?\s*,\s*movetype)\s*(=|!=)\s*([IAH])$/i);
  if (p2MtMatch && ctx.p2MoveType) {
    const target = p2MtMatch[2].toUpperCase();
    return p2MtMatch[1] === '=' ? ctx.p2MoveType === target : ctx.p2MoveType !== target;
  }
  const p2SnoMatch = clause.match(/^(?:p2stateno|enemy(?:near)?\s*,\s*stateno)\s*(=|!=)\s*(-?\d+)$/i);
  if (p2SnoMatch && ctx.p2StateNo !== undefined) {
    const target = parseInt(p2SnoMatch[2], 10);
    return p2SnoMatch[1] === '=' ? ctx.p2StateNo === target : ctx.p2StateNo !== target;
  }
  const p2LifeMatch = clause.match(/^(?:p2life|enemy(?:near)?\s*,\s*life)\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (p2LifeMatch && ctx.p2Life !== undefined) {
    return compareOp(ctx.p2Life, p2LifeMatch[1], parseInt(p2LifeMatch[2], 10));
  }

  const hitCntMatch = clause.match(/^(?:uniq)?hitcount\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (hitCntMatch) {
    return compareOp(ctx.moveHit > 0 ? 1 : 0, hitCntMatch[1], parseInt(hitCntMatch[2], 10));
  }
  const numTgtMatch = clause.match(/^numtarget(?:\s*\([^)]*\))?\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (numTgtMatch) {
    return compareOp(ctx.moveContact > 0 ? 1 : 0, numTgtMatch[1], parseInt(numTgtMatch[2], 10));
  }
  if (/^movereversed$/i.test(clause)) return false;
  if (/^(?:hitover|hitshakeover)$/i.test(clause)) return true;
  const randomMatch = clause.match(/^random\s*(=|!=|<|<=|>|>=)\s*(-?\d+)$/i);
  if (randomMatch) {
    return compareOp(Math.floor(Math.random() * 1000), randomMatch[1], parseInt(randomMatch[2], 10));
  }

  // Opponent / command guards: do not prematurely fire command proximity transitions
  if (/^(p2|enemy|command)\b/i.test(clause)) {
    return false;
  }

  return false;
}

function evalTriggerExpr(expr: string, ctx: EvalContext): boolean {
  const orParts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && expr.slice(i, i + 2) === '||') {
      orParts.push(expr.slice(last, i));
      last = i + 2;
      i++;
    }
  }
  orParts.push(expr.slice(last));

  return orParts.some(orPart => {
    const andParts: string[] = [];
    let d2 = 0;
    let l2 = 0;
    for (let i = 0; i < orPart.length; i++) {
      const ch = orPart[i];
      if (ch === '(') d2++;
      else if (ch === ')') d2 = Math.max(0, d2 - 1);
      else if (d2 === 0 && orPart.slice(i, i + 2) === '&&') {
        andParts.push(orPart.slice(l2, i));
        l2 = i + 2;
        i++;
      }
    }
    andParts.push(orPart.slice(l2));
    return andParts.every(p => evalSingleClause(p, ctx));
  });
}

function doesControllerFire(ctrl: ParsedController, ctx: EvalContext): boolean {
  for (const ta of ctrl.triggerAll) {
    if (!evalTriggerExpr(ta, ctx)) return false;
  }
  const groupKeys = Object.keys(ctrl.triggerGroups).map(Number).sort((a, b) => a - b);
  if (groupKeys.length === 0) return false;

  for (const gk of groupKeys) {
    const lines = ctrl.triggerGroups[gk];
    if (lines.length > 0 && lines.every(l => evalTriggerExpr(l, ctx))) {
      return true;
    }
  }
  return false;
}

function isHoldDirCmd(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/_/g, '');
  return n === 'holddown' || n === 'holdfwd' || n === 'holdback' || n === 'holdup';
}

function parseCmdAndStates(cmdFiles: TextFileLike[], stFiles: TextFileLike[]) {
  const commands: ParsedCommandDef[] = [];
  const rules: ParsedChangeStateRule[] = [];
  const states: Record<number, ParsedStateInfo> = {};
  const constants: CharacterPhysicsConstants = { ...DEFAULT_CONSTANTS };

  const extractCommentLabel = (recentComments: string[], inlineComment: string): string => {
    if (inlineComment) {
      const cleaned = inlineComment.replace(/^;+\s*/, '').trim();
      if (cleaned && !/^[-=_*#]+$/.test(cleaned)) return cleaned;
    }
    for (let i = recentComments.length - 1; i >= 0; i--) {
      const c = recentComments[i].replace(/^;+\s*/, '').trim();
      if (
        c &&
        !/^[-=_*#|\s]+$/.test(c) &&
        !/^CNS difficulty:/i.test(c) &&
        !/^Format:/i.test(c)
      ) {
        return c;
      }
    }
    return '';
  };

  let ctrlSeqId = 0;

  const parseFile = (content: string) => {
    const lines = content.split(/\r?\n/);
    let currentSection = '';
    let activeStatedefNo: number | null = null;
    let recentComments: string[] = [];

    const parsePatternTokens = (pat: string): string[] =>
      pat
        .replace(/[~$/\d]+/g, '')
        .split(',')
        .map(t => t.replace(/\s+/g, '').trim())
        .filter(Boolean);

    const splitTopLevelOr = (expr: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let last = 0;
      for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (depth === 0 && expr.slice(i, i + 2) === '||') {
          parts.push(expr.slice(last, i));
          last = i + 2;
          i++;
        }
      }
      parts.push(expr.slice(last));
      return parts;
    };

    // [Command] scratch
    let cmdName = '';
    let cmdPattern = '';

    // [State ...] scratch
    let stateTypeCtrl = '';
    let stateValExpr = '';
    let stateValNum: number | null = null;
    let stateCmdRef = '';
    const matchedCommands: string[] = [];
    const requiredCommands: string[] = [];
    const requiredAllCommands: string[] = [];
    const requiredAllOrSets: string[][][] = [];
    const commandOrGroups: string[][] = [];
    const forbiddenCommands: string[] = [];
    const allowedStateTypes = new Set<'S' | 'C' | 'A'>();
    const forbiddenStateTypes = new Set<'S' | 'C' | 'A'>();
    let requireCtrl = false;
    let requiresP2Close = false;
    let triggerAllMinPower = 0;
    let branchMinPowers: number[] = [];
    let sndVal: { group: number; sample: number } | null = null;
    let xExpr: string | undefined;
    let yExpr: string | undefined;
    let persistent = 1;
    let superTime: number | undefined;
    let superMoveTime: number | undefined;
    let superPowerAdd: number | undefined;
    let ctrlStateTypeVal: 'S' | 'C' | 'A' | 'L' | undefined;
    let ctrlMoveTypeVal: 'I' | 'A' | 'H' | undefined;
    let ctrlPhysicsVal: 'S' | 'C' | 'A' | 'N' | undefined;
    let ctrlVal: number | undefined;
    let triggerAll: string[] = [];
    let triggerGroups: Record<number, string[]> = {};
    let ctrlHasAnimTimeEnd = false;
    let hitDefScratch: Partial<ParsedHitDef> & { hasGetPower?: boolean; hasGivePower?: boolean } = {};

    let ctrlProjId: number | undefined;
    let ctrlProjAnim: number | undefined;
    let ctrlProjHitAnim: number | undefined;
    let ctrlProjRemAnim: number | undefined;
    let ctrlProjCancelAnim: number | undefined;
    let ctrlProjVelX: number | undefined;
    let ctrlProjVelY: number | undefined;
    let ctrlProjOffsetX: number | undefined;
    let ctrlProjOffsetY: number | undefined;
    let ctrlProjRemoveTime: number | undefined;

    let ctrlHelperType: 'normal' | 'player' | undefined;
    let ctrlHelperName: string | undefined;
    let ctrlHelperId: number | undefined;
    let ctrlHelperStateNo: number | undefined;
    let ctrlHelperOffsetX: number | undefined;
    let ctrlHelperOffsetY: number | undefined;
    let ctrlHelperPosType: 'p1' | 'p2' | 'front' | 'back' | 'left' | 'right' | undefined;
    let ctrlHelperFacing: 1 | -1 | undefined;
    let ctrlHelperKeyCtrl: number | undefined;
    let ctrlHelperOwnPal: number | undefined;

    let ctrlExplodAnim: number | undefined;
    let ctrlExplodId: number | undefined;
    let ctrlExplodOffsetX: number | undefined;
    let ctrlExplodOffsetY: number | undefined;
    let ctrlExplodPosType: 'p1' | 'p2' | 'front' | 'back' | 'left' | 'right' | undefined;
    let ctrlExplodFacing: 1 | -1 | undefined;
    let ctrlExplodVFacing: 1 | -1 | undefined;
    let ctrlExplodBindTime: number | undefined;
    let ctrlExplodVelX: number | undefined;
    let ctrlExplodVelY: number | undefined;
    let ctrlExplodRemoveTime: number | undefined;
    let ctrlExplodScaleX: number | undefined;
    let ctrlExplodScaleY: number | undefined;
    let ctrlExplodSprPriority: number | undefined;
    let ctrlExplodOwnPal: number | undefined;

    const resetControllerScratch = () => {
      cmdName = '';
      cmdPattern = '';
      stateTypeCtrl = '';
      stateValExpr = '';
      stateValNum = null;
      stateCmdRef = '';
      matchedCommands.length = 0;
      requiredCommands.length = 0;
      requiredAllCommands.length = 0;
      requiredAllOrSets.length = 0;
      commandOrGroups.length = 0;
      forbiddenCommands.length = 0;
      allowedStateTypes.clear();
      forbiddenStateTypes.clear();
      requireCtrl = false;
      requiresP2Close = false;
      triggerAllMinPower = 0;
      branchMinPowers = [];
      sndVal = null;
      xExpr = undefined;
      yExpr = undefined;
      persistent = 1;
      superTime = undefined;
      superMoveTime = undefined;
      superPowerAdd = undefined;
      ctrlStateTypeVal = undefined;
      ctrlMoveTypeVal = undefined;
      ctrlPhysicsVal = undefined;
      ctrlVal = undefined;
      triggerAll = [];
      triggerGroups = {};
      ctrlHasAnimTimeEnd = false;
      hitDefScratch = {};

      ctrlProjId = undefined;
      ctrlProjAnim = undefined;
      ctrlProjHitAnim = undefined;
      ctrlProjRemAnim = undefined;
      ctrlProjCancelAnim = undefined;
      ctrlProjVelX = undefined;
      ctrlProjVelY = undefined;
      ctrlProjOffsetX = undefined;
      ctrlProjOffsetY = undefined;
      ctrlProjRemoveTime = undefined;

      ctrlHelperType = undefined;
      ctrlHelperName = undefined;
      ctrlHelperId = undefined;
      ctrlHelperStateNo = undefined;
      ctrlHelperOffsetX = undefined;
      ctrlHelperOffsetY = undefined;
      ctrlHelperPosType = undefined;
      ctrlHelperFacing = undefined;
      ctrlHelperKeyCtrl = undefined;
      ctrlHelperOwnPal = undefined;

      ctrlExplodAnim = undefined;
      ctrlExplodId = undefined;
      ctrlExplodOffsetX = undefined;
      ctrlExplodOffsetY = undefined;
      ctrlExplodPosType = undefined;
      ctrlExplodFacing = undefined;
      ctrlExplodVFacing = undefined;
      ctrlExplodBindTime = undefined;
      ctrlExplodVelX = undefined;
      ctrlExplodVelY = undefined;
      ctrlExplodRemoveTime = undefined;
      ctrlExplodScaleX = undefined;
      ctrlExplodScaleY = undefined;
      ctrlExplodSprPriority = undefined;
      ctrlExplodOwnPal = undefined;
    };

    const ensureState = (stateNo: number, labelHint?: string, resetOnNewDef = false): ParsedStateInfo => {
      if (!states[stateNo]) {
        states[stateNo] = {
          stateNo,
          label: labelHint || defaultLabelForState(stateNo),
          stateType: 'S',
          moveType: 'I',
          physics: 'S',
          moveX: 0,
          moveY: 0,
          hasExplicitVel: false,
          isHyper: false,
          isCrouch: stateNo === 10 || stateNo === 11 || stateNo === 12 || (stateNo >= 400 && stateNo < 500),
          isHopBack: stateNo === 105 || stateNo === 106,
          category: 'other',
          endToState: stateNo === 11 || stateNo === 10 ? 11 : 0,
          sounds: [],
          controllers: [],
          rawText: '',
        };
      } else if (resetOnNewDef) {
        states[stateNo].controllers = [];
        states[stateNo].sounds = [];
        states[stateNo].moveX = 0;
        states[stateNo].moveY = 0;
        states[stateNo].hasExplicitVel = false;
        states[stateNo].powerAdd = undefined;
        states[stateNo].endToState = stateNo === 11 || stateNo === 10 ? 11 : 0;
      }
      return states[stateNo];
    };

    const flushStateController = () => {
      const secLower = currentSection.toLowerCase();
      if (secLower === 'command' && cmdName && cmdPattern) {
        const cleanTokens = parsePatternTokens(cmdPattern);
        const normKey = cleanTokens.join(',').toLowerCase();
        if (
          cleanTokens.length > 0 &&
          !commands.some(c => c.name === cmdName && c.cleanTokens.join(',').toLowerCase() === normKey)
        ) {
          const chordWeight = cleanTokens.reduce(
            (sum, t) => sum + Math.max(1, t.split('+').filter(Boolean).length),
            0
          );
          commands.push({
            name: cmdName,
            pattern: cmdPattern,
            cleanTokens,
            tokenCount: cleanTokens.length,
            chordWeight,
          });
        }
      }

      if (/^state(?:\s|,|\d|-|$)/i.test(secLower) && !secLower.startsWith('statedef')) {
        const commaIdx = currentSection.indexOf(',');
        const sectionLabel = commaIdx !== -1 ? currentSection.slice(commaIdx + 1).trim() : '';
        const isGlobalCmdState =
          activeStatedefNo === -1 ||
          activeStatedefNo === -2 ||
          activeStatedefNo === -3 ||
          /^State\s*-\s*[123]\b/i.test(currentSection);

        if (stateTypeCtrl === 'changestate' && stateValNum !== null) {
          if (isGlobalCmdState && (stateCmdRef || requiredAllCommands.length > 0 || commandOrGroups.length > 0)) {
            const minBranchPower = branchMinPowers.length > 0 ? Math.min(...branchMinPowers) : 0;
            let resolvedAllowed: ('S' | 'C' | 'A')[] = [];
            if (allowedStateTypes.size > 0) {
              const filtered = Array.from(allowedStateTypes).filter(t => !forbiddenStateTypes.has(t));
              resolvedAllowed = filtered.length > 0 ? filtered : Array.from(allowedStateTypes);
            } else if (forbiddenStateTypes.size > 0) {
              resolvedAllowed = (['S', 'C', 'A'] as const).filter(t => !forbiddenStateTypes.has(t));
            }
            rules.push({
              commandName: stateCmdRef || requiredAllCommands[0] || commandOrGroups[0]?.[0] || '',
              matchedCommands: matchedCommands.length > 0 ? [...matchedCommands] : [stateCmdRef],
              requiredCommands: [...requiredCommands],
              requiredAllCommands: [...requiredAllCommands],
              requiredAllOrSets: [...requiredAllOrSets],
              commandOrGroups: [...commandOrGroups],
              forbiddenCommands: [...forbiddenCommands],
              allowedStateTypes: resolvedAllowed,
              targetState: stateValNum,
              requireCtrl,
              requiresP2Close,
              minPowerRequired: Math.max(triggerAllMinPower, minBranchPower),
              label: sectionLabel && !/^\d+$/.test(sectionLabel) ? sectionLabel : undefined,
            });
          } else if (activeStatedefNo !== null && states[activeStatedefNo] && ctrlHasAnimTimeEnd) {
            states[activeStatedefNo].endToState = stateValNum;
          }
        }

        const sdMatch = currentSection.match(/^State\s*(-?\d+)/i);
        const ownerState = activeStatedefNo !== null ? activeStatedefNo : (sdMatch ? parseInt(sdMatch[1], 10) : null);

        if (ownerState !== null && ownerState >= 0) {
          const st = ensureState(ownerState);

          if (stateTypeCtrl === 'playsnd' && sndVal !== null) {
            st.sounds.push(sndVal);
          }

          if (stateTypeCtrl === 'superpause') {
            st.isHyper = true;
          }

          let builtHitDef: ParsedHitDef | undefined;
          if (stateTypeCtrl === 'hitdef' || stateTypeCtrl === 'projectile') {
            const attrMove = hitDefScratch.attrMove || (st.isHyper || ownerState >= 3000 ? 'H' : ownerState >= 1000 ? 'S' : 'N');
            const dmg = hitDefScratch.damage ?? (attrMove === 'H' ? 140 : attrMove === 'S' ? 85 : 42);
            const gDmg = hitDefScratch.guardDamage ?? (attrMove === 'N' ? 0 : Math.max(1, Math.round(dmg * 0.12)));
            const defaultGetHit = attrMove === 'H' ? 0 : Math.max(20, Math.round(dmg * 0.85));
            const defaultGetGuard = attrMove === 'H' ? 0 : Math.max(10, Math.round(dmg * 0.42));
            const defaultGiveHit = Math.max(12, Math.round(dmg * 0.35));
            const defaultGiveGuard = Math.max(6, Math.round(dmg * 0.18));
            const gvy = hitDefScratch.groundVelY ?? 0;
            const avx = hitDefScratch.airVelX ?? -3.2;
            const avy = hitDefScratch.airVelY ?? -4.5;
            builtHitDef = {
              attr: hitDefScratch.attr || (st.stateType === 'A' ? 'A' : st.stateType === 'C' ? 'C' : 'S'),
              attrMove,
              hitFlag: hitDefScratch.hitFlag ?? 'MAF',
              guardFlag: hitDefScratch.guardFlag ?? 'MA',
              damage: dmg,
              guardDamage: gDmg,
              getPowerHit: hitDefScratch.hasGetPower ? (hitDefScratch.getPowerHit ?? 0) : defaultGetHit,
              getPowerGuard: hitDefScratch.hasGetPower ? (hitDefScratch.getPowerGuard ?? 0) : defaultGetGuard,
              givePowerHit: hitDefScratch.hasGivePower ? (hitDefScratch.givePowerHit ?? 0) : defaultGiveHit,
              givePowerGuard: hitDefScratch.hasGivePower ? (hitDefScratch.givePowerGuard ?? 0) : defaultGiveGuard,
              pauseP1: hitDefScratch.pauseP1 ?? (attrMove === 'H' ? 10 : 8),
              pauseP2: hitDefScratch.pauseP2 ?? (attrMove === 'H' ? 10 : 8),
              groundVelX: hitDefScratch.groundVelX ?? -4.5,
              groundVelY: gvy,
              airVelX: avx,
              airVelY: avy,
              guardVelX: hitDefScratch.guardVelX ?? (hitDefScratch.groundVelX !== undefined ? hitDefScratch.groundVelX * 0.85 : -4),
              groundHittime: hitDefScratch.groundHittime ?? (dmg >= 70 ? 18 : 13),
              airHittime: hitDefScratch.airHittime ?? 16,
              guardHittime: hitDefScratch.guardHittime ?? 12,
              fall: hitDefScratch.fall ?? gvy < -0.5,
              hitSound: hitDefScratch.hitSound,
              guardSound: hitDefScratch.guardSound,
            };
          }

          const supportedTypes: ControllerType[] = [
            'velset',
            'veladd',
            'velmul',
            'posadd',
            'posset',
            'gravity',
            'superpause',
            'poweradd',
            'hitdef',
            'changestate',
            'changeanim',
            'playsnd',
            'statetypeset',
            'ctrlset',
            'projectile',
            'helper',
            'explod',
            'removeexplod',
            'modifyexplod',
            'destroyself',
          ];

          if (supportedTypes.includes(stateTypeCtrl as ControllerType)) {
            st.controllers.push({
              id: `ctrl-${++ctrlSeqId}`,
              type: stateTypeCtrl as ControllerType,
              triggerAll: [...triggerAll],
              triggerGroups: { ...triggerGroups },
              persistent,
              xExpr,
              yExpr,
              valueExpr: stateValExpr || undefined,
              sndValue: sndVal || undefined,
              superTime,
              superMoveTime,
              superPowerAdd,
              hitDef: builtHitDef,
              stateTypeVal: ctrlStateTypeVal,
              moveTypeVal: ctrlMoveTypeVal,
              physicsVal: ctrlPhysicsVal,
              ctrlVal,
              projId: ctrlProjId,
              projAnim: ctrlProjAnim,
              projHitAnim: ctrlProjHitAnim,
              projRemAnim: ctrlProjRemAnim,
              projCancelAnim: ctrlProjCancelAnim,
              projVelX: ctrlProjVelX,
              projVelY: ctrlProjVelY,
              projOffsetX: ctrlProjOffsetX,
              projOffsetY: ctrlProjOffsetY,
              projRemoveTime: ctrlProjRemoveTime,
              helperType: ctrlHelperType,
              helperName: ctrlHelperName,
              helperId: ctrlHelperId,
              helperStateNo: ctrlHelperStateNo,
              helperOffsetX: ctrlHelperOffsetX,
              helperOffsetY: ctrlHelperOffsetY,
              helperPosType: ctrlHelperPosType,
              helperFacing: ctrlHelperFacing,
              helperKeyCtrl: ctrlHelperKeyCtrl,
              helperOwnPal: ctrlHelperOwnPal,
              explodAnim: ctrlExplodAnim,
              explodId: ctrlExplodId,
              explodOffsetX: ctrlExplodOffsetX,
              explodOffsetY: ctrlExplodOffsetY,
              explodPosType: ctrlExplodPosType,
              explodFacing: ctrlExplodFacing,
              explodVFacing: ctrlExplodVFacing,
              explodBindTime: ctrlExplodBindTime,
              explodVelX: ctrlExplodVelX,
              explodVelY: ctrlExplodVelY,
              explodRemoveTime: ctrlExplodRemoveTime,
              explodScaleX: ctrlExplodScaleX,
              explodScaleY: ctrlExplodScaleY,
              explodSprPriority: ctrlExplodSprPriority,
              explodOwnPal: ctrlExplodOwnPal,
            });
          }

          // Track non-zero movement hints for Statedef search/badges
          if (stateTypeCtrl === 'velset' || stateTypeCtrl === 'veladd' || stateTypeCtrl === 'posadd') {
            const dummyCtx: EvalContext = {
              stateTime: 0,
              animElem: 1,
              animElemTick: 0,
              animId: st.anim ?? ownerState,
              animTime: -1,
              posX: 0,
              posY: 0,
              velX: 0,
              velY: 0,
              stateType: st.stateType,
              moveType: st.moveType,
              physics: st.physics,
              stateNo: ownerState,
              prevStateNo: 0,
              ctrl: 0,
              life: constants.life,
              maxLife: constants.life,
              power: constants.power,
              maxPower: constants.power,
              moveContact: 0,
              moveHit: 0,
              moveGuarded: 0,
              mode: 'practice',
              constants,
            };
            const nx = evalMugenNumber(xExpr, dummyCtx);
            const ny = evalMugenNumber(yExpr, dummyCtx);
            if (nx !== null && nx !== 0 && st.moveX === 0) {
              st.moveX = nx;
              st.hasExplicitVel = true;
            }
            if (ny !== null && ny !== 0 && st.moveY === 0) {
              st.moveY = ny;
              st.hasExplicitVel = true;
            }
          }
        }
      }
    };

    for (const raw of lines) {
      const semi = raw.indexOf(';');
      const code = (semi !== -1 ? raw.slice(0, semi) : raw).trim();
      const inlineComment = semi !== -1 ? raw.slice(semi) : '';

      if (activeStatedefNo !== null && states[activeStatedefNo]) {
        const nextSectionCheck = code.match(/^\[(.*)\]$/);
        if (!nextSectionCheck || (/^State(?:\s|,|\d|-|$)/i.test(nextSectionCheck[1].trim()) && !/^Statedef\b/i.test(nextSectionCheck[1].trim()))) {
          states[activeStatedefNo].rawText += raw + '\n';
        }
      }

      if (!code) {
        if (inlineComment.trim()) {
          recentComments.push(inlineComment.trim());
          if (recentComments.length > 6) recentComments.shift();
        }
        continue;
      }

      const secMatch = code.match(/^\[(.*)\]$/);
      if (secMatch) {
        flushStateController();
        currentSection = secMatch[1].trim();
        resetControllerScratch();

        const sdMatch = currentSection.match(/^Statedef\s+(-?\d+)/i);
        if (sdMatch) {
          activeStatedefNo = parseInt(sdMatch[1], 10);
          if (activeStatedefNo >= 0) {
            const commentLabel = extractCommentLabel(recentComments, inlineComment);
            const st = ensureState(activeStatedefNo, commentLabel, true);
            if (commentLabel) st.label = commentLabel;
            st.rawText = (recentComments.slice(-3).join('\n') + '\n' + raw + '\n').trimStart();
          }
        } else if (!/^State(?:\s|,|\d|-|$)/i.test(currentSection)) {
          activeStatedefNo = null;
        }
        recentComments = [];
        continue;
      }

      recentComments = [];
      const eq = code.indexOf('=');
      if (eq === -1) continue;
      const key = code.slice(0, eq).trim().toLowerCase();
      const val = code.slice(eq + 1).trim();
      const secLower = currentSection.toLowerCase();

      if (secLower === 'data') {
        const n = parseFloat(val);
        if (!Number.isNaN(n)) {
          if (key === 'life' && n >= 50) constants.life = Math.round(n);
          else if (key === 'power' && n >= 500) constants.power = Math.round(n);
          else if (key === 'attack' && n >= 10) constants.attack = n;
          else if ((key === 'defence' || key === 'defense') && n >= 10) constants.defence = n;
        }
      } else if (secLower === 'velocity') {
        const [x, y] = parseNumberPair(val);
        if (key === 'walk.fwd' && x !== undefined) constants.walkFwd = x;
        else if (key === 'walk.back' && x !== undefined) constants.walkBack = x;
        else if (key === 'run.fwd') {
          if (x !== undefined) constants.runFwdX = x;
          if (y !== undefined) constants.runFwdY = y;
        } else if (key === 'run.back') {
          if (x !== undefined) constants.runBackX = x;
          if (y !== undefined) constants.runBackY = y;
        } else if (key === 'jump.neu') {
          if (x !== undefined) constants.jumpNeuX = x;
          if (y !== undefined) constants.jumpNeuY = y;
        } else if (key === 'jump.fwd' && x !== undefined) constants.jumpFwdX = x;
        else if (key === 'jump.back' && x !== undefined) constants.jumpBackX = x;
        else if (key === 'airjump.neu' && y !== undefined) constants.airJumpY = y;
      } else if (secLower === 'movement') {
        const n = parseFloat(val);
        if (key === 'yaccel' && !Number.isNaN(n) && n > 0) constants.yaccel = n;
        else if (key === 'stand.friction' && !Number.isNaN(n)) constants.standFriction = n;
        else if (key === 'crouch.friction' && !Number.isNaN(n)) constants.crouchFriction = n;
      } else if (secLower === 'command') {
        if (key === 'name') cmdName = val.replace(/^"|"$/g, '');
        if (key === 'command') cmdPattern = val;
      } else if (secLower.startsWith('statedef') && activeStatedefNo !== null && activeStatedefNo >= 0) {
        const st = states[activeStatedefNo];
        if (!st) continue;
        if (key === 'anim') {
          const parsedAnim = /^-?\d+$/.test(val)
            ? parseInt(val, 10)
            : evalMugenNumber(val, {
                stateTime: 0,
                animElem: 1,
                animElemTick: 0,
                animId: activeStatedefNo,
                animTime: -1,
                posX: 0,
                posY: 0,
                velX: 0,
                velY: 0,
                stateType: st.stateType,
                moveType: st.moveType,
                physics: st.physics,
                stateNo: activeStatedefNo,
                prevStateNo: 0,
                ctrl: 0,
                life: constants.life,
                maxLife: constants.life,
                power: constants.power,
                maxPower: constants.power,
                moveContact: 0,
                moveHit: 0,
                moveGuarded: 0,
                mode: 'practice',
                constants,
              });
          if (parsedAnim !== null && Number.isFinite(parsedAnim)) st.anim = Math.trunc(parsedAnim);
        } else if (key === 'type') {
          const t = val.toUpperCase().charAt(0);
          if (t === 'S' || t === 'C' || t === 'A' || t === 'L') st.stateType = t;
          if (t === 'C') st.isCrouch = true;
        } else if (key === 'movetype') {
          const m = val.toUpperCase().charAt(0);
          if (m === 'I' || m === 'A' || m === 'H') st.moveType = m;
        } else if (key === 'physics') {
          const p = val.toUpperCase().charAt(0);
          if (p === 'S' || p === 'C' || p === 'A' || p === 'N') st.physics = p;
        } else if (key === 'velset') {
          const [vx, vy] = parseNumberPair(val);
          if (vx !== undefined) {
            st.velSetX = vx;
            st.moveX = vx;
          }
          if (vy !== undefined) {
            st.velSetY = vy;
            st.moveY = vy;
          }
          if ((vx !== undefined && vx !== 0) || (vy !== undefined && vy !== 0)) {
            st.hasExplicitVel = true;
          }
        } else if (key === 'poweradd') {
          const pw = parseInt(val, 10);
          if (!Number.isNaN(pw)) {
            st.powerAdd = pw;
            if (pw <= -1000) st.isHyper = true;
          }
        } else if (key === 'attr') {
          if (/\bH[APT]\b/i.test(val) || /,\s*H/i.test(val)) {
            st.isHyper = true;
          }
        } else if (key === 'ctrl') {
          const c = parseInt(val, 10);
          if (c === 0 || c === 1) st.ctrlVal = c;
        } else if (key === 'hitdefpersist') {
          const n = parseInt(val, 10);
          if (n === 1) st.hitDefPersist = true;
        } else if (key === 'movehitpersist') {
          const n = parseInt(val, 10);
          if (n === 1) st.moveHitPersist = true;
        }
      } else if (/^state(?:\s|,|\d|-|$)/i.test(secLower)) {
        if (key === 'type') {
          stateTypeCtrl = val.toLowerCase();
        } else if (key === 'persistent') {
          const p = parseInt(val, 10);
          if (!Number.isNaN(p)) persistent = p;
        } else if (key === 'value') {
          stateValExpr = val;
          if (/^-?\d+$/.test(val)) stateValNum = parseInt(val, 10);
          if (stateTypeCtrl === 'playsnd') {
            const pair = parseSoundPair(val);
            if (pair) sndVal = pair;
          } else if (stateTypeCtrl === 'ctrlset' && /^-?\d+$/.test(val)) {
            ctrlVal = parseInt(val, 10);
          }
        } else if (key === 'ctrl' && (stateTypeCtrl === 'changestate' || stateTypeCtrl === 'ctrlset') && /^-?\d+$/.test(val)) {
          ctrlVal = parseInt(val, 10);
        } else if (key === 'time' && stateTypeCtrl === 'superpause') {
          const n = parseInt(val, 10);
          if (!Number.isNaN(n)) superTime = n;
        } else if (key === 'movetime' && stateTypeCtrl === 'superpause') {
          const n = parseInt(val, 10);
          if (!Number.isNaN(n)) superMoveTime = n;
        } else if (key === 'poweradd' && stateTypeCtrl === 'superpause') {
          const n = parseInt(val, 10);
          if (!Number.isNaN(n)) superPowerAdd = n;
        } else if (key === 'statetype' && stateTypeCtrl === 'statetypeset') {
          const t = val.toUpperCase().charAt(0);
          if (t === 'S' || t === 'C' || t === 'A' || t === 'L') ctrlStateTypeVal = t;
        } else if (key === 'movetype' && stateTypeCtrl === 'statetypeset') {
          const m = val.toUpperCase().charAt(0);
          if (m === 'I' || m === 'A' || m === 'H') ctrlMoveTypeVal = m;
        } else if (key === 'physics' && stateTypeCtrl === 'statetypeset') {
          const p = val.toUpperCase().charAt(0);
          if (p === 'S' || p === 'C' || p === 'A' || p === 'N') ctrlPhysicsVal = p;
        } else if (key === 'x') {
          xExpr = val;
        } else if (key === 'y') {
          yExpr = val;
        } else if (key === 'attr') {
          if (activeStatedefNo !== null && states[activeStatedefNo] && (/\bH[APT]\b/i.test(val) || /,\s*H/i.test(val))) {
            states[activeStatedefNo].isHyper = true;
          }
          if (stateTypeCtrl === 'hitdef' || stateTypeCtrl === 'projectile') {
            const parts = val.split(',').map(p => p.trim().toUpperCase());
            const stChar = parts[0]?.charAt(0);
            if (stChar === 'S' || stChar === 'C' || stChar === 'A') hitDefScratch.attr = stChar;
            const mvChar = parts[1]?.charAt(0);
            if (mvChar === 'N' || mvChar === 'S' || mvChar === 'H') hitDefScratch.attrMove = mvChar;
          }
        } else if (stateTypeCtrl === 'hitdef' || stateTypeCtrl === 'projectile') {
          if (key === 'hitflag') hitDefScratch.hitFlag = val.toUpperCase().replace(/[^MAFDLH+-]/g, '');
          else if (key === 'guardflag') hitDefScratch.guardFlag = val.toUpperCase().replace(/[^MAHL]/g, '');
          else if (key === 'damage') {
            const [d, gd] = parseNumberPair(val);
            if (d !== undefined) hitDefScratch.damage = Math.max(0, Math.round(d));
            if (gd !== undefined) hitDefScratch.guardDamage = Math.max(0, Math.round(gd));
          } else if (key === 'getpower') {
            const [gh, gg] = parseNumberPair(val);
            hitDefScratch.hasGetPower = true;
            if (gh !== undefined) hitDefScratch.getPowerHit = Math.max(0, Math.round(gh));
            if (gg !== undefined) hitDefScratch.getPowerGuard = Math.max(0, Math.round(gg));
          } else if (key === 'givepower') {
            const [gh, gg] = parseNumberPair(val);
            hitDefScratch.hasGivePower = true;
            if (gh !== undefined) hitDefScratch.givePowerHit = Math.max(0, Math.round(gh));
            if (gg !== undefined) hitDefScratch.givePowerGuard = Math.max(0, Math.round(gg));
          } else if (key === 'pausetime') {
            const [p1, p2] = parseNumberPair(val);
            if (p1 !== undefined) hitDefScratch.pauseP1 = Math.max(0, Math.round(p1));
            if (p2 !== undefined) hitDefScratch.pauseP2 = Math.max(0, Math.round(p2));
          } else if (key === 'ground.velocity') {
            const [vx, vy] = parseNumberPair(val);
            if (vx !== undefined) hitDefScratch.groundVelX = vx;
            if (vy !== undefined) hitDefScratch.groundVelY = vy;
          } else if (key === 'air.velocity') {
            const [vx, vy] = parseNumberPair(val);
            if (vx !== undefined) hitDefScratch.airVelX = vx;
            if (vy !== undefined) hitDefScratch.airVelY = vy;
          } else if (key === 'guard.velocity') {
            const [vx] = parseNumberPair(val);
            if (vx !== undefined) hitDefScratch.guardVelX = vx;
          } else if (key === 'ground.hittime') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) hitDefScratch.groundHittime = Math.max(4, n);
          } else if (key === 'air.hittime') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) hitDefScratch.airHittime = Math.max(4, n);
          } else if (key === 'guard.hittime' || key === 'guard.slidetime') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) hitDefScratch.guardHittime = Math.max(4, n);
          } else if (key === 'fall') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) hitDefScratch.fall = n !== 0;
          } else if (key === 'hitsound') {
            const pair = parseSoundPair(val);
            if (pair) hitDefScratch.hitSound = pair;
          } else if (key === 'guardsound') {
            const pair = parseSoundPair(val);
            if (pair) hitDefScratch.guardSound = pair;
          }
        }

        if (stateTypeCtrl === 'projectile') {
          if (key === 'proj.id' || key === 'projid' || key === 'id') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlProjId = n;
          } else if (key === 'proj.anim' || key === 'projanim' || key === 'anim') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlProjAnim = n;
          } else if (key === 'proj.hitanim' || key === 'projhitanim') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlProjHitAnim = n;
          } else if (key === 'proj.remanim' || key === 'projremanim') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlProjRemAnim = n;
          } else if (key === 'proj.cancelanim' || key === 'projcancelanim') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlProjCancelAnim = n;
          } else if (key === 'velocity' || key === 'vel' || key === 'proj.velocity') {
            const [vx, vy] = parseNumberPair(val);
            if (vx !== undefined) ctrlProjVelX = vx;
            if (vy !== undefined) ctrlProjVelY = vy;
          } else if (key === 'offset' || key === 'pos' || key === 'proj.offset') {
            const [ox, oy] = parseNumberPair(val);
            if (ox !== undefined) ctrlProjOffsetX = ox;
            if (oy !== undefined) ctrlProjOffsetY = oy;
          } else if (key === 'removetime' || key === 'projremovetime' || key === 'proj.removetime') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlProjRemoveTime = n;
          }
        } else if (stateTypeCtrl === 'helper') {
          if (key === 'helpertype') {
            ctrlHelperType = val.toLowerCase() === 'player' ? 'player' : 'normal';
          } else if (key === 'name') {
            ctrlHelperName = val.replace(/^"|"$/g, '');
          } else if (key === 'id') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlHelperId = n;
          } else if (key === 'stateno' || key === 'value') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlHelperStateNo = n;
          } else if (key === 'pos' || key === 'offset') {
            const [ox, oy] = parseNumberPair(val);
            if (ox !== undefined) ctrlHelperOffsetX = ox;
            if (oy !== undefined) ctrlHelperOffsetY = oy;
          } else if (key === 'postype') {
            const pt = val.toLowerCase();
            if (pt === 'p1' || pt === 'p2' || pt === 'front' || pt === 'back' || pt === 'left' || pt === 'right') {
              ctrlHelperPosType = pt;
            }
          } else if (key === 'facing') {
            const n = parseInt(val, 10);
            if (n === 1 || n === -1) ctrlHelperFacing = n;
          } else if (key === 'keyctrl') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlHelperKeyCtrl = n;
          } else if (key === 'ownpal') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlHelperOwnPal = n;
          }
        } else if (stateTypeCtrl === 'explod') {
          if (key === 'anim') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlExplodAnim = n;
          } else if (key === 'id') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlExplodId = n;
          } else if (key === 'pos' || key === 'offset') {
            const [ox, oy] = parseNumberPair(val);
            if (ox !== undefined) ctrlExplodOffsetX = ox;
            if (oy !== undefined) ctrlExplodOffsetY = oy;
          } else if (key === 'postype') {
            const pt = val.toLowerCase();
            if (pt === 'p1' || pt === 'p2' || pt === 'front' || pt === 'back' || pt === 'left' || pt === 'right') {
              ctrlExplodPosType = pt;
            }
          } else if (key === 'facing') {
            const n = parseInt(val, 10);
            if (n === 1 || n === -1) ctrlExplodFacing = n;
          } else if (key === 'vfacing') {
            const n = parseInt(val, 10);
            if (n === 1 || n === -1) ctrlExplodVFacing = n;
          } else if (key === 'bindtime') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlExplodBindTime = n;
          } else if (key === 'vel' || key === 'velocity') {
            const [vx, vy] = parseNumberPair(val);
            if (vx !== undefined) ctrlExplodVelX = vx;
            if (vy !== undefined) ctrlExplodVelY = vy;
          } else if (key === 'removetime') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlExplodRemoveTime = n;
          } else if (key === 'scale') {
            const [sx, sy] = parseNumberPair(val);
            if (sx !== undefined) ctrlExplodScaleX = sx;
            if (sy !== undefined) ctrlExplodScaleY = sy;
          } else if (key === 'sprpriority') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlExplodSprPriority = n;
          } else if (key === 'ownpal') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlExplodOwnPal = n;
          }
        } else if (stateTypeCtrl === 'removeexplod') {
          if (key === 'id' || key === 'value') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n)) ctrlExplodId = n;
          }
        }

        if (key === 'triggerall' || key.startsWith('trigger')) {
          if (key === 'triggerall') {
            triggerAll.push(val);
          } else {
            const idxMatch = key.match(/^trigger(\d+)$/);
            if (idxMatch) {
              const gIdx = parseInt(idxMatch[1], 10);
              if (!triggerGroups[gIdx]) triggerGroups[gIdx] = [];
              triggerGroups[gIdx].push(val);
            }
          }

          // Extract power >= N / power > N requirements
          const pwChecks = Array.from(val.matchAll(/\bpower\s*(>=|>)\s*(\d+)/gi));
          for (const pm of pwChecks) {
            const rawNum = parseInt(pm[2], 10);
            const req = pm[1] === '>' ? rawNum + 1 : rawNum;
            if (key === 'triggerall') {
              triggerAllMinPower = Math.max(triggerAllMinPower, req);
            } else {
              branchMinPowers.push(req);
            }
          }

          const neqMatches = Array.from(val.matchAll(/command\s*!=\s*"([^"]+)"/gi));
          for (const m of neqMatches) {
            forbiddenCommands.push(m[1]);
          }
          const eqMatches = Array.from(val.matchAll(/command\s*=\s*"([^"]+)"/gi));
          for (const m of eqMatches) {
            const cname = m[1];
            requiredCommands.push(cname);
            if (!isHoldDirCmd(cname)) {
              if (!matchedCommands.includes(cname)) matchedCommands.push(cname);
              if (!stateCmdRef) stateCmdRef = cname;
            }
          }
          const orBranches = splitTopLevelOr(val)
            .map(branch =>
              Array.from(branch.matchAll(/command\s*=\s*"([^"]+)"/gi))
                .map(m => m[1])
                .filter(cname => !isHoldDirCmd(cname))
            )
            .filter(group => group.length > 0);
          if (orBranches.length > 0) {
            if (key === 'triggerall') {
              if (orBranches.length === 1) {
                for (const cname of orBranches[0]) {
                  if (!requiredAllCommands.includes(cname)) requiredAllCommands.push(cname);
                }
              } else {
                requiredAllOrSets.push(orBranches);
              }
            } else {
              for (const branchCmds of orBranches) {
                commandOrGroups.push(branchCmds);
              }
            }
          }
          if (!stateCmdRef && requiredCommands.length > 0) {
            stateCmdRef = requiredCommands[0];
          }
          if (/\bctrl\b/i.test(val)) requireCtrl = true;
          if (/\bp2bodydist\b|\bp2dist\b/i.test(val)) requiresP2Close = true;

          if (/statetype\s*=\s*S\b/i.test(val)) allowedStateTypes.add('S');
          if (/statetype\s*=\s*C\b/i.test(val)) allowedStateTypes.add('C');
          if (/statetype\s*=\s*A\b/i.test(val)) allowedStateTypes.add('A');
          if (/statetype\s*!=\s*A\b/i.test(val)) forbiddenStateTypes.add('A');
          if (/statetype\s*!=\s*C\b/i.test(val)) forbiddenStateTypes.add('C');
          if (/statetype\s*!=\s*S\b/i.test(val)) forbiddenStateTypes.add('S');
          if (/animtime\s*=\s*0|!\s*animtime\b/i.test(val)) {
            ctrlHasAnimTimeEnd = true;
          }
        }
      }
    }
    flushStateController();
  };

  const hasCustomCmd = cmdFiles.some(f => f.id !== 'default');
  const activeCmdFiles = hasCustomCmd ? cmdFiles.filter(f => f.id !== 'default') : cmdFiles;
  const hasCustomSt = stFiles.some(f => f.id !== 'default');
  const activeStFiles = hasCustomSt ? stFiles.filter(f => f.id !== 'default') : stFiles;

  activeCmdFiles.forEach(f => parseFile(f.content));
  activeStFiles.forEach(f => parseFile(f.content));

  // Prioritize multi-token commands (motions, hypers, FF/BB) and multi-button chords over single buttons
  commands.sort((a, b) => b.tokenCount - a.tokenCount || b.chordWeight - a.chordWeight);

  // Enrich Statedef labels from [State -1] rule labels
  for (const r of rules) {
    const st = states[r.targetState];
    if (st && r.label) {
      const isGeneric = st.label.startsWith('State ') || st.label === defaultLabelForState(st.stateNo);
      if (isGeneric) st.label = r.label;
    }
  }

  if (states[105] && !states[105].hasExplicitVel) {
    states[105].moveX = constants.runBackX;
    states[105].moveY = constants.runBackY;
    states[105].isHopBack = true;
  }
  if (states[100] && !states[100].hasExplicitVel) {
    states[100].moveX = constants.runFwdX;
    states[100].moveY = constants.runFwdY;
  }

  Object.values(states).forEach(st => {
    const codeOnlyText = st.rawText
      .split(/\r?\n/)
      .map(line => {
        const semi = line.indexOf(';');
        return semi !== -1 ? line.slice(0, semi) : line;
      })
      .join('\n');
    const textLower = (st.label + '\n' + codeOnlyText).toLowerCase();
    if (/\b(hyper|super|ultra|desperation|superpause|max\s*mode|level\s*3|lvl\s*3)\b/.test(textLower)) {
      st.isHyper = true;
    }
    if (/\b(crouch|duck|holddown)\b/.test(textLower) || st.stateType === 'C') {
      st.isCrouch = true;
    }
    if (/\b(hop\s*back|back\s*hop|backdash|run\s*back)\b/.test(textLower) || st.stateNo === 105 || st.stateNo === 106) {
      st.isHopBack = true;
    }

    if (st.isHyper || st.stateNo >= 3000) {
      st.category = 'hyper';
    } else if (st.isCrouch || st.isHopBack || (st.stateNo >= 10 && st.stateNo <= 120)) {
      st.category = 'crouch_hop';
    } else if (st.stateNo >= 1000 && st.stateNo < 3000) {
      st.category = 'special';
    } else if (st.stateNo >= 200 && st.stateNo < 900) {
      st.category = 'normal';
    } else {
      st.category = 'other';
    }
  });

  const sortedStates = Object.values(states).sort((a, b) => a.stateNo - b.stateNo);
  return { commands, rules, states, sortedStates, constants };
}

interface CustomButtonSlot {
  id: 'B' | 'D' | 'U' | 'F' | 'x' | 'y' | 'z' | 'a' | 'b' | 'c' | 'm1' | 'm2';
  kind: 'dir' | 'attack';
  token: string;
  label: string;
  key: string;
  visible: boolean;
  colorClass: string;
}

const STORAGE_CONTROLS_KEY = 'mugen-move-tester-buttons-v1';

const DEFAULT_BUTTON_SLOTS: CustomButtonSlot[] = [
  { id: 'B', kind: 'dir', token: 'B', label: '←', key: 'ArrowLeft', visible: true, colorClass: '' },
  { id: 'D', kind: 'dir', token: 'D', label: '↓', key: 'ArrowDown', visible: true, colorClass: '' },
  { id: 'U', kind: 'dir', token: 'U', label: '↑', key: 'ArrowUp', visible: true, colorClass: '' },
  { id: 'F', kind: 'dir', token: 'F', label: '→', key: 'ArrowRight', visible: true, colorClass: '' },
  { id: 'x', kind: 'attack', token: 'x', label: 'x', key: 'u', visible: true, colorClass: 'bg-sky-900/50 border-sky-600/60 text-sky-300' },
  { id: 'y', kind: 'attack', token: 'y', label: 'y', key: 'i', visible: true, colorClass: 'bg-blue-900/50 border-blue-600/60 text-blue-300' },
  { id: 'z', kind: 'attack', token: 'z', label: 'z', key: 'o', visible: true, colorClass: 'bg-purple-900/50 border-purple-600/60 text-purple-300' },
  { id: 'm1', kind: 'attack', token: 'x+y', label: 'X+Y', key: 'p', visible: true, colorClass: 'bg-fuchsia-900/50 border-fuchsia-600/60 text-fuchsia-300' },
  { id: 'a', kind: 'attack', token: 'a', label: 'a', key: 'j', visible: true, colorClass: 'bg-amber-900/50 border-amber-600/60 text-amber-300' },
  { id: 'b', kind: 'attack', token: 'b', label: 'b', key: 'k', visible: true, colorClass: 'bg-orange-900/50 border-orange-600/60 text-orange-300' },
  { id: 'c', kind: 'attack', token: 'c', label: 'c', key: 'l', visible: true, colorClass: 'bg-red-900/50 border-red-600/60 text-red-300' },
  { id: 'm2', kind: 'attack', token: 'x+y+z', label: 'X+Y+Z', key: 'm', visible: true, colorClass: 'bg-rose-900/50 border-rose-600/60 text-rose-300' },
];

const BUTTON_CANONICAL_ORDER = ['x', 'y', 'z', 'a', 'b', 'c', 's'];

function canonicalChord(tokens: Iterable<string>): string {
  const unique = Array.from(new Set(Array.from(tokens).map(t => t.trim().toLowerCase()).filter(Boolean)));
  unique.sort((a, b) => {
    const ia = BUTTON_CANONICAL_ORDER.indexOf(a);
    const ib = BUTTON_CANONICAL_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  return unique.join('+');
}

function splitButtonToken(raw: string): string[] {
  return raw
    .split('+')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean);
}

const SECONDARY_FALLBACK_KEYS: Record<string, string> = {
  a: 'B',
  d: 'F',
  w: 'U',
  s: 'D',
  z: 'a',
  x: 'x',
  c: 'c',
  ' ': 's',
  enter: 's',
};

function loadStoredButtonSlots(): CustomButtonSlot[] {
  try {
    if (typeof window === 'undefined') return DEFAULT_BUTTON_SLOTS;
    const raw = window.localStorage.getItem(STORAGE_CONTROLS_KEY);
    if (!raw) return DEFAULT_BUTTON_SLOTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_BUTTON_SLOTS;
    return DEFAULT_BUTTON_SLOTS.map(def => {
      const match = parsed.find((item: any) => item && item.id === def.id);
      if (!match) return def;
      return {
        ...def,
        token: typeof match.token === 'string' && match.token.trim() ? match.token.trim() : def.token,
        label: typeof match.label === 'string' && match.label.trim() ? match.label.slice(0, 8) : def.label,
        key: typeof match.key === 'string' ? match.key : def.key,
        visible: def.kind === 'dir' ? true : typeof match.visible === 'boolean' ? match.visible : def.visible,
      };
    });
  } catch {
    return DEFAULT_BUTTON_SLOTS;
  }
}

function formatKeyLabel(key: string): string {
  if (!key) return '—';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key.slice(0, 6);
}

type StateFilterChip = 'all' | 'hyper' | 'movexy' | 'crouch_hop' | 'special' | 'normal';
type TesterMode = 'practice' | 'fight';
type TeamSize = 1 | 2 | 3 | 4;
type AiDifficulty = 'dummy' | 'normal' | 'hard';
type FightOutcome = 'P1_WIN' | 'P2_WIN' | 'DRAW' | null;

interface FightMemberHud {
  id: string;
  slotIdx: number;
  life: number;
  trail: number;
  maxLife: number;
  power: number;
  maxPower: number;
  stateNo: number;
  comboCount: number;
}

interface HitSparkEffect {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  guarded: boolean;
  isHyper: boolean;
}

interface FighterRuntime {
  id: string;
  team: 1 | 2;
  slotIdx: number;
  isPlayer: boolean;
  posX: number;
  posY: number; // 270 = ground, < 270 = air
  velX: number;
  velY: number;
  facing: 1 | -1;
  stateNo: number;
  prevStateNo: number;
  animId: number;
  frameIdx: number;
  tickInFrame: number;
  stateTime: number;
  stateType: 'S' | 'C' | 'A' | 'L';
  moveType: 'I' | 'A' | 'H';
  physics: 'S' | 'C' | 'A' | 'N';
  ctrl: number;
  life: number;
  trailLife: number;
  maxLife: number;
  power: number;
  maxPower: number;
  attackMul: number;
  defenceMul: number;
  hitPauseTicks: number;
  hitStunTicks: number;
  lieDownPhase: 'none' | 'bounce' | 'lie' | 'getup' | 'ko';
  lieDownTimer: number;
  invulnTicks: number;
  comboCount: number;
  activeHitDef: ParsedHitDef | null;
  lastHitDefCtrlKey: string;
  hitScoredThisWindow: boolean;
  hitTargetsThisWindow: Set<string>;
  moveContact: number;
  moveHit: number;
  moveGuarded: number;
  firedPersist: Set<string>;
  heldDirs: Set<string>; // screen-space 'F' | 'B' | 'U' | 'D'
  crouchLocked: boolean;
  runLocked: boolean;
  aiActionTimer: number;
  aiCooldown: number;
  aiWalkDir: -1 | 0 | 1;
  aiHoldDown: boolean;
  aiBlockTimer: number;
  pendingLanding?: boolean;
  landingVelY?: number;
  cmdBuffer?: Record<string, number>;
  isHelper?: boolean;
  helperId?: number;
  ownerId?: string;
  hasPlayedDeathSound: boolean;
}

function createFighterRuntime(
  id: string,
  team: 1 | 2,
  slotIdx: number,
  teamSize: TeamSize,
  constants: CharacterPhysicsConstants,
  mode: TesterMode
): FighterRuntime {
  let startX = 0;
  if (mode === 'fight') {
    const baseOffset = teamSize === 1 ? 95 : 58 + slotIdx * 38;
    startX = team === 1 ? -baseOffset : baseOffset;
  }
  const startFacing: 1 | -1 = team === 1 ? 1 : -1;
  return {
    id,
    team,
    slotIdx,
    isPlayer: team === 1 && slotIdx === 0,
    posX: startX,
    posY: 270,
    velX: 0,
    velY: 0,
    facing: startFacing,
    stateNo: 0,
    prevStateNo: 0,
    animId: 0,
    frameIdx: 0,
    tickInFrame: 0,
    stateTime: 0,
    stateType: 'S',
    moveType: 'I',
    physics: 'S',
    ctrl: 1,
    life: constants.life,
    trailLife: constants.life,
    maxLife: constants.life,
    power: mode === 'fight' ? 0 : constants.power,
    maxPower: constants.power,
    attackMul: constants.attack / 100,
    defenceMul: constants.defence / 100,
    hitPauseTicks: 0,
    hitStunTicks: 0,
    lieDownPhase: 'none',
    lieDownTimer: 0,
    invulnTicks: 0,
    comboCount: 0,
    activeHitDef: null,
    lastHitDefCtrlKey: '',
    hitScoredThisWindow: false,
    hitTargetsThisWindow: new Set<string>(),
    moveContact: 0,
    moveHit: 0,
    moveGuarded: 0,
    firedPersist: new Set<string>(),
    heldDirs: new Set<string>(),
    crouchLocked: false,
    runLocked: false,
    aiActionTimer: 12 + slotIdx * 8,
    aiCooldown: 14 + slotIdx * 10,
    aiWalkDir: 0,
    aiHoldDown: false,
    aiBlockTimer: 0,
    landingVelY: 0,
    cmdBuffer: {},
    hasPlayedDeathSound: false,
  };
}

function getNearestLivingOpponent(f: FighterRuntime, oppTeam: FighterRuntime[]): FighterRuntime {
  let best: FighterRuntime | null = null;
  let bestDist = Infinity;
  for (const cand of oppTeam) {
    if (cand.life <= 0) continue;
    const d = Math.abs(cand.posX - f.posX);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best || oppTeam[0];
}

interface BoxEntity {
  posX: number;
  posY: number;
  facing: 1 | -1;
}

function toWorldBox(b: ClsnBox, f: BoxEntity) {
  const xA = f.posX + b.x1 * f.facing;
  const xB = f.posX + b.x2 * f.facing;
  const wyOffset = f.posY - 270;
  const yA = wyOffset + b.y1;
  const yB = wyOffset + b.y2;
  return {
    x1: Math.min(xA, xB),
    x2: Math.max(xA, xB),
    y1: Math.min(yA, yB),
    y2: Math.max(yA, yB),
  };
}

function findBoxesOverlap(
  atkBoxes: ClsnBox[],
  atk: BoxEntity,
  defBoxes: ClsnBox[],
  def: FighterRuntime
): { x: number; y: number } | null {
  for (const ab of atkBoxes) {
    const wa = toWorldBox(ab, atk);
    for (const db of defBoxes) {
      const wd = toWorldBox(db, def);
      const ix1 = Math.max(wa.x1, wd.x1);
      const ix2 = Math.min(wa.x2, wd.x2);
      const iy1 = Math.max(wa.y1, wd.y1);
      const iy2 = Math.min(wa.y2, wd.y2);
      if (ix1 < ix2 && iy1 < iy2) {
        return { x: (ix1 + ix2) / 2, y: (iy1 + iy2) / 2 };
      }
    }
  }
  return null;
}

export const MoveTesterModal: React.FC<MoveTesterModalProps> = ({
  isOpen,
  onClose,
  sffData,
  airData,
  actPalette,
  selectedPaletteIdx = 0,
  onSelectPaletteIdx,
  iniData = null,
  characterName = 'Character',
  cmdFiles,
  stFiles,
  sndData,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { commands, rules, states, sortedStates, constants } = useMemo(
    () => parseCmdAndStates(cmdFiles, stFiles),
    [cmdFiles, stFiles]
  );

  const paletteKeymap = useMemo(() => parsePaletteKeymap(iniData), [iniData]);
  const palDefaults = useMemo(() => parsePalDefaults(iniData), [iniData]);
  const palSlotIndices = useMemo(() => {
    const map: Record<number, number> = {};
    const pals = sffData?.palettes || [];
    for (let i = 0; i < pals.length; i++) {
      const p = pals[i];
      if (p.group === 1 && p.item >= 1 && p.item <= 12 && map[p.item] === undefined) {
        map[p.item] = i;
      }
    }
    for (let i = 0; i < pals.length; i++) {
      const p = pals[i];
      if (p.group === 0 && p.item >= 1 && p.item <= 12 && map[p.item] === undefined) {
        map[p.item] = i;
      }
    }
    if (Object.keys(map).length === 0) {
      let slot = 1;
      for (let i = 0; i < pals.length && slot <= 12; i++) {
        if (pals[i].group < 7000) {
          map[slot++] = i;
        }
      }
    }
    return map;
  }, [sffData]);

  const bodyPalIndices = useMemo(() => {
    const pals = sffData?.palettes || [];
    const indices = pals.map((p, i) => (p.group < 7000 ? i : -1)).filter(i => i >= 0);
    return indices.length > 0 ? indices : pals.map((_, i) => i);
  }, [sffData]);

  const availableCmdTokens = useMemo(() => {
    const base = [
      'x',
      'y',
      'z',
      'a',
      'b',
      'c',
      's',
      'x+y',
      'y+z',
      'x+z',
      'a+b',
      'b+c',
      'a+c',
      'x+a',
      'y+b',
      'z+c',
      'x+y+z',
      'a+b+c',
    ];
    for (const cmd of commands) {
      for (const tok of cmd.cleanTokens) {
        if (tok.includes('+')) {
          const norm = canonicalChord(splitButtonToken(tok));
          if (norm && !base.includes(norm)) base.push(norm);
        }
      }
    }
    return base;
  }, [commands]);

  const [buttonSlots, setButtonSlots] = useState<CustomButtonSlot[]>(loadStoredButtonSlots);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showPaletteKeymapMenu, setShowPaletteKeymapMenu] = useState(false);
  const [paletteMenuTarget, setPaletteMenuTarget] = useState<'p1' | 'p2'>('p1');
  const [localP1PaletteIdx, setLocalP1PaletteIdx] = useState<number>(selectedPaletteIdx);
  const [listeningSlotId, setListeningSlotId] = useState<string | null>(null);
  const [mode, setMode] = useState<TesterMode>('practice');
  const [teamSize, setTeamSize] = useState<TeamSize>(1);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('normal');
  const [fightOutcome, setFightOutcome] = useState<FightOutcome>(null);
  const [fightBanner, setFightBanner] = useState<string | null>(null);
  const [showClsn, setShowClsn] = useState(true);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [activeState, setActiveState] = useState(0);
  const [activeAnimId, setActiveAnimId] = useState(0);
  const [frameIdx, setFrameIdx] = useState(0);
  const [inputLog, setInputLog] = useState<string[]>([]);
  const [matchedMove, setMatchedMove] = useState<string | null>(null);
  const [heldDirs, setHeldDirs] = useState<Set<string>>(new Set());
  const [heldAttackTokens, setHeldAttackTokens] = useState<Set<string>>(new Set());
  const [crouchLocked, setCrouchLocked] = useState(false);
  const [runLocked, setRunLocked] = useState(false);
  const [isHyperActive, setIsHyperActive] = useState(false);
  const [p2PaletteIdx, setP2PaletteIdx] = useState<number>(0);
  const [showExternalPad, setShowExternalPad] = useState(true);
  const [showStatedefDrawer, setShowStatedefDrawer] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 768 && window.innerHeight >= 600
  );
  const [isLandscapeShort, setIsLandscapeShort] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.innerHeight < 540 && window.innerWidth >= 560
  );
  const [joystickKnob, setJoystickKnob] = useState<{ x: number; y: number; activeDir: string | null }>({
    x: 0,
    y: 0,
    activeDir: null,
  });

  useEffect(() => {
    const pals = sffData?.palettes || [];
    const fallbackIdx = bodyPalIndices[0] ?? 0;
    const safeIdx =
      selectedPaletteIdx >= 0 &&
      selectedPaletteIdx < pals.length &&
      pals[selectedPaletteIdx]?.group < 7000
        ? selectedPaletteIdx
        : fallbackIdx;
    setLocalP1PaletteIdx(safeIdx);
  }, [selectedPaletteIdx, isOpen, sffData, bodyPalIndices]);

  const p1Palette = useMemo(
    () =>
      sffData?.palettes?.[localP1PaletteIdx]?.data ||
      actPalette ||
      sffData?.palettes?.[selectedPaletteIdx]?.data ||
      sffData?.palettes?.[0]?.data ||
      null,
    [actPalette, sffData, localP1PaletteIdx, selectedPaletteIdx]
  );

  const differentPaletteIndices = useMemo(() => {
    const pals = sffData?.palettes || [];
    const res: number[] = [];
    for (let i = 0; i < pals.length; i++) {
      if (pals[i].group >= 7000) continue;
      if (!palettesAreSame(pals[i].data, p1Palette)) {
        res.push(i);
      }
    }
    return res;
  }, [sffData, p1Palette]);

  useEffect(() => {
    const total = sffData?.palettes?.length || 0;
    if (total > 1) {
      for (const defNum of palDefaults) {
        const resolved = resolvePaletteSlotIndex(defNum, total, palSlotIndices, bodyPalIndices);
        if (differentPaletteIndices.includes(resolved)) {
          setP2PaletteIdx(resolved);
          return;
        }
      }
    }
    if (differentPaletteIndices.length > 0) {
      setP2PaletteIdx(differentPaletteIndices[0]);
    } else {
      setP2PaletteIdx(bodyPalIndices[0] ?? 0);
    }
  }, [differentPaletteIndices, palDefaults, palSlotIndices, bodyPalIndices, sffData]);

  const p2Palette = useMemo(() => {
    const pals = sffData?.palettes || [];
    if (pals[p2PaletteIdx]?.data) return pals[p2PaletteIdx].data;
    if (differentPaletteIndices.length > 0 && pals[differentPaletteIndices[0]]?.data) {
      return pals[differentPaletteIndices[0]].data;
    }
    return p1Palette;
  }, [sffData, p2PaletteIdx, differentPaletteIndices, p1Palette]);

  const { team1Palettes, team2Palettes } = useMemo(() => {
    const pals = sffData?.palettes || [];
    const altPool = differentPaletteIndices.length > 0 ? differentPaletteIndices : pals.map((_, i) => i);
    const t1: (Uint8Array | null)[] = [];
    const t2: (Uint8Array | null)[] = [];

    for (let slot = 0; slot < 4; slot++) {
      if (slot === 0) {
        t1.push(p1Palette);
        t2.push(p2Palette);
      } else {
        if (pals.length > 2 && altPool.length > 1) {
          const p2Pos = altPool.indexOf(p2PaletteIdx);
          const t2Idx = altPool[( (p2Pos >= 0 ? p2Pos : 0) + slot ) % altPool.length];
          t2.push(pals[t2Idx]?.data || p2Palette);
          const t1Cand = pals.findIndex((p, idx) => idx !== p2PaletteIdx && !palettesAreSame(p.data, p2Palette) && (slot === 1 ? !palettesAreSame(p.data, p1Palette) : true));
          if (t1Cand >= 0 && slot === 1) {
            t1.push(pals[t1Cand].data);
          } else {
            const safePool = altPool.filter(idx => idx !== p2PaletteIdx);
            const t1Idx = safePool.length > 0 ? safePool[slot % safePool.length] : 0;
            t1.push(pals[t1Idx]?.data || p1Palette);
          }
        } else {
          // 1 or 2 palettes: keep Team 1 matching P1's color and Team 2 matching P2's color for clear team ID
          t1.push(p1Palette);
          t2.push(p2Palette);
        }
      }
    }
    return { team1Palettes: t1, team2Palettes: t2 };
  }, [sffData, p1Palette, p2Palette, p2PaletteIdx, differentPaletteIndices]);

  const { team1PortraitUrls, team2PortraitUrls } = useMemo(() => {
    const renderPortraitDataUrl = (sprite: SffImage | undefined, pal: Uint8Array | null | undefined): string | null => {
      if (typeof document === 'undefined') return null;
      if (!sprite || !sprite.pixelIndices || sprite.width <= 0 || sprite.height <= 0 || !pal) return null;
      try {
        const imgData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, pal);
        const off = document.createElement('canvas');
        off.width = sprite.width;
        off.height = sprite.height;
        const octx = off.getContext('2d');
        if (!octx) return null;
        octx.putImageData(imgData, 0, 0);
        return off.toDataURL('image/png');
      } catch {
        return null;
      }
    };

    const empty = [null, null, null, null] as (string | null)[];
    if (!sffData || sffData.images.length === 0) {
      return { team1PortraitUrls: empty, team2PortraitUrls: empty };
    }

    const iconSprite =
      sffData.images.find(img => img.group === 9000 && img.image === 0 && img.pixelIndices?.length > 0 && img.width > 0 && img.height > 0) ||
      sffData.images.find(img => img.group === 9000 && img.image === 1 && img.pixelIndices?.length > 0 && img.width > 0 && img.height > 0) ||
      sffData.images.find(img => img.group === 0 && img.image === 0 && img.pixelIndices?.length > 0 && img.width > 0 && img.height > 0);

    if (!iconSprite) {
      return { team1PortraitUrls: empty, team2PortraitUrls: empty };
    }

    const mainPal = sffData.palettes?.find(p => p.group < 7000)?.data || sffData.palettes?.[0]?.data || actPalette || null;
    const hasDedicatedPortraitPalette = Boolean(
      iconSprite.palette &&
      mainPal &&
      !palettesAreSame(iconSprite.palette, mainPal) &&
      (iconSprite.isSharedPalette === false || sffData.isV2)
    );

    const cache = new Map<Uint8Array, string | null>();
    const urlForPal = (targetPal: Uint8Array | null | undefined): string | null => {
      const resolved = hasDedicatedPortraitPalette
        ? iconSprite.palette
        : (targetPal || iconSprite.palette || sffData.palettes?.[0]?.data);
      if (!resolved) return null;
      for (const [k, v] of cache.entries()) {
        if (palettesAreSame(k, resolved)) return v;
      }
      const rendered = renderPortraitDataUrl(iconSprite, resolved);
      cache.set(resolved, rendered);
      return rendered;
    };

    return {
      team1PortraitUrls: team1Palettes.map(p => urlForPal(p)),
      team2PortraitUrls: team2Palettes.map(p => urlForPal(p)),
    };
  }, [sffData, actPalette, team1Palettes, team2Palettes]);

  const makeMemberHud = (f: FighterRuntime): FightMemberHud => ({
    id: f.id,
    slotIdx: f.slotIdx,
    life: Math.ceil(f.life),
    trail: Math.ceil(f.trailLife),
    maxLife: f.maxLife,
    power: Math.floor(f.power),
    maxPower: f.maxPower,
    stateNo: f.stateNo,
    comboCount: f.comboCount,
  });

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
    p2StateNo: number;
  }>(() => ({
    team1: [
      { id: 'p1', slotIdx: 0, life: constants.life, trail: constants.life, maxLife: constants.life, power: 0, maxPower: constants.power, stateNo: 0, comboCount: 0 },
    ],
    team2: [
      { id: 'p2', slotIdx: 0, life: constants.life, trail: constants.life, maxLife: constants.life, power: 0, maxPower: constants.power, stateNo: 0, comboCount: 0 },
    ],
    p1Life: constants.life,
    p1Trail: constants.life,
    p1MaxLife: constants.life,
    p1Power: 0,
    p1MaxPower: constants.power,
    p1Combo: 0,
    p2Life: constants.life,
    p2Trail: constants.life,
    p2MaxLife: constants.life,
    p2Power: 0,
    p2MaxPower: constants.power,
    p2Combo: 0,
    p2StateNo: 0,
  }));

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_CONTROLS_KEY, JSON.stringify(buttonSlots));
    } catch {
      // ignore storage quota errors
    }
  }, [buttonSlots]);

  const resolveTokenForKeyboardEvent = (eKey: string): string | null => {
    const exact = buttonSlots.find(b => b.key && b.key === eKey);
    if (exact) return exact.token;
    const lower = eKey.toLowerCase();
    const ci = buttonSlots.find(b => b.key && b.key.toLowerCase() === lower);
    if (ci) return ci.token;
    const fallbackTok = SECONDARY_FALLBACK_KEYS[lower];
    if (fallbackTok) return fallbackTok;
    return null;
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

  const [hudVelocity, setHudVelocity] = useState<{ x: number; y: number; px: number; py: number }>({
    x: 0,
    y: 0,
    px: 0,
    py: 0,
  });
  const [rightTab, setRightTab] = useState<'commands' | 'statedefs'>('statedefs');
  const [stateSearch, setStateSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilterChip>('all');

  const team1Ref = useRef<FighterRuntime[]>([createFighterRuntime('p1', 1, 0, 1, constants, 'practice')]);
  const team2Ref = useRef<FighterRuntime[]>([createFighterRuntime('p2', 2, 0, 1, constants, 'fight')]);
  const p1Ref = useRef<FighterRuntime>(team1Ref.current[0]);
  const p2Ref = useRef<FighterRuntime>(team2Ref.current[0]);
  const cameraXRef = useRef(0);
  const modeRef = useRef<TesterMode>('practice');
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
  const keymapMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => {
      setIsLandscapeShort(window.innerHeight < 540 && window.innerWidth >= 560);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    teamSizeRef.current = teamSize;
  }, [teamSize]);

  useEffect(() => {
    aiDifficultyRef.current = aiDifficulty;
  }, [aiDifficulty]);

  const isDownHeld = () => p1Ref.current.heldDirs.has('D') || p1Ref.current.crouchLocked;

  const playSoundByPair = (group: number, sample: number): boolean => {
    if (!sndData || !sndData.sounds.length) return false;
    let match = sndData.sounds.find(s => s.group === group && s.sample === sample);
    if (!match && group === 11) {
      match = sndData.sounds.find(s => s.group === 11);
    }
    if (!match) return false;
    try {
      if (audioPoolRef.current.length === 0) {
        audioPoolRef.current = [
          new Audio(),
          new Audio(),
          new Audio(),
          new Audio(),
          new Audio(),
          new Audio(),
          new Audio(),
          new Audio(),
        ];
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
      // ignore audio context errors
    }
  };

  const resolveAnimForState = (targetState: number, stateDef?: ParsedStateInfo): number => {
    if (stateDef?.anim !== undefined && airData?.actions[stateDef.anim]) {
      return stateDef.anim;
    }
    if (airData?.actions[targetState]) return targetState;
    if (targetState === 10 && airData?.actions[11]) return 11;
    if (targetState === 11 && airData?.actions[10]) return 10;
    if (targetState === 106 && airData?.actions[47]) return 47;
    if (targetState === 105 && airData?.actions[41]) return 41;
    if (targetState === 150) {
      if (airData?.actions[130]) return 130;
      if (airData?.actions[120]) return 120;
    }
    if (targetState === 152) {
      if (airData?.actions[131]) return 131;
      if (airData?.actions[150]) return 150;
      if (airData?.actions[11]) return 11;
    }
    if (targetState === 154) {
      if (airData?.actions[132]) return 132;
      if (airData?.actions[150]) return 150;
      if (airData?.actions[41]) return 41;
    }
    if (targetState === 5010 && airData?.actions[5000]) return 5000;
    if (targetState === 5050) {
      if (airData?.actions[5030]) return 5030;
      if (airData?.actions[5000]) return 5000;
    }
    if (targetState === 5100) {
      if (airData?.actions[5110]) return 5110;
      if (airData?.actions[5050]) return 5050;
      if (airData?.actions[5000]) return 5000;
    }
    if (targetState === 5110) {
      if (airData?.actions[5100]) return 5100;
      if (airData?.actions[5050]) return 5050;
      if (airData?.actions[5000]) return 5000;
    }
    if (targetState === 5150) {
      if (airData?.actions[5110]) return 5110;
      if (airData?.actions[5100]) return 5100;
      if (airData?.actions[5050]) return 5050;
    }
    if (targetState === 181 && airData?.actions[180]) return 180;
    if (airData?.actions[0]) return 0;
    return Number(Object.keys(airData?.actions || {})[0] || 0);
  };

  const syncP1ReactHud = () => {
    const p1 = p1Ref.current;
    const vx = Number(p1.velX.toFixed(1));
    const vy = Number(p1.velY.toFixed(1));
    const px = Math.round(p1.posX);
    const py = Math.round(p1.posY - 270);
    setActiveState(prev => (prev === p1.stateNo ? prev : p1.stateNo));
    setActiveAnimId(prev => (prev === p1.animId ? prev : p1.animId));
    setFrameIdx(prev => (prev === p1.frameIdx ? prev : p1.frameIdx));
    setFacing(prev => (prev === p1.facing ? prev : p1.facing));
    setHudVelocity(prev =>
      prev.x === vx && prev.y === vy && prev.px === px && prev.py === py
        ? prev
        : { x: vx, y: vy, px, py }
    );
  };

  const transitionFighterState = (
    f: FighterRuntime,
    targetState: number,
    options?: { label?: string; asHitOrGuard?: boolean }
  ) => {
    const stateDef = states[targetState];
    const nextAnim = resolveAnimForState(targetState, stateDef);
    const prevWasHyper = Boolean(states[f.stateNo]?.isHyper);

    f.prevStateNo = f.stateNo;
    f.stateNo = targetState;
    f.animId = nextAnim;
    f.frameIdx = 0;
    f.tickInFrame = 0;
    f.stateTime = 0;
    f.firedPersist = new Set();
    f.cmdBuffer = {};
    f.landingVelY = 0;
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
      const defaultCtrl =
        targetState === 0 ||
        targetState === 11 ||
        targetState === 20 ||
        targetState === 21 ||
        isJumpCtrlState ||
        targetState === 100
          ? 1
          : 0;
      f.ctrl = isJumpCtrlState ? 1 : (stateDef?.ctrlVal ?? defaultCtrl);

      if (modeRef.current === 'fight' && stateDef?.powerAdd !== undefined) {
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
        playSoundByPair(stateDef.sounds[0].group, stateDef.sounds[0].sample);
      }
    }

    if (f.id === 'p1') {
      syncP1ReactHud();
      if (options?.label) {
        setMatchedMove(stateDef?.isHyper ? `HYPER: ${options.label}` : options.label);
      } else if (stateDef?.label && !options?.asHitOrGuard) {
        setMatchedMove(stateDef.isHyper ? `HYPER: ${stateDef.label}` : stateDef.label);
      }
    }
  };

  const triggerStateTransition = (targetState: number, label?: string) => {
    const p1 = p1Ref.current;
    if (modeRef.current === 'fight') {
      if (fightOutcomeRef.current || p1.life <= 0 || p1.moveType === 'H') return;
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
    }
    transitionFighterState(p1, targetState, { label });
  };

  const resetArena = (nextMode: TesterMode = modeRef.current, nextSize: TeamSize = teamSizeRef.current) => {
    const activeCount: TeamSize = nextMode === 'fight' ? nextSize : 1;
    const t1: FighterRuntime[] = [];
    const t2: FighterRuntime[] = [];
    for (let i = 0; i < activeCount; i++) {
      t1.push(createFighterRuntime(i === 0 ? 'p1' : `p1-ally-${i}`, 1, i, activeCount, constants, nextMode));
      t2.push(createFighterRuntime(i === 0 ? 'p2' : `p2-cpu-${i}`, 2, i, activeCount, constants, 'fight'));
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
    setFightBanner(nextMode === 'fight' ? (activeCount > 1 ? `${activeCount}v${activeCount} FIGHT!` : 'FIGHT!') : null);
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
    if (nextMode === 'fight') {
      t2.forEach(f => {
        f.hasPlayedDeathSound = false;
        transitionFighterState(f, 0);
      });
    }
    setFightHud({
      team1: t1.map(makeMemberHud),
      team2: t2.map(makeMemberHud),
      p1Life: constants.life,
      p1Trail: constants.life,
      p1MaxLife: constants.life,
      p1Power: nextMode === 'fight' ? 0 : constants.power,
      p1MaxPower: constants.power,
      p1Combo: 0,
      p2Life: constants.life,
      p2Trail: constants.life,
      p2MaxLife: constants.life,
      p2Power: 0,
      p2MaxPower: constants.power,
      p2Combo: 0,
      p2StateNo: 0,
    });
  };

  useEffect(() => {
    if (!fightBanner) return;
    const t = window.setTimeout(() => setFightBanner(null), 1100);
    return () => window.clearTimeout(t);
  }, [fightBanner]);

  const getCharHeldDirs = (f: FighterRuntime = p1Ref.current): Set<string> => {
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

  const currentStanceType = (f: FighterRuntime = p1Ref.current): 'S' | 'C' | 'A' => {
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

  const triggerHopBack = () => {
    const p1 = p1Ref.current;
    if (modeRef.current === 'fight' && (fightOutcomeRef.current || p1.life <= 0 || p1.moveType === 'H')) return;
    const nextLog = [...inputLogRef.current, 'B', 'B'].slice(-12);
    inputLogRef.current = nextLog;
    setInputLog(nextLog);
    triggerStateTransition(105, 'Hop Back');
  };

  const enterCrouch = (f: FighterRuntime = p1Ref.current) => {
    if (f.posY < 270 || f.moveType === 'H' || fightOutcomeRef.current) return;
    if (f.stateNo === 0 || f.stateNo === 20 || f.stateNo === 21) {
      const target = airData?.actions[10] ? 10 : 11;
      transitionFighterState(f, target, f.id === 'p1' ? { label: 'Crouch' } : undefined);
    }
  };

  const exitCrouch = (f: FighterRuntime = p1Ref.current) => {
    if (f.stateNo === 10 || f.stateNo === 11) {
      if (airData?.actions[12]) {
        transitionFighterState(f, 12, f.id === 'p1' ? { label: 'Stand Up' } : undefined);
      } else {
        transitionFighterState(f, 0);
      }
    }
  };

  const isCommandSatisfied = (
    requiredCmd: string,
    satisfiedCmdNames: Set<string>,
    activeBtns: Set<string>,
    f: FighterRuntime = p1Ref.current
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
    stanceOverride?: 'S' | 'C' | 'A',
    ignoreStance?: boolean,
    f: FighterRuntime = p1Ref.current
  ): { matches: boolean; multiWeight: number } => {
    if (rule.requiresP2Close) {
      if (modeRef.current !== 'fight') return { matches: false, multiWeight: 0 };
      const opp = getNearestLivingOpponent(f, f.team === 1 ? team2Ref.current : team1Ref.current);
      if (!opp || Math.abs(f.posX - opp.posX) > 65) return { matches: false, multiWeight: 0 };
    }

    if (modeRef.current === 'fight' && rule.minPowerRequired > 0 && f.power < rule.minPowerRequired) {
      return { matches: false, multiWeight: 0 };
    }

    if (!ignoreStance) {
      const stance = stanceOverride ?? currentStanceType(f);
      if (rule.allowedStateTypes.length > 0) {
        if (!rule.allowedStateTypes.includes(stance)) {
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
        if (stance === 'A' && isGroundOnlyTarget) {
          return { matches: false, multiWeight: 0 };
        }
        if (stance !== 'A' && isAirOnlyTarget) {
          return { matches: false, multiWeight: 0 };
        }
      }
    }

    const charDirs = getCharHeldDirs(f);
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

  const triggerCommandByName = (commandName: string) => {
    const p1 = p1Ref.current;
    if (modeRef.current === 'fight' && (fightOutcomeRef.current || p1.life <= 0 || p1.moveType === 'H')) return;
    const cmdLower = commandName.toLowerCase();
    const cmdObj = commands.find(c => c.name.toLowerCase() === cmdLower);
    const activeBtns = new Set<string>();
    if (cmdObj && cmdObj.cleanTokens.length > 0) {
      const last = cmdObj.cleanTokens[cmdObj.cleanTokens.length - 1];
      for (const p of splitButtonToken(last)) {
        if (!['f', 'b', 'u', 'd', 'df', 'db', 'uf', 'ub'].includes(p)) activeBtns.add(p);
      }
    } else if (cmdLower.includes('+')) {
      for (const p of splitButtonToken(cmdLower)) activeBtns.add(p);
    }
    const satisfied = new Set<string>([cmdLower]);

    const matchedRule =
      rules.find(r => ruleMatchesCurrentContext(r, satisfied, activeBtns).matches) ||
      rules.find(r => ruleMatchesCurrentContext(r, satisfied, activeBtns, undefined, true).matches) ||
      rules.find(r => !r.requiresP2Close && (r.matchedCommands.some(c => c.toLowerCase() === cmdLower) || r.commandName.toLowerCase() === cmdLower)) ||
      rules.find(r => r.matchedCommands.some(c => c.toLowerCase() === cmdLower) || r.commandName.toLowerCase() === cmdLower);
    if (matchedRule) {
      triggerStateTransition(matchedRule.targetState, matchedRule.label || commandName);
      return;
    }

    const stance = currentStanceType();
    if (cmdLower === 'bb') {
      triggerHopBack();
      return;
    }
    if (cmdLower === 'ff') {
      triggerStateTransition(100, 'Run Forward');
      return;
    }

    if ((cmdLower === 's' || cmdLower === 'start' || cmdLower === 'taunt') && stance !== 'A' && (states[195] || airData?.actions[195])) {
      triggerStateTransition(195, 'Taunt');
      return;
    }

    const baseOffset = stance === 'C' ? 400 : stance === 'A' ? 600 : 200;
    const btnMap: Record<string, number> = { x: 0, y: 10, z: 20, a: 30, b: 40, c: 50 };
    if (btnMap[cmdLower] !== undefined) {
      const target = baseOffset + btnMap[cmdLower];
      if (states[target] || airData?.actions[target]) {
        triggerStateTransition(
          target,
          `${stance === 'C' ? 'Crouch ' : stance === 'A' ? 'Air ' : ''}${commandName.toUpperCase()}`
        );
        return;
      }
    }
    setMatchedMove(`${commandName} (no ChangeState found)`);
  };

  const pushInputToken = (rawToken: string, explicitActiveBtns?: Set<string>) => {
    const p1 = p1Ref.current;
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

    const p1LockedOut = modeRef.current === 'fight' && (fightOutcomeRef.current !== null || p1.life <= 0 || p1.moveType === 'H');

    // Double-tap detection for Hop Back (B, B) & Run Forward (F, F)
    if (!p1LockedOut && (token === 'B' || token === 'F')) {
      const prev = lastDirTapRef.current;
      if (prev && prev.dir === token && now - prev.time < 300 && p1.posY >= 270 && p1.ctrl === 1) {
        lastDirTapRef.current = null;
        if (token === 'B') {
          triggerHopBack();
          return;
        }
        if (token === 'F' && (states[100] || airData?.actions[100])) {
          const runLog = [...inputLogRef.current, 'F', 'F'].slice(-12);
          inputLogRef.current = runLog;
          setInputLog(runLog);
          triggerStateTransition(100, 'Run Forward');
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
      next = [...inputLogRef.current, token].slice(-12);
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
      const pParts = pat
        .toUpperCase()
        .split('+')
        .map(s => s.trim())
        .filter(Boolean);
      if (pParts.length === 0) return 0;
      const allPresent = pParts.every(p => activeChordSet.has(p));
      return allPresent ? pParts.length : 0;
    };

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
      const simplified = cleanTokens.filter(t => {
        const u = t.toUpperCase();
        return u !== 'DF' && u !== 'DB' && u !== 'UF' && u !== 'UB';
      });
      if (simplified.length > 1 && simplified.length < cleanTokens.length && next.length >= simplified.length) {
        const tail = next.slice(next.length - simplified.length);
        if (simplified.slice(0, -1).every((p, idx) => matchHistToken(p, tail[idx]))) {
          return lastMatchCount;
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

    // Allow in-state Command triggers (such as KFM's 1051 -> 1055 Kung Fu Knee air kick follow-up)
    // to fire before Practice Mode free-cancels or Fight Mode ctrl-gate blocks them.
    if (p1.ctrl === 0 && states[p1.stateNo]) {
      const curStDef = states[p1.stateNo];
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
        mode: modeRef.current,
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
        const trigText = [
          ...ctrl.triggerAll,
          ...(Object.values(ctrl.triggerGroups) as string[][]).flat(),
        ];
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

    // Check ctrl/chain cancel permissions in Fight Mode (allow cancels if moveContact > 0 or ctrl === 1 or upgrading a chord)
    const canCancelMove =
      modeRef.current === 'practice' ||
      p1.ctrl === 1 ||
      p1.moveContact > 0 ||
      (activeBtnSet.size >= 2 && isUpgradeWindow);

    if (!canCancelMove) return;

    let bestCandidate: { rule: ParsedChangeStateRule; label: string; score: number; isMulti: boolean } | null = null;
    for (let rIdx = 0; rIdx < rules.length; rIdx++) {
      const rule = rules[rIdx];
      const isAirChainCancel =
        p1.moveContact > 0 &&
        stanceForCheck === 'A' &&
        rule.targetState !== p1.stateNo &&
        (rule.allowedStateTypes.includes('A') ||
          states[rule.targetState]?.stateType === 'A' ||
          (rule.targetState >= 600 && rule.targetState < 700));
      if (
        modeRef.current === 'fight' &&
        rule.requireCtrl &&
        p1.ctrl === 0 &&
        !isAirChainCancel &&
        !(activeBtnSet.size >= 2 && isUpgradeWindow)
      ) {
        continue;
      }
      const ctxRes = ruleMatchesCurrentContext(rule, satisfiedCmdNames, activeBtnSet, stanceForCheck, false, p1);
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
          states[rule.targetState]?.stateType === 'A' ||
          (rule.targetState >= 600 && rule.targetState < 700))
          ? 500
          : 0;
      const score =
        effectiveChord * 10000 +
        bestTokenCount * 200 +
        bestChordWeight * 20 +
        airBonus +
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
      triggerStateTransition(bestCandidate.rule.targetState, bestCandidate.label);
      return;
    }

    const canAttack =
      p1.stateNo === 0 ||
      p1.stateNo === 10 ||
      p1.stateNo === 11 ||
      p1.stateNo === 20 ||
      p1.stateNo === 21 ||
      p1.stateNo === 100 ||
      p1.posY < 270 ||
      p1.velY < 0 ||
      p1.stateType === 'A' ||
      (p1.stateNo >= 40 && p1.stateNo <= 52);

    if (canAttack && (modeRef.current === 'practice' || p1.ctrl === 1)) {
      const stance = stanceForCheck;
      if (activeBtnSet.has('s') && stance !== 'A' && (states[195] || airData?.actions[195])) {
        triggerStateTransition(195, 'Taunt');
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
          triggerStateTransition(st, `${stance === 'C' ? 'Crouch ' : stance === 'A' ? 'Air ' : ''}${singleTok.toUpperCase()}`);
        }
      }
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

      const lockedOut = modeRef.current === 'fight' && (fightOutcomeRef.current !== null || p1.life <= 0 || p1.moveType === 'H');
      if (lockedOut) return;

      if (rawDir === 'U' && p1.posY >= 270 && (modeRef.current === 'practice' || p1.ctrl === 1)) {
        setCrouchLocked(false);
        p1.crouchLocked = false;
        p1.velY = constants.jumpNeuY < -1 ? constants.jumpNeuY : -8.4;
        const jumpLocalX = p1.heldDirs.has('F')
          ? (p1.facing === 1 ? constants.jumpFwdX : constants.jumpBackX)
          : p1.heldDirs.has('B')
            ? (p1.facing === -1 ? constants.jumpFwdX : constants.jumpBackX)
            : constants.jumpNeuX;
        p1.velX = jumpLocalX;
        const jumpState = states[50] ? 50 : airData?.actions[41] ? 41 : 40;
        triggerStateTransition(jumpState, 'Jump');
      } else if (rawDir === 'D') {
        enterCrouch(p1);
      }
    }
  };

  const handleDirRelease = (rawDir: string) => {
    const p1 = p1Ref.current;
    if (p1.heldDirs.has(rawDir)) {
      p1.heldDirs.delete(rawDir);
      setHeldDirs(new Set(p1.heldDirs));
      if (rawDir === 'D' && !p1.crouchLocked) {
        exitCrouch(p1);
      }
      if ((rawDir === 'D' || rawDir === 'U') && (p1.heldDirs.has('F') !== p1.heldDirs.has('B'))) {
        const rem = p1.heldDirs.has('F') ? 'F' : 'B';
        const remFacing = p1.facing === -1 ? (rem === 'F' ? 'B' : 'F') : rem;
        if (inputLogRef.current[inputLogRef.current.length - 1] !== remFacing) {
          const next = [...inputLogRef.current, remFacing].slice(-12);
          inputLogRef.current = next;
          setInputLog(next);
        }
      }
    }
  };

  const releaseAllInputs = () => {
    p1Ref.current.heldDirs.clear();
    heldAttackBtnsRef.current.clear();
    recentAttackPressesRef.current = [];
    joystickPointerIdRef.current = null;
    joystickHeldDirsRef.current.clear();
    activeAttackPointersRef.current.clear();
    setJoystickKnob({ x: 0, y: 0, activeDir: null });
    setHeldDirs(new Set());
    setHeldAttackTokens(new Set());
    if (!p1Ref.current.crouchLocked) exitCrouch(p1Ref.current);
  };

  const syncJoystickDirs = (nextDirs: Set<string>, dirLabel: string | null, kx: number, ky: number) => {
    setJoystickKnob({ x: kx, y: ky, activeDir: dirLabel });
    const prev = joystickHeldDirsRef.current;

    for (const h of ['B', 'F']) {
      if (prev.has(h) && !nextDirs.has(h)) {
        handleDirRelease(h);
      }
    }
    for (const d of ['B', 'F', 'D', 'U']) {
      if (nextDirs.has(d) && !prev.has(d)) {
        handleDirPress(d);
      }
    }
    for (const v of ['D', 'U']) {
      if (prev.has(v) && !nextDirs.has(v)) {
        handleDirRelease(v);
      }
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
    } catch {
      // ignore if capture unsupported
    }
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
    } catch {
      // ignore
    }
    syncJoystickDirs(new Set(), null, 0, 0);
  };

  const onAttackPointerDown = (e: React.PointerEvent<HTMLButtonElement>, token: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeAttackPointersRef.current.has(e.pointerId)) return;
    activeAttackPointersRef.current.set(e.pointerId, token);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    }
    handleAttackRelease(tok);
  };

  const keyHandlersRef = useRef({
    onClose,
    handleDirPress,
    handleDirRelease,
    handleAttackPress,
    handleAttackRelease,
    releaseAllInputs,
    resolveTokenForKeyboardEvent,
    listeningSlotId,
    setListeningSlotId,
    setButtonSlots,
  });
  keyHandlersRef.current = {
    onClose,
    handleDirPress,
    handleDirRelease,
    handleAttackPress,
    handleAttackRelease,
    releaseAllInputs,
    resolveTokenForKeyboardEvent,
    listeningSlotId,
    setListeningSlotId,
    setButtonSlots,
  };

  // Keyboard listener & initial reset when modal opens
  useEffect(() => {
    if (!isOpen) return;
    resetArena(modeRef.current);
    setListeningSlotId(null);

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
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }

      if (e.key === 'Escape') {
        keyHandlersRef.current.onClose();
        return;
      }
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
      if (keyHandlersRef.current.listeningSlotId) return;
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

    const onBlur = () => {
      keyHandlersRef.current.releaseAllInputs();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [isOpen]);

  // 60 FPS M.U.G.E.N Dual-Fighter Controller, Hitbox & Physics Engine
  useEffect(() => {
    if (!isOpen) return;
    let rafId = 0;
    let lastTime = performance.now();
    let acc = 0;
    const stepMs = 1000 / 60;
    let hudFrameCounter = 0;

    const runControllersForFighter = (f: FighterRuntime, opp: FighterRuntime) => {
      let transitionsThisTick = 0;
      while (transitionsThisTick < 4) {
        const stDef = states[f.stateNo];
        if (!stDef || stDef.controllers.length === 0) break;

        const act = airData?.actions[f.animId];
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
          mode: modeRef.current,
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
            ? (f.ownerId ? ([...team1Ref.current, ...team2Ref.current].find(o => o.id === f.ownerId)?.life ?? 1000) : 1000)
            : f.life,
          facing: f.facing,
        };

        let transitioned = false;

        for (const ctrl of stDef.controllers) {
          if (ctrl.persistent === 0 && f.firedPersist.has(ctrl.id)) continue;
          if (!doesControllerFire(ctrl, ctx)) continue;

          if (ctrl.persistent === 0) {
            f.firedPersist.add(ctrl.id);
          }

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
              if (addVal !== null && modeRef.current === 'fight') {
                f.power = Math.max(0, Math.min(f.maxPower, f.power + addVal));
              }
            }
          } else if (ctrl.type === 'hitdef' && ctrl.hitDef) {
            const allTrigLines = [
              ...ctrl.triggerAll,
              ...(Object.values(ctrl.triggerGroups) as string[][]).flat(),
            ];
            const hasPulseTime = allTrigLines.some(
              t => /\btime\s*%\s*\d+/i.test(t) || /\btime\s*=\s*\d+/i.test(t)
            );
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
              const t = Math.min(34, Math.max(12, ctrl.superTime ?? 26));
              const mt = ctrl.superMoveTime ?? 0;
              superPauseTicksRef.current = t;
              superMoveTimeRef.current = mt;
              superCasterRef.current = f.id;
              if (modeRef.current === 'fight' && ctrl.superPowerAdd !== undefined) {
                f.power = Math.max(0, Math.min(f.maxPower, f.power + ctrl.superPowerAdd));
              }
              setIsHyperActive(true);
            }
          } else if (ctrl.type === 'playsnd' && ctrl.sndValue) {
            const sndKey = `snd-${ctrl.id}-${f.frameIdx}`;
            if (!f.firedPersist.has(sndKey)) {
              f.firedPersist.add(sndKey);
              playSoundByPair(ctrl.sndValue.group, ctrl.sndValue.sample);
            }
          } else if (ctrl.type === 'changeanim') {
            const nextA = evalMugenNumber(ctrl.valueExpr, ctx);
            if (nextA !== null && nextA !== f.animId && airData?.actions[nextA]) {
              f.animId = nextA;
              f.frameIdx = 0;
              f.tickInFrame = 0;
              if (f.id === 'p1') {
                setActiveAnimId(nextA);
                setFrameIdx(0);
              }
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
            const allTrigLines = [
              ...ctrl.triggerAll,
              ...(Object.values(ctrl.triggerGroups) as string[][]).flat(),
            ];
            const hasElemOrTime = allTrigLines.some(t => /animelem|time/i.test(t));
            const dedupKey = hasElemOrTime ? pKey : `proj-${ctrl.id}`;
            if (!f.firedPersist.has(dedupKey)) {
              f.firedPersist.add(dedupKey);

              const offX = ctrl.projOffsetX ?? 40;
              const offY = ctrl.projOffsetY ?? -55;
              const vx = ctrl.projVelX ?? 5.2;
              const vy = ctrl.projVelY ?? 0;
              const pAnim = ctrl.projAnim ?? (airData?.actions[1005] ? 1005 : f.animId);
              const maxTicks = ctrl.projRemoveTime !== undefined && ctrl.projRemoveTime > 0 ? ctrl.projRemoveTime : 180;

              const hitDefToUse = ctrl.hitDef || {
                attr: (f.stateType === 'A' ? 'A' : f.stateType === 'C' ? 'C' : 'S') as 'S' | 'C' | 'A',
                attrMove: (stDef?.isHyper || f.stateNo >= 3000 ? 'H' : f.stateNo >= 1000 ? 'S' : 'N') as 'N' | 'S' | 'H',
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
                team: f.team,
                posX: f.posX + offX * f.facing,
                posY: f.posY + offY,
                velX: vx,
                velY: vy,
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
            const allTrigLines = [
              ...ctrl.triggerAll,
              ...(Object.values(ctrl.triggerGroups) as string[][]).flat(),
            ];
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

              const newHelper: FighterRuntime = {
                id: `helper-${f.id}-${hId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
                animId: airData?.actions[helperAnim] ? helperAnim : f.animId,
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
              };
              helpersRef.current.push(newHelper);
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
            if (f.isHelper) {
              f.life = 0;
            }
          }
        }

        if (!transitioned) break;
      }
    };

    const runAiDecision = (ai: FighterRuntime, opp: FighterRuntime) => {
      const diff = aiDifficultyRef.current;
      ai.heldDirs.clear();
      ai.aiHoldDown = false;

      if (fightOutcomeRef.current || ai.life <= 0) return;

      // Always auto-face opponent when grounded & idle/crouching
      if (ai.posY >= 270 && ai.ctrl === 1) {
        if (opp.posX > ai.posX + 4) ai.facing = 1;
        else if (opp.posX < ai.posX - 4) ai.facing = -1;
      }

      if (diff === 'dummy') return;

      const dist = Math.abs(opp.posX - ai.posX);
      const isOppAttacking = opp.moveType === 'A' && dist < 135;

      if (ai.aiBlockTimer > 0) {
        ai.aiBlockTimer--;
        // Hold screen direction away from opponent (= HoldBack)
        ai.heldDirs.add(ai.facing === 1 ? 'B' : 'F');
        if (opp.stateType === 'C' || (ai.stateNo === 152)) ai.aiHoldDown = true;
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

      // Maintain walk motion during neutral footsies
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
          s => ((s.stateNo >= 200 && s.stateNo <= 250) || (s.stateNo >= 400 && s.stateNo <= 450)) && (airData?.actions[s.anim ?? s.stateNo] || airData?.actions[s.stateNo])
        );
        const specials = sortedStates.filter(
          s => s.category === 'special' && s.moveType === 'A' && (airData?.actions[s.anim ?? s.stateNo] || airData?.actions[s.stateNo])
        );
        const hypers = sortedStates.filter(s => {
          if (!s.isHyper || s.moveType !== 'A') return false;
          const costFromRule = rules.find(r => r.targetState === s.stateNo)?.minPowerRequired ?? 0;
          const costFromSt = s.powerAdd && s.powerAdd < 0 ? Math.abs(s.powerAdd) : 0;
          const req = Math.max(costFromRule, costFromSt, 1000);
          return ai.power >= req && (airData?.actions[s.anim ?? s.stateNo] || airData?.actions[s.stateNo]);
        });

        // Spend Hyper when meter is ready!
        if (hypers.length > 0 && dist < 170 && roll < (diff === 'hard' ? 0.55 : 0.35)) {
          const pick = hypers[Math.floor(Math.random() * hypers.length)];
          transitionFighterState(ai, pick.stateNo);
          ai.aiCooldown = diff === 'hard' ? 32 : 48;
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
          } else if (roll >= 0.88 && (states[105] || airData?.actions[105])) {
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
          // Walk forward toward player
          ai.aiWalkDir = opp.posX >= ai.posX ? 1 : -1;
          ai.aiActionTimer = 22;
          ai.aiCooldown = 14;
          return;
        } else {
          // Far range: run forward or jump in occasionally
          if (roll < 0.25 && (states[100] || airData?.actions[100])) {
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

      // Smoothly decay trailing life bar
      if (f.trailLife > f.life) {
        f.trailLife = Math.max(f.life, f.trailLife - Math.max(2, (f.trailLife - f.life) * 0.12));
      }

      // Hitstop freeze (decremented in advanceFighterAnim after resolveHit)
      if (f.hitPauseTicks > 0) {
        return;
      }

      // Auto-face opponent in neutral grounded states (Fight Mode)
      if (
        modeRef.current === 'fight' &&
        f.posY >= 270 &&
        f.ctrl === 1 &&
        (f.stateNo === 0 || f.stateNo === 10 || f.stateNo === 11 || f.stateNo === 20 || f.stateNo === 21)
      ) {
        if (opp.posX > f.posX + 5) f.facing = 1;
        else if (opp.posX < f.posX - 5) f.facing = -1;
      }

      const downNow = f.heldDirs.has('D') || f.crouchLocked || f.aiHoldDown;

      // Guardstun / Hitstun / Knockdown state machine (Fight Mode)
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
          // KO lie-down stays until rematch
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
                const playedDeath = playSoundByPair(11, 0);
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

        // 5000 / 5010 / 5050 active hitstun / launch
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
                const playedDeath = playSoundByPair(11, 0);
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
          f.animId = resolveAnimForState(0, states[0]);
          f.frameIdx = 0;
          f.tickInFrame = 0;
        }
      } else {
        // Allow quick diagonal UF/UB input within first 2 ticks of jump to steer jump arc
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
          const hasCustomRunVel = Boolean(
            st100?.controllers.some(c => c.type === 'velset' || c.type === 'veladd')
          );
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

      // Vertical velocity & gravity (defer landing state reset to advanceFighterAnim after resolveHit!)
      if (f.posY < 270 || f.velY < 0) {
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
      if (f.stateNo === 5150) {
        return;
      }

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
        if (f.posY >= 270 && f.velY >= 0) {
          f.velY = 0;
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
        if (f.stateNo === 5000 || f.stateNo === 5010 || f.stateNo === 5050) {
          f.stateTime++;
        }
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

      // Advance AIR animation & StateTime AFTER resolveHit so time=1 hit frames still count
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
          } else {
            if (f.stateNo === 10 && downNow) {
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
                    mode: modeRef.current,
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
                      ? (f.ownerId ? ([...team1Ref.current, ...team2Ref.current].find(o => o.id === f.ownerId)?.life ?? 1000) : 1000)
                      : f.life,
                    facing: f.facing,
                  };
                  for (const ctrl of stDef.controllers) {
                    if (ctrl.type !== 'changestate') continue;
                    if (ctrl.persistent === 0 && f.firedPersist.has(ctrl.id)) continue;
                    const trigText = [
                      ...ctrl.triggerAll,
                      ...(Object.values(ctrl.triggerGroups) as string[][]).flat(),
                    ];
                    if (!trigText.some(t => /animtime/i.test(t))) continue;
                    if (!doesControllerFire(ctrl, endCtx)) continue;
                    const nextS = evalMugenNumber(ctrl.valueExpr, endCtx);
                    if (nextS !== null && nextS !== f.stateNo) {
                      transitionFighterState(f, nextS);
                      if (ctrl.ctrlVal !== undefined) f.ctrl = ctrl.ctrlVal;
                      return;
                    }
                  }
                }
                const nextOnEnd = stDef ? stDef.endToState : 0;
                const stillAirborne = f.posY < 270 || f.velY < 0;
                const isAirHoldState =
                  f.stateNo === 40 ||
                  f.stateNo === 41 ||
                  f.stateNo === 45 ||
                  f.stateNo === 50 ||
                  f.stateNo === 105 ||
                  f.stateType === 'A';
                if (nextOnEnd !== f.stateNo && nextOnEnd !== 0 && (states[nextOnEnd] || airData?.actions[nextOnEnd])) {
                  transitionFighterState(f, nextOnEnd);
                } else if (f.isHelper) {
                  f.life = 0;
                  return;
                } else if (stillAirborne && (isAirHoldState || (stDef && stDef.controllers.some(c => c.type === 'changestate')))) {
                  f.frameIdx = act.elements.length - 1;
                } else {
                  transitionFighterState(f, downNow ? 11 : 0);
                }
              }
            }
          }
        }
      }
    };

    const getHurtBoxes = (f: FighterRuntime): ClsnBox[] => {
      const act = airData?.actions[f.animId];
      const el = act?.elements[f.frameIdx];
      const boxes = el?.clsn2 ?? act?.clsn2;
      if (boxes && boxes.length > 0) return boxes;
      return [{ id: 0, x1: -18, y1: f.stateType === 'C' ? -55 : -85, x2: 18, y2: 0 }];
    };

    const getAtkBoxes = (f: FighterRuntime): ClsnBox[] => {
      const act = airData?.actions[f.animId];
      const el = act?.elements[f.frameIdx];
      const boxes = el?.clsn1 ?? act?.clsn1 ?? [];
      if (boxes.length > 0) return boxes;
      if (f.isHelper && f.moveType === 'A') {
        return [{ id: 0, x1: -18, y1: -18, x2: 18, y2: 18 }];
      }
      return [];
    };

    const getProjectileAtkBoxes = (p: ProjectileRuntime): ClsnBox[] => {
      const act = airData?.actions[p.animId];
      const el = act?.elements[p.frameIdx];
      const boxes = el?.clsn1 ?? act?.clsn1 ?? [];
      if (boxes.length > 0) return boxes;
      return [{ id: 0, x1: -18, y1: -18, x2: 18, y2: 18 }];
    };

    const resolveHit = (atk: FighterRuntime, def: FighterRuntime) => {
      if (def.life <= 0 || def.invulnTicks > 0 || def.stateNo === 5110 || def.stateNo === 5120 || def.stateNo === 5150) {
        return;
      }
      const atkBoxes = getAtkBoxes(atk);
      if (atkBoxes.length === 0) return;

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

      // Check hitflag compatibility
      if (def.posY < 270 && !hitDef.hitFlag.includes('A')) return;

      const defBoxes = getHurtBoxes(def);
      const hitPoint = findBoxesOverlap(atkBoxes, atk, defBoxes, def);
      if (!hitPoint) return;

      atk.hitScoredThisWindow = true;
      atk.hitTargetsThisWindow.add(def.id);
      atk.moveContact = 1;

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
        rawBaseDmg > 0 ? Math.max(1, Math.round(rawBaseDmg * (atk.attackMul / Math.max(0.1, def.defenceMul)))) : 0;

      def.life = Math.max(0, def.life - scaledDmg);
      atk.power = Math.min(atk.maxPower, atk.power + (isGuarded ? hitDef.getPowerGuard : hitDef.getPowerHit));
      def.power = Math.min(def.maxPower, def.power + (isGuarded ? hitDef.givePowerGuard : hitDef.givePowerHit));

      atk.hitPauseTicks = Math.max(2, Math.min(18, hitDef.pauseP1));
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
        atk.moveGuarded = 1;
        const played = hitDef.guardSound ? playSoundByPair(hitDef.guardSound.group, hitDef.guardSound.sample) : false;
        if (!played) playSynthImpact('guard');
        const guardState = def.posY < 270 ? 154 : defDirs.has('D') ? 152 : 150;
        transitionFighterState(def, guardState, { asHitOrGuard: true });
        def.velX = hitDef.guardVelX;
        def.hitStunTicks = hitDef.guardHittime;
      } else {
        atk.moveHit = 1;
        def.comboCount = def.moveType === 'H' ? def.comboCount + 1 : 1;
        const played = hitDef.hitSound ? playSoundByPair(hitDef.hitSound.group, hitDef.hitSound.sample) : false;
        if (!played && def.life > 0) playSynthImpact('hit');

        if (def.life <= 0 && !def.hasPlayedDeathSound) {
          def.hasPlayedDeathSound = true;
          const playedDeath = playSoundByPair(11, 0);
          if (!playedDeath) playSynthImpact('ko');
        }

        if (def.life <= 0 || def.posY < 270 || hitDef.fall || hitDef.groundVelY < 0) {
          transitionFighterState(def, 5050, { asHitOrGuard: true });
          def.velX = def.posY < 270 ? hitDef.airVelX : (hitDef.groundVelX || hitDef.airVelX);
          def.velY = hitDef.airVelY < 0 ? hitDef.airVelY : -4.8;
          def.hitStunTicks = hitDef.airHittime;
          if (def.life <= 0) {
            atk.hitPauseTicks = 14;
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

    const applyProjectileHit = (
      proj: ProjectileRuntime,
      def: FighterRuntime,
      hitPoint: { x: number; y: number }
    ) => {
      const hitDef = proj.hitDef;
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
        rawBaseDmg > 0 ? Math.max(1, Math.round(rawBaseDmg * (1 / Math.max(0.1, def.defenceMul)))) : 0;

      def.life = Math.max(0, def.life - scaledDmg);
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
        const played = hitDef.guardSound ? playSoundByPair(hitDef.guardSound.group, hitDef.guardSound.sample) : false;
        if (!played) playSynthImpact('guard');
        const guardState = def.posY < 270 ? 154 : defDirs.has('D') ? 152 : 150;
        transitionFighterState(def, guardState, { asHitOrGuard: true });
        def.velX = hitDef.guardVelX;
        def.hitStunTicks = hitDef.guardHittime;
      } else {
        def.comboCount = def.moveType === 'H' ? def.comboCount + 1 : 1;
        const played = hitDef.hitSound ? playSoundByPair(hitDef.hitSound.group, hitDef.hitSound.sample) : false;
        if (!played && def.life > 0) playSynthImpact('hit');

        // Play death sound (11, 0)
        if (def.life <= 0 && !def.hasPlayedDeathSound) {
          def.hasPlayedDeathSound = true;
          const playedDeath = playSoundByPair(11, 0);
          if (!playedDeath) playSynthImpact('ko');
        }

        if (def.life <= 0 || def.posY < 270 || hitDef.fall || hitDef.groundVelY < 0) {
          transitionFighterState(def, 5050, { asHitOrGuard: true });
          def.velX = def.posY < 270 ? hitDef.airVelX : (hitDef.groundVelX || hitDef.airVelX);
          def.velY = hitDef.airVelY < 0 ? hitDef.airVelY : -4.8;
          def.hitStunTicks = hitDef.airHittime;
          if (def.life <= 0) {
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

    const drawProjectile = (
      ctx: CanvasRenderingContext2D,
      p: ProjectileRuntime,
      camX: number,
      canvasW: number,
      scale: number,
      fighterPal: Uint8Array | null
    ) => {
      const screenX = canvasW / 2 + (p.posX - camX) * scale;
      const screenY = 270 + (p.posY - 270) * scale;

      const act = airData?.actions[p.animId];
      const el = act?.elements[p.frameIdx];
      let drewSprite = false;

      if (act && el && sffData) {
        const sprite = sffData.images.find(img => img.group === el.group && img.image === el.image);
        if (sprite && sprite.pixelIndices && sprite.width > 0 && sprite.height > 0) {
          const pal =
            sprite.group >= 7000 && sprite.isSharedPalette === false && sprite.palette
              ? sprite.palette
              : (fighterPal || sprite.palette || sffData.palettes?.[0]?.data);
          if (pal) {
            const imgData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, pal);
            const off = document.createElement('canvas');
            off.width = sprite.width;
            off.height = sprite.height;
            const octx = off.getContext('2d');
            if (octx) {
              octx.putImageData(imgData, 0, 0);
              const flipStr = (el.flip || '').toUpperCase();
              const flipH = (p.facing === -1) !== flipStr.includes('H');
              const flipV = flipStr.includes('V');

              ctx.save();
              ctx.translate(screenX, screenY);
              ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(
                off,
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

        ctx.fillStyle = isCyan ? 'rgba(56, 189, 248, 0.45)' : 'rgba(251, 146, 60, 0.45)';
        ctx.beginPath();
        ctx.moveTo(0, -10 * scale);
        ctx.quadraticCurveTo(-18 * scale, -14 * scale, -28 * scale, 0);
        ctx.quadraticCurveTo(-18 * scale, 14 * scale, 0, 10 * scale);
        ctx.closePath();
        ctx.fill();

        const coreGrad = ctx.createRadialGradient(-3 * scale, 0, 1, 0, 0, 9 * scale);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.7, isCyan ? '#bae6fd' : '#fed7aa');
        coreGrad.addColorStop(1, isCyan ? '#38bdf8' : '#fb923c');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 9 * scale, 0, Math.PI * 2);
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
          const bx = Math.min(b.x1, b.x2) * scale;
          const by = Math.min(b.y1, b.y2) * scale;
          const bw = Math.abs(b.x2 - b.x1) * scale;
          const bh = Math.abs(b.y2 - b.y1) * scale;
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeRect(bx, by, bw, bh);
        }
        ctx.restore();
      }
    };

    const drawExplod = (
      ctx: CanvasRenderingContext2D,
      ex: ExplodRuntime,
      camX: number,
      canvasW: number,
      scale: number,
      fighterPal: Uint8Array | null
    ) => {
      const screenX = canvasW / 2 + (ex.posX - camX) * scale;
      const screenY = 270 + (ex.posY - 270) * scale;

      const act = airData?.actions[ex.animId];
      const el = act?.elements[ex.frameIdx];
      if (act && el && sffData) {
        const sprite = sffData.images.find(img => img.group === el.group && img.image === el.image);
        if (sprite && sprite.pixelIndices && sprite.width > 0 && sprite.height > 0) {
          const pal =
            sprite.group >= 7000 && sprite.isSharedPalette === false && sprite.palette
              ? sprite.palette
              : (fighterPal || sprite.palette || sffData.palettes?.[0]?.data);
          if (pal) {
            const imgData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, pal);
            const off = document.createElement('canvas');
            off.width = sprite.width;
            off.height = sprite.height;
            const octx = off.getContext('2d');
            if (octx) {
              octx.putImageData(imgData, 0, 0);
              const flipStr = (el.flip || '').toUpperCase();
              const flipH = (ex.facing === -1) !== flipStr.includes('H');
              const flipV = (ex.vfacing === -1) !== flipStr.includes('V');

              ctx.save();
              ctx.translate(screenX, screenY);
              ctx.scale((flipH ? -1 : 1) * ex.scaleX, (flipV ? -1 : 1) * ex.scaleY);
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(
                off,
                (el.xOffset - sprite.xOffset) * scale,
                (el.yOffset - sprite.yOffset) * scale,
                sprite.width * scale,
                sprite.height * scale
              );
              ctx.restore();
            }
          }
        }
      }
    };

    const drawFighter = (
      ctx: CanvasRenderingContext2D,
      f: FighterRuntime,
      camX: number,
      canvasW: number,
      scale: number,
      fighterPal: Uint8Array | null
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

      const act = airData?.actions[f.animId];
      const el = act?.elements[f.frameIdx];
      let drewHelperSprite = false;
      if (act && el && sffData) {
        const sprite = sffData.images.find(img => img.group === el.group && img.image === el.image);
        if (sprite && sprite.pixelIndices && sprite.width > 0 && sprite.height > 0) {
          // For fighter body sprites (< 7000), force fighter's assigned palette so SFFv1 frame 0,0 uses P2's alternate palette too
          const pal =
            sprite.group >= 7000 && sprite.isSharedPalette === false && sprite.palette
              ? sprite.palette
              : (fighterPal || sprite.palette || sffData.palettes?.[0]?.data);
          if (pal) {
            const imgData = applyPalette(sprite.pixelIndices, sprite.width, sprite.height, pal);
            const off = document.createElement('canvas');
            off.width = sprite.width;
            off.height = sprite.height;
            const octx = off.getContext('2d');
            if (octx) {
              octx.putImageData(imgData, 0, 0);
              const flipStr = (el.flip || '').toUpperCase();
              const flipH = (f.facing === -1) !== flipStr.includes('H');
              const flipV = flipStr.includes('V');

              ctx.save();
              ctx.translate(screenX, screenY);
              ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(
                off,
                (el.xOffset - sprite.xOffset) * scale,
                (el.yOffset - sprite.yOffset) * scale,
                sprite.width * scale,
                sprite.height * scale
              );
              ctx.restore();
              drewHelperSprite = true;
            }
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

      if (f.isHelper && !drewHelperSprite) {
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

      // Draw role tag above fighters in 2v2 / 3v3 / 4v4 battles
      if (!f.isHelper && modeRef.current === 'fight' && teamSizeRef.current > 1 && f.life > 0) {
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
        ctx.fillStyle = f.isPlayer ? '#34d399' : f.team === 1 ? '#2dd4bf' : '#38bdf8';
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
        const p1 = team1[0];
        p1Ref.current = p1;
        p2Ref.current = getNearestLivingOpponent(p1, team2);
        const p2 = p2Ref.current;
        const isFight = modeRef.current === 'fight';

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
            if (isFight) {
              for (const def of oppTeam) {
                if (def.life > 0) resolveHit(caster, def);
              }
            }
            advanceFighterAnim(caster, target);
          } else {
            continue;
          }
        } else {
          if (isFight) {
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

            // Body Pushbox separation across opposing teams (only when vertically close)
            for (const a of team1) {
              if (a.life <= 0) continue;
              for (const b of team2) {
                if (b.life <= 0) continue;
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

            // Stage & camera viewport clamping so fighters never leave the arena
            const stageLimit = 520;
            const allFighters = [...team1, ...team2];
            const living = allFighters.filter(f => f.life > 0);
            const camGroup = living.length > 0 ? living : allFighters;
            for (const f of allFighters) {
              f.posX = Math.max(-stageLimit, Math.min(stageLimit, f.posX));
            }
            const minCamX = Math.min(...camGroup.map(f => f.posX));
            const maxCamX = Math.max(...camGroup.map(f => f.posX));
            const targetCam = Math.max(-330, Math.min(330, (minCamX + maxCamX) / 2));
            cameraXRef.current += (targetCam - cameraXRef.current) * 0.2;

            const screenHalfSpan = 190;
            for (const f of allFighters) {
              f.posX = Math.max(cameraXRef.current - screenHalfSpan, Math.min(cameraXRef.current + screenHalfSpan, f.posX));
            }

            // Combat hit detection (Clsn1 vs Clsn2) BEFORE advancing animation ticks
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

            // Check Team K.O. state
            const team1Alive = team1.some(f => f.life > 0);
            const team2Alive = team2.some(f => f.life > 0);
            if (!fightOutcomeRef.current && (!team1Alive || !team2Alive)) {
              const outcome: FightOutcome =
                !team1Alive && !team2Alive ? 'DRAW' : !team2Alive ? 'P1_WIN' : 'P2_WIN';
              fightOutcomeRef.current = outcome;
              setFightOutcome(outcome);
              const winners = outcome === 'P1_WIN' ? team1 : outcome === 'P2_WIN' ? team2 : [];
              for (const w of winners) {
                if (w.life > 0 && w.posY >= 270 && w.ctrl === 1 && (airData?.actions[181] || airData?.actions[180])) {
                  transitionFighterState(w, airData?.actions[181] ? 181 : 180);
                }
              }
            }

            // Advance animation frames & stateTime after hit resolution
            for (const f of team1) {
              advanceFighterAnim(f, getNearestLivingOpponent(f, team2));
            }
            for (const f of team2) {
              advanceFighterAnim(f, getNearestLivingOpponent(f, team1));
            }
          } else {
            stepFighter(p1, p2);
            const deadzone = 75;
            if (p1.posX - cameraXRef.current > deadzone) {
              cameraXRef.current += (p1.posX - deadzone - cameraXRef.current) * 0.25;
            } else if (p1.posX - cameraXRef.current < -deadzone) {
              cameraXRef.current += (p1.posX + deadzone - cameraXRef.current) * 0.25;
            }
            advanceFighterAnim(p1, p2);
          }

          // Step active Helpers (in both Fight & Practice modes)
          if (helpersRef.current.length > 0) {
            for (const h of helpersRef.current) {
              if (h.life <= 0) continue;
              const hOppTeam = h.team === 1 ? team2 : team1;
              const hOpp = getNearestLivingOpponent(h, hOppTeam);
              stepFighter(h, hOpp);
              if (isFight && h.life > 0) {
                for (const def of hOppTeam) {
                  if (def.life > 0) resolveHit(h, def);
                }
              }
              if (h.life > 0) {
                advanceFighterAnim(h, hOpp);
              }
            }
            helpersRef.current = helpersRef.current.filter(
              h => h.life > 0 && Math.abs(h.posX - cameraXRef.current) < 480 && Math.abs(h.posX) < 1200 && h.stateTime < 600
            );
          }

          // Step active Projectiles (Hadoken balls, energy blasts, etc.)
          if (projectilesRef.current.length > 0) {
            for (const p of projectilesRef.current) {
              p.lifeTicks++;
              if (!p.isHitOrDying) {
                p.posX += p.velX * p.facing;
                p.posY += p.velY;

                if (isFight) {
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
                      applyProjectileHit(p, def, hitPt);
                      p.isHitOrDying = true;
                      if (p.hitAnimId !== undefined && airData?.actions[p.hitAnimId]) {
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
              }

              // Advance projectile AIR animation
              const act = airData?.actions[p.animId];
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

          // Step active Explods (aura, fire trails, energy bursts, hit FX)
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

              const act = airData?.actions[ex.animId];
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

              if (alive && ex.ageTicks < 600) {
                nextExplods.push(ex);
              }
            }
            explodsRef.current = nextExplods;
          }
        }

        // Advance hit/guard sparks
        if (sparksRef.current.length > 0) {
          sparksRef.current = sparksRef.current
            .map(sp => ({ ...sp, age: sp.age + 1 }))
            .filter(sp => sp.age < sp.maxAge);
        }

        hudFrameCounter++;
        if (hudFrameCounter % 3 === 0) {
          syncP1ReactHud();
          if (isFight) {
            const leadP2 = p2Ref.current;
            const team1Combo = Math.max(0, ...team2.map(f => f.comboCount));
            const team2Combo = Math.max(0, ...team1.map(f => f.comboCount));
            const nextT1 = team1.map(makeMemberHud);
            const nextT2 = team2.map(makeMemberHud);
            const p1Life = Math.ceil(p1.life);
            const p1Trail = Math.ceil(p1.trailLife);
            const p1Power = Math.floor(p1.power);
            const p2Life = Math.ceil(leadP2.life);
            const p2Trail = Math.ceil(leadP2.trailLife);
            const p2Power = Math.floor(leadP2.power);
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
                prev.p2Life === p2Life &&
                prev.p2Trail === p2Trail &&
                prev.p2MaxLife === leadP2.maxLife &&
                prev.p2Power === p2Power &&
                prev.p2MaxPower === leadP2.maxPower &&
                prev.p2Combo === team2Combo &&
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
                p2Life,
                p2Trail,
                p2MaxLife: leadP2.maxLife,
                p2Power,
                p2MaxPower: leadP2.maxPower,
                p2Combo: team2Combo,
                p2StateNo: leadP2.stateNo,
              };
            });
          }
        }
      }

      // Render Canvas
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
        grad.addColorStop(0, hyperFlash ? '#1e0b36' : '#12131a');
        grad.addColorStop(0.75, hyperFlash ? '#2d124d' : '#191b26');
        grad.addColorStop(1, '#0e1017');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Hyper SuperPause ring burst on caster
        if (hyperFlash) {
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

        // Scrolling perspective floor grid
        ctx.strokeStyle = hyperFlash ? 'rgba(192, 132, 252, 0.25)' : 'rgba(99, 102, 241, 0.14)';
        ctx.lineWidth = 1;
        const step = 40 * scale;
        const camOffset = (((cameraXRef.current * scale) % step) + step) % step;
        for (let gx = -camOffset; gx <= canvas.width + step; gx += step) {
          ctx.beginPath();
          ctx.moveTo(gx, 270);
          ctx.lineTo(gx + (gx - canvas.width / 2) * 0.35, canvas.height);
          ctx.stroke();
        }

        // Distance markers
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.font = '9px monospace';
        const firstMark = Math.floor((cameraXRef.current - 240) / 100) * 100;
        const lastMark = Math.ceil((cameraXRef.current + 240) / 100) * 100;
        for (let wx = firstMark; wx <= lastMark; wx += 100) {
          const mx = canvas.width / 2 + (wx - cameraXRef.current) * scale;
          ctx.fillRect(mx, 270, 1, 5);
          ctx.fillText(`${wx}`, mx - 10, 286);
        }

        ctx.strokeStyle = hyperFlash ? 'rgba(216, 180, 254, 0.55)' : 'rgba(129, 140, 248, 0.35)';
        ctx.beginPath();
        ctx.moveTo(0, 270);
        ctx.lineTo(canvas.width, 270);
        ctx.stroke();

        // Draw Fighters (KO'd -> neutral -> attacking -> P1 in front)
        if (modeRef.current === 'fight') {
          const drawOrder = [...allFighters].sort((a, b) => {
            const za = (a.life <= 0 ? 0 : a.moveType === 'A' ? 2 : 1) + (a.isPlayer ? 0.5 : 0);
            const zb = (b.life <= 0 ? 0 : b.moveType === 'A' ? 2 : 1) + (b.isPlayer ? 0.5 : 0);
            return za - zb;
          });
          for (const f of drawOrder) {
            const pal = f.team === 1 ? team1Palettes[f.slotIdx] ?? p1Palette : team2Palettes[f.slotIdx] ?? p2Palette;
            drawFighter(ctx, f, cameraXRef.current, canvas.width, scale, pal);
          }

          // Render Helpers, Explods & Projectiles in Fight Mode
          for (const h of helpersRef.current) {
            const pal = h.team === 1 ? team1Palettes[h.slotIdx] ?? p1Palette : team2Palettes[h.slotIdx] ?? p2Palette;
            drawFighter(ctx, h, cameraXRef.current, canvas.width, scale, pal);
          }
          for (const ex of explodsRef.current) {
            const pal = ex.team === 1 ? p1Palette : p2Palette;
            drawExplod(ctx, ex, cameraXRef.current, canvas.width, scale, pal);
          }
          for (const p of projectilesRef.current) {
            const pal = p.team === 1 ? p1Palette : p2Palette;
            drawProjectile(ctx, p, cameraXRef.current, canvas.width, scale, pal);
          }

          // Render Hit / Guard Sparks
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
        } else {
          drawFighter(ctx, p1, cameraXRef.current, canvas.width, scale, p1Palette);
          for (const h of helpersRef.current) {
            drawFighter(ctx, h, cameraXRef.current, canvas.width, scale, p1Palette);
          }
          for (const ex of explodsRef.current) {
            drawExplod(ctx, ex, cameraXRef.current, canvas.width, scale, p1Palette);
          }
          for (const p of projectilesRef.current) {
            drawProjectile(ctx, p, cameraXRef.current, canvas.width, scale, p1Palette);
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isOpen, airData, sffData, p1Palette, p2Palette, team1Palettes, team2Palettes, showClsn, constants, states, rules, sortedStates]);

  const filteredStatedefs = useMemo(() => {
    const q = stateSearch.trim().toLowerCase();
    return sortedStates
      .filter(st => {
        if (stateFilter === 'hyper' && !st.isHyper) return false;
        if (stateFilter === 'movexy' && !st.hasExplicitVel && st.moveX === 0 && st.moveY === 0) return false;
        if (stateFilter === 'crouch_hop' && !st.isCrouch && !st.isHopBack) return false;
        if (stateFilter === 'special' && st.category !== 'special') return false;
        if (stateFilter === 'normal' && st.category !== 'normal') return false;
        if (!q) return true;
        return (
          String(st.stateNo).includes(q) ||
          st.label.toLowerCase().includes(q) ||
          st.rawText.toLowerCase().includes(q) ||
          (q.includes('move x') && (st.moveX !== 0 || /vel|posadd|x\s*=/.test(st.rawText.toLowerCase()))) ||
          (q.includes('move y') && (st.moveY !== 0 || /vel|posadd|y\s*=/.test(st.rawText.toLowerCase())))
        );
      })
      .map(st => {
        if (!q) return st;
        const lines = st.rawText.split(/\r?\n/);
        const matchLine = lines.find(l => l.toLowerCase().includes(q));
        return matchLine ? { ...st, matchedSnippet: matchLine.trim() } : st;
      });
  }, [sortedStates, stateSearch, stateFilter]);

  if (!isOpen) return null;

  const currentStanceLabel =
    p1Ref.current.posY < 270
      ? 'AIR'
      : isDownHeld() || activeState === 10 || activeState === 11
        ? 'CROUCH'
        : 'STAND';

  const visibleAttacks = buttonSlots.filter(b => b.kind === 'attack' && b.visible);
  const macroAttackIds = new Set(['m1', 'm2', 's']);
  const primaryAttacks = visibleAttacks.filter(b => !macroAttackIds.has(b.id));
  const extraAttacks = visibleAttacks.filter(b => macroAttackIds.has(b.id));
  const mainPadList = primaryAttacks.length > 0 ? primaryAttacks : visibleAttacks;
  const macroPadList = primaryAttacks.length > 0 ? extraAttacks : [];
  const splitIdx = Math.ceil(mainPadList.length / 2);
  const topAttackRow = mainPadList.slice(0, splitIdx);
  const bottomAttackRow = mainPadList.slice(splitIdx);

  const toggleCrouchLock = () => {
    const next = !crouchLocked;
    setCrouchLocked(next);
    p1Ref.current.crouchLocked = next;
    if (next) enterCrouch(p1Ref.current);
    else exitCrouch(p1Ref.current);
  };

  const toggleRunLock = () => {
    const nextRun = !runLocked;
    setRunLocked(nextRun);
    p1Ref.current.runLocked = nextRun;
    if (nextRun) {
      setCrouchLocked(false);
      p1Ref.current.crouchLocked = false;
      const runLog = [...inputLogRef.current, 'F', 'F'].slice(-12);
      inputLogRef.current = runLog;
      setInputLog(runLog);
      triggerStateTransition(100, 'Run Forward');
    } else if (p1Ref.current.stateNo === 100) {
      p1Ref.current.velX = 0;
      triggerStateTransition(0);
    }
  };

  const renderExternalJoystick = (compact = false) => {
    const dirFlags = {
      U: heldDirs.has('U'),
      D: heldDirs.has('D'),
      B: heldDirs.has('B'),
      F: heldDirs.has('F'),
    };
    return (
      <div className="flex flex-col items-center gap-2 select-none touch-none" onClick={e => e.stopPropagation()}>
        {/* Quick Movement / Stance Strip above Joystick */}
        <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onPointerDown={e => {
              e.preventDefault();
              e.stopPropagation();
              triggerHopBack();
            }}
            className="min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl bg-[#191922]/95 active:scale-95 hover:bg-[#252534] border border-amber-500/50 text-amber-200 text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer touch-none"
            title="Hop Back (State 105)"
          >
            <CornerUpLeft size={12} />
            <span>Hop</span>
          </button>
          <button
            type="button"
            onPointerDown={e => {
              e.preventDefault();
              e.stopPropagation();
              toggleRunLock();
            }}
            className={`min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl border text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer active:scale-95 touch-none transition-colors ${
              runLocked
                ? 'bg-indigo-600 border-indigo-300 text-white'
                : 'bg-[#191922]/95 hover:bg-[#252534] border-indigo-500/50 text-indigo-200'
            }`}
            title="Run Forward (State 100)"
          >
            <Move size={12} />
            <span>{runLocked ? 'Run ✓' : 'Run'}</span>
          </button>
          <button
            type="button"
            onPointerDown={e => {
              e.preventDefault();
              e.stopPropagation();
              toggleCrouchLock();
            }}
            className={`min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl border text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer active:scale-95 touch-none transition-colors ${
              crouchLocked
                ? 'bg-cyan-600 border-cyan-300 text-white'
                : 'bg-[#191922]/95 hover:bg-[#252534] border-cyan-500/50 text-cyan-200'
            }`}
            title="Crouch Lock"
          >
            <ArrowDown size={12} />
            <span>{crouchLocked ? 'Crch ✓' : 'Crouch'}</span>
          </button>
          <button
            type="button"
            onPointerDown={e => onAttackPointerDown(e, 's')}
            onPointerUp={onAttackPointerEnd}
            onPointerCancel={onAttackPointerEnd}
            className={`min-h-[36px] px-2 sm:px-2.5 py-1 rounded-xl border text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-lg cursor-pointer active:scale-95 touch-none transition-colors ${
              heldAttackTokens.has('s')
                ? 'bg-fuchsia-600 border-fuchsia-300 text-white'
                : 'bg-[#191922]/95 hover:bg-[#252534] border-fuchsia-500/50 text-fuchsia-200'
            }`}
            title="Taunt (State 195 · Space / Enter)"
          >
            <Sparkles size={12} />
            <span>Taunt</span>
          </button>
        </div>

        {/* Big Smooth 8-Way Fighting Joystick */}
        <div
          ref={joystickZoneRef}
          onPointerDown={onJoystickPointerDown}
          onPointerMove={onJoystickPointerMove}
          onPointerUp={onJoystickPointerEnd}
          onPointerCancel={onJoystickPointerEnd}
          style={{ touchAction: 'none' }}
          className={`relative rounded-full bg-gradient-to-b from-[#1e1e28]/95 to-[#101016]/95 border-2 ${
            joystickKnob.activeDir ? 'border-blue-400/80 shadow-[0_0_28px_rgba(59,130,246,0.35)]' : 'border-zinc-500/60 shadow-[0_10px_30px_rgba(0,0,0,0.8)]'
          } flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing ${
            compact ? 'w-[140px] h-[140px]' : 'w-[142px] h-[142px] min-[420px]:w-[158px] min-[420px]:h-[158px] sm:w-[176px] sm:h-[176px]'
          }`}
        >
          {/* Inner Octagonal Gate Ring */}
          <div className="absolute inset-3 rounded-full border border-white/10 pointer-events-none" />
          <div className="absolute inset-8 rounded-full border border-dashed border-white/10 pointer-events-none" />

          {/* 8-Way Direction Indicators */}
          <span className={`absolute top-2 text-xs font-black pointer-events-none transition-colors ${dirFlags.U && !dirFlags.B && !dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>▲</span>
          <span className={`absolute bottom-2 text-xs font-black pointer-events-none transition-colors ${dirFlags.D && !dirFlags.B && !dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>▼</span>
          <span className={`absolute left-2.5 text-xs font-black pointer-events-none transition-colors ${dirFlags.B && !dirFlags.U && !dirFlags.D ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>◀</span>
          <span className={`absolute right-2.5 text-xs font-black pointer-events-none transition-colors ${dirFlags.F && !dirFlags.U && !dirFlags.D ? 'text-cyan-300 scale-125' : 'text-zinc-500'}`}>▶</span>

          {/* Diagonal markers for quarter/half-circle motions */}
          <span className={`absolute top-4 left-4 text-[10px] font-bold pointer-events-none ${dirFlags.U && dirFlags.B ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↖</span>
          <span className={`absolute top-4 right-4 text-[10px] font-bold pointer-events-none ${dirFlags.U && dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↗</span>
          <span className={`absolute bottom-4 left-4 text-[10px] font-bold pointer-events-none ${dirFlags.D && dirFlags.B ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↙</span>
          <span className={`absolute bottom-4 right-4 text-[10px] font-bold pointer-events-none ${dirFlags.D && dirFlags.F ? 'text-cyan-300 scale-125' : 'text-zinc-600'}`}>↘</span>

          {/* Movable Ergonomic Thumb Stick Ball-Top */}
          <div
            style={{
              transform: `translate3d(${joystickKnob.x}px, ${joystickKnob.y}px, 0)`,
            }}
            className={`rounded-full pointer-events-none flex items-center justify-center border-2 transition-colors ${
              compact ? 'w-14 h-14' : 'w-14 h-14 min-[420px]:w-16 min-[420px]:h-16 sm:w-[70px] sm:h-[70px]'
            } ${
              joystickKnob.activeDir
                ? 'bg-gradient-to-br from-blue-400 via-blue-600 to-indigo-700 border-white/80 shadow-[0_0_20px_rgba(59,130,246,0.75)]'
                : 'bg-gradient-to-br from-zinc-500 via-zinc-700 to-zinc-900 border-zinc-400/60 shadow-xl'
            }`}
          >
            <span className="text-sm font-black text-white/95 drop-shadow">
              {joystickKnob.activeDir || '●'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderAttackButtonCircle = (btn: CustomButtonSlot, compact = false, colIndex = 0) => {
    const parts = splitButtonToken(btn.token);
    const isPressed = parts.length > 0 && parts.every(p => heldAttackTokens.has(p));
    // Ergonomic finger-arc vertical stagger for middle/right fingers
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
          compact ? 'w-[50px] h-[50px] text-xs' : 'w-[52px] h-[52px] min-[420px]:w-[58px] min-[420px]:h-[58px] sm:w-[66px] sm:h-[66px] text-xs sm:text-base'
        } ${btn.colorClass} ${
          isPressed ? 'ring-4 ring-white brightness-150 scale-90' : 'hover:brightness-125 active:scale-90'
        }`}
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
    <div
      className="flex flex-col items-end justify-end gap-2 select-none touch-none"
      onClick={e => e.stopPropagation()}
    >
      {/* Optional Combo / Macro Quick Bar above the 2x3 Arcade Buttons */}
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
                title={`Send "${btn.token}" · Key: ${formatKeyLabel(btn.key)}`}
                className={`min-h-[36px] px-3 py-1 rounded-xl border font-mono font-bold text-[11px] sm:text-xs uppercase cursor-pointer select-none touch-none shadow-lg transition-transform ${btn.colorClass} ${
                  isPressed ? 'ring-2 ring-white brightness-150 scale-95' : 'active:scale-95'
                }`}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      )}
      {/* Top Row (Punches / Row 1) */}
      <div className="flex items-center gap-1.5 min-[420px]:gap-2 sm:gap-2.5 pr-0.5">
        {topAttackRow.map((btn, idx) => renderAttackButtonCircle(btn, compact, idx))}
      </div>
      {/* Bottom Row (Kicks / Row 2) */}
      {bottomAttackRow.length > 0 && (
        <div className="flex items-center gap-1.5 min-[420px]:gap-2 sm:gap-2.5 pr-2">
          {bottomAttackRow.map((btn, idx) => renderAttackButtonCircle(btn, compact, idx))}
        </div>
      )}
    </div>
  );

  const modalCard = (
    <div
      className={`relative bg-[#18181c] border border-[#34343d] rounded-2xl shadow-2xl w-full flex flex-col ${
        isLandscapeShort ? 'max-w-[540px] max-h-full' : 'max-w-5xl max-h-full'
      }`}
      onClick={e => {
        e.stopPropagation();
        if (showPaletteKeymapMenu && keymapMenuRef.current && !keymapMenuRef.current.contains(e.target as Node)) {
          setShowPaletteKeymapMenu(false);
        }
      }}
    >
      {/* Header */}
      <div className="relative z-30 px-3 sm:px-4 py-2 bg-[#121216] border-b border-[#2a2a32] rounded-t-2xl flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
            mode === 'fight'
              ? 'bg-rose-600/20 border-rose-500/40 text-rose-400'
              : 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
          }`}>
            {mode === 'fight' ? <Swords size={15} /> : <Gamepad2 size={16} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate">Mini Playable Move Tester</h3>
              <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1d1d24] border border-[#2f2f3a] text-[9px] font-mono text-zinc-300">
                HP {constants.life} · PWR {constants.power} · ATK {constants.attack}% · DEF {constants.defence}%
              </span>
            </div>
            <p className="hidden sm:block text-[10px] text-zinc-400 truncate">
              Move: {buttonSlots.filter(b => b.kind === 'dir').map(b => formatKeyLabel(b.key)).join(' ')} · Attacks:{' '}
              {buttonSlots
                .filter(b => b.kind === 'attack' && b.visible)
                .map(b => `${formatKeyLabel(b.key)}(${b.label})`)
                .join(' ')}{' '}
              · Taunt: Space / Enter
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {/* Mode Switcher: Practice vs Fight VS */}
          <div className="flex bg-[#1a1a21] p-0.5 rounded-lg border border-[#32323e]">
            <button
              type="button"
              onClick={() => {
                if (mode !== 'practice') {
                  setMode('practice');
                  modeRef.current = 'practice';
                  resetArena('practice');
                }
              }}
              className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                mode === 'practice' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Gamepad2 size={11} />
              Practice
            </button>
            <button
              type="button"
              onClick={() => {
                if (mode !== 'fight') {
                  setMode('fight');
                  modeRef.current = 'fight';
                  resetArena('fight');
                }
              }}
              className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                mode === 'fight' ? 'bg-rose-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Swords size={11} />
              Fight VS
            </button>
          </div>

          {mode === 'fight' && (
            <>
              {/* Team Size Selector: 1v1, 2v2, 3v3, 4v4 */}
              <div
                className="flex bg-[#1a1a21] p-0.5 rounded-lg border border-[#32323e]"
                title="Battle format: 1v1 Solo or Simultaneous Team (2v2, 3v3, 4v4)"
              >
                {([1, 2, 3, 4] as TeamSize[]).map(sz => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => {
                      if (teamSize !== sz) {
                        setTeamSize(sz);
                        teamSizeRef.current = sz;
                        resetArena('fight', sz);
                      }
                    }}
                    className={`px-1.5 py-1 rounded text-[10px] font-bold font-mono cursor-pointer transition-colors ${
                      teamSize === sz ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {sz}v{sz}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const order: AiDifficulty[] = ['dummy', 'normal', 'hard'];
                  const next = order[(order.indexOf(aiDifficulty) + 1) % order.length];
                  setAiDifficulty(next);
                }}
                className="px-2 py-1 rounded bg-[#24242b] hover:bg-[#30303a] border border-[#3a3a45] text-[10px] font-semibold text-amber-300 flex items-center gap-1 cursor-pointer"
                title="Cycle AI behavior: Dummy (stand/watch), Normal CPU, or Hard CPU"
              >
                <Cpu size={11} />
                AI: {aiDifficulty === 'dummy' ? 'Dummy' : aiDifficulty === 'hard' ? 'Hard' : 'Normal'}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (bodyPalIndices.length <= 1) return;
                  if (differentPaletteIndices.length > 1) {
                    const pos = differentPaletteIndices.indexOf(p2PaletteIdx);
                    setP2PaletteIdx(differentPaletteIndices[(pos + 1) % differentPaletteIndices.length]);
                  } else {
                    const pos = bodyPalIndices.indexOf(p2PaletteIdx);
                    setP2PaletteIdx(bodyPalIndices[(pos + 1) % bodyPalIndices.length]);
                  }
                }}
                disabled={bodyPalIndices.length <= 1}
                className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 transition-colors ${
                  bodyPalIndices.length > 1
                    ? 'bg-[#24242b] hover:bg-[#30303a] border-[#3a3a45] text-cyan-300 cursor-pointer'
                    : 'bg-[#1c1c22] border-[#2c2c34] text-zinc-500 cursor-not-allowed'
                }`}
                title={
                  differentPaletteIndices.length > 0
                    ? 'Cycle alternate P2 palette (.act / SFF palette)'
                    : 'Only one unique palette loaded in this character'
                }
              >
                P2 Pal #{p2PaletteIdx + 1}
                {(() => {
                  const total = sffData?.palettes?.length ?? 0;
                  const btns = total > 0 ? getKeymapButtonsForPaletteIndex(p2PaletteIdx, paletteKeymap, total, palSlotIndices, bodyPalIndices) : [];
                  return btns.length > 0 ? ` [${btns[0].toUpperCase()}]` : '';
                })()}
                {bodyPalIndices.length <= 1 && ' (1 Pal)'}
              </button>
            </>
          )}

          {bodyPalIndices.length > 1 && (
            <div className="relative" ref={keymapMenuRef}>
              <button
                type="button"
                onClick={() => setShowPaletteKeymapMenu(v => !v)}
                className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  showPaletteKeymapMenu
                    ? 'bg-purple-600/30 border-purple-500/60 text-purple-200'
                    : 'bg-[#24242b] hover:bg-[#30303a] border-[#3a3a45] text-purple-300'
                }`}
                title="Pick P1 or P2 palette using [Palette Keymap] (X/Y/Z/A/B/C)"
              >
                <Palette size={11} />
                Keymap
              </button>
              {showPaletteKeymapMenu && (
                <div className="absolute right-0 mt-1.5 w-64 bg-[#18181f] border border-[#3a3a48] rounded-xl shadow-2xl p-2.5 z-50 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 border-b border-[#2b2b36] pb-1.5">
                    <span className="text-[10px] font-bold uppercase text-purple-300">
                      Palette Keymap
                    </span>
                    {mode === 'fight' && (
                      <div className="flex bg-[#111116] p-0.5 rounded border border-[#2d2d38] text-[10px]">
                        <button
                          type="button"
                          onClick={() => setPaletteMenuTarget('p1')}
                          className={`px-1.5 py-0.5 rounded cursor-pointer font-bold ${
                            paletteMenuTarget === 'p1' ? 'bg-emerald-600 text-white' : 'text-zinc-400'
                          }`}
                        >
                          P1
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaletteMenuTarget('p2')}
                          className={`px-1.5 py-0.5 rounded cursor-pointer font-bold ${
                            paletteMenuTarget === 'p2' ? 'bg-rose-600 text-white' : 'text-zinc-400'
                          }`}
                        >
                          P2
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {PALETTE_KEYMAP_KEYS.map((keyBtn: PaletteKeyName) => {
                      const pals = sffData?.palettes || [];
                      const palNum = paletteKeymap[keyBtn] ?? 1;
                      const resolvedIdx = resolvePaletteSlotIndex(palNum, pals.length, palSlotIndices, bodyPalIndices);
                      const activeIdx = mode === 'fight' && paletteMenuTarget === 'p2' ? p2PaletteIdx : localP1PaletteIdx;
                      const isSel = activeIdx === resolvedIdx;
                      const palData = pals[resolvedIdx]?.data;
                      return (
                        <button
                          key={keyBtn}
                          type="button"
                          onClick={() => {
                            if (mode === 'fight' && paletteMenuTarget === 'p2') {
                              setP2PaletteIdx(resolvedIdx);
                            } else {
                              setLocalP1PaletteIdx(resolvedIdx);
                              onSelectPaletteIdx?.(resolvedIdx);
                            }
                          }}
                          className={`px-1.5 py-1 rounded border text-[10px] font-mono flex items-center justify-between gap-1 cursor-pointer ${
                            isSel
                              ? 'bg-purple-600/35 border-purple-400 text-white font-bold'
                              : 'bg-[#22222b] border-[#323240] text-zinc-300 hover:bg-[#2c2c38]'
                          }`}
                        >
                          <span className="flex items-center gap-1">
                            <span
                              className="w-2 h-2 rounded-full border border-black/50 shrink-0"
                              style={{ backgroundColor: getPaletteSwatchColor(palData) }}
                            />
                            <span className="uppercase">{keyBtn}</span>
                          </span>
                          <span className="text-zinc-400">P{palNum}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowExternalPad(p => !p)}
            className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
              showExternalPad
                ? 'bg-cyan-600/25 border-cyan-500/50 text-cyan-200'
                : 'bg-[#24242b] border-[#3a3a45] text-zinc-400'
            }`}
            title="Show or hide external thumb joystick & arcade buttons outside the tester"
          >
            <Gamepad2 size={11} />
            Pad
          </button>

          <button
            type="button"
            onClick={() => {
              setShowCustomize(s => !s);
              setListeningSlotId(null);
            }}
            className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
              showCustomize
                ? 'bg-amber-600/25 border-amber-500/60 text-amber-300'
                : 'bg-[#24242b] hover:bg-[#30303a] border-[#3a3a45] text-zinc-200'
            }`}
            title="Customize keyboard bindings, button labels, MUGEN tokens, and pad layout"
          >
            <SlidersHorizontal size={11} />
            Buttons
          </button>

          {mode === 'practice' && (
            <button
              type="button"
              onClick={() => {
                const next: 1 | -1 = p1Ref.current.facing === 1 ? -1 : 1;
                p1Ref.current.facing = next;
                setFacing(next);
              }}
              className="px-2 py-1 rounded bg-[#24242b] hover:bg-[#30303a] border border-[#3a3a45] text-[10px] font-semibold text-zinc-200 cursor-pointer"
            >
              {facing === 1 ? 'Right →' : '← Left'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowClsn(s => !s)}
            className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 cursor-pointer ${
              showClsn
                ? 'bg-blue-600/25 border-blue-500/50 text-blue-300'
                : 'bg-[#24242b] border-[#3a3a45] text-zinc-400'
            }`}
          >
            <Eye size={11} />
            CLSN
          </button>
          <button
            type="button"
            onClick={() => resetArena(mode)}
            className="px-2 py-1 rounded bg-[#24242b] hover:bg-[#30303a] border border-[#3a3a45] text-[10px] font-semibold text-zinc-200 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw size={11} />
            {mode === 'fight' ? 'Rematch' : 'Reset'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Button & Keybinding Customizer Drawer */}
      {showCustomize && (
        <div className="relative z-20 px-4 py-2.5 bg-[#16161d] border-b border-[#2e2e38] flex flex-col gap-2 shrink-0 max-h-44 overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Keyboard size={13} className="text-amber-400" />
              <span className="text-[11px] font-bold text-zinc-100">Customize Controls & Pad Buttons</span>
              <span className="text-[10px] text-zinc-400">
                {listeningSlotId
                  ? 'Press any key to assign (Esc to cancel, Backspace to clear)...'
                  : 'Click a keycap to rebind, edit labels/tokens, or hide unused buttons.'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => applyButtonPreset('default')}
                className="px-2 py-0.5 rounded bg-[#24242e] hover:bg-[#323240] border border-[#3a3a48] text-[9px] font-semibold text-zinc-200 cursor-pointer"
              >
                6-Btn Arrows
              </button>
              <button
                type="button"
                onClick={() => applyButtonPreset('wasd')}
                className="px-2 py-0.5 rounded bg-[#24242e] hover:bg-[#323240] border border-[#3a3a48] text-[9px] font-semibold text-zinc-200 cursor-pointer"
              >
                6-Btn WASD
              </button>
              <button
                type="button"
                onClick={() => applyButtonPreset('kof4')}
                className="px-2 py-0.5 rounded bg-[#24242e] hover:bg-[#323240] border border-[#3a3a48] text-[9px] font-semibold text-zinc-200 cursor-pointer"
              >
                4-Btn Arcade
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
            {buttonSlots.map(slot => {
              const isListening = listeningSlotId === slot.id;
              return (
                <div
                  key={slot.id}
                  className={`rounded-lg border p-1.5 flex flex-col gap-1 ${
                    slot.visible
                      ? 'bg-[#1f1f28] border-[#343442]'
                      : 'bg-[#15151a] border-[#262630] opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    {slot.kind === 'dir' ? (
                      <span className="text-[10px] font-bold text-zinc-300 px-1">
                        {slot.label} {slot.id === 'B' ? 'Back' : slot.id === 'F' ? 'Fwd' : slot.id === 'U' ? 'Up' : 'Down'}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={slot.label}
                        maxLength={8}
                        onChange={e => {
                          const val = e.target.value;
                          setButtonSlots(prev =>
                            prev.map(s => (s.id === slot.id ? { ...s, label: val || s.id } : s))
                          );
                        }}
                        title="Custom button label"
                        className="w-14 bg-[#121218] border border-[#333340] focus:border-blue-500 rounded px-1 py-0.5 text-[10px] font-mono font-bold text-white outline-none text-center uppercase"
                      />
                    )}
                    {slot.kind === 'attack' && (
                      <button
                        type="button"
                        onClick={() =>
                          setButtonSlots(prev =>
                            prev.map(s => (s.id === slot.id ? { ...s, visible: !s.visible } : s))
                          )
                        }
                        title={slot.visible ? 'Hide button from pad' : 'Show button on pad'}
                        className={`text-[8px] px-1 py-0.5 rounded border cursor-pointer ${
                          slot.visible
                            ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                        }`}
                      >
                        {slot.visible ? 'ON' : 'OFF'}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setListeningSlotId(isListening ? null : slot.id)}
                    className={`w-full py-1 rounded border text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                      isListening
                        ? 'bg-amber-500/30 border-amber-400 text-amber-200 animate-pulse'
                        : 'bg-[#121217] hover:bg-[#2a2a36] border-[#3d3d4a] text-cyan-300'
                    }`}
                    title="Click then press a key to bind"
                  >
                    {isListening ? 'Press Key...' : `Key: ${formatKeyLabel(slot.key)}`}
                  </button>

                  {slot.kind === 'attack' && (
                    <select
                      value={slot.token}
                      onChange={e => {
                        const tok = e.target.value;
                        setButtonSlots(prev =>
                          prev.map(s => (s.id === slot.id ? { ...s, token: tok } : s))
                        );
                      }}
                      title="MUGEN command or 2/3-key combo token sent by this button"
                      className="w-full bg-[#121218] border border-[#333340] rounded px-1 py-0.5 text-[9px] font-mono text-zinc-300 outline-none cursor-pointer"
                    >
                      {availableCmdTokens.map(tok => (
                        <option key={tok} value={tok}>
                          CMD: {tok}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stage + HUD */}
      <div className="relative z-10 bg-black flex items-center justify-center shrink min-h-[120px] overflow-hidden">
        <canvas
          ref={canvasRef}
          width={640}
          height={320}
          className={`pointer-events-none w-full aspect-[640/320] object-contain ${
            isLandscapeShort
              ? 'max-h-[68vh]'
              : showExternalPad
                ? 'max-w-[720px] max-h-[36vh] sm:max-h-[42vh]'
                : 'max-w-[760px] max-h-[56vh]'
          }`}
        />

        {mode === 'fight' ? (
          <>
            {/* M.U.G.E.N Top VS Health Bars & Infinite Timer */}
            <div className="absolute top-2 inset-x-2.5 sm:inset-x-4 z-10 flex items-start justify-between gap-1.5 sm:gap-2 pointer-events-none">
              {/* Team 1 Portrait (9000,0) & Life (+ Allies in 2v2/3v3/4v4) */}
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-start gap-1.5 sm:gap-2">
                  <div
                    className={`w-9 h-9 sm:w-11 sm:h-11 shrink-0 rounded-sm bg-[#14111a]/95 border-2 border-emerald-400/80 shadow-md overflow-hidden flex items-center justify-center relative ${
                      fightHud.p1Life <= 0 ? 'grayscale opacity-50' : ''
                    }`}
                    title={`${characterName} (P1) — Icon 9000,0`}
                  >
                    {team1PortraitUrls[0] ? (
                      <img
                        src={team1PortraitUrls[0]}
                        alt={`${characterName} P1 icon`}
                        className="w-full h-full object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="text-xs sm:text-sm font-black text-emerald-300 uppercase">
                        {(characterName || 'P1').slice(0, 2)}
                      </span>
                    )}
                    {fightHud.p1Life <= 0 && (
                      <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-[8px] font-black text-rose-400">
                        KO
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col gap-0.5 sm:gap-1">
                    <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-bold px-0.5 gap-1">
                      <span className="text-white uppercase tracking-wider truncate drop-shadow">
                        {characterName} <span className="text-emerald-400 font-mono">P1</span>
                      </span>
                      <span className="font-mono text-zinc-200 tabular-nums drop-shadow shrink-0">
                        {fightHud.p1Life}/{fightHud.p1MaxLife}
                      </span>
                    </div>
                    <div className="relative h-3.5 sm:h-4 bg-[#171219]/90 border-2 border-zinc-300/70 rounded-sm overflow-hidden shadow-md flex justify-end">
                      <div
                        className="absolute inset-y-0 right-0 bg-rose-600/85 transition-[width] duration-150"
                        style={{ width: `${Math.max(0, Math.min(100, (fightHud.p1Trail / Math.max(1, fightHud.p1MaxLife)) * 100))}%` }}
                      />
                      <div
                        className={`relative h-full transition-[width] duration-75 ${
                          fightHud.p1Life / Math.max(1, fightHud.p1MaxLife) > 0.5
                            ? 'bg-gradient-to-l from-emerald-400 to-lime-400'
                            : fightHud.p1Life / Math.max(1, fightHud.p1MaxLife) > 0.25
                              ? 'bg-gradient-to-l from-amber-400 to-yellow-300'
                              : 'bg-gradient-to-l from-red-500 to-orange-500'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, (fightHud.p1Life / Math.max(1, fightHud.p1MaxLife)) * 100))}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Team 1 Ally Bars (2v2 / 3v3 / 4v4) */}
                {fightHud.team1.slice(1).map(ally => {
                  const iconUrl = team1PortraitUrls[ally.slotIdx];
                  const isKo = ally.life <= 0;
                  return (
                    <div key={ally.id} className={`flex items-center gap-1.5 pl-0.5 ${isKo ? 'opacity-55' : ''}`}>
                      <div className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 rounded-sm bg-[#14111a]/95 border border-teal-400/75 overflow-hidden flex items-center justify-center relative">
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt={`Ally ${ally.slotIdx + 1} icon`}
                            className={`w-full h-full object-contain ${isKo ? 'grayscale' : ''}`}
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <span className="text-[8px] font-black text-teal-300">A{ally.slotIdx + 1}</span>
                        )}
                        {isKo && (
                          <span className="absolute inset-0 bg-black/65 flex items-center justify-center text-[7px] font-black text-rose-400">
                            KO
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center justify-between text-[8px] font-mono leading-none px-0.5">
                          <span className="text-teal-300 font-bold">ALLY {ally.slotIdx + 1}</span>
                          <span className="text-zinc-300 tabular-nums">{ally.life}/{ally.maxLife}</span>
                        </div>
                        <div className="relative h-2 bg-[#171219]/90 border border-zinc-400/60 rounded-sm overflow-hidden flex justify-end">
                          <div
                            className="absolute inset-y-0 right-0 bg-rose-600/85 transition-[width] duration-150"
                            style={{ width: `${Math.max(0, Math.min(100, (ally.trail / Math.max(1, ally.maxLife)) * 100))}%` }}
                          />
                          <div
                            className="relative h-full bg-gradient-to-l from-teal-400 to-emerald-400 transition-[width] duration-75"
                            style={{ width: `${Math.max(0, Math.min(100, (ally.life / Math.max(1, ally.maxLife)) * 100))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {fightHud.p1Combo >= 2 && (
                  <div className="self-start mt-0.5 px-2 py-0.5 rounded bg-amber-500/90 text-black font-black text-[10px] sm:text-[11px] tracking-wider italic shadow">
                    {fightHud.p1Combo} HITS!
                  </div>
                )}
              </div>

              {/* Infinite Time Badge */}
              <div className="w-10 sm:w-14 h-9 sm:h-11 bg-[#14141b]/95 border-2 border-amber-400/70 rounded-md flex flex-col items-center justify-center shadow-lg shrink-0">
                <span className="text-base sm:text-xl font-black leading-none text-amber-300">∞</span>
                <span className="text-[7px] font-mono uppercase tracking-widest text-zinc-400 mt-0.5">
                  {teamSize > 1 ? `${teamSize}v${teamSize}` : 'TIME'}
                </span>
              </div>

              {/* Team 2 Life & Portrait (9000,0) (+ Opponents in 2v2/3v3/4v4) */}
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-start gap-1.5 sm:gap-2">
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5 sm:gap-1">
                    <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-bold px-0.5 gap-1">
                      <span className="font-mono text-zinc-200 tabular-nums drop-shadow shrink-0">
                        {fightHud.team2[0]?.life ?? fightHud.p2Life}/{fightHud.team2[0]?.maxLife ?? fightHud.p2MaxLife}
                      </span>
                      <span className="text-white uppercase tracking-wider truncate drop-shadow flex items-center gap-1">
                        <span className="text-cyan-300 font-mono">
                          {aiDifficulty === 'dummy' ? 'DUMMY' : teamSize > 1 ? 'CPU 1' : 'CPU'}
                        </span>
                        <span className="truncate">{characterName}</span>
                      </span>
                    </div>
                    <div className="relative h-3.5 sm:h-4 bg-[#171219]/90 border-2 border-zinc-300/70 rounded-sm overflow-hidden shadow-md flex justify-start">
                      <div
                        className="absolute inset-y-0 left-0 bg-rose-600/85 transition-[width] duration-150"
                        style={{ width: `${Math.max(0, Math.min(100, ((fightHud.team2[0]?.trail ?? fightHud.p2Trail) / Math.max(1, fightHud.team2[0]?.maxLife ?? fightHud.p2MaxLife)) * 100))}%` }}
                      />
                      <div
                        className={`relative h-full transition-[width] duration-75 ${
                          (fightHud.team2[0]?.life ?? fightHud.p2Life) / Math.max(1, fightHud.team2[0]?.maxLife ?? fightHud.p2MaxLife) > 0.5
                            ? 'bg-gradient-to-r from-emerald-400 to-lime-400'
                            : (fightHud.team2[0]?.life ?? fightHud.p2Life) / Math.max(1, fightHud.team2[0]?.maxLife ?? fightHud.p2MaxLife) > 0.25
                              ? 'bg-gradient-to-r from-amber-400 to-yellow-300'
                              : 'bg-gradient-to-r from-red-500 to-orange-500'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, ((fightHud.team2[0]?.life ?? fightHud.p2Life) / Math.max(1, fightHud.team2[0]?.maxLife ?? fightHud.p2MaxLife)) * 100))}%` }}
                      />
                    </div>
                  </div>

                  <div
                    className={`w-9 h-9 sm:w-11 sm:h-11 shrink-0 rounded-sm bg-[#14111a]/95 border-2 border-cyan-400/80 shadow-md overflow-hidden flex items-center justify-center relative ${
                      (fightHud.team2[0]?.life ?? 1) <= 0 ? 'grayscale opacity-50' : ''
                    }`}
                    title={`${characterName} (Opponent) — Icon 9000,0`}
                  >
                    {team2PortraitUrls[0] ? (
                      <img
                        src={team2PortraitUrls[0]}
                        alt={`${characterName} P2 icon`}
                        className="w-full h-full object-contain -scale-x-100"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="text-xs sm:text-sm font-black text-cyan-300 uppercase">
                        {(characterName || 'P2').slice(0, 2)}
                      </span>
                    )}
                    {(fightHud.team2[0]?.life ?? 1) <= 0 && (
                      <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-[8px] font-black text-rose-400">
                        KO
                      </span>
                    )}
                  </div>
                </div>

                {/* Team 2 Teammate Bars (2v2 / 3v3 / 4v4) */}
                {fightHud.team2.slice(1).map(enemy => {
                  const iconUrl = team2PortraitUrls[enemy.slotIdx];
                  const isKo = enemy.life <= 0;
                  return (
                    <div key={enemy.id} className={`flex items-center gap-1.5 pr-0.5 ${isKo ? 'opacity-55' : ''}`}>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center justify-between text-[8px] font-mono leading-none px-0.5">
                          <span className="text-zinc-300 tabular-nums">{enemy.life}/{enemy.maxLife}</span>
                          <span className="text-cyan-300 font-bold">
                            {aiDifficulty === 'dummy' ? `DMY ${enemy.slotIdx + 1}` : `CPU ${enemy.slotIdx + 1}`}
                          </span>
                        </div>
                        <div className="relative h-2 bg-[#171219]/90 border border-zinc-400/60 rounded-sm overflow-hidden flex justify-start">
                          <div
                            className="absolute inset-y-0 left-0 bg-rose-600/85 transition-[width] duration-150"
                            style={{ width: `${Math.max(0, Math.min(100, (enemy.trail / Math.max(1, enemy.maxLife)) * 100))}%` }}
                          />
                          <div
                            className="relative h-full bg-gradient-to-r from-cyan-400 to-sky-400 transition-[width] duration-75"
                            style={{ width: `${Math.max(0, Math.min(100, (enemy.life / Math.max(1, enemy.maxLife)) * 100))}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 rounded-sm bg-[#14111a]/95 border border-cyan-400/75 overflow-hidden flex items-center justify-center relative">
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt={`CPU ${enemy.slotIdx + 1} icon`}
                            className={`w-full h-full object-contain -scale-x-100 ${isKo ? 'grayscale' : ''}`}
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <span className="text-[8px] font-black text-cyan-300">C{enemy.slotIdx + 1}</span>
                        )}
                        {isKo && (
                          <span className="absolute inset-0 bg-black/65 flex items-center justify-center text-[7px] font-black text-rose-400">
                            KO
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {fightHud.p2Combo >= 2 && (
                  <div className="self-end mt-0.5 px-2 py-0.5 rounded bg-rose-500/90 text-white font-black text-[10px] sm:text-[11px] tracking-wider italic shadow">
                    {fightHud.p2Combo} HITS!
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Power Gauges */}
            <div className="absolute bottom-2 inset-x-3 sm:inset-x-4 z-10 flex items-end justify-between gap-4 sm:gap-6 pointer-events-none">
              <div className="w-[43%] flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-[8px] sm:text-[9px] font-mono">
                  <span className="px-1.5 py-0.2 rounded bg-fuchsia-700/80 text-white font-bold">
                    LV {Math.floor(fightHud.p1Power / 1000)}
                  </span>
                  <span className="text-fuchsia-200 tabular-nums drop-shadow">
                    {fightHud.p1Power} / {fightHud.p1MaxPower}
                  </span>
                </div>
                <div className="relative h-2 sm:h-2.5 bg-[#12101a]/90 border border-fuchsia-400/50 rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-400 transition-[width] duration-75"
                    style={{ width: `${Math.max(0, Math.min(100, (fightHud.p1Power / Math.max(1, fightHud.p1MaxPower)) * 100))}%` }}
                  />
                  {Array.from({ length: Math.max(0, Math.floor(fightHud.p1MaxPower / 1000) - 1) }).map((_, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0 w-[1px] bg-white/40"
                      style={{ left: `${((i + 1) * 1000 / Math.max(1, fightHud.p1MaxPower)) * 100}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="w-[43%] flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-[8px] sm:text-[9px] font-mono">
                  <span className="text-cyan-200 tabular-nums drop-shadow">
                    {fightHud.p2Power} / {fightHud.p2MaxPower}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-cyan-700/80 text-white font-bold">
                    LV {Math.floor(fightHud.p2Power / 1000)}
                  </span>
                </div>
                <div className="relative h-2 sm:h-2.5 bg-[#12101a]/90 border border-cyan-400/50 rounded-sm overflow-hidden flex justify-end">
                  <div
                    className="h-full bg-gradient-to-l from-blue-500 via-cyan-400 to-teal-300 transition-[width] duration-75"
                    style={{ width: `${Math.max(0, Math.min(100, (fightHud.p2Power / Math.max(1, fightHud.p2MaxPower)) * 100))}%` }}
                  />
                  {Array.from({ length: Math.max(0, Math.floor(fightHud.p2MaxPower / 1000) - 1) }).map((_, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0 w-[1px] bg-white/40"
                      style={{ right: `${((i + 1) * 1000 / Math.max(1, fightHud.p2MaxPower)) * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {fightBanner && !fightOutcome && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className="px-6 sm:px-8 py-2 rounded-xl bg-black/70 border-2 border-amber-400 text-amber-300 font-black text-2xl sm:text-3xl tracking-widest italic shadow-2xl animate-pulse">
                  {fightBanner}
                </div>
              </div>
            )}

            {fightOutcome && (
              <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-2 z-20">
                <div className="px-5 sm:px-6 py-2.5 sm:py-3 rounded-2xl bg-[#121218]/95 border-2 border-rose-500/80 shadow-2xl flex flex-col items-center gap-1.5 text-center">
                  <div className="flex items-center gap-2 text-rose-400 font-black text-xl sm:text-2xl tracking-widest italic">
                    <Trophy size={20} className="text-amber-300" />
                    <span>{fightOutcome === 'DRAW' ? 'DOUBLE K.O.!' : 'K.O.!'}</span>
                  </div>
                  <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-zinc-200">
                    {fightOutcome === 'P1_WIN'
                      ? teamSize > 1
                        ? `${characterName} TEAM (${teamSize}v${teamSize}) WINS!`
                        : `${characterName} (P1) WINS!`
                      : fightOutcome === 'P2_WIN'
                        ? teamSize > 1
                          ? `${aiDifficulty === 'dummy' ? 'DUMMY' : 'CPU'} TEAM (${teamSize}v${teamSize}) WINS!`
                          : `${characterName} (${aiDifficulty === 'dummy' ? 'DUMMY' : 'CPU'}) WINS!`
                        : 'MATCH DRAW'}
                  </div>
                  <button
                    type="button"
                    onClick={() => resetArena('fight', teamSize)}
                    className="mt-1 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <RotateCcw size={12} />
                    Fight Again
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Practice Mode: Top-left State & Pos/Vel HUD */}
            <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-black/75 border border-white/10 rounded-lg px-2.5 py-1 font-mono text-[9px] sm:text-[10px] text-zinc-200 flex flex-wrap items-center gap-2 max-w-[60%]">
              <span>State: <strong className="text-emerald-400">{activeState}</strong></span>
              <span>Anim: <strong className="text-blue-400">{activeAnimId}</strong></span>
              <span>#{frameIdx + 1}</span>
              <span className="px-1 py-0.5 rounded bg-zinc-800 text-cyan-300 text-[8px] sm:text-[9px] font-bold">
                {currentStanceLabel}
              </span>
              <span className="hidden sm:inline text-zinc-400 text-[9px]">
                Vel: <strong className="text-emerald-300">{hudVelocity.x}, {hudVelocity.y}</strong> · Pos: <strong className="text-zinc-200">{hudVelocity.px}, {hudVelocity.py}</strong>
              </span>
              {matchedMove && (
                <span className={`font-semibold flex items-center gap-1 ${isHyperActive ? 'text-fuchsia-300' : 'text-purple-300'}`}>
                  <Volume2 size={10} /> {matchedMove}
                </span>
              )}
            </div>

            {/* Practice Mode: Input History Strip */}
            <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-black/75 border border-white/10 rounded-lg px-2 py-1 flex items-center gap-1 max-w-[36%] overflow-hidden">
              <span className="text-[8px] sm:text-[9px] text-zinc-500 uppercase font-bold mr-0.5 hidden sm:inline">Inputs:</span>
              {inputLog.length === 0 ? (
                <span className="text-[9px] text-zinc-600 italic">none</span>
              ) : (
                inputLog.slice(-6).map((tok, i) => (
                  <span
                    key={i}
                    className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] sm:text-[10px] font-mono text-amber-300"
                  >
                    {tok}
                  </span>
                ))
              )}
            </div>
          </>
        )}

        {isHyperActive && (
          <div className="absolute inset-x-0 top-14 flex justify-center pointer-events-none z-20">
            <div className="px-4 py-1 rounded-full bg-fuchsia-600/85 border border-fuchsia-300 text-white font-black tracking-widest text-xs uppercase shadow-lg shadow-fuchsia-500/40 animate-pulse">
              HYPER ART / SUPERPAUSE
            </div>
          </div>
        )}
      </div>

      {/* Fight Mode Non-overlapping Telemetry & Input Strip */}
      {mode === 'fight' && (
        <div className="relative z-20 px-3 sm:px-4 py-1 bg-[#0e0e13] border-t border-[#262630] flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] sm:text-[10px] text-zinc-300 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span>P1: <strong className="text-emerald-400">{activeState}</strong></span>
            <span>P2: <strong className="text-cyan-400">{fightHud.p2StateNo}</strong></span>
            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-cyan-300 text-[8px] sm:text-[9px] font-bold">
              {currentStanceLabel}
            </span>
            <span className="hidden sm:flex items-center gap-1 text-zinc-400 text-[9px]">
              <Shield size={10} className="text-sky-400" /> Hold Back to Guard
            </span>
            {matchedMove && (
              <span className={`font-semibold flex items-center gap-1 ${isHyperActive ? 'text-fuchsia-300' : 'text-purple-300'}`}>
                <Volume2 size={10} /> {matchedMove}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 overflow-hidden">
            <span className="text-[8px] sm:text-[9px] text-zinc-500 uppercase font-bold mr-1">Inputs:</span>
            {inputLog.length === 0 ? (
              <span className="text-[9px] text-zinc-600 italic">none</span>
            ) : (
              inputLog.slice(-6).map((tok, i) => (
                <span
                  key={i}
                  className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] sm:text-[10px] font-mono text-amber-300"
                >
                  {tok}
                </span>
              ))
            )}
          </div>
        </div>
      )}

      {/* Statedefs & CMD Moves Panel (No joystick/arcade buttons inside modal!) */}
      <div className="relative z-20 bg-[#141418] border-t border-[#282830] rounded-b-2xl flex flex-col shrink min-h-0 overflow-hidden">
        <div className="px-3 py-1.5 bg-[#17171d] border-b border-[#25252e] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex bg-[#121216] p-0.5 rounded-lg border border-[#2b2b34]">
              <button
                type="button"
                onClick={() => {
                  setRightTab('statedefs');
                  setShowStatedefDrawer(true);
                }}
                className={`px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                  rightTab === 'statedefs' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Statedefs ({sortedStates.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setRightTab('commands');
                  setShowStatedefDrawer(true);
                }}
                className={`px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                  rightTab === 'commands' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                CMD Commands ({commands.length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-end">
            {showStatedefDrawer && rightTab === 'statedefs' && (
              <div className="relative flex-1 max-w-xs min-w-[130px]">
                <Search size={11} className="absolute left-2 top-2 text-zinc-500" />
                <input
                  type="text"
                  value={stateSearch}
                  onChange={e => setStateSearch(e.target.value)}
                  placeholder="Filter states / moves..."
                  className="w-full bg-[#111115] border border-[#30303a] focus:border-blue-500 rounded-lg pl-6 pr-2 py-1 text-[10px] text-zinc-200 outline-none font-mono"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowStatedefDrawer(d => !d)}
              className="px-2 py-1 rounded bg-[#23232c] hover:bg-[#2d2d38] border border-[#353542] text-[10px] font-semibold text-zinc-300 flex items-center gap-1 cursor-pointer shrink-0"
            >
              {showStatedefDrawer ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              <span className="hidden sm:inline">{showStatedefDrawer ? 'Hide List' : 'Show Moves'}</span>
            </button>
          </div>
        </div>

        {showStatedefDrawer && (
          <div className="p-2.5 sm:p-3 flex flex-col gap-2 overflow-y-auto max-h-28 sm:max-h-36">
            {rightTab === 'statedefs' && (
              <>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'hyper', label: 'Hyper' },
                      { id: 'movexy', label: 'Move X / Move Y' },
                      { id: 'crouch_hop', label: 'Crouch / Hop Back' },
                      { id: 'special', label: 'Special' },
                      { id: 'normal', label: 'Normal' },
                    ] as { id: StateFilterChip; label: string }[]
                  ).map(chip => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setStateFilter(chip.id)}
                      className={`px-2 py-0.5 rounded text-[9px] font-semibold border cursor-pointer transition-colors ${
                        stateFilter === chip.id
                          ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                          : 'bg-[#141418] border-[#2c2c36] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 overflow-y-auto max-h-24 pr-1">
                  {filteredStatedefs.map(st => (
                    <button
                      key={st.stateNo}
                      type="button"
                      onClick={() => triggerStateTransition(st.stateNo, st.label)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        activeState === st.stateNo
                          ? 'bg-emerald-950/40 border-emerald-500/70 text-white'
                          : 'bg-[#22222b] hover:bg-[#2b2b36] border-[#333340] text-zinc-200'
                      }`}
                    >
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold text-blue-300 shrink-0">
                            [{st.stateNo}]
                          </span>
                          <span className="text-[11px] font-semibold truncate">{st.label}</span>
                        </div>
                        {st.matchedSnippet && (
                          <span className="text-[9px] font-mono text-amber-300/90 truncate">
                            Match: {st.matchedSnippet}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {st.isHyper && (
                          <span className="px-1.5 py-0.5 rounded bg-fuchsia-950/80 border border-fuchsia-600/60 text-fuchsia-300 text-[8px] font-bold flex items-center gap-0.5">
                            <Zap size={8} /> HYPER
                          </span>
                        )}
                        {st.moveX !== 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/50 text-emerald-300 text-[8px] font-mono">
                            X:{st.moveX}
                          </span>
                        )}
                        {st.moveY !== 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-700/50 text-sky-300 text-[8px] font-mono">
                            Y:{st.moveY}
                          </span>
                        )}
                        {st.isCrouch && (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-700/50 text-cyan-300 text-[8px] font-bold">
                            CROUCH
                          </span>
                        )}
                        {st.isHopBack && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/50 text-amber-300 text-[8px] font-bold">
                            HOP
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                  {filteredStatedefs.length === 0 && (
                    <span className="text-[10px] text-zinc-500 italic py-2 text-center col-span-full">
                      No Statedefs match your current filter/text query.
                    </span>
                  )}
                </div>
              </>
            )}

            {rightTab === 'commands' && (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {commands.map((cmd, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => triggerCommandByName(cmd.name)}
                    className="px-2 py-1 rounded bg-[#25252e] hover:bg-purple-600/30 border border-[#383846] hover:border-purple-500/50 text-[10px] font-mono text-zinc-200 cursor-pointer transition-colors"
                    title={cmd.pattern}
                  >
                    {cmd.name} <span className="text-zinc-500">({cmd.pattern})</span>
                  </button>
                ))}
                {commands.length === 0 && (
                  <span className="text-[10px] text-zinc-500 italic">No [Command] definitions parsed yet.</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex overflow-hidden ${
        isLandscapeShort && showExternalPad
          ? 'flex-row items-end justify-between gap-2 p-2'
          : 'flex-col justify-between p-2 sm:p-3'
      }`}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {isLandscapeShort && showExternalPad ? (
        <>
          <div className="shrink-0 self-end pb-1">{renderExternalJoystick(true)}</div>
          <div className="flex-1 min-w-0 h-full flex items-center justify-center">{modalCard}</div>
          <div className="shrink-0 self-end pb-1">{renderExternalActionPad(true)}</div>
        </>
      ) : (
        <>
          <div className="flex-1 min-h-0 w-full flex items-center justify-center">{modalCard}</div>
          {showExternalPad && (
            <div
              className="shrink-0 w-full max-w-6xl mx-auto pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] px-1 sm:px-4 flex items-end justify-between gap-2 sm:gap-4 select-none touch-none"
              onClick={e => e.stopPropagation()}
            >
              {renderExternalJoystick(false)}
              {renderExternalActionPad(false)}
            </div>
          )}
        </>
      )}
    </div>
  );
};
