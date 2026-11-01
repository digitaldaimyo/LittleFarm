import type { SkillName, StageSpec } from '../domain/types';
import { newId } from '../domain/spec';
import type { SerializedQ } from '../learning/qtable';
import type { TrainingReport } from '../learning/report';
import type { GameState, NavigatorName, PaletteId, Pet, Skill, SkillRevision } from './types';
import { addJournal, addJournalOnce, pct } from './journal';
import { Rng, hashSeed } from '../sim/rng';
import { REGISTRY } from '../domain/registry';
import { senseDefFor, templateOf } from '../learning/skilldef';
import { ABILITY_LABELS } from '../learning/senses';
import { SensePolicy } from '../learning/policies';
import { RoutineController, RoutineRun, compileRoutine, type SubSkills } from '../learning/routine';
import { compileCondition, withTarget } from '../sim/compile';

export const NAME_SUGGESTIONS = ['Pip', 'Biscuit', 'Mochi', 'Clover', 'Pebble', 'Juniper', 'Toast'];
export const PALETTES: { id: PaletteId; label: string; body: string; belly: string; ear: string; ink: string }[] = [
  { id: 'meadow', label: 'Meadow', body: '#E8B878', belly: '#FFF1D6', ear: '#C98F4E', ink: '#3B2A1A' },
  { id: 'plum', label: 'Plum', body: '#B48BC7', belly: '#F4E8FA', ear: '#8C649F', ink: '#2F1D3A' },
  { id: 'sky', label: 'Sky', body: '#8EC3E6', belly: '#EEF8FF', ear: '#5E9CC4', ink: '#17324A' },
  { id: 'moss', label: 'Moss', body: '#9CC48A', belly: '#F0F8E8', ear: '#6F9A5E', ink: '#1F3519' },
];

type Meta = Pick<Skill, 'kind' | 'signature' | 'initiation' | 'termination'>;
export const SKILL_META: Record<string, Meta> = {
  Approach: { kind: 'nav', signature: 'Approach(target: Kind) → Event', initiation: 'A target of that kind is lying somewhere on the grid.', termination: 'Standing on the target (success) or out of time (fail).' },
  Avoid: { kind: 'nav', signature: 'Avoid(target: Kind, hazard: Kind<Hazard>) → Event', initiation: 'A target is visible; hazards may be nearby.', termination: 'Reached the target dry (success), or out of time (fail).' },
  Fetch: { kind: 'fetch', signature: 'Fetch(item: Kind<Carryable>, into: Kind<Container>) → Event', initiation: 'An item to carry and a container both exist.', termination: 'Item delivered (success) or out of time (fail).' },
};

export function isPreset(name: string): boolean {
  return name === 'Approach' || name === 'Avoid' || name === 'Fetch';
}

/** Describe a player-made skill from its lesson: signature lists what it pays attention to and can do. */
export function customMeta(stage: StageSpec): Meta {
  if (templateOf(stage) === 'routine') {
    const opts = (stage.learner.routine?.options ?? []).map((o) => o.cardId === 'opt.skill' ? String(o.args.skill) : `${String(o.args.action)}`).join(', ');
    return {
      kind: 'routine',
      signature: `${stage.learner.skill}(routine) — chooses between: ${opts}; watches ${(stage.learner.routine?.watch ?? []).length} condition(s)`,
      initiation: 'Can start anywhere.',
      termination: 'Ends when its lesson’s SUCCESS condition holds, or time runs out.',
    };
  }
  const def = senseDefFor(stage);
  const senses = def.senses.map((n) => REGISTRY.cards.get(n.cardId)?.presentation.title ?? n.cardId).join(', ');
  const acts = stage.abilities.map((a) => ABILITY_LABELS[a] ?? a).join(', ');
  return {
    kind: 'nav',
    signature: `${stage.learner.skill}(target: Kind) — senses: ${senses}; can: ${acts}`,
    initiation: 'Can start anywhere.',
    termination: stage.outcome === 'survive' ? 'Runs until time is up (judged at the end).' : 'Ends when its lesson’s SUCCESS condition holds, or time runs out.',
  };
}

export function adoptPet(s: GameState, name: string, palette: PaletteId): Pet {
  const rng = new Rng(hashSeed(Date.now() & 0xffffff, s.pets.length));
  const jitter = () => Math.round((0.35 + rng.next() * 0.3) * 100) / 100;
  const pet: Pet = {
    id: newId('pet'),
    name: name.trim().slice(0, 20) || 'Pip',
    palette,
    createdAt: Date.now(),
    traits: { curiosity: jitter(), persistence: jitter(), caution: jitter() },
    energy: 100,
    mood: 70,
    skills: [],
    executive: { mode: 'rules', table: {}, decisions: 0 },
    feedback: {},
    stats: { coins: 0, berries: 0, carrots: 0, dips: 0, trainingRuns: 0, episodes: 0, deliveries: 0 },
    assignment: { mode: 'auto', job: 'forage', navigator: 'Approach' },
    mastery: {},
  };
  s.pets.push(pet);
  s.activePetId = pet.id;
  if (!s.farm.dutyPetId) s.farm.dutyPetId = pet.id;
  addJournal(s, pet.id, 'adopt', `${pet.name} came home to the farm. They sniffed every fence post twice.`, true);
  return pet;
}

export function activePet(s: GameState): Pet | null {
  return s.pets.find((p) => p.id === s.activePetId) ?? s.pets[0] ?? null;
}

export function petById(s: GameState, id: string | null): Pet | null {
  return s.pets.find((p) => p.id === id) ?? null;
}

export function getSkill(p: Pet, name: SkillName): Skill | null {
  return p.skills.find((k) => k.name === name) ?? null;
}

export function activeRevision(k: Skill | null): SkillRevision | null {
  if (!k) return null;
  return k.revisions.find((r) => r.rev === k.activeRev) ?? null;
}

export function navPolicyFor(p: Pet, prefer: NavigatorName): { skill: Skill; rev: SkillRevision } | null {
  for (const name of [prefer, prefer === 'Approach' ? 'Avoid' : 'Approach'] as NavigatorName[]) {
    const k = getSkill(p, name);
    const r = activeRevision(k);
    if (k && r) return { skill: k, rev: r };
  }
  return null;
}

/** Runtime policy for a sense-skill revision (falls back to the movement preset for v1 revisions). */
export function sensePolicyOf(rev: SkillRevision): SensePolicy | null {
  return SensePolicy.from(rev.policy, rev.learner);
}

/** Snapshots of a pet's saved sense skills (active revisions) that routines may call. */
export function subskillsFor(p: Pet): SubSkills {
  const out: SubSkills = {};
  for (const k of p.skills) {
    if ((k.template ?? (k.name === 'Fetch' ? 'fetch' : 'sense')) !== 'sense') continue;
    const r = activeRevision(k);
    if (!r) continue;
    out[k.name] = { name: k.name, rev: r.rev, preset: !k.custom, policy: r.policy, learner: r.learner, focus: r.focus, success: r.success, outcome: r.outcome, maxTicks: r.maxTicks };
  }
  return out;
}

/** Sub-skills whose active revision differs from the one a routine revision was certified with. */
export function staleUses(p: Pet, rev: SkillRevision | null): { skill: string; trained: number; now: number | null }[] {
  if (!rev?.uses) return [];
  return rev.uses
    .map((u) => ({ skill: u.skill, trained: u.rev, now: getSkill(p, u.skill)?.activeRev ?? null }))
    .filter((u) => u.now !== u.trained);
}

/** Runtime controller for a routine revision, wired to the pet's current sub-skill revisions. */
export function routineRunFor(p: Pet, rev: SkillRevision, target: string | undefined, rng: Rng, timeout: number): RoutineRun | null {
  if (!rev.stage) return null;
  const compiled = compileRoutine(rev.stage, subskillsFor(p), p.traits, target);
  const ctrl = RoutineController.from(rev.policy, compiled);
  const goal = rev.stage.success && rev.stage.outcome !== 'survive' ? withTarget(target ?? rev.stage.learner.focus, () => compileCondition(rev.stage!.success!)) : null;
  return new RoutineRun(compiled, ctrl, rng, timeout, goal ? (w) => goal({ w, prev: w.pet }) : null);
}

export function customSkills(p: Pet): Skill[] {
  return p.skills.filter((k) => k.custom && activeRevision(k));
}

export function isCertified(k: Skill | null): boolean {
  return !!k && k.revisions.some((r) => r.eval.passed);
}

export interface SaveRevisionInput {
  stage: StageSpec;
  policy: SerializedQ;
  report: TrainingReport;
  episodes: number;
  durationMs: number;
  simTicks: number;
  resumedFrom?: number;
  navigator?: { skill: NavigatorName; rev: number };
  /** Routines: which skill revisions the options called. */
  uses?: { skill: string; rev: number }[];
}

/** Save an immutable new skill revision and make it active. */
export function saveRevision(s: GameState, pet: Pet, input: SaveRevisionInput): SkillRevision {
  const name = input.stage.learner.skill;
  let skill = getSkill(pet, name);
  if (!skill) {
    const custom = !isPreset(name);
    skill = { id: newId('skill'), name, ...(custom ? customMeta(input.stage) : SKILL_META[name]), template: templateOf(input.stage), custom: custom || undefined, activeRev: 0, revisions: [], navigator: name === 'Fetch' ? (input.stage.learner.navigator ?? 'Approach') : undefined };
    pet.skills.push(skill);
  } else if (skill.custom) {
    Object.assign(skill, customMeta(input.stage));
  }
  const sense = templateOf(input.stage) === 'sense';
  const routine = templateOf(input.stage) === 'routine';
  const rev: SkillRevision = {
    rev: (skill.revisions.at(-1)?.rev ?? 0) + 1,
    createdAt: Date.now(),
    stageId: input.stage.id,
    stageName: input.stage.name,
    stageVersion: input.stage.version,
    episodes: input.episodes,
    policy: input.policy,
    eval: {
      successRate: input.report.after.successRate,
      episodes: input.report.after.episodes,
      meanReward: input.report.after.meanReward,
      beforeRate: input.report.before.successRate,
      randomRate: input.report.random.successRate,
      transferRate: input.report.transfer.successRate,
      passed: input.report.passed,
      minimum: input.stage.evaluation.minimumSuccessRate,
    },
    provenance: {
      trainer: !sense ? 'Double Q-learning over options (SMDP)' : 'Tabular Double Q-learning',
      features: routine ? `${(input.stage.learner.routine?.watch ?? []).length} watched condition(s) → ${1 << (input.stage.learner.routine?.watch ?? []).length} situations` : !sense ? 'carrying × at item × at bin × item visible' : senseDefFor(input.stage).senses.map((n) => REGISTRY.cards.get(n.cardId)?.presentation.title ?? n.cardId).join(' × '),
      trainSeeds: `hash(stage ${input.stage.seed}, i) mod 800000`,
      evalSeeds: input.report.evalSeeds,
      navigator: input.navigator,
      durationMs: input.durationMs,
      simTicks: input.simTicks,
      resumedFrom: input.resumedFrom,
    },
    ...(input.report.after.summary ? { summary: input.report.after.summary } : {}),
    ...(routine ? { uses: input.uses ?? [], stage: structuredClone(input.stage), focus: input.stage.learner.focus, maxTicks: input.stage.maxTicks } : {}),
    ...(sense ? {
      learner: senseDefFor(input.stage),
      focus: input.stage.learner.focus,
      success: input.stage.success ? structuredClone(input.stage.success) : null,
      outcome: input.stage.outcome ?? 'reach',
      maxTicks: input.stage.maxTicks,
    } : {}),
  };
  skill.revisions.push(rev);
  // Never silently replace a certified behavior with an uncertified one; the player can switch in Pets.
  const prevActive = activeRevision(skill);
  const keepPrev = !rev.eval.passed && !!prevActive?.eval.passed;
  if (!keepPrev) skill.activeRev = rev.rev;
  pet.mastery[input.stage.id] = {
    rate: rev.eval.successRate, episodes: rev.eval.episodes, rev: rev.rev, skill: name, at: Date.now(), transfer: rev.eval.transferRate,
  };
  const r = input.report.after;
  const wins = r.successes;
  if (rev.rev === 1) {
    addJournal(s, pet.id, `skill-${name}`, `${pet.name} learned ${name}! After ${input.episodes} practice tries, they succeeded ${wins} of ${r.episodes} times on layouts they had never seen (untrained: ${Math.round(input.report.before.successRate * r.episodes)} of ${r.episodes}).`, true);
  } else {
    addJournal(s, pet.id, `skill-${name}-rev`, `${pet.name} saved ${name} revision ${rev.rev}: ${pct(r.successRate)} on held-out layouts.${keepPrev ? ` Revision ${prevActive!.rev} stays active because it is certified.` : ''}`);
  }
  if (rev.eval.passed) addJournalOnce(s, pet.id, `mastered-${name}`, `${name} certified for ${pet.name}: ${wins}/${r.episodes} on unseen layouts (needed ${pct(input.stage.evaluation.minimumSuccessRate)}).`);
  return rev;
}

export function rollbackSkill(s: GameState, pet: Pet, name: SkillName, rev: number): boolean {
  const k = getSkill(pet, name);
  if (!k || !k.revisions.some((r) => r.rev === rev)) return false;
  k.activeRev = rev;
  addJournal(s, pet.id, 'rollback', `${pet.name}'s ${name} was switched to revision ${rev}.`);
  return true;
}
