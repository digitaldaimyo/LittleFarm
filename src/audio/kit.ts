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
};

/** Total length of a recipe in seconds (plus a short tail so decays aren't cut). */
export function recipeLength(r: Recipe): number {
  return Math.max(...r.voices.map((v) => v.at + v.dur)) + 0.05;
}
