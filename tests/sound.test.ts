import { describe, expect, it } from 'vitest';
import { CUES, CueLimiter, musicBar, trainTickCrossed, voicePitch, DEFAULT_AUDIO, SILENT_EVENTS, SILENT_FX, ambienceMix, cueForFx, cueGain, cuesForFarmFx, cuesForSimEvents, sanitizeAudio, type CueId } from '../src/game/sound';
import type { SimEvent, SimEventType } from '../src/sim/world';
import { AMBIENCE_OVERLAP, AMBIENCE_SECONDS, KIT, ambienceRecipe, recipeLength } from '../src/audio/kit';
import type { FarmFx } from '../src/game/farm';
import { DAY_TICKS, createRuntime, farmTick } from '../src/game/farm';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { parseGame, serializeGame } from '../src/persistence/save';
import { recipeStage, trainAndSave, giveFarmJobs } from './helpers';

const FX_TYPES: FarmFx['type'][] = ['coin', 'splash', 'pickup', 'drop', 'celebrate', 'confused', 'nap', 'bump', 'sound'];
const isSilent = (f: FarmFx) => SILENT_FX.has(f.type) || (!!f.text && SILENT_FX.has(`${f.type}:${f.text}`));
// Every tag the farm attaches to an effect (src/game/farm.ts).
const FX_SAMPLES: FarmFx[] = [
  ...FX_TYPES.filter((t) => t !== 'sound').map((type) => ({ type, x: 3, y: 3, amount: 1 })),
  ...['rain'].map((text) => ({ type: 'splash' as const, x: 1, y: 1, text })),
  ...['egg'].map((text) => ({ type: 'pickup' as const, x: 1, y: 1, text })),
  ...['watered', 'filled', 'gate open', 'gate shut', 'stored'].map((text) => ({ type: 'drop' as const, x: 1, y: 1, text })),
  ...['shoo!'].map((text) => ({ type: 'celebrate' as const, x: 1, y: 1, text })),
  ...['pecked', 'timed out', 'full'].map((text) => ({ type: 'confused' as const, x: 1, y: 1, text })),
  ...['night'].map((text) => ({ type: 'nap' as const, x: 1, y: 1, text })),
  ...['shoo', 'firefly', 'crow', 'dawn', 'dusk'].map((text) => ({ type: 'sound' as const, x: 1, y: 1, text })),
];
const SIM_EVENTS: SimEventType[] = ['tick', 'move', 'bump', 'reach', 'enter', 'pickup', 'drop', 'deliver', 'fumble', 'stay', 'fill', 'water', 'shoo', 'scare', 'peck', 'enterArea', 'leaveArea', 'gate', 'full', 'plant', 'lift', 'empty'];

describe('sound cues', () => {
  it('every farm effect (and every tag on one) either makes a sound or is silent on purpose', () => {
    for (const f of FX_SAMPLES) expect(isSilent(f) || cueForFx(f) !== null, `${f.type}:${f.text ?? ''}`).toBe(true);
    // Phase B gave the tagged moments their own sounds.
    const id = (type: FarmFx['type'], text?: string) => cueForFx({ type, x: 0, y: 0, text });
    expect([id('drop', 'watered'), id('drop', 'filled'), id('drop', 'gate open'), id('drop', 'gate shut'), id('drop')])
      .toEqual(['farm.water', 'farm.fill', 'farm.gateOpen', 'farm.gateShut', 'farm.drop']);
    expect([id('celebrate', 'shoo!'), id('celebrate'), id('confused', 'pecked'), id('confused'), id('pickup', 'egg')])
      .toEqual(['farm.scare', 'farm.celebrate', 'farm.peck', 'farm.confused', 'farm.egg']);
    expect([id('sound', 'shoo'), id('sound', 'firefly'), id('sound', 'crow'), id('sound', 'dawn'), id('sound', 'dusk')])
      .toEqual(['farm.shoo', 'farm.firefly', 'farm.crow', 'world.dawn', 'world.dusk']);
    // A nap starting sighs; dusk has its own cue and rain is carried by the ambience.
    expect([id('nap'), id('nap', 'night'), id('splash', 'rain')]).toEqual(['pet.sigh', null, null]);
  });

  it('a real farm run (with a night) only produces effects the mapping knows about, including dusk and dawn', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    trainAndSave(s, p, recipeStage('go-to-berry'));
    giveFarmJobs(s, p);
    const rt = createRuntime(s.farm);
    const seen = new Set<string>();
    let cues = 0;
    for (let i = 0; i < DAY_TICKS + 50; i++) {
      const r = farmTick(s, rt);
      for (const f of r.fx) {
        seen.add(f.text ? `${f.type}:${f.text}` : f.type);
        expect(FX_TYPES).toContain(f.type);
        expect(isSilent(f) || cueForFx(f) !== null, `${f.type}:${f.text}`).toBe(true);
      }
      cues += cuesForFarmFx(r.fx, s.farm.world.w).length;
    }
    expect([...seen]).toEqual(expect.arrayContaining(['coin', 'pickup', 'sound:dusk', 'sound:dawn']));
    expect(cues).toBeGreaterThan(10);
  });

  it('maps farm effects with stereo position; coins in one tick merge into one brighter chime', () => {
    const fx: FarmFx[] = [
      { type: 'pickup', x: 0, y: 1, text: 'carrot' },
      { type: 'splash', x: 11, y: 1 },
      { type: 'bump', x: 5, y: 1 },
      { type: 'coin', x: 4, y: 1, amount: 2 },
      { type: 'coin', x: 4, y: 1, amount: 1 },
      { type: 'pickup', x: 2, y: 2, text: 'egg' },
      { type: 'splash', x: 2, y: 2, text: 'rain' },
      { type: 'nap', x: 2, y: 2 },
    ];
    const c = cuesForFarmFx(fx, 12);
    expect(c.map((x) => x.id)).toEqual(['farm.pickup', 'farm.splash', 'farm.bump', 'farm.egg', 'pet.sigh', 'farm.coin']);
    expect(c[0].pitch).toBeLessThan(1); // carrots sound a little lower than berries
    expect(c[0].pan).toBe(-0.4);
    expect(c[1].pan).toBe(0.4);
    expect(c[5].pitch).toBeGreaterThan(1.1); // 3 coins at once
  });

  it('replays: every sim event either has a sound or is silent on purpose, and they match the farm', () => {
    for (const type of SIM_EVENTS) {
      const e: SimEvent = { type, x: 2, y: 2, state: 'open' };
      expect(SILENT_EVENTS.has(type) || cuesForSimEvents([e], 8).length === 1, type).toBe(true);
    }
    const ids = (events: SimEvent[]) => cuesForSimEvents(events, 8).map((c) => c.id);
    expect(ids([{ type: 'enter', x: 1, y: 1 }, { type: 'bump', x: 1, y: 1 }, { type: 'pickup', x: 1, y: 1, kind: 'carrot' }, { type: 'deliver', x: 1, y: 1 }]))
      .toEqual(['farm.splash', 'farm.bump', 'farm.pickup', 'farm.deliver']);
    expect(ids([{ type: 'gate', x: 1, y: 1, state: 'closed' }, { type: 'move', x: 1, y: 1 }, { type: 'tick', x: 1, y: 1 }])).toEqual(['farm.gateShut']);
  });

  it('ambience: day birds, night crickets and rain layer the way the farm looks', () => {
    expect(ambienceMix({ night: false, raining: false })).toEqual({ day: 1, night: 0, rain: 0 });
    expect(ambienceMix({ night: true, raining: false })).toEqual({ day: 0, night: 1, rain: 0 });
    expect(ambienceMix({ night: false, raining: true })).toEqual({ day: 0.3, night: 0, rain: 1 });
    for (const id of ['day', 'night', 'rain'] as const) {
      const r = ambienceRecipe(id);
      expect(r).toEqual(ambienceRecipe(id)); // seeded: the same loop everywhere
      expect(r.voices.length).toBeGreaterThan(5);
      for (const v of r.voices) {
        expect(v.at + v.dur).toBeLessThanOrEqual(AMBIENCE_SECONDS + AMBIENCE_OVERLAP + 1e-9);
        expect(v.gain).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('limiter: per-cue cooldown, voice cap, deterministic with a fake clock', () => {
    const l = new CueLimiter(2);
    expect(l.allow('farm.pickup', 0)).toBe(true);
    expect(l.allow('farm.pickup', 50)).toBe(false); // within the 120 ms cooldown
    expect(l.allow('farm.pickup', 130)).toBe(true);
    expect(l.allow('farm.coin', 130)).toBe(true);
    expect(l.allow('farm.splash', 131)).toBe(false); // both voices are still sounding
    expect(l.allow('farm.splash', 400)).toBe(true); // they have finished
    // Same calls, same answers.
    const a = new CueLimiter(8), b = new CueLimiter(8);
    const seq: [CueId, number][] = [['farm.bump', 0], ['farm.bump', 100], ['farm.bump', 260], ['card.snap', 261], ['card.snap', 300]];
    expect(seq.map(([id, t]) => a.allow(id, t))).toEqual(seq.map(([id, t]) => b.allow(id, t)));
  });

  it('at 4× farm speed a burst of pickups stays sparse (at most one per cooldown)', () => {
    const l = new CueLimiter(8);
    let played = 0;
    for (let t = 0; t < 1000; t += 20) if (l.allow('farm.pickup', t, 4)) played++;
    expect(played).toBeLessThanOrEqual(Math.ceil(1000 / CUES['farm.pickup'].cooldownMs));
  });

  it('every cue has a recipe that fits its declared length, with gentle levels', () => {
    for (const id of Object.keys(CUES) as CueId[]) {
      const r = KIT[id];
      expect(r, id).toBeDefined();
      expect(r.voices.length).toBeGreaterThan(0);
      for (const v of r.voices) {
        expect(v.dur).toBeGreaterThan(0);
        expect(v.gain).toBeGreaterThan(0);
        expect(v.gain).toBeLessThanOrEqual(0.4);
        for (const f of [...(v.freq ?? []), ...(v.filter?.freq ?? [])]) expect(f >= 20 && f <= 20000, `${id} ${f}`).toBe(true);
      }
      expect(recipeLength(r) * 1000, id).toBeLessThanOrEqual(CUES[id].durationMs + 120);
    }
    expect(Object.keys(KIT).sort()).toEqual(Object.keys(CUES).sort());
  });
});

describe('sound settings', () => {
  it('new games have sound on with the default mix', () => {
    const g = newGame();
    expect(g.settings.sound).toBe(true);
    expect(g.settings.audio).toEqual(DEFAULT_AUDIO);
  });

  it('older saves (sound never offered) start with sound on; volumes are clamped; a chosen “off” is kept', () => {
    const old = JSON.parse(serializeGame(newGame()));
    old.game.settings.sound = false;
    delete old.game.settings.audio;
    const r = parseGame(JSON.stringify(old));
    expect(r.ok).toBe(true);
    expect(r.game!.settings.sound).toBe(true);
    expect(r.game!.settings.audio).toEqual(DEFAULT_AUDIO);

    const chosen = JSON.parse(serializeGame(newGame()));
    chosen.game.settings.sound = false;
    chosen.game.settings.audio = { master: 7, effects: -1, ui: 'loud', musicOn: 'yes', hintShown: true };
    const r2 = parseGame(JSON.stringify(chosen));
    expect(r2.game!.settings.sound).toBe(false);
    expect(r2.game!.settings.audio).toMatchObject({ master: 1, effects: 0, ui: DEFAULT_AUDIO.ui, musicOn: false, hintShown: true });
  });

  it('sanitizes garbage and computes bus gains (off = silent, other screens = half)', () => {
    expect(sanitizeAudio(null)).toEqual(DEFAULT_AUDIO);
    const a = { ...DEFAULT_AUDIO, master: 0.5, effects: 0.8, ui: 0.4 };
    expect(cueGain(false, a, 'effects')).toBe(0);
    expect(cueGain(true, a, 'effects')).toBeCloseTo(0.4);
    expect(cueGain(true, a, 'ui')).toBeCloseTo(0.2);
    expect(cueGain(true, a, 'effects', true)).toBeCloseTo(0.2);
  });
});

describe('sound phase C: voices, ticks, music box', () => {
  it('each pet has a stable voice, and different pets usually sound different', () => {
    expect(voicePitch('Pip', 'meadow')).toBe(voicePitch('Pip', 'meadow'));
    const pitches = ['Pip', 'Mochi', 'Bean', 'Juniper', 'Tofu', 'Clover'].map((n) => voicePitch(n, 'meadow'));
    for (const p of pitches) expect(p >= 0.82 && p <= 1.25).toBe(true);
    expect(new Set(pitches).size).toBeGreaterThanOrEqual(5);
    expect(voicePitch('Pip', 'plum')).not.toBe(voicePitch('Pip', 'meadow'));
  });

  it('training ticks fire once as practice crosses 25%, 50% and 75%', () => {
    let ticks = 0, prev = 0;
    for (let e = 0; e <= 1500; e += 37) { const now = e / 1500; if (trainTickCrossed(prev, now)) ticks++; prev = now; }
    expect(ticks).toBe(3);
  });

  it('the music box is reproducible, pentatonic and gentle: night sparser than day', () => {
    expect(musicBar('day', 7)).toEqual(musicBar('day', 7));
    const pent = new Set([0, 2, 4, 7, 9]); // C major pentatonic = A minor pentatonic, as pitch classes
    const count = (mood: 'day' | 'night' | 'pen') => { let n = 0; for (let b = 0; b < 200; b++) { for (const x of musicBar(mood, b)) { expect(pent.has(((x.midi % 12) + 12) % 12)).toBe(true); expect(x.beat >= 0 && x.beat < 4).toBe(true); expect(x.gain).toBeLessThanOrEqual(1); } n += musicBar(mood, b).length; } return n; };
    const day = count('day'), night = count('night'), pen = count('pen');
    expect(night).toBeLessThan(pen);
    expect(pen).toBeLessThan(day);
    expect(new Set(Array.from({ length: 50 }, (_, b) => JSON.stringify(musicBar('day', b)))).size).toBeGreaterThan(40); // rarely repeats
  });
});
