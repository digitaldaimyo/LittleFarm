/**
 * Sound playback (browser only). Renders each kit recipe once into a buffer, then plays cues through a
 * gentle compressor. The AudioContext is created on the first user gesture with sound on, and suspended
 * while the tab is hidden. Nothing is fetched. See docs/SOUND_PLAN.md.
 */
import { CUES, CueLimiter, DEFAULT_AUDIO, cueGain, cuesForFarmFx, type AudioSettings, type CueId, type CueRequest } from '../game/sound';
import type { FarmFx } from '../game/farm';
import { KIT, recipeLength, type Recipe, type Voice } from './kit';

type Ctor = typeof AudioContext;
type OfflineCtor = typeof OfflineAudioContext;

interface DebugHook { contexts: number; rendered: number; state: string; cues: CueId[] }

declare global {
  interface Window {
    webkitAudioContext?: Ctor;
    webkitOfflineAudioContext?: OfflineCtor;
    /** Test hook: how many AudioContexts were created and which cues played (see scripts/e2e-guide.mjs). */
    __penDeckAudio?: DebugHook;
  }
}

const RATE = 44100;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private buffers = new Map<CueId, AudioBuffer>();
  private limiter = new CueLimiter(8);
  private enabled = false;
  private settings: AudioSettings = { ...DEFAULT_AUDIO };
  private noise: Float32Array | null = null;
  private rendering: Promise<void> | null = null;
  /** Called once, the first time a sound actually plays (for the one-time "Sound is on" note). */
  onFirstSound: (() => void) | null = null;
  private played = false;

  constructor() {
    if (typeof window !== 'undefined') window.__penDeckAudio = { contexts: 0, rendered: 0, state: 'none', cues: [] };
  }

  configure(enabled: boolean, settings: AudioSettings) {
    this.enabled = enabled;
    this.settings = settings;
    if (!enabled && this.ctx?.state === 'running') void this.ctx.suspend();
    if (enabled && this.ctx?.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  /** Call from a user gesture (click, key). Creates the context the first time, if sound is on. */
  unlock() {
    if (!this.enabled || typeof window === 'undefined') return;
    if (!this.ctx) {
      const C = window.AudioContext ?? window.webkitAudioContext;
      if (!C) return;
      try {
        this.ctx = new C();
      } catch {
        return;
      }
      window.__penDeckAudio!.contexts++;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(this.ctx.destination);
      this.out = comp;
      this.rendering = this.renderAll();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  /** Pause audio while the tab is hidden (saves battery); resume when it's back. */
  visibility(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden && this.ctx.state === 'running') void this.ctx.suspend();
    if (!hidden && this.enabled && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(req: CueRequest | CueId, opts: { farmSpeed?: number; offScreen?: boolean } = {}) {
    const r: CueRequest = typeof req === 'string' ? { id: req } : req;
    if (!this.enabled) return;
    if (!this.limiter.allow(r.id, performance.now(), opts.farmSpeed ?? 1)) return;
    window.__penDeckAudio?.cues.push(r.id);
    const gain = cueGain(this.enabled, this.settings, CUES[r.id].bus, opts.offScreen);
    const buf = this.buffers.get(r.id);
    if (window.__penDeckAudio && this.ctx) window.__penDeckAudio.state = this.ctx.state;
    if (!this.ctx || !this.out || !buf || gain <= 0 || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (r.pitch ?? 1) * (0.97 + Math.random() * 0.06); // a little variety
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node: AudioNode = src.connect(g);
    if (r.pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = r.pan;
      node = node.connect(p);
    }
    node.connect(this.out);
    src.start();
    if (!this.played) {
      this.played = true;
      this.onFirstSound?.();
    }
  }

  /** One farm tick's effects. Farm sounds play on the Farm screen, or quieter elsewhere if the player asked. */
  playFarm(fx: FarmFx[], width: number, farmSpeed: number, onFarmScreen: boolean) {
    if (!this.enabled || !fx.length) return;
    if (!onFarmScreen && !this.settings.offScreen) return;
    for (const c of cuesForFarmFx(fx, width)) this.play(c, { farmSpeed, offScreen: !onFarmScreen });
  }

  private async renderAll() {
    const O = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
    if (!O) return;
    for (const id of Object.keys(KIT) as CueId[]) {
      try {
        this.buffers.set(id, await this.render(O, KIT[id]));
        window.__penDeckAudio!.rendered = this.buffers.size;
      } catch {
        // A cue that can't render stays silent; the game never depends on sound.
      }
    }
  }

  private render(O: OfflineCtor, recipe: Recipe): Promise<AudioBuffer> {
    const len = Math.ceil(recipeLength(recipe) * RATE);
    const oc = new O(1, len, RATE);
    for (const v of recipe.voices) this.voice(oc, v);
    return oc.startRendering();
  }

  private voice(oc: OfflineAudioContext, v: Voice) {
    const end = v.at + v.dur;
    let src: AudioScheduledSourceNode;
    if (v.wave === 'noise') {
      if (!this.noise) {
        this.noise = new Float32Array(RATE);
        let seed = 1;
        for (let i = 0; i < this.noise.length; i++) { seed = (seed * 16807) % 2147483647; this.noise[i] = (seed / 2147483647) * 2 - 1; }
      }
      const b = oc.createBuffer(1, this.noise.length, RATE);
      b.copyToChannel(this.noise, 0);
      const n = oc.createBufferSource();
      n.buffer = b;
      n.loop = true;
      src = n;
    } else {
      const o = oc.createOscillator();
      o.type = v.wave;
      const [f0, f1] = v.freq ?? [440, 440];
      o.frequency.setValueAtTime(f0, v.at);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, end);
      if (v.vibrato) {
        const lfo = oc.createOscillator();
        lfo.frequency.value = v.vibrato.rate;
        const depth = oc.createGain();
        depth.gain.value = v.vibrato.depth;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(v.at);
        lfo.stop(end + 0.02);
      }
      src = o;
    }
    let node: AudioNode = src;
    if (v.filter) {
      const f = oc.createBiquadFilter();
      f.type = v.filter.type;
      f.Q.value = v.filter.q ?? 0.7;
      f.frequency.setValueAtTime(v.filter.freq[0], v.at);
      if (v.filter.freq[1] !== v.filter.freq[0]) f.frequency.exponentialRampToValueAtTime(v.filter.freq[1], end);
      node = node.connect(f);
    }
    const g = oc.createGain();
    const attack = Math.min(v.attack ?? 0.005, v.dur / 2);
    g.gain.setValueAtTime(0, v.at);
    g.gain.linearRampToValueAtTime(v.gain, v.at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    node.connect(g).connect(oc.destination);
    src.start(v.at);
    src.stop(end + 0.02);
  }

  /** Resolves when every cue is rendered (tests and the first-play path). */
  ready(): Promise<void> {
    return this.rendering ?? Promise.resolve();
  }
}

export const audio = new AudioEngine();
