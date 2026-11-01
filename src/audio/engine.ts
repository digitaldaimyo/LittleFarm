/**
 * Sound playback (browser only). Renders each kit recipe once into a buffer, then plays cues through a
 * gentle compressor. The AudioContext is created on the first user gesture with sound on, and suspended
 * while the tab is hidden. Nothing is fetched. See docs/SOUND_PLAN.md.
 */
import { CUES, CueLimiter, DEFAULT_AUDIO, ambienceMix, cueGain, cuesForFarmFx, cuesForSimEvents, musicBar, type AudioSettings, type CueId, type CueRequest, type MusicMood } from '../game/sound';
import type { SimEvent } from '../sim/world';
import type { FarmFx } from '../game/farm';
import { AMBIENCE_OVERLAP, AMBIENCE_SECONDS, KIT, ambienceRecipe, recipeLength, type AmbienceId, type Recipe, type Voice } from './kit';

type Ctor = typeof AudioContext;
type OfflineCtor = typeof OfflineAudioContext;

interface DebugHook {
  contexts: number; rendered: number; state: string; cues: CueId[]; ambience: Record<AmbienceId, number>;
  /** Cues whose rendered peak is near silence (should stay empty), and each ambience loop's RMS level. */
  quiet: string[]; loops: Partial<Record<AmbienceId, number>>;
  /** Music-box notes scheduled so far. */
  musicNotes: number;
}

declare global {
  interface Window {
    webkitAudioContext?: Ctor;
    webkitOfflineAudioContext?: OfflineCtor;
    /** Test hook: how many AudioContexts were created and which cues played (see scripts/e2e-guide.mjs). */
    __penDeckAudio?: DebugHook;
  }
}

const RATE = 44100;
const DUCK = new Set<CueId>(['train.certified', 'train.notCertified', 'train.loophole', 'ui.unlock', 'guide.done', 'ui.request']);
/** Ambience loops are rendered at a lower rate: nothing in them needs more, and they're long. */
const AMB_RATE = 22050;
const AMBIENCE: AmbienceId[] = ['day', 'night', 'rain'];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private buffers = new Map<CueId, AudioBuffer>();
  private limiter = new CueLimiter(8);
  private enabled = false;
  private settings: AudioSettings = { ...DEFAULT_AUDIO };
  private noise: AudioBuffer | null = null;
  private rendering: Promise<void> | null = null;
  /** Called once, the first time a sound actually plays (for the one-time "Sound is on" note). */
  onFirstSound: (() => void) | null = null;
  private played = false;
  private amb = new Map<AmbienceId, GainNode>();
  private scene = { night: false, raining: false, onFarm: true };
  private music: { gain: GainNode; timer: ReturnType<typeof setInterval>; nextBar: number; bar: number } | null = null;
  /** The duty pet's voice pitch (see voicePitch in game/sound). */
  private petPitch = 1;

  constructor() {
    if (typeof window !== 'undefined') window.__penDeckAudio = { contexts: 0, rendered: 0, state: 'none', cues: [], ambience: { day: 0, night: 0, rain: 0 }, quiet: [], loops: {}, musicNotes: 0 };
  }

  configure(enabled: boolean, settings: AudioSettings) {
    this.enabled = enabled;
    this.settings = settings;
    if (!enabled && this.ctx?.state === 'running') void this.ctx.suspend();
    if (enabled && this.ctx?.state === 'suspended' && !document.hidden) void this.ctx.resume();
    this.applyAmbience();
    this.applyMusic();
  }

  setVoice(pitch: number) {
    this.petPitch = pitch;
  }

  /** The optional music box: gentle generative bars, scheduled a little ahead on the audio clock. */
  private applyMusic() {
    const want = this.enabled && this.settings.musicOn && !!this.ctx && !!this.out;
    if (!want) {
      if (this.music) {
        const m = this.music;
        clearInterval(m.timer);
        if (this.ctx) m.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
        setTimeout(() => m.gain.disconnect(), 1500);
        this.music = null;
      }
      return;
    }
    const ctx = this.ctx!;
    if (!this.music) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.out!);
      this.music = { gain, nextBar: ctx.currentTime + 0.3, bar: 0, timer: setInterval(() => this.scheduleMusic(), 250) };
    }
    this.music.gain.gain.setTargetAtTime(this.musicLevel(), ctx.currentTime, 0.5);
  }

  private musicLevel() {
    return this.enabled && this.settings.musicOn ? this.settings.master * this.settings.music * 0.35 : 0;
  }

  private scheduleMusic() {
    const ctx = this.ctx, m = this.music;
    if (!ctx || !m || ctx.state !== 'running') return;
    const mood: MusicMood = this.scene.onFarm ? (this.scene.night ? 'night' : 'day') : 'pen';
    const beat = mood === 'night' ? 1 : mood === 'pen' ? 0.85 : 0.75;
    while (m.nextBar < ctx.currentTime + 1.5) {
      for (const n of musicBar(mood, m.bar)) {
        const t = m.nextBar + n.beat * beat, len = n.beats * beat * 1.2;
        const f = 440 * Math.pow(2, (n.midi - 69) / 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12 * n.gain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        g.connect(m.gain);
        for (const [type, mult, lvl] of [['triangle', 1, 1], ['sine', 2, 0.25]] as const) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f * mult;
          if (lvl < 1) { const gg = ctx.createGain(); gg.gain.value = lvl; o.connect(gg).connect(g); } else o.connect(g);
          o.start(t);
          o.stop(t + len + 0.05);
        }
        if (window.__penDeckAudio) window.__penDeckAudio.musicNotes++;
      }
      m.nextBar += 4 * beat;
      m.bar++;
    }
  }

  /** Music dips under the jingles that mark results, then comes back. */
  private duck() {
    if (!this.music || !this.ctx) return;
    const g = this.music.gain.gain, now = this.ctx.currentTime, lvl = this.musicLevel();
    g.cancelScheduledValues(now);
    g.setTargetAtTime(lvl * 0.3, now, 0.05);
    g.setTargetAtTime(lvl, now + 1.2, 0.4);
  }

  /** What the farm sounds like right now. Ambience crossfades over a couple of seconds when this changes. */
  setScene(scene: { night: boolean; raining: boolean; onFarm: boolean }) {
    const s = this.scene;
    if (s.night === scene.night && s.raining === scene.raining && s.onFarm === scene.onFarm) return;
    this.scene = { ...scene };
    this.applyAmbience();
  }

  private applyAmbience() {
    const mix = ambienceMix(this.scene);
    // Ambience is the farm's soundtrack: full on the Farm screen, softer elsewhere.
    const level = cueGain(this.enabled, this.settings, 'ambience') * (this.scene.onFarm ? 1 : 0.4);
    for (const id of AMBIENCE) {
      const target = mix[id] * level;
      if (window.__penDeckAudio) window.__penDeckAudio.ambience[id] = Math.round(target * 1000) / 1000;
      const g = this.amb.get(id);
      if (g && this.ctx) g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.8);
    }
  }

  /** One replay frame's sim events (only for replays the player watches, not training samples). */
  playReplay(events: SimEvent[], width: number) {
    if (!this.enabled) return;
    for (const c of cuesForSimEvents(events, width)) this.play(c);
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
      // Render in a later task, so the click that unlocked audio stays snappy.
      this.rendering = new Promise<void>((done) => setTimeout(() => void this.renderAll().then(done), 0));
      this.applyMusic();
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
    if (DUCK.has(r.id)) this.duck();
    if (!this.played) {
      this.played = true;
      this.onFirstSound?.();
    }
  }

  /** One farm tick's effects. Farm sounds play on the Farm screen, or quieter elsewhere if the player asked. */
  playFarm(fx: FarmFx[], width: number, farmSpeed: number, onFarmScreen: boolean) {
    if (!this.enabled || !fx.length) return;
    if (!onFarmScreen && !this.settings.offScreen) return;
    const cues = cuesForFarmFx(fx, width);
    for (const c of cues) this.play(c, { farmSpeed, offScreen: !onFarmScreen });
    // The pet's own voice: a chirp (pitched per pet) when it picks something up or finishes a job.
    const happy = cues.find((c) => c.id === 'farm.pickup' || c.id === 'farm.celebrate');
    if (happy) this.play({ id: 'pet.chirp', pitch: this.petPitch, pan: happy.pan }, { farmSpeed, offScreen: !onFarmScreen });
  }

  private async renderAll() {
    const O = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
    if (!O) return;
    for (const id of Object.keys(KIT) as CueId[]) {
      try {
        const buf = await this.render(O, KIT[id]);
        this.buffers.set(id, buf);
        const hook = window.__penDeckAudio!;
        hook.rendered = this.buffers.size;
        if (peak(buf.getChannelData(0)) < 0.01) hook.quiet.push(id);
      } catch {
        // A cue that can't render stays silent; the game never depends on sound.
      }
    }
    for (const id of AMBIENCE) {
      try {
        const buf = await this.renderLoop(O, ambienceRecipe(id));
        const d = buf.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        window.__penDeckAudio!.loops[id] = Math.round(Math.sqrt(sum / d.length) * 10000) / 10000;
        this.startLoop(id, buf);
      } catch {
        // No ambience is fine.
      }
    }
  }

  private render(O: OfflineCtor, recipe: Recipe): Promise<AudioBuffer> {
    const len = Math.ceil(recipeLength(recipe) * RATE);
    const oc = new O(1, len, RATE);
    for (const v of recipe.voices) this.voice(oc, v);
    return oc.startRendering();
  }

  /** Render a loop with an overlap, then fold the overlap into the start so it repeats without a seam. */
  private async renderLoop(O: OfflineCtor, recipe: Recipe): Promise<AudioBuffer> {
    const L = Math.round(AMBIENCE_SECONDS * AMB_RATE);
    const X = Math.round(AMBIENCE_OVERLAP * AMB_RATE);
    const oc = new O(1, L + X, AMB_RATE);
    for (const v of recipe.voices) this.voice(oc, v);
    const full = (await oc.startRendering()).getChannelData(0);
    const out = this.ctx!.createBuffer(1, L, AMB_RATE);
    const d = out.getChannelData(0);
    d.set(full.subarray(0, L));
    for (let i = 0; i < X; i++) { const a = i / X; d[i] = full[i] * a + full[L + i] * (1 - a); }
    return out;
  }

  private startLoop(id: AmbienceId, buf: AudioBuffer) {
    if (!this.ctx || !this.out) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.out);
    src.start();
    this.amb.set(id, g);
    this.applyAmbience();
  }

  private voice(oc: OfflineAudioContext, v: Voice) {
    const end = v.at + v.dur;
    let src: AudioScheduledSourceNode;
    if (v.wave === 'noise') {
      if (!this.noise) {
        // 4.1 s of noise, made once and shared by every noise voice (AudioBuffers aren't tied to a context).
        // Long enough that looping it inside a 12 s ambience bed isn't heard as a pulse.
        const b = oc.createBuffer(1, Math.round(RATE * 4.1), RATE);
        const d = b.getChannelData(0);
        let seed = 1;
        for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
        this.noise = b;
      }
      const n = oc.createBufferSource();
      n.buffer = this.noise;
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
    if (v.release !== undefined) {
      // Beds: hold, then a short fade at the very end.
      g.gain.setValueAtTime(v.gain, Math.max(v.at + attack, end - v.release));
      g.gain.linearRampToValueAtTime(0, end);
    } else g.gain.exponentialRampToValueAtTime(0.0001, end);
    node.connect(g).connect(oc.destination);
    src.start(v.at);
    src.stop(end + 0.02);
  }

  /** Resolves when every cue is rendered (tests and the first-play path). */
  ready(): Promise<void> {
    return this.rendering ?? Promise.resolve();
  }
}

function peak(d: Float32Array): number {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  return m;
}

export const audio = new AudioEngine();
