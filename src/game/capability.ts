import type { GameState, Pet, Skill, SkillRevision } from './types';
import { activeRevision, deployExplore, getSkill, isCertified, navPolicyFor, routineRunFor, sensePolicyOf, staleUses } from './pets';
import { FetchController, FetchRun, SkillRun, type ExecStep, type NoteRunner } from '../learning/policies';
import { compileCondition, compileStage, withTarget } from '../sim/compile';
import { TRAIT_AIMS, nearest, def, type SimEvent, type Tally, type World } from '../sim/world';
import { walk } from '../domain/spec';
import type { SpecNode, StageSpec } from '../domain/types';
import type { Rng } from '../sim/rng';
import { navTimeout } from '../learning/episodes';

/**
 * Capabilities (learned-farm roadmap, phase 1): a saved skill or routine plus what it's aimed at. Every learned
 * behaviour on the farm — a job the player assigns, a plan row, later a responsibility or the executive — starts
 * through `runCapability`, and ends with one outcome (success, failure, timeout, interrupted, cancelled).
 */
export interface Capability {
  skillId: string;
  name: string;
  kind: 'skill' | 'routine' | 'fetch';
  /** The revision that runs: the pinned one if set (and still has its table), else the active one. */
  rev: number;
  pinned: boolean;
  /** A kind ("berry") or a trait aim ("@crop", "@storage"). */
  aim: string;
  certified: boolean;
  /** May the farm use it without being told? Certified ones by default; others when the player opts in. */
  allowed: boolean;
}

export type IneligibleReason = 'missing_skill' | 'not_allowed' | 'no_target' | 'stale_dependency' | 'hands_full' | 'too_tired';
export type Eligibility = { ok: true; warnings: string[] } | { ok: false; reason: IneligibleReason; text: string };

export interface CapabilityRunner {
  next(w: World): ExecStep;
  /** After each farm step (skills that write notes keep writing them). */
  observe?(w: World, prev: { x: number; y: number }, events: SimEvent[]): void;
}

/** The revision a skill runs with: its pin (if the table is still kept), else the active revision. */
export function deployedRevision(k: Skill | null): SkillRevision | null {
  if (!k) return null;
  if (k.pinnedRev !== undefined) {
    const r = k.revisions.find((x) => x.rev === k.pinnedRev && !x.tableDropped);
    if (r) return r;
  }
  return activeRevision(k);
}

export function kindOfSkill(k: Skill): Capability['kind'] {
  const t = k.template ?? (k.name === 'Fetch' ? 'fetch' : 'sense');
  return t === 'routine' || k.kind === 'routine' ? 'routine' : t === 'fetch' ? 'fetch' : 'skill';
}

/** May the farm use this skill on its own? Certified: yes unless switched off; uncertified: only if opted in. */
export function allowedOnFarm(k: Skill): boolean {
  return k.farmUse === 'on' || (k.farmUse !== 'off' && isCertified(k));
}

/** What a skill is aimed at unless told otherwise. */
export function defaultAim(k: Skill): string {
  const r = deployedRevision(k);
  return r?.focus ?? r?.stage?.learner.focus ?? (k.name === 'Fetch' ? 'berry' : 'berry');
}

export function capabilityOf(k: Skill, aim?: string): Capability | null {
  const r = deployedRevision(k);
  if (!r) return null;
  return { skillId: k.id, name: k.name, kind: kindOfSkill(k), rev: r.rev, pinned: k.pinnedRev !== undefined && r.rev === k.pinnedRev, aim: aim || defaultAim(k), certified: isCertified(k), allowed: allowedOnFarm(k) };
}

/** Every capability the pet has (one per skill or routine, at its default aim). */
export function capabilitiesOf(p: Pet): Capability[] {
  return p.skills.map((k) => capabilityOf(k)).filter((c): c is Capability => !!c);
}

/** A human name for an aim. */
export function aimLabel(aim: string): string {
  return TRAIT_AIMS[aim] ?? def(aim).name ?? aim;
}

/**
 * Can this capability run now, and if not, why? `forFarm` also applies the farm's opt-in (a job the player assigns
 * directly may run an uncertified skill: the player asked for it).
 */
export function eligibility(s: GameState, p: Pet, cap: Capability, opts: { forFarm?: boolean; tired?: number } = {}, w: World = s.farm.world): Eligibility {
  const k = getSkill(p, cap.name);
  const r = deployedRevision(k);
  if (!k || !r) return { ok: false, reason: 'missing_skill', text: `${p.name} hasn’t learned ${cap.name}.` };
  if (opts.forFarm && !cap.allowed) return { ok: false, reason: 'not_allowed', text: `${cap.name} isn’t certified — allow it on the farm in Pets to use it anyway.` };
  if (opts.tired !== undefined && p.energy < opts.tired) return { ok: false, reason: 'too_tired', text: `${p.name} is too tired.` };
  if (cap.kind !== 'routine' && !nearest(w, cap.aim)) return { ok: false, reason: 'no_target', text: `Nothing to aim ${cap.name} at (${aimLabel(cap.aim)}).` };
  const held = w.pet.carrying !== null ? w.objects.find((o) => o.id === w.pet.carrying) : undefined;
  if (held && cap.kind === 'skill' && !(r.learner?.actions ?? []).includes('drop')) return { ok: false, reason: 'hands_full', text: `${p.name}’s paws are full, and ${cap.name} can’t put things down.` };
  const stale = staleUses(p, r);
  const warnings = stale.length ? [`${cap.name} was certified with ${stale.map((u) => `${u.skill} r${u.trained}`).join(', ')}; now ${stale.map((u) => `r${u.now ?? '–'}`).join(', ')}.`] : [];
  return { ok: true, warnings };
}

/** A skill's note-writing rules, compiled for the farm (aimed at `target`), or null if it writes none. */
export function noteRunnerFor(stage: StageSpec | undefined, target: string): NoteRunner | null {
  if (!stage) return null;
  const writes = (r: SpecNode) => { let found = false; walk(r, (x) => { if (x.cardId === 'eff.note') found = true; }); return found; };
  const rules = stage.rules.filter((r) => r.args.off !== 1 && writes(r));
  if (!rules.length) return null;
  return compileStage({ ...stage, rules, learner: { ...stage.learner, focus: target } });
}

/**
 * A run's goal is judged from when the run started: deliveries counted before it began don't count for it (the
 * farm's totals keep growing all day; a pen starts from zero every try).
 */
export function sinceStart(w: World, cond: (ctx: { w: World; prev: World['pet']; base?: Tally }) => boolean): (world: World, base?: Tally) => boolean {
  const before = { ...w.delivered };
  const soldBefore = { ...(w.soldKinds ?? {}) };
  return (world, base) => {
    const delivered: Record<string, number> = {};
    for (const [k, v] of Object.entries(world.delivered)) delivered[k] = v - (before[k] ?? 0);
    const soldKinds: Record<string, number> = {};
    for (const [k, v] of Object.entries(world.soldKinds ?? {})) soldKinds[k] = v - (soldBefore[k] ?? 0);
    return cond({ w: { ...world, delivered, soldKinds }, prev: world.pet, base });
  };
}

/** Start a capability: one runtime for skills, Fetch and routines. */
export interface RunOptions {
  /** The job's own idea of done (replaces the skill's goal), e.g. a Basket run is done once the basket is set down. */
  goal?: (w: World) => boolean;
  /** Fetch: where to deliver, and how to count deliveries (the farm's Haul counts sales at the house). */
  dest?: string;
  count?: (w: World) => number;
}

export function runCapability(s: GameState, p: Pet, name: string, aim: string | undefined, rng: Rng, timeout: number, opts: RunOptions = {}): CapabilityRunner {
  const k = getSkill(p, name);
  const rev = deployedRevision(k);
  const missing = (reason: string): CapabilityRunner => ({ next: () => ({ done: 'fail', reason }) });
  if (!k || !rev) return missing('skill missing');
  const kind = kindOfSkill(k);
  const target = aim || defaultAim(k);
  if (kind === 'routine') return routineRunFor(p, rev, target, rng, timeout, s.farm.world, opts.goal) ?? missing('routine missing');
  if (kind === 'fetch') {
    const w = s.farm.world;
    const nav = navPolicyFor(p, k.navigator ?? 'Approach');
    const ctrl = FetchController.from(rev.policy) ?? new FetchController();
    const dest = opts.dest ?? rev.stage?.learner.destination ?? 'home';
    return new FetchRun(ctrl, nav ? sensePolicyOf(nav.rev) : null, target, dest, navTimeout(w.w, w.h, p.traits.persistence), timeout, rng, opts.count ? opts.count(w) : w.delivered[target] ?? 0, opts.count);
  }
  const policy = sensePolicyOf(rev);
  if (!policy) return missing('skill missing');
  const survive = rev.outcome === 'survive';
  const goal = rev.success && !survive ? withTarget(target, () => compileCondition(rev.success!)) : null;
  const failNode = rev.stage?.fail ?? null;
  const fail = survive && failNode ? withTarget(target, () => compileCondition(failNode)) : null;
  return new SkillRun(policy, target, timeout, opts.goal ? (world) => opts.goal!(world) : goal ? sinceStart(s.farm.world, goal) : null, noteRunnerFor(rev.stage, target), survive ? (world) => !fail?.({ w: world, prev: world.pet }) : null, { eps: deployExplore(p), rng });
}

/**
 * Farm jobs done by learned skills (learned-farm roadmap, phase 3). A job is *bound* to one of the pet's skills or
 * routines: the player's choice (`Pet.jobSkills`), else the one taught by the job's recipe or named after it. A job
 * with no bound skill can't run — there is no scripted fallback.
 */
export interface LearnedJob {
  label: string;
  /** Recipes that teach a skill for this job, preferred first. */
  recipes: string[];
  aim: string;
  /** Names a skill for this job may have (besides being taught by one of the recipes). */
  names: string[];
}
export const LEARNED_JOBS: Record<string, LearnedJob> = {
  forage: { label: 'Harvest', recipes: ['harvest-store', 'harvest'], aim: '@crop', names: ['Harvest to storage', 'Harvest'] },
  deliver: { label: 'Haul', recipes: ['bring-it-home'], aim: 'bin', names: ['Fetch'] },
  tote: { label: 'Basket run', recipes: ['basket-run'], aim: 'bin', names: ['Basket run'] },
  plant: { label: 'Plant', recipes: ['plant'], aim: 'soil', names: ['Plant'] },
  gateOpen: { label: 'Open the gate', recipes: ['open-gate'], aim: 'gate', names: ['Open the gate'] },
  gateShut: { label: 'Shut the gate', recipes: ['shut-gate'], aim: 'gate', names: ['Shut the gate'] },
};

/** Which recipe (if any) taught this skill's deployed revision, or which of the job's names it has. */
function servesJob(k: Skill, spec: LearnedJob): number {
  const r = deployedRevision(k);
  if (!r) return -1;
  const byRecipe = spec.recipes.indexOf(r.stage?.recipeId ?? '');
  if (byRecipe >= 0) return byRecipe;
  const byName = spec.names.findIndex((x) => x.toLowerCase() === k.name.toLowerCase());
  return byName >= 0 ? byName : -1;
}

/** Every skill of the pet that can do a job (the player's pick alone, if they made one), preferred first. */
export function jobSkills(p: Pet, job: string): Skill[] {
  const spec = LEARNED_JOBS[job];
  if (!spec) return [];
  const chosen = p.jobSkills?.[job];
  if (chosen) { const k = getSkill(p, chosen); return k && deployedRevision(k) ? [k] : []; }
  return p.skills.map((k) => ({ k, i: servesJob(k, spec) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.k);
}

export function jobSkill(p: Pet, job: string): Skill | null {
  return jobSkills(p, job)[0] ?? null;
}

/**
 * The learned capability that does a farm job, if the pet has one the farm may use. Harvest has two forms: into
 * storage (when there's storage with room and someone on the farm can empty it) or straight to the house.
 */
export function jobCapability(p: Pet, job: string, s?: GameState): Capability | null {
  const ks = jobSkills(p, job).filter(allowedOnFarm);
  if (!ks.length) return null;
  let k = ks[0];
  if (job === 'forage' && s && ks.length > 1 && deployedRevision(k)?.stage?.recipeId === 'harvest-store') {
    const w = s.farm.world;
    // Storage only when it's nearer than the house (from the crop in paws, or the nearest ripe crop).
    const from = w.pet.carrying !== null ? w.pet : nearest(w, '@crop') ?? w.pet;
    const store = nearest(w, '@storage', from.x, from.y), home = nearest(w, 'home', from.x, from.y);
    const d = (o: { x: number; y: number } | null) => (o ? Math.abs(o.x - from.x) + Math.abs(o.y - from.y) : Infinity);
    const room = !!store && d(store) < d(home);
    const haulers = s.pets.filter((q) => q.id === s.farm.dutyPetId || s.farm.helpers?.some((h) => h.petId === q.id));
    const emptied = haulers.some((q) => jobSkills(q, 'deliver').some(allowedOnFarm) || jobSkills(q, 'tote').some(allowedOnFarm));
    if (!room || !emptied) k = ks[1];
  }
  return capabilityOf(k, LEARNED_JOBS[job].aim);
}
