import { describe, expect, it } from 'vitest';
import { CUES, CueLimiter, DEFAULT_AUDIO, SILENT_FX, cueGain, cuesForFarmFx, sanitizeAudio, type CueId } from '../src/game/sound';
import { KIT, recipeLength } from '../src/audio/kit';
import type { FarmFx } from '../src/game/farm';
import { createRuntime, farmTick } from '../src/game/farm';
import { newGame } from '../src/game/state';
import { adoptPet } from '../src/game/pets';
import { parseGame, serializeGame } from '../src/persistence/save';
import { recipeStage, trainAndSave } from './helpers';

const FX_TYPES: FarmFx['type'][] = ['coin', 'splash', 'pickup', 'drop', 'celebrate', 'confused', 'nap', 'bump'];
const isSilent = (f: FarmFx) => SILENT_FX.has(f.type) || (!!f.text && SILENT_FX.has(`${f.type}:${f.text}`));

describe('sound cues', () => {
  it('every farm effect type either makes a sound or is silent on purpose', () => {
    for (const type of FX_TYPES) {
      const f: FarmFx = { type, x: 3, y: 3, amount: 1 };
      expect(isSilent(f) || cuesForFarmFx([f], 12).length === 1, type).toBe(true);
    }
  });

  it('a real farm run only produces effects the mapping knows about', () => {
    const s = newGame();
    const p = adoptPet(s, 'Pip', 'meadow');
    trainAndSave(s, p, recipeStage('go-to-berry'));
    const rt = createRuntime(s.farm);
    const seen = new Set<string>();
    let cues = 0;
    for (let i = 0; i < 1500; i++) {
      const r = farmTick(s, rt);
      for (const f of r.fx) {
        seen.add(f.type);
        expect(FX_TYPES).toContain(f.type);
      }
      cues += cuesForFarmFx(r.fx, s.farm.world.w).length;
    }
    expect(seen.has('coin') && seen.has('pickup')).toBe(true);
    expect(cues).toBeGreaterThan(10);
  });

  it('maps pickups, splashes and bumps; coins in one tick merge into one brighter chime', () => {
    const fx: FarmFx[] = [
      { type: 'pickup', x: 0, y: 1, text: 'carrot' },
      { type: 'splash', x: 11, y: 1 },
      { type: 'bump', x: 5, y: 1 },
      { type: 'coin', x: 4, y: 1, amount: 2 },
      { type: 'coin', x: 4, y: 1, amount: 1 },
      { type: 'pickup', x: 2, y: 2, text: 'egg' }, // an egg being laid: phase B
      { type: 'splash', x: 2, y: 2, text: 'rain' }, // rain: phase B ambience
      { type: 'drop', x: 2, y: 2 },
    ];
    const c = cuesForFarmFx(fx, 12);
    expect(c.map((x) => x.id)).toEqual(['farm.pickup', 'farm.splash', 'farm.bump', 'farm.coin']);
    expect(c[0].pitch).toBeLessThan(1); // carrots sound a little lower than berries
    expect(c[0].pan).toBe(-0.4);
    expect(c[1].pan).toBe(0.4);
    expect(c[3].pitch).toBeGreaterThan(1.1); // 3 coins at once
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
