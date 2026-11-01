/**
 * Sound cues: which moments make a sound, and how often. Pure and deterministic (no audio APIs),
 * so the mapping and the rate limiter are unit-tested like the rest of the game.
 * Playback lives in `audio/engine.ts`; recipes in `audio/kit.ts`. See docs/SOUND_PLAN.md.
 */
import type { FarmFx } from './farm';

export type CueId =
  // Teaching
  | 'card.flick' | 'card.snap' | 'card.reject' | 'pen.place'
  | 'train.start' | 'train.certified' | 'train.notCertified' | 'train.loophole' | 'skill.save'
  // Farm
  | 'farm.pickup' | 'farm.coin' | 'farm.splash' | 'farm.bump'
  // Progression
  | 'pet.adopt' | 'ui.unlock' | 'ui.shop';

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
  'pet.adopt': { bus: 'ui', priority: 'A', cooldownMs: 500, durationMs: 250 },
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
 * Farm effects that are silent on purpose in phase A (they get sounds in phase B), keyed by `type:text`.
 * Every FarmFx type must either map to a cue or appear here — tested.
 */
export const SILENT_FX = new Set(['drop', 'celebrate', 'confused', 'nap', 'splash:rain', 'pickup:egg']);

const PICKUP_PITCH: Record<string, number> = { egg: 1.15, carrot: 0.9 };

/** Turn one farm tick's effects into cues. Coins in the same tick merge into one brighter chime. */
export function cuesForFarmFx(fx: FarmFx[], width: number): CueRequest[] {
  const out: CueRequest[] = [];
  const pan = (x: number) => (width > 1 ? Math.round(((x / (width - 1)) * 2 - 1) * 0.4 * 100) / 100 : 0);
  let coins = 0;
  let coinX = 0;
  for (const f of fx) {
    if (SILENT_FX.has(f.type) || (f.text && SILENT_FX.has(`${f.type}:${f.text}`))) continue;
    if (f.type === 'coin') { coins += f.amount ?? 1; coinX = f.x; continue; }
    if (f.type === 'pickup') out.push({ id: 'farm.pickup', pitch: PICKUP_PITCH[f.text ?? ''] ?? 1, pan: pan(f.x) });
    else if (f.type === 'splash') out.push({ id: 'farm.splash', pan: pan(f.x) });
    else if (f.type === 'bump') out.push({ id: 'farm.bump', pan: pan(f.x) });
  }
  if (coins > 0) out.push({ id: 'farm.coin', pitch: coins >= 3 ? 1.12 : coins === 2 ? 1.06 : 1, pan: pan(coinX) });
  return out;
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
export function cueGain(enabled: boolean, a: AudioSettings, bus: Bus, offScreen = false): number {
  if (!enabled) return 0;
  return a.master * (bus === 'ui' ? a.ui : a.effects) * (offScreen ? 0.5 : 1);
}
