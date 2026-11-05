/**
 * The farm's jobs (split from farm.ts, polish phase 3): how each job runs once chosen — through the pet's learned
 * skill or routine (runCapability), with its time limit — and which object a running job has claimed.
 */
import type { World } from '../sim/world';
import { storeCount, nearest, onGround } from '../sim/world';
import { isDone, type ExecStep } from '../learning/policies';
import { atFocus } from '../learning/features';
import type { Invocation } from '../learning/executive';
import type { GameState, Pet } from './types';
import { getSkill } from './pets';
import { jobCapability, runCapability } from './capability';
import { CROPS, heldBasket, totalSold } from './farmworld';
import type { FarmRuntime } from './farm';

export function buildExecutor(s: GameState, pet: Pet, inv: Invocation, rt: FarmRuntime): { next(w: World): ExecStep } {
  const w = s.farm.world;
  // The walking skill errands, fireflies and the walk home use: Avoid if asked for and learned, else Approach.
  const walker = (inv.args.navigator ?? pet.assignment.navigator) === 'Avoid' && getSkill(pet, 'Avoid') ? 'Avoid' : 'Approach';
  switch (inv.behaviorId) {
    case 'harvest': {
      // Harvest: the pet's own Harvest skill or routine, aimed at any ripe crop (learned-farm phase 3).
      const cap = jobCapability(pet, 'harvest', s);
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Harvest skill' }) };
      return runCapability(s, pet, cap.name, inv.args.aim ?? cap.aim, rt.rng, inv.timeout);
    }
    case 'goto': {
      // An errand: the pet's own walking skill (Approach, or Avoid), aimed at the target — through the one runtime.
      const target = inv.args.target ?? 'home';
      return runCapability(s, pet, walker, target, rt.rng, inv.timeout, { goal: (world) => atFocus(world, target) });
    }
    case 'basketRun': {
      // Basket run: the pet's own Basket run routine (learned-farm phase 3b). The job is done once a basket it
      // lifted is set down again (the routine's own goal also needs every basket empty, which a farm rarely is).
      const cap = jobCapability(pet, 'basketRun');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Basket run skill' }) };
      let lifted = !!heldBasket(w);
      const goal = (world: World) => { if (heldBasket(world)) lifted = true; return lifted && world.pet.carrying === null; };
      return runCapability(s, pet, cap.name, inv.args.aim ?? cap.aim, rt.rng, inv.timeout, { goal });
    }
    case 'plant': {
      // Plant: the pet's own Plant routine (learned-farm phase 3c). Done once a plot has been sown.
      const cap = jobCapability(pet, 'plant');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Plant skill' }) };
      const soil = (world: World) => world.objects.filter((o) => o.kind === 'soil' && onGround(o)).length;
      const before = soil(w);
      return runCapability(s, pet, cap.name, inv.args.aim ?? cap.aim, rt.rng, inv.timeout, { goal: (world) => soil(world) < before });
    }
    case 'gate': {
      // Mind the gate: the pet's own gate skill (it learned to nudge a gate from beside it). Done when every gate is
      // as asked; nudging toggles, so the same skill opens and shuts.
      const want = inv.args.state === 'open';
      const cap = jobCapability(pet, want ? 'gateOpen' : 'gateShut');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no gate skill' }) };
      return runCapability(s, pet, cap.name, cap.aim, rt.rng, inv.timeout, { goal: (world) => !world.objects.some((o) => o.kind === 'gate' && onGround(o) && !!o.open !== want) });
    }
    case 'catch': {
      // Fireflies are caught by walking into them (see handleEvents): the pet's own walking skill, aimed at one.
      const before = w.objects.filter((o) => o.kind === 'firefly' && onGround(o)).length;
      return runCapability(s, pet, walker, 'firefly', rt.rng, inv.timeout, { goal: (world) => world.objects.filter((o) => o.kind === 'firefly' && onGround(o)).length < before });
    }
    case 'haul': {
      // Haul: the pet's own Fetch, aimed at eggs or stored goods (fullest storage first), delivered to the house.
      const cap = jobCapability(pet, 'haul');
      if (!cap) return { next: () => ({ done: 'fail', reason: 'no Fetch skill' }) };
      const fullest = w.objects.filter((o) => o.store && storeCount(o) > 0).sort((a, b) => storeCount(b) - storeCount(a))[0];
      const item = w.pet.carrying !== null ? (w.objects.find((o) => o.id === w.pet.carrying)?.kind ?? 'carrot') : inv.args.aim ?? (nearest(w, 'egg') ? 'egg' : fullest?.kind ?? 'bin');
      return runCapability(s, pet, cap.name, item, rt.rng, inv.timeout, { dest: 'home', count: totalSold });
    }
    case 'skill':
      // One runtime for every learned skill, routine or Fetch (direct jobs and plan rows alike).
      return runCapability(s, pet, inv.args.skill ?? '', inv.args.target || undefined, rt.rng, inv.timeout);
    case 'rest': {
      // Resting is innate (Stay). With another pet on duty, it naps at the house (a tile both may share) rather than
      // in someone's way: the walk there is the pet's own walking skill, through the one runtime.
      let t = 0;
      const walkHome = w.crew?.length && w.pet.carrying === null && !atFocus(w, 'home') && getSkill(pet, walker)
        ? runCapability(s, pet, walker, 'home', rt.rng, 40, { goal: (world) => atFocus(world, 'home') }) : null;
      let walking = !!walkHome;
      return {
        next(world) {
          if ((pet.energy >= 98 && t >= 6) || t >= inv.timeout + (walkHome ? 40 : 0)) return { done: 'success', reason: 'rested' };
          t++;
          if (walking) { const st = walkHome!.next(world); if (!isDone(st)) return st; walking = false; }
          return 'wait';
        },
      };
    }
    case 'manual':
    default:
      return {
        next() {
          return rt.manual.shift() ?? 'wait';
        },
      };
  }
}

export function claimFor(w: World, inv: Invocation | null): number | null {
  if (!inv) return null;
  // Harvesters claim the crop they're heading for; haulers claim eggs. Storage is shared, never claimed
  // (hiding a basket would stop the other pet storing there).
  const kinds = inv.behaviorId === 'harvest' && w.pet.carrying === null ? [...CROPS] : inv.behaviorId === 'plant' ? ['soil'] : inv.behaviorId === 'basketRun' && w.pet.carrying === null ? ['bin'] : inv.behaviorId === 'catch' ? ['firefly'] : inv.behaviorId === 'goto' ? [inv.args.target ?? ''] : inv.behaviorId === 'haul' && w.pet.carrying === null ? ['egg'] : [];
  let best: number | null = null, bd = Infinity;
  for (const k of kinds) {
    const o = nearest(w, k);
    if (!o) continue;
    const d = Math.abs(o.x - w.pet.x) + Math.abs(o.y - w.pet.y);
    if (d < bd) { bd = d; best = o.id; }
  }
  return best;
}
