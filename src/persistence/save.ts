import { migrateLegacyEndOutcomes } from '../domain/spec';
import { sanitizeAudio } from '../game/sound';
import type { GameState } from '../game/types';
import { SAVE_VERSION } from '../game/types';
import { newGame } from '../game/state';
import { REGISTRY } from '../domain/registry';
import { stageRoots, walk } from '../domain/spec';
import type { SpecNode } from '../domain/types';
import { presetSenses } from '../learning/senses';

export interface SaveEnvelope {
  format: 'pen-deck-save';
  version: number;
  exportedAt: number;
  game: GameState;
}

export interface LoadResult {
  ok: boolean;
  game?: GameState;
  diagnostics: string[];
}

export function serializeGame(g: GameState): string {
  const env: SaveEnvelope = { format: 'pen-deck-save', version: SAVE_VERSION, exportedAt: Date.now(), game: g };
  return JSON.stringify(env);
}

type Migration = (g: any) => any;
/** version N → N+1 migrations. Add new entries here; never edit old ones. */
const MIGRATIONS: Record<number, Migration> = {
  /** v1 → v2: learner templates + explicit senses; skills record their template; pets can stay still. */
  1: (g) => {
    for (const st of Array.isArray(g.stages) ? g.stages : []) {
      if (!isObj(st?.learner)) continue;
      st.learner.template ??= st.learner.skill === 'Fetch' ? 'fetch' : 'sense';
      if (st.learner.template === 'sense' && !Array.isArray(st.learner.senses)) st.learner.senses = presetSenses();
    }
    for (const p of Array.isArray(g.pets) ? g.pets : []) {
      for (const k of Array.isArray(p?.skills) ? p.skills : []) k.template ??= k.name === 'Fetch' ? 'fetch' : 'sense';
    }
    if (isObj(g.farm?.world?.pet)) g.farm.world.pet.still ??= 0;
    g.version = 2;
    return g;
  },
  /** v2 → v3: the farm gets a well (watering) and a clock-driven night flag. */
  2: (g) => {
    const w = g.farm?.world;
    if (isObj(w) && Array.isArray(w.objects) && !w.objects.some((o: any) => o?.kind === 'well')) {
      const taken = (x: number, y: number) => w.objects.some((o: any) => o?.x === x && o?.y === y && !o.carried && !o.delivered) || (w.pet?.x === x && w.pet?.y === y);
      let spot: [number, number] | null = taken(3, 1) ? null : [3, 1];
      for (let y = 0; !spot && y < w.h; y++) for (let x = 0; !spot && x < w.w; x++) if (!taken(x, y)) spot = [x, y];
      if (spot) w.objects.push({ id: w.nextId++, kind: 'well', x: spot[0], y: spot[1], carried: false, delivered: false });
    }
    g.version = 3;
    return g;
  },
  /** v3 → v4: the farm gets a coop area and a creature PRNG. */
  3: (g) => {
    const w = g.farm?.world;
    if (isObj(w)) {
      if (!Array.isArray(w.areas)) w.areas = [{ name: 'coop', x: 0, y: 5, w: 2, h: 2 }];
      w.rng ??= 0xfa53;
    }
    g.version = 4;
    return g;
  },
  /** v5 → v6 (farm life): the farm's bin becomes a basket that stores 6 of one kind; produce sells at the house. */
  5: (g) => {
    const w = g.farm?.world;
    if (isObj(w) && Array.isArray(w.objects)) {
      for (const o of w.objects) if (isObj(o) && o.kind === 'bin' && !Array.isArray(o.store)) o.store = [{ kind: null, n: 0 }];
      w.sold ??= 0;
    }
    g.version = 6;
    return g;
  },
  /** v4 → v5: "End try (done ✓)" meant "SUCCESS decides"; it is now spelled 'judge' ('success' counts outright). */
  4: (g) => {
    migrateLegacyEndOutcomes(g);
    g.version = 5;
    return g;
  },
};

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Parse and sanitise a save. Unknown fields are preserved (round-trip), unknown card ids
 * are reported with a diagnostic (never silently dropped), and no code is ever executed.
 */
export function parseGame(text: string): LoadResult {
  const diagnostics: string[] = [];
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, diagnostics: ['This file is not valid JSON.'] };
  }
  if (!isObj(raw) || raw.format !== 'pen-deck-save' || !isObj(raw.game)) return { ok: false, diagnostics: ['This is not a Pen Deck save file.'] };
  let g: any = raw.game;
  let v = Number(g.version) || 1;
  if (v > SAVE_VERSION) return { ok: false, diagnostics: [`This save is from a newer version (v${v}). Please update the game.`] };
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return { ok: false, diagnostics: [`No migration from save v${v}.`] };
    g = m(g);
    v++;
    diagnostics.push(`Migrated save to v${v}.`);
  }
  // Fill missing top-level sections from a fresh game; keep everything else (including unknown keys).
  const base = newGame();
  for (const k of Object.keys(base) as (keyof GameState)[]) {
    if (g[k] === undefined) {
      g[k] = base[k];
      diagnostics.push(`Missing “${k}” — using defaults.`);
    }
  }
  const required: [string, (x: any) => boolean][] = [
    ['pets', Array.isArray], ['stages', Array.isArray], ['journal', Array.isArray], ['templates', Array.isArray],
    ['resources', isObj], ['progress', isObj], ['farm', isObj], ['settings', isObj],
  ];
  for (const [k, ok] of required) if (!ok(g[k])) return { ok: false, diagnostics: [...diagnostics, `Save field “${k}” is malformed.`] };
  // Sound settings (added after save v4; additive, so no version bump). Older saves stored `sound: false` only
  // because the option was never shown, so they start with sound on, like new games.
  if (!isObj(g.settings.audio)) g.settings.sound = true;
  g.settings.sound = g.settings.sound !== false;
  g.settings.audio = sanitizeAudio(g.settings.audio);
  for (const key of ['coins', 'berries', 'carrots', 'fireflies', 'eggs']) {
    if ((key === 'fireflies' || key === 'eggs') && g.resources[key] === undefined) continue;
    const n = Number(g.resources[key]);
    g.resources[key] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (!isObj(g.farm.world) || !Array.isArray(g.farm.world.objects)) return { ok: false, diagnostics: [...diagnostics, 'Farm world is malformed.'] };
  for (const p of g.pets) {
    if (!isObj(p) || typeof p.id !== 'string' || !Array.isArray(p.skills)) return { ok: false, diagnostics: [...diagnostics, 'A pet entry is malformed.'] };
    p.name = String(p.name ?? 'Pet').slice(0, 20);
    p.energy = clamp(Number(p.energy), 0, 100, 100);
    p.mood = clamp(Number(p.mood), 0, 100, 60);
    for (const k of p.skills) {
      if (!Array.isArray(k.revisions)) return { ok: false, diagnostics: [...diagnostics, `Skill ${k.name} is malformed.`] };
      for (const r of k.revisions) if (!isObj(r.policy) || r.policy.format !== 'double-q/v1') return { ok: false, diagnostics: [...diagnostics, `Skill ${k.name} r${r.rev} has an unknown policy format.`] };
    }
  }
  for (const s of g.stages) {
    if (!isObj(s) || !Array.isArray(s.environment) || !Array.isArray(s.rules)) return { ok: false, diagnostics: [...diagnostics, 'A stage is malformed.'] };
    for (const root of stageRoots(s as any)) {
      walk(root as SpecNode, (n) => {
        if (!REGISTRY.cards.has(n.cardId)) diagnostics.push(`Stage “${s.name}”: unknown card “${n.cardId}” kept but disabled (from a newer or missing pack).`);
      });
    }
  }
  g.version = SAVE_VERSION;
  return { ok: true, game: g as GameState, diagnostics };
}

function clamp(x: number, lo: number, hi: number, d: number): number {
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
}
