import { migrateLegacyEndOutcomes } from '../domain/spec';
import { sanitizeAudio } from '../game/sound';
import type { GameState } from '../game/types';
import { SAVE_VERSION } from '../game/types';
import { newGame } from '../game/state';
import { jobPlan } from '../game/plan';
import { renameJob, renameOldCards } from '../domain/aliases';
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
  /**
   * v6 → v7 (farm layout): plots that waited for the old shop items ("Two more bushes", "Third carrot patch")
   * and were never bought are removed — you place plots yourself now. The orchard's fence and gate are marked fixed.
   */
  6: (g) => {
    const f = g.farm;
    const unlocks: string[] = Array.isArray(g.progress?.unlocks) ? g.progress.unlocks : [];
    if (isObj(f) && isObj(f.world) && Array.isArray(f.world.objects) && Array.isArray(f.plots)) {
      const gone = f.plots.filter((p: any) => isObj(p) && (p.unlock === 'bushes' || p.unlock === 'patch2') && !unlocks.includes(p.unlock));
      f.plots = f.plots.filter((p: any) => !gone.includes(p));
      f.world.objects = f.world.objects.filter((o: any) => !(isObj(o) && ['bush', 'patch', 'soil'].includes(o.kind) && gone.some((p: any) => p.x === o.x && p.y === o.y)));
      if (f.world.w >= 16) for (const o of f.world.objects) if (isObj(o) && ((o.kind === 'fence' && ((o.x === 12 && o.y <= 9) || (o.y === 9 && o.x >= 13))) || o.kind === 'gate')) o.fixed = true;
    }
    g.version = 7;
    return g;
  },
  /** v7 → v8 (pet roster): the second pet on duty becomes the first of up to 3 helpers; its body moves to `world.crew`. */
  7: (g) => {
    const f = g.farm;
    if (isObj(f)) {
      if (typeof f.duty2PetId === 'string' && f.duty2PetId && f.duty2PetId !== f.dutyPetId) {
        f.helpers = [{ petId: f.duty2PetId, current: f.current2 ?? null, stun: Number(f.stun2) || 0, queue: Array.isArray(f.queue2) ? f.queue2 : [], rngState: Number(f.rngState2 ?? 0x5ec0d) >>> 0 }];
        if (isObj(f.world) && isObj(f.world.pet2)) f.world.crew = [f.world.pet2];
      }
      for (const k of ['duty2PetId', 'current2', 'stun2', 'queue2', 'rngState2']) delete f[k];
      if (isObj(f.world)) delete f.world.pet2;
    }
    g.version = 8;
    return g;
  },
  /**
   * v8 → v9 (learned farm, phase 3): farm jobs no longer have built-in scripts — each runs a skill or routine the pet
   * learned. Jobs left half-run by the old scripts are cleared, the journal explains what changed, and the farm shows
   * a one-time notice (with a fresh-start option: playtesters were told saves may suffer).
   */
  8: (g) => {
    const f = g.farm;
    if (isObj(f)) {
      f.current = null;
      f.queue = [];
      if (Array.isArray(f.helpers)) for (const h of f.helpers) if (isObj(h)) { h.current = null; h.queue = []; }
    }
    // Old assignments and plans are dropped (roadmap §6): every pet goes back to Auto, which only uses learned jobs.
    if (Array.isArray(g.pets)) for (const p of g.pets) if (isObj(p)) {
      const nav = isObj(p.assignment) && p.assignment.navigator === 'Avoid' ? 'Avoid' : 'Approach';
      p.assignment = { mode: 'auto', job: 'forage', navigator: nav };
      delete p.plan;
    }
    if (isObj(g.progress)) {
      g.progress.flags = isObj(g.progress.flags) ? g.progress.flags : {};
      g.progress.flags.learnedFarmNotice = true;
    }
    if (Array.isArray(g.journal)) g.journal.unshift({
      id: `j-v9-${Date.now().toString(36)}`, at: Date.now(), petId: null, kind: 'learned-farm', milestone: true,
      text: 'The farm now runs only on what your pets have learned: Harvest, Plant, Basket runs and Mind the gate are skills and routines you teach in the pen (Haul uses Fetch). Start with the Guide’s “Teach a job: Harvest”.',
    });
    g.version = 9;
    return g;
  },
  /**
   * v9 → v10 (learned farm, phase 6): direct jobs are retired — a pet on one gets it as responsibilities (do it,
   * otherwise nap) and goes on Auto; plan mode is Auto; responsibilities that wandered are dropped (Wander is retired).
   */
  9: (g) => {
    if (Array.isArray(g.pets)) for (const p of g.pets) if (isObj(p) && isObj(p.assignment)) {
      const a = p.assignment;
      if (a.mode === 'job') {
        p.plan = jobPlan(renameJob(String(a.job)) as never, { skill: a.skillName, target: a.target, navigator: a.navigator });
        if (isObj(p.executive)) p.executive.mode = 'rules';
      }
      if (a.mode === 'job' || a.mode === 'plan') a.mode = 'auto';
      if (isObj(p.plan) && Array.isArray(p.plan.rows)) {
        p.plan.rows = p.plan.rows.filter((r: any) => !(isObj(r) && isObj(r.args) && isObj(r.args.do) && r.args.do.cardId === 'job.wander'));
        delete p.plan.table;
        if (p.plan.chooser === 'learned') p.plan.chooser = 'first';
      }
    }
    g.version = 10;
    return g;
  },
  /**
   * v10 → v11 (polish phase 3): internal names match the player's. Old card ids (job.forage, job.deliver, job.tote,
   * plan.row) and job ids (forage, deliver, tote) are renamed wherever they are stored, keeping key order; the
   * executive's 'rules' mode is 'order'; the retired bandit's table and the plan's chooser are dropped.
   */
  10: (g) => {
    renameOldCards(g);
    const rekey = <T,>(o: Record<string, T>, f: (k: string) => string): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));
    const lastPart = (k: string) => { const i = k.lastIndexOf('|'); return i < 0 ? renameJob(k) : k.slice(0, i + 1) + renameJob(k.slice(i + 1)); };
    const inv = (x: any) => { if (!isObj(x)) return; if (typeof x.behaviorId === 'string') x.behaviorId = renameJob(x.behaviorId); if (isObj(x.args) && typeof x.args.cap === 'string') x.args.cap = renameJob(x.args.cap); };
    if (Array.isArray(g.pets)) for (const p of g.pets) if (isObj(p)) {
      if (isObj(p.executive)) {
        if (p.executive.mode !== 'learned') p.executive.mode = 'order';
        delete p.executive.table;
        p.executive.decisions = Number(p.executive.decisions) || 0;
        const v = p.executive.values;
        if (isObj(v) && isObj(v.lower)) v.lower = rekey(v.lower, lastPart);
      }
      if (isObj(p.assignment)) {
        p.assignment.job = renameJob(String(p.assignment.job ?? 'harvest'));
        if (p.assignment.mode !== 'manual') p.assignment.mode = 'auto';
      }
      if (isObj(p.jobSkills)) p.jobSkills = rekey(p.jobSkills, renameJob);
      p.evidence = isObj(p.evidence) ? rekey(p.evidence, renameJob) : {};
      if (isObj(p.plan)) { delete p.plan.chooser; delete p.plan.table; }
    }
    if (isObj(g.farm)) {
      inv(g.farm.current);
      if (Array.isArray(g.farm.queue)) g.farm.queue.forEach(inv);
      if (Array.isArray(g.farm.helpers)) for (const h of g.farm.helpers) if (isObj(h)) { inv(h.current); if (Array.isArray(h.queue)) h.queue.forEach(inv); }
    }
    g.version = 11;
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
