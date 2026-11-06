/**
 * The farm's executive glue (split from farm.ts, polish phase 3): what the pet sees (farmContext), choosing the next
 * job from needs and responsibilities (chooseDuty in plan.ts), and learning from how it went (progress is judged by
 * what changed in the world).
 */
import type { World } from '../sim/world';
import { storeCount, nearest, onGround } from '../sim/world';
import { type Outcome } from '../learning/policies';
import { navTimeout } from '../learning/episodes';
import type { BehaviorId, ExecContext, Invocation } from '../learning/executive';
import type { GameState, Pet } from './types';
import { getSkill } from './pets';
import { deployedRevision, jobCapability } from './capability';
import { GUARD_HOLD, afterDutyJob, chooseDuty, compilePlan, deployExploreExec, starterPlan, traceDecision, type ExecHow } from './plan';
import { TIRED, CROPS, storeHalfFull, canPlantSomewhere, heldBasket, toteTarget } from './farmworld';
import type { FarmRuntime, FarmFx } from './farm';
import { homeLife } from './homestead';

export function farmContext(s: GameState, pet: Pet, recentFail: boolean): ExecContext {
  const w = s.farm.world;
  return {
    energyLow: pet.energy < TIRED,
    // "berry": something ripe to harvest; "carrot": goods to haul (eggs, or anything in storage).
    berry: CROPS.some((c) => !!nearest(w, c)),
    carrot: !!nearest(w, 'egg') || w.objects.some((o) => o.store && onGround(o) && storeCount(o) > 0),
    storeHalf: storeHalfFull(w),
    soil: canPlantSomewhere(w),
    ...(heldBasket(w) ? { basket: true } : {}),
    ...(jobCapability(pet, 'basketRun') && toteTarget(s) ? { tote: true } : {}),
    carrying: w.pet.carrying !== null,
    recentFail,
    night: !!w.night,
    firefly: !!nearest(w, 'firefly'),
  };
}

export function chooseInvocation(s: GameState, pet: Pet, rt: FarmRuntime): Invocation {
  const ctx = farmContext(s, pet, rt.recentFail);
  rt.ctx = ctx;
  const w = s.farm.world;
  const tmo = navTimeout(w.w, w.h, pet.traits.persistence);
  const harvestRev = deployedRevision(jobCapability(pet, 'harvest') ? getSkill(pet, jobCapability(pet, 'harvest')!.name) : null);
  const timeouts: Record<BehaviorId, number> = { harvest: Math.max(tmo * 3 + 6, Math.round((harvestRev?.stage?.maxTicks ?? 0) * (1 + pet.traits.persistence))), // a whole harvest trip (the routine's own time per try)
    haul: tmo * 3, plant: Math.round(tmo * 1.5) + 4, basketRun: tmo * 4 + 10, rest: 30, wander: 0, manual: 1e9, skill: 60, catch: tmo, goto: tmo, gate: tmo + 2 };
  const custom = pet.assignment.skillName ? deployedRevision(getSkill(pet, pet.assignment.skillName)) : null;
  if (custom) timeouts.skill = Math.round((custom.maxTicks ?? 40) * (1 + pet.traits.persistence));
  const navigator = pet.assignment.navigator;
  const mk = (b: BehaviorId, chosenBy: Invocation['chosenBy'], why: string): Invocation => ({
    behaviorId: b,
    args: b === 'harvest' ? { target: 'berry', navigator }
      : b === 'haul' ? { item: ctx.carrying ? 'carried item' : 'carrot or egg', into: 'bin', navigator }
      : b === 'catch' ? { target: 'firefly', navigator }
      : b === 'plant' ? { target: 'soil', navigator }
      : b === 'basketRun' ? { target: 'bin', navigator }
      : b === 'skill' ? { skill: pet.assignment.skillName ?? '', target: pet.assignment.target || custom?.focus || 'berry' }
      : {},
    intention: why,
    timeout: timeouts[b],
    chosenBy,
  });
  if (pet.assignment.mode === 'manual') return mk('manual', 'player', 'Following your lead');
  if (pet.energy <= 5) return mk('rest', 'rules', 'Too sleepy to work — nap first');
  // Direct jobs were retired in phase 6: an old one becomes a responsibility (do it, otherwise nap).
  // Auto: the responsibility executive (phase 4) — needs first, then the pet's responsibilities (or the starter ones).
  pet.executive.decisions++;
  const plan = (pet.plan ??= starterPlan());
  const rows = compilePlan(plan);
  // Learned (phase 5): learned values, exploring with Curiosity; practice and comparisons set their own (rt.execHow).
  const how: ExecHow = rt.execHow ?? (pet.executive.mode === 'learned' ? { mode: 'learned', eps: deployExploreExec(pet) } : { mode: 'order', eps: 0 });
  const d = chooseDuty(s, pet, plan, rows, ctx, rt.plan, rt.rng, how);
  if (d.guarded) rt.plan.guarded++;
  traceDecision(rt.plan, s.farm.tick, d.row ? `${d.row.label} → ${d.job!.label}: ${d.why}` : d.why);
  // Academy edition: with nothing to do, a pet sometimes practises what it was certified in (Homestead, phase 2).
  if (s.academy && !d.need && !d.guarded && (!d.row || d.job?.behaviorId === 'rest')) { const h = homeLife(s, pet, rt.rng); if (h) return h; }
  if (!d.row) return d.guarded && !d.need ? { ...mk('rest', 'plan', d.why), timeout: GUARD_HOLD } : mk('rest', 'plan', d.why);
  const row = d.row, job = d.job!;
  const prev = rt.plan.starts.at(-1)?.row;
  if (prev && prev !== row.id) rt.plan.switches++;
  rt.plan.starts.push({ tick: s.farm.tick, row: row.id });
  if (rt.plan.starts.length > 60) rt.plan.starts.shift();
  rt.plan.fires[row.id] = (rt.plan.fires[row.id] ?? 0) + 1;
  let t = timeouts[job.behaviorId];
  if (job.behaviorId === 'skill') t = Math.round((deployedRevision(getSkill(pet, job.args.skill ?? ''))?.maxTicks ?? 40) * (1 + pet.traits.persistence));
  const inv: Invocation = { behaviorId: job.behaviorId, args: { ...job.args }, intention: `${row.label}: ${d.why}`, timeout: t, chosenBy: 'plan' };
  if (job.behaviorId === 'haul') inv.args.item = ctx.carrying ? 'carried item' : 'carrot or egg';
  if (d.learned) inv.args.learned = '1';
  return inv;
}

export function finishInvocation(s: GameState, pet: Pet, rt: FarmRuntime, result: Outcome, reason: string, fx: FarmFx[]): void {
  const inv = rt.inv!;
  const ticks = s.farm.tick - rt.startTick;
  rt.recentFail = result !== 'success';
  if (rt.stats) {
    const st = (rt.stats[inv.behaviorId] ??= { started: 0, ok: 0, fail: 0, timeout: 0, ticks: 0 });
    st.started++; st.ticks += ticks;
    if (result === 'success') st.ok++; else if (result === 'timeout') st.timeout++; else st.fail++;
  }
  if (inv.chosenBy === 'plan' && inv.args.row && pet.plan) afterDutyJob(pet, rt.plan, compilePlan(pet.plan), inv.args, result === 'success', ticks, s.farm.tick, workDone(s.farm.world) !== rt.startWork, s.farm.world);
  const w = s.farm.world;
  if (result !== 'success') {
    fx.push({ type: 'confused', x: w.pet.x, y: w.pet.y, text: reason });
  }
  if (result === 'success' && (inv.behaviorId === 'harvest' || inv.behaviorId === 'haul' || (inv.behaviorId === 'skill' && reason === 'goal reached'))) fx.push({ type: 'celebrate', x: w.pet.x, y: w.pet.y });
  s.farm.current = null;
  rt.exec = null;
  rt.inv = null;
}

/**
 * A fingerprint of work done on the farm: sales, deliveries, what's in the pet's paws, sown plots, fireflies, gates.
 * A job that changed it made progress, whatever it reported.
 */
export function workDone(w: World): string {
  const n = (k: string) => w.objects.filter((o) => o.kind === k && onGround(o)).length;
  const delivered = Object.values(w.delivered).reduce((a, b) => a + b, 0);
  return `${w.sold ?? 0}|${delivered}|${w.pet.carrying}|${n('soil')}|${n('firefly')}|${w.objects.filter((o) => o.kind === 'gate' && o.open).length}`;
}
