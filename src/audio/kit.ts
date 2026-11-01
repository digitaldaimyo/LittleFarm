/**
 * The sound kit: every cue is a small synthesis recipe (oscillators and filtered noise with envelopes),
 * rendered once into a buffer by the engine. No audio files: nothing to download or license, and it
 * matches the procedural art. A cue id can later be swapped for a sample without touching game code.
 */
import type { CueId } from '../game/sound';

export interface Voice {
  /** 'noise' is white noise (shaped by the filter). */
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';
  /** Start and end frequency in Hz (exponential glide). Ignored for noise. */
  freq?: [number, number];
  /** Start time and duration in seconds. */
  at: number;
  dur: number;
  /** Peak gain (0–1) and attack time in seconds; the rest of the note decays exponentially. */
  gain: number;
  attack?: number;
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: [number, number]; q?: number };
  vibrato?: { rate: number; depth: number };
  /** Hold the peak and fade out over this many seconds at the end (for beds); default = decay over the whole note. */
  release?: number;
}

export interface Recipe {
  voices: Voice[];
}

const note = (f: number, at: number, dur: number, gain = 0.22, wave: Voice['wave'] = 'triangle'): Voice => ({ wave, freq: [f, f], at, dur, gain, attack: 0.008 });

// Notes (Hz)
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1568, C7 = 2093;

export const KIT: Record<CueId, Recipe> = {
  // Teaching
  'card.flick': { voices: [{ wave: 'noise', at: 0, dur: 0.05, gain: 0.18, attack: 0.003, filter: { type: 'bandpass', freq: [2600, 4200], q: 1.2 } }] },
  'card.snap': { voices: [
    { wave: 'noise', at: 0, dur: 0.03, gain: 0.22, attack: 0.001, filter: { type: 'highpass', freq: [1800, 1800] } },
    { wave: 'triangle', freq: [900, 620], at: 0, dur: 0.06, gain: 0.2, attack: 0.002 },
  ] },
  'card.reject': { voices: [
    { wave: 'triangle', freq: [190, 140], at: 0, dur: 0.1, gain: 0.3, attack: 0.002, filter: { type: 'lowpass', freq: [900, 600] } },
    { wave: 'triangle', freq: [170, 130], at: 0.09, dur: 0.08, gain: 0.18, attack: 0.002, filter: { type: 'lowpass', freq: [800, 500] } },
  ] },
  'pen.place': { voices: [{ wave: 'sine', freq: [480, 820], at: 0, dur: 0.08, gain: 0.28, attack: 0.004 }] },
  'train.start': { voices: [{ wave: 'sine', freq: [600, 1150], at: 0, dur: 0.24, gain: 0.2, attack: 0.03, vibrato: { rate: 9, depth: 18 } }] },
  'train.certified': { voices: [note(G5, 0, 0.14), note(C6, 0.12, 0.14), note(E6, 0.24, 0.4, 0.24), note(G6, 0.24, 0.4, 0.08, 'sine')] },
  'train.notCertified': { voices: [note(E5, 0, 0.2, 0.18), note(C5, 0.16, 0.3, 0.16)] },
  'train.loophole': { voices: [{ wave: 'sine', freq: [260, 720], at: 0, dur: 0.55, gain: 0.26, attack: 0.01, vibrato: { rate: 11, depth: 55 } }] },
  'skill.save': { voices: [
    { wave: 'noise', at: 0, dur: 0.06, gain: 0.2, attack: 0.002, filter: { type: 'lowpass', freq: [900, 500] } },
    { wave: 'sine', freq: [140, 80], at: 0, dur: 0.1, gain: 0.35, attack: 0.002 },
    note(C6, 0.06, 0.09, 0.08, 'sine'),
  ] },
  // Farm
  'farm.pickup': { voices: [{ wave: 'sine', freq: [680, 1050], at: 0, dur: 0.07, gain: 0.26, attack: 0.003 }] },
  'farm.coin': { voices: [note(G6, 0, 0.07, 0.16), note(C7, 0.06, 0.2, 0.16), note(C7 * 2, 0.06, 0.12, 0.03, 'sine')] },
  'farm.splash': { voices: [
    { wave: 'noise', at: 0, dur: 0.38, gain: 0.32, attack: 0.01, filter: { type: 'bandpass', freq: [1600, 380], q: 0.9 } },
    { wave: 'sine', freq: [210, 90], at: 0, dur: 0.16, gain: 0.25, attack: 0.004 },
  ] },
  'farm.bump': { voices: [
    { wave: 'sine', freq: [170, 95], at: 0, dur: 0.11, gain: 0.4, attack: 0.002 },
    { wave: 'noise', at: 0, dur: 0.03, gain: 0.08, attack: 0.001, filter: { type: 'lowpass', freq: [700, 400] } },
  ] },
  // Progression
  'pet.adopt': { voices: [
    { wave: 'sine', freq: [900, 1400], at: 0, dur: 0.08, gain: 0.22, attack: 0.004 },
    { wave: 'sine', freq: [1150, 1750], at: 0.11, dur: 0.1, gain: 0.22, attack: 0.004 },
  ] },
  'ui.unlock': { voices: [note(C6, 0, 0.09, 0.16), note(E6, 0.07, 0.09, 0.16), note(G6, 0.14, 0.09, 0.16), note(C7, 0.21, 0.24, 0.18),
    { wave: 'noise', at: 0.21, dur: 0.22, gain: 0.04, attack: 0.01, filter: { type: 'highpass', freq: [6000, 9000] } }] },
  'ui.shop': { voices: [
    { wave: 'noise', at: 0, dur: 0.06, gain: 0.2, attack: 0.001, filter: { type: 'highpass', freq: [4500, 4500] } },
    note(2637, 0.06, 0.2, 0.12), note(3136, 0.06, 0.24, 0.1),
  ] },

  // Phase B: teaching
  'card.remove': { voices: [{ wave: 'noise', at: 0, dur: 0.05, gain: 0.15, attack: 0.02, filter: { type: 'bandpass', freq: [4200, 2400], q: 1.2 } }] },
  'card.repair': { voices: [
    note(2350, 0, 0.12, 0.12, 'sine'), note(3520, 0.005, 0.1, 0.06, 'sine'),
    { wave: 'noise', at: 0.12, dur: 0.03, gain: 0.2, attack: 0.001, filter: { type: 'highpass', freq: [1800, 1800] } },
    { wave: 'triangle', freq: [900, 620], at: 0.12, dur: 0.06, gain: 0.18, attack: 0.002 },
  ] },
  // Phase B: farm
  'farm.drop': { voices: [
    { wave: 'sine', freq: [240, 120], at: 0, dur: 0.09, gain: 0.3, attack: 0.003 },
    { wave: 'noise', at: 0, dur: 0.04, gain: 0.08, attack: 0.002, filter: { type: 'lowpass', freq: [900, 500] } },
  ] },
  'farm.deliver': { voices: [{ wave: 'sine', freq: [300, 170], at: 0, dur: 0.08, gain: 0.25, attack: 0.003 }, note(E6, 0.05, 0.16, 0.12)] },
  'farm.confused': { voices: [{ wave: 'triangle', freq: [420, 380], at: 0, dur: 0.09, gain: 0.14, attack: 0.01 }, { wave: 'triangle', freq: [400, 560], at: 0.09, dur: 0.12, gain: 0.14, attack: 0.01 }] },
  'farm.fill': { voices: [0, 0.09, 0.18].map((t, i) => ({ wave: 'sine' as const, freq: [260 + i * 40, 520 + i * 60] as [number, number], at: t, dur: 0.1, gain: 0.2, attack: 0.01 }))
    .concat([{ wave: 'sine', freq: [380, 760], at: 0.27, dur: 0.05, gain: 0.08, attack: 0.005 }]) },
  'farm.water': { voices: [
    { wave: 'noise', at: 0, dur: 0.3, gain: 0.16, attack: 0.04, filter: { type: 'highpass', freq: [3500, 5500] } },
    ...[0.03, 0.1, 0.17, 0.23].map((t, i) => note(1800 + i * 260, t, 0.05, 0.05, 'sine')),
  ] },
  'farm.shoo': { voices: [
    { wave: 'noise', at: 0, dur: 0.18, gain: 0.18, attack: 0.05, filter: { type: 'bandpass', freq: [700, 2500], q: 0.8 } },
    { wave: 'square', freq: [620, 540], at: 0.15, dur: 0.06, gain: 0.05, attack: 0.004, filter: { type: 'lowpass', freq: [1800, 1500] } },
    { wave: 'square', freq: [700, 480], at: 0.22, dur: 0.07, gain: 0.05, attack: 0.004, filter: { type: 'lowpass', freq: [1800, 1400] } },
  ] },
  'farm.scare': { voices: [
    ...[0, 0.05, 0.1, 0.15, 0.2].map((t) => ({ wave: 'noise' as const, at: t, dur: 0.04, gain: 0.12, attack: 0.004, filter: { type: 'bandpass' as const, freq: [1200, 900] as [number, number], q: 1 } })),
    { wave: 'sawtooth', freq: [880, 640], at: 0.18, dur: 0.22, gain: 0.06, attack: 0.01, filter: { type: 'bandpass', freq: [1400, 1100], q: 2 } },
  ] },
  'farm.peck': { voices: [{ wave: 'sawtooth', freq: [820, 600], at: 0, dur: 0.28, gain: 0.06, attack: 0.015, filter: { type: 'bandpass', freq: [1300, 1000], q: 2.2 } }] },
  'farm.egg': { voices: [
    { wave: 'square', freq: [520, 600], at: 0, dur: 0.07, gain: 0.04, attack: 0.004, filter: { type: 'lowpass', freq: [1500, 1500] } },
    { wave: 'square', freq: [560, 420], at: 0.08, dur: 0.09, gain: 0.04, attack: 0.004, filter: { type: 'lowpass', freq: [1500, 1200] } },
    { wave: 'sine', freq: [500, 900], at: 0.18, dur: 0.05, gain: 0.18, attack: 0.003 },
  ] },
  'farm.gateOpen': { voices: [{ wave: 'sawtooth', freq: [180, 260], at: 0, dur: 0.4, gain: 0.05, attack: 0.05, vibrato: { rate: 23, depth: 14 }, filter: { type: 'bandpass', freq: [900, 1200], q: 3 } }] },
  'farm.gateShut': { voices: [
    { wave: 'sine', freq: [150, 90], at: 0, dur: 0.1, gain: 0.32, attack: 0.002 },
    { wave: 'noise', at: 0.06, dur: 0.03, gain: 0.14, attack: 0.001, filter: { type: 'highpass', freq: [2500, 2500] } },
    note(1400, 0.07, 0.08, 0.05, 'sine'),
  ] },
  'farm.firefly': { voices: [note(C7, 0, 0.12, 0.08, 'sine'), note(2637, 0.08, 0.12, 0.07, 'sine'), note(3136, 0.16, 0.2, 0.07, 'sine')] },
  'farm.celebrate': { voices: [note(G5, 0, 0.08, 0.1), note(C6, 0.07, 0.08, 0.1), note(E6, 0.14, 0.14, 0.1)] },
  'farm.crow': { voices: [
    { wave: 'sawtooth', freq: [760, 560], at: 0, dur: 0.18, gain: 0.035, attack: 0.02, filter: { type: 'bandpass', freq: [1200, 900], q: 2 } },
    { wave: 'sawtooth', freq: [740, 540], at: 0.24, dur: 0.18, gain: 0.03, attack: 0.02, filter: { type: 'bandpass', freq: [1200, 900], q: 2 } },
  ] },
  'world.dawn': { voices: [note(C5, 0, 0.5, 0.07, 'sine'), note(E5, 0.18, 0.5, 0.07, 'sine'), note(G5, 0.36, 0.6, 0.07, 'sine'), note(C6, 0.54, 0.5, 0.05, 'sine')] },
  'world.dusk': { voices: [note(G5, 0, 0.6, 0.06, 'sine'), note(E5, 0.25, 0.6, 0.06, 'sine'), note(C5, 0.5, 0.75, 0.07, 'sine')] },
  // Phase B: progression and the Field Guide
  'ui.request': { voices: [note(1760, 0, 0.5, 0.12, 'sine'), note(4400, 0, 0.25, 0.03, 'sine'), note(2217, 0.12, 0.5, 0.08, 'sine')] },
  'guide.step': { voices: [note(1568, 0, 0.06, 0.08, 'sine')] },
  'guide.offer': { voices: [
    { wave: 'noise', at: 0, dur: 0.2, gain: 0.08, attack: 0.08, filter: { type: 'bandpass', freq: [1800, 3600], q: 0.9 } },
    note(E6, 0.16, 0.12, 0.06, 'sine'),
  ] },
  'guide.done': { voices: [note(C6, 0, 0.14, 0.12), note(G6, 0.12, 0.38, 0.12), note(E6, 0.12, 0.38, 0.06, 'sine')] },
  // Phase C: a pet's chirp (pitched per pet at play time), a nap sigh, probe plucks, training ticks
  'pet.chirp': { voices: [{ wave: 'sine', freq: [1100, 1500], at: 0, dur: 0.07, gain: 0.14, attack: 0.005 }, { wave: 'sine', freq: [1350, 1050], at: 0.08, dur: 0.08, gain: 0.12, attack: 0.005 }] },
  'pet.sigh': { voices: [{ wave: 'noise', at: 0, dur: 0.55, gain: 0.07, attack: 0.15, filter: { type: 'bandpass', freq: [900, 400], q: 1.1 } }, { wave: 'sine', freq: [330, 250], at: 0.05, dur: 0.45, gain: 0.05, attack: 0.1 }] },
  'probe.pluck': { voices: [{ wave: 'triangle', freq: [784, 784], at: 0, dur: 0.12, gain: 0.1, attack: 0.002 }] },
  'farm.store': { voices: [{ wave: 'sine', freq: [260, 160], at: 0, dur: 0.1, gain: 0.25, attack: 0.003 }, { wave: 'noise', at: 0, dur: 0.05, gain: 0.08, attack: 0.002, filter: { type: 'lowpass', freq: [1200, 600] } }, note(G5, 0.07, 0.08, 0.05, 'sine')] },
  'farm.full': { voices: [{ wave: 'triangle', freq: [200, 160], at: 0, dur: 0.08, gain: 0.22, attack: 0.002, filter: { type: 'lowpass', freq: [800, 600] } }, { wave: 'triangle', freq: [200, 160], at: 0.1, dur: 0.08, gain: 0.18, attack: 0.002, filter: { type: 'lowpass', freq: [800, 600] } }] },
  'train.tick': { voices: [{ wave: 'sine', freq: [1800, 1800], at: 0, dur: 0.03, gain: 0.06, attack: 0.001 }] },
};

/** A small seeded PRNG so ambience loops are the same on every device (and testable). */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

export type AmbienceId = 'day' | 'night' | 'rain';
/** Ambience loops: this long, plus an overlap the engine crossfades into the start so the loop is seamless. */
export const AMBIENCE_SECONDS = 12;
export const AMBIENCE_OVERLAP = 0.8;

/** Day: sparse birdsong over a faint breeze. Night: a few crickets at their own pace. Rain: a soft bed with drops. */
export function ambienceRecipe(id: AmbienceId): Recipe {
  const len = AMBIENCE_SECONDS + AMBIENCE_OVERLAP;
  const r = rng(id === 'day' ? 11 : id === 'night' ? 22 : 33);
  const voices: Voice[] = [];
  if (id === 'day') {
    voices.push({ wave: 'noise', at: 0, dur: len, gain: 0.05, attack: 0.01, release: 0.01, filter: { type: 'lowpass', freq: [420, 380], q: 0.5 } });
    for (let t = 0.4; t < AMBIENCE_SECONDS - 1; t += 1.2 + r() * 2.2) {
      const base = 2200 + r() * 1600;
      const notes = 2 + Math.floor(r() * 4);
      for (let k = 0; k < notes; k++) {
        const f = base * (0.85 + r() * 0.35);
        voices.push({ wave: 'sine', freq: [f, f * (r() < 0.5 ? 1.35 : 0.75)], at: t + k * (0.09 + r() * 0.05), dur: 0.05 + r() * 0.06, gain: 0.05 + r() * 0.04, attack: 0.008 });
      }
    }
  } else if (id === 'night') {
    for (const [pitch, every, offset] of [[4600, 0.9, 0.1], [4150, 1.3, 0.5], [5000, 2.1, 0.9]] as const) {
      for (let t = offset; t < AMBIENCE_SECONDS - 0.3; t += every * (0.92 + r() * 0.16)) {
        for (let k = 0; k < 3; k++) voices.push({ wave: 'sine', freq: [pitch, pitch], at: t + k * 0.045, dur: 0.028, gain: pitch === 5000 ? 0.025 : 0.04, attack: 0.004 });
      }
    }
    voices.push({ wave: 'noise', at: 0, dur: len, gain: 0.025, attack: 0.01, release: 0.01, filter: { type: 'lowpass', freq: [300, 300], q: 0.5 } });
  } else {
    voices.push({ wave: 'noise', at: 0, dur: len, gain: 0.08, attack: 0.01, release: 0.01, filter: { type: 'lowpass', freq: [1500, 1500], q: 0.4 } });
    voices.push({ wave: 'noise', at: 0, dur: len, gain: 0.03, attack: 0.01, release: 0.01, filter: { type: 'highpass', freq: [4000, 4000], q: 0.4 } });
    for (let t = 0.05; t < AMBIENCE_SECONDS - 0.1; t += 0.05 + r() * 0.25) {
      const f = 1800 + r() * 2600;
      voices.push({ wave: 'noise', at: t, dur: 0.02, gain: 0.03 + r() * 0.05, attack: 0.001, filter: { type: 'bandpass', freq: [f, f * 0.8], q: 4 } });
    }
  }
  return { voices };
}

/** Total length of a recipe in seconds (plus a short tail so decays aren't cut). */
export function recipeLength(r: Recipe): number {
  return Math.max(...r.voices.map((v) => v.at + v.dur)) + 0.05;
}
