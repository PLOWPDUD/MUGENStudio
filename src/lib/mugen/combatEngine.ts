import type { AirElement, ClsnBox } from './types';

export interface TextFileLike {
  id: string;
  filename: string;
  content: string;
}

export interface ParsedCommandDef {
  name: string;
  pattern: string;
  cleanTokens: string[];
  tokenCount: number;
  chordWeight: number;
}

export interface ParsedHitDef {
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

export interface ParsedChangeStateRule {
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

export type ControllerType =
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

export interface ParsedController {
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

export interface ParsedStateInfo {
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

export interface CharacterPhysicsConstants {
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

export interface ParsedCharacterMoveset {
  commands: ParsedCommandDef[];
  rules: ParsedChangeStateRule[];
  states: Record<number, ParsedStateInfo>;
  sortedStates: ParsedStateInfo[];
  constants: CharacterPhysicsConstants;
}

export const DEFAULT_CONSTANTS: CharacterPhysicsConstants = {
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

export function palettesAreSame(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
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

export function defaultLabelForState(stateNo: number): string {
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

export function parseNumberPair(val: string): [number | undefined, number | undefined] {
  const parts = val.split(',').map(p => parseFloat(p.trim()));
  const x = parts.length >= 1 && !Number.isNaN(parts[0]) ? parts[0] : undefined;
  const y = parts.length >= 2 && !Number.isNaN(parts[1]) ? parts[1] : undefined;
  return [x, y];
}

export function parseSoundPair(val: string): { group: number; sample: number } | undefined {
  const parts = val.split(',').map(p => parseInt(p.trim().replace(/^[sSfF]/, ''), 10));
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    return { group: parts[0], sample: parts[1] };
  }
  return undefined;
}

export interface ProjectileRuntime {
  id: string;
  projId: number;
  ownerId: string;
  charProfileId?: string;
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

export interface ExplodRuntime {
  id: string;
  explodId: number;
  ownerId: string;
  charProfileId?: string;
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

export interface EvalContext {
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

export function resolveConstValue(name: string, c: CharacterPhysicsConstants): number {
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

export function evalMugenNumber(expr: string | undefined, ctx: EvalContext): number | null {
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

export function compareOp(lhs: number, op: string, rhs: number): boolean {
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

export function evalSingleClause(rawClause: string, ctx: EvalContext): boolean {
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

  // Hit confirms
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

  // AnimElemTime(N) <op> M
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

  if (/^(p2|enemy|command)\b/i.test(clause)) {
    return false;
  }

  return false;
}

export function evalTriggerExpr(expr: string, ctx: EvalContext): boolean {
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

export function doesControllerFire(ctrl: ParsedController, ctx: EvalContext): boolean {
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

export function isHoldDirCmd(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/_/g, '');
  return n === 'holddown' || n === 'holdfwd' || n === 'holdback' || n === 'holdup';
}

export function parseCmdAndStates(cmdFiles: TextFileLike[], stFiles: TextFileLike[]): ParsedCharacterMoveset {
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

  commands.sort((a, b) => b.tokenCount - a.tokenCount || b.chordWeight - a.chordWeight);

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

export interface CustomButtonSlot {
  id: 'B' | 'D' | 'U' | 'F' | 'x' | 'y' | 'z' | 'a' | 'b' | 'c' | 'm1' | 'm2';
  kind: 'dir' | 'attack';
  token: string;
  label: string;
  key: string;
  visible: boolean;
  colorClass: string;
}

export const STORAGE_CONTROLS_KEY = 'mugen-move-tester-buttons-v1';

export const DEFAULT_BUTTON_SLOTS: CustomButtonSlot[] = [
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

export const BUTTON_CANONICAL_ORDER = ['x', 'y', 'z', 'a', 'b', 'c', 's'];

export function canonicalChord(tokens: Iterable<string>): string {
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

export function splitButtonToken(raw: string): string[] {
  return raw
    .split('+')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean);
}

export const SECONDARY_FALLBACK_KEYS: Record<string, string> = {
  a: 'B',
  d: 'F',
  w: 'U',
  s: 'D',
  z: 'a',
  x: 'x',
  c: 'c',
};

export function loadStoredButtonSlots(): CustomButtonSlot[] {
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

export function formatKeyLabel(key: string): string {
  if (!key) return '—';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key.slice(0, 6);
}

export type StateFilterChip = 'all' | 'hyper' | 'movexy' | 'crouch_hop' | 'special' | 'normal';
export type TesterMode = 'practice' | 'fight';
export type TeamSize = 1 | 2 | 3 | 4;
export type AiDifficulty = 'dummy' | 'normal' | 'hard';
export type FightOutcome = 'P1_WIN' | 'P2_WIN' | 'DRAW' | null;

export interface FightMemberHud {
  id: string;
  slotIdx: number;
  charProfileId?: string;
  name?: string;
  portraitUrl?: string | null;
  life: number;
  trail: number;
  maxLife: number;
  power: number;
  maxPower: number;
  stateNo: number;
  comboCount: number;
}

export interface HitSparkEffect {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  guarded: boolean;
  isHyper: boolean;
}

export interface FighterRuntime {
  id: string;
  team: 1 | 2;
  slotIdx: number;
  isPlayer: boolean;
  charProfileId?: string;
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

export function createFighterRuntime(
  id: string,
  team: 1 | 2,
  slotIdx: number,
  teamSize: TeamSize,
  constants: CharacterPhysicsConstants,
  mode: TesterMode,
  charProfileId?: string
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
    charProfileId,
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

export function getNearestLivingOpponent(f: FighterRuntime, oppTeam: FighterRuntime[]): FighterRuntime {
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

export interface BoxEntity {
  posX: number;
  posY: number;
  facing: 1 | -1;
}

export function toWorldBox(b: ClsnBox, f: BoxEntity) {
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

export function findBoxesOverlap(
  atkBoxes: ClsnBox[],
  atk: BoxEntity,
  defBoxes: ClsnBox[],
  def: BoxEntity
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
