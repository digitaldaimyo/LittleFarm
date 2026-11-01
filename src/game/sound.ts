/**
 * Sound cues: which moments make a sound, and how often. Pure and deterministic (no audio APIs),
 * so the mapping and the rate limiter are unit-tested like the rest of the game.
 * Playback lives in `audio/engine.ts`; recipes in `audio/kit.ts`. See docs/SOUND_PLAN.md.
 */
import type { FarmFx } from './farm';
import type { SimEvent, SimEventType } from '../sim/world';

export type CueId =
  // Teaching
  | 'card.flick' | 'card.snap' | 'card.reject' | 'card.remove' | 'card.repair' | 'pen.place'
  | 'train.start' | 'train.certified' | 'train.notCertified' | 'train.loophole' | 'skill.save'
  // Farm (and replays)
  | 'farm.pickup' | 'farm.coin' | 'farm.splash' | 'farm.bump'
  | 'farm.drop' | 'farm.deliver' | 'farm.confused' | 'farm.fill' | 'farm.water' | 'farm.shoo' | 'farm.scare' | 'farm.peck'
  | 'farm.egg' | 'farm.gateOpen' | 'farm.gateShut' | 'farm.firefly' | 'farm.celebrate' | 'farm.crow'
  // World
  | 'world.dawn' | 'world.dusk'
  // Progression and the Field Guide
  | 'pet.adopt' | 'ui.unlock' | 'ui.shop' | 'ui.request' | 'guide.step' | 'guide.offer' | 'guide.done';

export type Bus = 'effects' | 'ui';

export interface CueDef {
  bus: Bus;
  /** Phase/priority from the plan: A = clarity or core feedback. Lower priorities thin out at high farm speeds. */
  priority: 'A' | 'B' | 'C';
  /** Minimum gap between two plays of this cue. */
  cooldownMs: number;
  /** How long one play occupies a voice. */
  durationMs: number;
}

export const CUES: Record<CueId, CueDef> = {
  'card.flick': { bus: 'ui', priority: 'A', cooldownMs: 80, durationMs: 60 },
  'card.snap': { bus: 'ui', priority: 'A', cooldownMs: 60, durationMs: 80 },
  'card.reject': { bus: 'ui', priority: 'A', cooldownMs: 200, durationMs: 120 },
  'pen.place': { bus: 'ui', priority: 'A', cooldownMs: 60, durationMs: 100 },
  'train.start': { bus: 'ui', priority: 'A', cooldownMs: 300, durationMs: 260 },
  'train.certified': { bus: 'ui', priority: 'A', cooldownMs: 500, durationMs: 700 },
  'train.notCertified': { bus: 'ui', priority: 'A', cooldownMs: 500, durationMs: 450 },
  'train.loophole': { bus: 'ui', priority: 'A', cooldownMs: 500, durationMs: 600 },
  'skill.save': { bus: 'ui', priority: 'A', cooldownMs: 300, durationMs: 150 },
  'farm.pickup': { bus: 'effects', priority: 'A', cooldownMs: 120, durationMs: 90 },
  'farm.coin': { bus: 'effects', priority: 'A', cooldownMs: 150, durationMs: 260 },
  'farm.splash': { bus: 'effects', priority: 'A', cooldownMs: 300, durationMs: 400 },
  'farm.bump': { bus: 'effects', priority: 'A', cooldownMs: 250, durationMs: 120 },
  'card.remove': { bus: 'ui', priority: 'B', cooldownMs: 80, durationMs: 70 },
  'card.repair': { bus: 'ui', priority: 'B', cooldownMs: 300, durationMs: 260 },
  'farm.drop': { bus: 'effects', priority: 'B', cooldownMs: 150, durationMs: 110 },
  'farm.deliver': { bus: 'effects', priority: 'B', cooldownMs: 200, durationMs: 230 },
  'farm.confused': { bus: 'effects', priority: 'B', cooldownMs: 600, durationMs: 220 },
  'farm.fill': { bus: 'effects', priority: 'B', cooldownMs: 300, durationMs: 330 },
  'farm.water': { bus: 'effects', priority: 'B', cooldownMs: 250, durationMs: 330 },
  'farm.shoo': { bus: 'effects', priority: 'B', cooldownMs: 250, durationMs: 300 },
  'farm.scare': { bus: 'effects', priority: 'B', cooldownMs: 500, durationMs: 450 },
  'farm.peck': { bus: 'effects', priority: 'B', cooldownMs: 1500, durationMs: 330 },
  'farm.egg': { bus: 'effects', priority: 'B', cooldownMs: 600, durationMs: 270 },
  'farm.gateOpen': { bus: 'effects', priority: 'B', cooldownMs: 300, durationMs: 470 },
  'farm.gateShut': { bus: 'effects', priority: 'B', cooldownMs: 300, durationMs: 200 },
  'farm.firefly': { bus: 'effects', priority: 'B', cooldownMs: 250, durationMs: 420 },
  'farm.celebrate': { bus: 'effects', priority: 'C', cooldownMs: 1500, durationMs: 330 },
  'farm.crow': { bus: 'effects', priority: 'B', cooldownMs: 3000, durationMs: 470 },
  'world.dawn': { bus: 'effects', priority: 'B', cooldownMs: 5000, durationMs: 1100 },
  'world.dusk': { bus: 'effects', priority: 'B', cooldownMs: 5000, durationMs: 1300 },
  'pet.adopt': { bus: 'ui', priority: 'A', cooldownMs: 500, durationMs: 250 },
  'ui.request': { bus: 'ui', priority: 'B', cooldownMs: 600, durationMs: 650 },
  'guide.step': { bus: 'ui', priority: 'B', cooldownMs: 300, durationMs: 90 },
  'guide.offer': { bus: 'ui', priority: 'B', cooldownMs: 800, durationMs: 300 },
  'guide.done': { bus: 'ui', priority: 'B', cooldownMs: 800, durationMs: 550 },
  'ui.unlock': { bus: 'ui', priority: 'A', cooldownMs: 600, durationMs: 450 },
  'ui.shop': { bus: 'ui', priority: 'A', cooldownMs: 300, durationMs: 300 },
};

export interface CueRequest {
  id: CueId;
  /** Playback-rate multiplier (1 = as designed). */
  pitch?: number;
  /** Stereo position, −1 (left) … 1 (right). */
  pan?: number;
}

/**
 * Farm effects that are silent on purpose, keyed by `type` or `type:text`. Every FarmFx must either map to a
 * cue or appear here — tested. (`nap` repeats every tick of a nap; rain is carried by the rain ambience.)
 */
export const SILENT_FX = new Set(['nap', 'splash:rain']);

const PICKUP_PITCH: Record<string, number> = { egg: 1.15, carrot: 0.9 };

/** Sound-only farm markers (`type: 'sound'`), which the farm view doesn't draw. */
const SOUND_TAGS: Record<string, CueId> = { shoo: 'farm.shoo', firefly: 'farm.firefly', crow: 'farm.crow', dawn: 'world.dawn', dusk: 'world.dusk' };
const DROP_TAGS: Record<string, CueId> = { watered: 'farm.water', filled: 'farm.fill', 'gate open': 'farm.gateOpen', 'gate shut': 'farm.gateShut' };

/** The cue for one farm effect (null = silent). Exposed for the coverage test. */
export function cueForFx(f: FarmFx): CueId | null {
  if (SILENT_FX.has(f.type) || (f.text && SILENT_FX.has(`${f.type}:${f.text}`))) return null;
  switch (f.type) {
    case 'coin': return 'farm.coin';
    case 'pickup': return f.text === 'egg' ? 'farm.egg' : 'farm.pickup';
    case 'splash': return 'farm.splash';
    case 'bump': return 'farm.bump';
    case 'drop': return (f.text && DROP_TAGS[f.text]) || 'farm.drop';
    case 'celebrate': return f.text === 'shoo!' ? 'farm.scare' : 'farm.celebrate';
    case 'confused': return f.text === 'pecked' ? 'farm.peck' : 'farm.confused';
    case 'sound': return (f.text && SOUND_TAGS[f.text]) || null;
    default: return null;
  }
}

/** Turn one farm tick's effects into cues. Coins in the same tick merge into one brighter chime. */
export function cuesForFarmFx(fx: FarmFx[], width: number): CueRequest[] {
  const out: CueRequest[] = [];
  let coins = 0;
  let coinX = 0;
  for (const f of fx) {
    const id = cueForFx(f);
    if (!id) continue;
    if (id === 'farm.coin') { coins += f.amount ?? 1; coinX = f.x; continue; }
    const pitch = id === 'farm.pickup' ? PICKUP_PITCH[f.text ?? ''] ?? 1 : undefined;
    out.push({ id, ...(pitch !== undefined ? { pitch } : {}), pan: panFor(f.x, width) });
  }
  if (coins > 0) out.push({ id: 'farm.coin', pitch: coins >= 3 ? 1.12 : coins === 2 ? 1.06 : 1, pan: panFor(coinX, width) });
  return out;
}

function panFor(x: number, width: number): number {
  return width > 1 ? Math.round(((x / (width - 1)) * 2 - 1) * 0.4 * 100) / 100 : 0;
}

/** Sim events that are silent in replays (too frequent, or not something you'd hear). Tested for coverage. */
export const SILENT_EVENTS = new Set<SimEventType>(['tick', 'move', 'stay', 'reach', 'enterArea', 'leaveArea']);

/** Cues for one replay frame: the same sounds as the farm, so a splash in a replay *is* a splash. */
export function cuesForSimEvents(events: SimEvent[], width: number): CueRequest[] {
  const out: CueRequest[] = [];
  for (const e of events) {
    if (SILENT_EVENTS.has(e.type)) continue;
    const id: CueId | null =
      e.type === 'bump' ? 'farm.bump'
      : e.type === 'enter' ? 'farm.splash'
      : e.type === 'pickup' ? 'farm.pickup'
      : e.type === 'drop' ? 'farm.drop'
      : e.type === 'deliver' ? 'farm.deliver'
      : e.type === 'fumble' ? 'farm.confused'
      : e.type === 'fill' ? 'farm.fill'
      : e.type === 'water' ? 'farm.water'
      : e.type === 'shoo' ? 'farm.shoo'
      : e.type === 'scare' ? 'farm.scare'
      : e.type === 'peck' ? 'farm.peck'
      : e.type === 'gate' ? (e.state === 'open' ? 'farm.gateOpen' : 'farm.gateShut')
      : null;
    if (id) out.push({ id, ...(id === 'farm.pickup' ? { pitch: PICKUP_PITCH[e.kind ?? ''] ?? 1 } : {}), pan: panFor(e.x, width) });
  }
  return out;
}

/** Which ambience layers should sound, and how loud (0–1 before volume settings). */
export function ambienceMix(scene: { night: boolean; raining: boolean }): { day: number; night: number; rain: number } {
  return { day: scene.night ? 0 : scene.raining ? 0.3 : 1, night: scene.night ? (scene.raining ? 0.5 : 1) : 0, rain: scene.raining ? 1 : 0 };
}

/**
 * Keeps sound sparse: a per-cue cooldown, a voice cap, and longer cooldowns for low-priority cues at high
 * farm speeds. `now` is passed in (milliseconds), so tests can use a fake clock.
 */
export class CueLimiter {
  private last = new Map<CueId, number>();
  private active: number[] = [];
  constructor(private maxVoices = 8) {}

  allow(id: CueId, now: number, farmSpeed = 1): boolean {
    const def = CUES[id];
    const slow = farmSpeed > 1 && def.priority !== 'A' ? 2 : 1;
    if (def.priority === 'C' && farmSpeed >= 4) return false;
    const prev = this.last.get(id);
    if (prev !== undefined && now - prev < def.cooldownMs * slow) return false;
    this.active = this.active.filter((end) => end > now);
    if (this.active.length >= this.maxVoices) return false;
    this.last.set(id, now);
    this.active.push(now + def.durationMs);
    return true;
  }
}

export interface AudioSettings {
  master: number;
  effects: number;
  ui: number;
  ambience: number;
  music: number;
  musicOn: boolean;
  /** Play farm sounds (quieter) while another screen is open. */
  offScreen: boolean;
  trainTicks: boolean;
  /** The one-time "Sound is on" note has been shown. */
  hintShown: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = {
  master: 0.7, effects: 0.8, ui: 0.7, ambience: 0.5, music: 0.4, musicOn: false, offScreen: false, trainTicks: false, hintShown: false,
};

/** Fill and clamp audio settings from a save (unknown or missing fields → defaults). */
export function sanitizeAudio(a: unknown): AudioSettings {
  const src = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  const vol = (k: keyof AudioSettings) => {
    const n = Number(src[k]);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : (DEFAULT_AUDIO[k] as number);
  };
  const bool = (k: keyof AudioSettings) => (typeof src[k] === 'boolean' ? (src[k] as boolean) : (DEFAULT_AUDIO[k] as boolean));
  return {
    master: vol('master'), effects: vol('effects'), ui: vol('ui'), ambience: vol('ambience'), music: vol('music'),
    musicOn: bool('musicOn'), offScreen: bool('offScreen'), trainTicks: bool('trainTicks'), hintShown: bool('hintShown'),
  };
}

/** Final gain for a cue on a bus (0 when sound is off). */
export function cueGain(enabled: boolean, a: AudioSettings, bus: Bus | 'ambience', offScreen = false): number {
  if (!enabled) return 0;
  return a.master * (bus === 'ui' ? a.ui : bus === 'ambience' ? a.ambience : a.effects) * (offScreen ? 0.5 : 1);
}
