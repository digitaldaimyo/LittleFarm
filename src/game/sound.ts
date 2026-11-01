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
  | 'pet.adopt' | 'ui.unlock' | 'ui.shop' | 'ui.request' | 'guide.step' | 'guide.offer' | 'guide.done'
  // Phase C: personality and small extras
  | 'pet.chirp' | 'pet.sigh' | 'probe.pluck' | 'train.tick';

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
  'pet.chirp': { bus: 'effects', priority: 'B', cooldownMs: 2500, durationMs: 200 },
  'pet.sigh': { bus: 'effects', priority: 'C', cooldownMs: 4000, durationMs: 650 },
  'probe.pluck': { bus: 'ui', priority: 'C', cooldownMs: 40, durationMs: 160 },
  'train.tick': { bus: 'ui', priority: 'C', cooldownMs: 300, durationMs: 60 },
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
 * cue or appear here — tested. (Dusk has its own cue; rain is carried by the rain ambience. A plain `nap` is a nap starting: a sigh.)
 */
export const SILENT_FX = new Set(['nap:night', 'splash:rain']);

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
    case 'nap': return 'pet.sigh';
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

/** Each pet's voice: a stable pitch from its name and colours, so two pets sound different (0.82–1.25). */
export function voicePitch(name: string, palette: string): number {
  let h = 2166136261;
  for (const ch of `${name}|${palette}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return Math.round((0.82 + (h % 1000) / 1000 * 0.43) * 100) / 100;
}

/** Optional training ticks: one soft tick as practice passes 25%, 50% and 75%. */
export function trainTickCrossed(prev: number, now: number): boolean {
  return [0.25, 0.5, 0.75].some((q) => prev < q && now >= q);
}

export type MusicMood = 'day' | 'night' | 'pen';
export interface MusicNote { beat: number; midi: number; beats: number; gain: number }

/**
 * The music box: one 4-beat bar of gentle pentatonic notes, chosen from a seed (the bar number), so it never
 * repeats exactly but is reproducible. Day is brighter and fuller, night lower and sparser, the pen lighter.
 */
export function musicBar(mood: MusicMood, seed: number): MusicNote[] {
  let s = (seed * 2654435761 + 12345) >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const scale = mood === 'night' ? [57, 60, 62, 64, 67, 69] : [60, 62, 64, 67, 69, 72]; // A minor / C major pentatonic
  const density = mood === 'day' ? 0.6 : mood === 'pen' ? 0.45 : 0.3;
  const out: MusicNote[] = [];
  // A soft root under the bar (every other bar at night).
  if (mood !== 'night' || seed % 2 === 0) out.push({ beat: 0, midi: (seed % 4 === 2 ? scale[3] : scale[0]) - 12, beats: 4, gain: 0.5 });
  let last = Math.floor(r() * scale.length);
  for (let beat = 0; beat < 4; beat += 0.5) {
    if (r() > density * (beat % 1 === 0 ? 1 : 0.4)) continue;
    last = Math.max(0, Math.min(scale.length - 1, last + Math.round((r() - 0.5) * 3)));
    out.push({ beat, midi: scale[last] + (mood === 'pen' && r() < 0.3 ? 12 : 0), beats: r() < 0.3 ? 2 : 1, gain: 0.6 + r() * 0.3 });
  }
  return out;
}
