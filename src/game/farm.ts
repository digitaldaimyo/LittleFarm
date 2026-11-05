import type { Action, Obj, PetBody, SimEvent, World } from '../sim/world';
import { addObject, inBounds, isSolidAt, bfsPath, cloneTally, def, seedPrice, objectsAt, step, type StepOptions } from '../sim/world';
import { trackRequests } from './requests';
import { Rng } from '../sim/rng';
import { SkillRun, isDone, type ExecStep } from '../learning/policies';
import type { BehaviorId, ExecContext, Invocation } from '../learning/executive';
import type { FarmState, GameState, Helper, Pet } from './types';
import { petById } from './pets';
import { addJournal, addJournalOnce } from './journal';
import { checkUnlocks } from './progression';
import { newPlanRuntime, planUsesMemory, starterPlan, type ExecHow, type PlanRuntime } from './plan';
import { SELL_PRICE, regrow, updateClock, updateWeather, updateCreatures } from './farmworld';
import { buildExecutor, claimFor } from './farmjobs';
import { chooseInvocation, workDone, finishInvocation } from './farmexec';
export * from './farmexec';
export * from './farmjobs';
export * from './farmworld';
export * from './farmlessons';

export interface FarmFx {
  /** 'sound' marks a moment that is heard but not drawn (text: shoo, firefly, crow, dawn, dusk). */
  type: 'coin' | 'splash' | 'pickup' | 'drop' | 'celebrate' | 'confused' | 'nap' | 'bump' | 'sound';
  x: number;
  y: number;
  amount?: number;
  text?: string;
}

/** Non-serialised runtime attached to the farm (rebuilt after load). */
export interface FarmRuntime {
  exec: { next(w: World): ExecStep } | null;
  inv: Invocation | null;
  ctx: ExecContext | null;
  startCoins: number;
  /** Overrides how Auto chooses (executive practice and comparisons); unset on the real farm. */
  execHow?: ExecHow;
  /** What the world looked like (work done) when the current job started: progress is measured from the world. */
  startWork?: string;
  startEnergy: number;
  startTick: number;
  manual: Action[];
  recentFail: boolean;
  /** Recovery after a failed job: a few random sniffing steps so a pet never repeats a stuck loop forever. */
  /** Farm-plan memory: row starts (for the anti-dithering guard), fire counts, switches. */
  plan: PlanRuntime;
  /** Object this pet is heading for (hidden from the other pets on duty). */
  claim: number | null;
  /** Benchmarks only: per-job outcome counts (absent in play; never affects behaviour). */
  stats?: Record<string, { started: number; ok: number; fail: number; timeout: number; ticks: number }>;
  /** Runtimes of the helpers on duty (`FarmState.helpers`, same order; created on demand). */
  crew: FarmRuntime[];
  rng: Rng;
}

export function createRuntime(f: FarmState): FarmRuntime {
  const rng = new Rng(1);
  rng.state = f.rngState >>> 0;
  return { exec: null, inv: null, ctx: null, startCoins: 0, startEnergy: 0, startTick: 0, manual: [], recentFail: false, plan: newPlanRuntime(), claim: null, crew: [], rng };
}

function earn(s: GameState, pet: Pet, amount: number, x: number, y: number, fx: FarmFx[]) {
  s.resources.coins += amount;
  s.progress.totalCoins += amount;
  pet.stats.coins += amount;
  s.farm.production.push({ tick: s.farm.tick, coins: amount });
  fx.push({ type: 'coin', x, y, amount });
}

function handleEvents(s: GameState, pet: Pet, events: SimEvent[], rt: FarmRuntime, fx: FarmFx[]): void {
  const w = s.farm.world;
  trackRequests(s, events);
  for (const e of events) {
    if (e.type === 'enter') {
      s.farm.stun = 3;
      pet.stats.dips++;
      pet.mood = Math.max(0, pet.mood - 2);
      fx.push({ type: 'splash', x: e.x, y: e.y });
      if (pet.stats.dips === 1) addJournal(s, pet.id, 'first-dip', `${pet.name} walked straight through the pond on the way to work and had to shake dry. Approach takes the shortest path — even a wet one.`, true);
      else if (pet.stats.dips === 5) addJournal(s, pet.id, 'dips-5', `${pet.name} has splashed through the pond 5 times now. An Avoid lesson might keep them dry.`, false);
    } else if (e.type === 'reach' && e.kind === 'firefly') {
      const o = w.objects.find((x) => x.id === e.objId);
      if (o) o.delivered = true;
      s.resources.fireflies = (s.resources.fireflies ?? 0) + 1;
      pet.stats.fireflies = (pet.stats.fireflies ?? 0) + 1;
      earn(s, pet, 1, e.x, e.y, fx);
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'firefly' });
      addJournalOnce(s, pet.id, 'first-firefly', `${pet.name} caught a firefly by moonlight and let it glow in the jar.`);
    } else if (e.type === 'water') {
      pet.stats.waterings = (pet.stats.waterings ?? 0) + 1;
      fx.push({ type: 'drop', x: e.x, y: e.y, text: 'watered' });
      addJournalOnce(s, pet.id, 'first-water', `${pet.name} watered the ${e.kind === 'bush' ? 'berry bush' : 'carrot patch'} — it will grow back twice as fast.`);
    } else if (e.type === 'scare') {
      fx.push({ type: 'celebrate', x: e.x, y: e.y, text: 'shoo!' });
      pet.stats.crowsShooed = (pet.stats.crowsShooed ?? 0) + 1;
      addJournalOnce(s, pet.id, 'first-scare', `${pet.name} shooed a crow off the farm. It flapped away, empty-beaked.`);
    } else if (e.type === 'shoo') {
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'shoo' });
    } else if (e.type === 'peck') {
      fx.push({ type: 'confused', x: e.x, y: e.y, text: 'pecked' });
      addJournalOnce(s, null, 'first-peck', `A crow pecked a ${e.kind} and flew off with it. It will regrow — but a guard would help.`);
    } else if (e.type === 'enterArea' && e.kind === 'chicken' && e.area === 'coop' && events.some((x) => x.type === 'shoo' && x.objId === e.objId)) {
      addJournalOnce(s, pet.id, 'first-herd', `${pet.name} shooed a chicken back into the coop.`);
    } else if (e.type === 'gate') {
      fx.push({ type: 'drop', x: e.x, y: e.y, text: e.state === 'open' ? 'gate open' : 'gate shut' });
      addJournalOnce(s, pet.id, `first-gate-${e.state}`, e.state === 'open' ? `${pet.name} nudged the orchard gate open.` : `${pet.name} nudged the gate shut — nothing’s wandering through now.`);
    } else if (e.type === 'fill') {
      fx.push({ type: 'drop', x: e.x, y: e.y, text: 'filled' });
    } else if (e.type === 'bump') {
      fx.push({ type: 'bump', x: e.x, y: e.y });
    } else if (e.type === 'pickup' && e.kind === 'berry' && !e.into) {
      // Picked, not sold: it travels to storage or the house first.
      fx.push({ type: 'pickup', x: e.x, y: e.y });
      addJournalOnce(s, pet.id, 'first-berry', `${pet.name} picked their first berry on the farm${rt.inv?.chosenBy === 'player' && rt.inv.behaviorId === 'manual' ? ' with your help' : ' all on their own'}. It earns coins once it reaches the house.`);
    } else if (e.type === 'plant') {
      // Sowing costs the seed; the plot starts growing.
      const price = seedPrice(e.kind ?? 'carrot');
      s.resources.coins -= price;
      s.farm.production.push({ tick: s.farm.tick, coins: -price });
      pet.stats.planted = (pet.stats.planted ?? 0) + 1;
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'plant' });
      addJournalOnce(s, pet.id, 'first-plant', `${pet.name} planted ${e.kind === 'pumpkin' ? 'a pumpkin' : e.kind === 'sunflower' ? 'a sunflower' : 'carrots'} (seed: ${price} coin${price === 1 ? '' : 's'}). Field crops are replanted after every harvest; berry bushes regrow by themselves.`);
    } else if (e.type === 'full') {
      fx.push({ type: 'confused', x: e.x, y: e.y, text: 'full' });
      addJournalOnce(s, null, 'first-full', `The ${e.into === 'shed' ? 'shed' : 'basket'} was full (or held something else), so the ${e.kind} was left beside it. Someone with Fetch can haul storage to the house.`);
    } else if (e.type === 'pickup') {
      fx.push({ type: 'pickup', x: e.x, y: e.y });
    } else if (e.type === 'drop') {
      fx.push({ type: 'drop', x: e.x, y: e.y });
    } else if (e.type === 'lift') {
      fx.push({ type: 'pickup', x: e.x, y: e.y });
      addJournalOnce(s, pet.id, 'first-lift', `${pet.name} lifted a basket. A carried basket can’t be filled — put it down by the crops, or at the house or a shed to empty it there.`);
    } else if (e.type === 'empty') {
      fx.push({ type: 'sound', x: e.x, y: e.y, text: 'emptied' });
      addJournalOnce(s, pet.id, 'first-basket-run', `${pet.name} carried a whole basket to the ${e.into === 'shed' ? 'shed' : 'house'} and emptied it there — several crops in one trip.`, true);
    } else if (e.type === 'deliver' && e.into === 'home') {
      // Sold at the house: the only place produce turns into coins.
      const value = SELL_PRICE[e.kind ?? ''] ?? 1;
      if (e.kind === 'berry') { s.resources.berries++; pet.stats.berries++; }
      if (e.kind === 'carrot') { s.resources.carrots++; pet.stats.carrots++; }
      if (e.kind === 'egg') { s.resources.eggs = (s.resources.eggs ?? 0) + 1; addJournalOnce(s, pet.id, 'first-egg-delivery', `${pet.name} carried an egg all the way to the house without dropping it.`); }
      pet.stats.deliveries++;
      pet.mood = Math.min(100, pet.mood + 2);
      earn(s, pet, value, e.x, e.y, fx);
      addJournalOnce(s, pet.id, 'first-sale', `${pet.name} brought a ${e.kind} to the house and sold it for ${value} coin${value === 1 ? '' : 's'}. Produce only earns once it reaches the house.`, true);
    } else if (e.type === 'deliver') {
      fx.push({ type: 'drop', x: e.x, y: e.y, text: 'stored' });
      addJournalOnce(s, pet.id, 'first-store', `${pet.name} put a ${e.kind} in the ${e.into === 'shed' ? 'shed' : 'basket'}. It's safe there until someone hauls it to the house.`);
    }
  }
  // Delivered/collected objects leave the world.
  if (w.objects.some((o) => o.delivered)) w.objects = w.objects.filter((o) => !o.delivered);
}

export interface TickResult {
  fx: FarmFx[];
  unlocked: string[];
}

/** Advance the farm by one tick. Deterministic given state + runtime RNG + inputs. */
export function farmTick(s: GameState, rt: FarmRuntime): TickResult {
  const fx: FarmFx[] = [];
  const f = s.farm;
  f.tick++;
  regrow(s);
  updateClock(s, rt, fx);
  updateWeather(s, rt, fx);
  updateCreatures(s, rt, fx);
  const pet = petById(s, f.dutyPetId);
  const helpers = tidyHelpers(s);
  const onDuty = new Set([f.dutyPetId, ...helpers.map((h) => h.petId)]);
  for (const p of s.pets) {
    if (!onDuty.has(p.id)) p.energy = Math.min(100, p.energy + 0.5); // off-duty pets nap at home
  }
  if (!pet) {
    f.rngState = rt.rng.state;
    return { fx, unlocked: checkUnlocks(s) };
  }
  syncCrew(s, rt, helpers);
  withOthers(s, rt, -1, () => petTurn(s, pet, rt, fx, {}));
  f.rngState = rt.rng.state;
  for (let i = 0; i < helpers.length; i++) helperTurn(s, i, rt, fx);
  if (f.production.length && f.tick - f.production[0].tick > 2400) f.production = f.production.filter((p) => f.tick - p.tick <= 2400);
  return { fx, unlocked: checkUnlocks(s) };
}

/** A pet's job changed: drop what it's doing so it decides afresh next tick (lead or helper). */
export function restartPet(s: GameState, rt: FarmRuntime, petId: string): void {
  const f = s.farm;
  if (f.dutyPetId === petId) { rt.exec = null; rt.inv = null; f.current = null; return; }
  const i = (f.helpers ?? []).findIndex((h) => h.petId === petId);
  if (i < 0) return;
  f.helpers![i].current = null;
  const r = rt.crew[i];
  if (r) { r.exec = null; r.inv = null; }
}

/** What a pet on the farm is doing right now (null = off duty). */
export function petActivity(s: GameState, petId: string): { current: Invocation | null; stun: number; lead: boolean } | null {
  const f = s.farm;
  if (f.dutyPetId === petId) return { current: f.current, stun: f.stun, lead: true };
  const h = (f.helpers ?? []).find((x) => x.petId === petId);
  return h ? { current: h.current, stun: h.stun, lead: false } : null;
}

/** "Who does what" across the pets on duty, e.g. "2 harvesting, 1 hauling". */
export function crewSummary(s: GameState): string {
  const VERB: Partial<Record<BehaviorId, string>> = { harvest: 'harvesting', haul: 'hauling', plant: 'planting', basketRun: 'on a basket run', rest: 'napping', catch: 'catching fireflies', wander: 'sniffing around', skill: 'running a skill', goto: 'on an errand', gate: 'minding the gate', manual: 'steered by you' };
  const n = new Map<string, number>();
  for (const p of dutyPets(s)) {
    const a = petActivity(s, p.id);
    const v = a?.stun ? 'drying off' : a?.current ? VERB[a.current.behaviorId] ?? a.current.behaviorId : 'thinking';
    n.set(v, (n.get(v) ?? 0) + 1);
  }
  return [...n].map(([v, k]) => `${k} ${v}`).join(', ') || 'nobody on duty';
}

/** Pets on duty: the lead first, then helpers. */
export function dutyPets(s: GameState): Pet[] {
  const f = s.farm;
  return [f.dutyPetId, ...(f.helpers ?? []).map((h) => h.petId)].map((id) => petById(s, id)).filter((p): p is Pet => !!p);
}

/** Put a pet on duty (as a helper, or as the lead if nobody leads) or take it off. Returns a reason if it can't. */
export function setOnDuty(s: GameState, petId: string, on: boolean, rt?: FarmRuntime): string | null {
  const f = s.farm;
  const helpers = f.helpers ?? [];
  const i = helpers.findIndex((h) => h.petId === petId);
  if (on) {
    if (f.dutyPetId === petId || i >= 0) return null;
    if (!f.dutyPetId || !petById(s, f.dutyPetId)) { f.dutyPetId = petId; resetLead(s, rt); return null; }
    if (dutyPets(s).length >= MAX_ON_DUTY) return `At most ${MAX_ON_DUTY} pets can work at once.`;
    // A new helper gets its own RNG stream (the first keeps the seed the second pet always had).
    const used = new Set(helpers.map((h) => h.rngState));
    let seed = HELPER_SEED;
    for (let k = 0; used.has(seed); k++) seed = HELPER_SEED + (k + 1) * 0x1000;
    f.helpers = [...helpers, { petId, current: null, stun: 0, queue: [], rngState: seed }];
    return null;
  }
  if (i >= 0) {
    f.helpers = helpers.filter((_, k) => k !== i);
    f.world.crew?.splice(i, 1);
    rt?.crew.splice(i, 1);
    if (!f.helpers.length) { delete f.helpers; delete f.world.crew; }
    return null;
  }
  if (f.dutyPetId === petId) {
    if (!helpers.length) return 'Someone has to mind the farm — put another pet on duty first.';
    makeLead(s, helpers[0].petId, rt);
    return setOnDuty(s, petId, false, rt);
  }
  return null;
}

/** Make a helper the lead (the pet you steer and whose plan previews run first); the old lead becomes that helper. */
export function makeLead(s: GameState, petId: string, rt?: FarmRuntime): void {
  const f = s.farm;
  const i = (f.helpers ?? []).findIndex((h) => h.petId === petId);
  if (i < 0 || !f.dutyPetId) return;
  const h = f.helpers![i];
  const w = f.world;
  [w.pet, w.crew![i]] = [w.crew![i], w.pet];
  h.petId = f.dutyPetId;
  f.dutyPetId = petId;
  s.activePetId = petId;
  h.current = null; h.queue = []; h.stun = 0;
  resetLead(s, rt);
}

function resetLead(s: GameState, rt?: FarmRuntime): void {
  s.farm.current = null;
  s.farm.stun = 0;
  for (const h of s.farm.helpers ?? []) h.current = null;
  if (!rt) return;
  rt.exec = null; rt.inv = null; rt.manual = []; rt.claim = null;
  rt.crew = [];
}

/** Most pets on duty at once (the lead + 3 helpers). */
export const MAX_ON_DUTY = 4;
const HELPER_SEED = 0x5ec0d;

/** Drop helpers that aren't valid any more (gone, the lead, duplicates, too many), with their bodies and runtimes. */
function tidyHelpers(s: GameState): Helper[] {
  const f = s.farm;
  const list = f.helpers ?? [];
  const seen = new Set<string | null>([f.dutyPetId]);
  const keep: number[] = [];
  list.forEach((h, i) => { if (!seen.has(h.petId) && s.pets.some((p) => p.id === h.petId) && keep.length < MAX_ON_DUTY - 1) { seen.add(h.petId); keep.push(i); } });
  if (keep.length !== list.length) {
    f.helpers = keep.map((i) => list[i]);
    if (f.world.crew) f.world.crew = keep.map((i) => f.world.crew![i]).filter(Boolean);
  }
  if (!f.helpers?.length) delete f.helpers;
  return f.helpers ?? [];
}

/** Bodies (and runtimes) for every helper; a new helper starts beside the lead. */
function syncCrew(s: GameState, rt: FarmRuntime, helpers: Helper[]): void {
  const w = s.farm.world;
  if (!helpers.length) {
    if (w.crew) delete w.crew;
    rt.crew = [];
    return;
  }
  w.crew ??= [];
  if (w.crew.length > helpers.length) w.crew.length = helpers.length;
  while (w.crew.length < helpers.length) w.crew.push(startBody(w, w.crew.length));
  if (rt.crew.length > helpers.length) rt.crew.length = helpers.length;
  for (let i = 0; i < helpers.length; i++) {
    if (!rt.crew[i]) {
      const r = createRuntime(s.farm);
      r.rng.state = (helpers[i].rngState ?? HELPER_SEED + i * 0x1000) >>> 0;
      rt.crew[i] = r;
    }
  }
}

function startBody(w: World, i: number): PetBody {
  const first = { x: w.pet.x, y: Math.min(w.h - 1, w.pet.y + 1), carrying: null, facing: 'S' as const };
  if (i === 0) return first; // where the second pet always started
  const taken = (x: number, y: number) => (w.pet.x === x && w.pet.y === y) || (w.crew ?? []).some((b) => b.x === x && b.y === y) || isSolidAt(w, x, y);
  for (let r = 1; r < w.w + w.h; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.abs(dx) + Math.abs(dy) !== r) continue;
    const x = w.pet.x + dx, y = w.pet.y + dy;
    if (inBounds(w, x, y) && !taken(x, y)) return { x, y, carrying: null, facing: 'S' };
  }
  return first;
}

/**
 * While one pet acts, the others are solid obstacles and whatever they're heading for is hidden,
 * so no two pets chase the same thing. `acting` is -1 for the lead, else the helper's index.
 */
function withOthers(s: GameState, rt: FarmRuntime, acting: number, fn: () => void): void {
  const w = s.farm.world;
  const others = acting < 0 ? rt.crew : [rt, ...rt.crew.filter((_, i) => i !== acting)];
  const bodies = w.crew ?? [];
  const buddies: Obj[] = [];
  const hidden: Obj[] = [];
  for (const body of bodies) {
    // Another pet is an obstacle, except at the house and storage, which pets may use at once
    // (a pet napping in the house mustn't stop another selling).
    const shared = objectsAt(w, body.x, body.y).some((o) => def(o.kind).container);
    if (!shared) buddies.push(addObject(w, 'buddy', body.x, body.y));
  }
  for (const other of others) {
    const claimed = other.claim !== null ? w.objects.find((o) => o.id === other.claim && !o.carried && !o.delivered) : undefined;
    if (claimed) { claimed.hidden = true; hidden.push(claimed); }
  }
  try { fn(); } finally {
    for (const o of hidden) delete o.hidden;
    if (buddies.length) w.objects = w.objects.filter((o) => !buddies.includes(o));
  }
}

/** A helper's turn: swap its body, job, stun and queue into the primary slots and reuse the same logic. */
function helperTurn(s: GameState, i: number, rt: FarmRuntime, fx: FarmFx[]): void {
  const f = s.farm;
  const w = f.world;
  const h = f.helpers![i];
  const pet = petById(s, h.petId)!;
  const rtH = rt.crew[i];
  const swap = () => {
    [w.pet, w.crew![i]] = [w.crew![i], w.pet];
    [f.current, h.current] = [h.current ?? null, f.current];
    [f.stun, h.stun] = [h.stun ?? 0, f.stun];
    [f.queue, h.queue] = [h.queue ?? [], f.queue];
  };
  swap();
  try {
    withOthers(s, rt, i, () => petTurn(s, pet, rtH, fx, { advance: false }));
  } finally {
    swap();
  }
  h.rngState = rtH.rng.state;
}

/** One pet's decision + action for this tick (the original single-pet logic, unchanged). */
function petTurn(s: GameState, pet: Pet, rt: FarmRuntime, fx: FarmFx[], opts: StepOptions): void {
  const f = s.farm;
  pet.mood += (60 - pet.mood) * 0.002;
  f.world.petEnergy = pet.energy;
  f.world.seedCoins = s.resources.coins; // what planting may spend
  if (f.stun > 0) {
    f.stun--;
    return;
  }
  // Mode change → drop current activity.
  if (rt.inv && ((pet.assignment.mode === 'manual') !== (rt.inv.behaviorId === 'manual'))) { rt.exec = null; rt.inv = null; f.current = null; }
  if (!rt.exec) {
    // Plans with "Has done…" rows need the farm to remember events; they count from each job's start.
    const remembers = pet.assignment.mode === 'auto' && !!pet.plan && planUsesMemory(pet.plan);
    if (remembers) f.world.tally ??= {};
    const inv = chooseInvocation(s, pet, rt);
    if (remembers) rt.plan.base = cloneTally(f.world.tally);
    rt.inv = inv;
    rt.exec = buildExecutor(s, pet, inv, rt);
    rt.startCoins = s.resources.coins;
    rt.startWork = workDone(f.world);
    rt.startEnergy = pet.energy;
    rt.startTick = f.tick;
    f.current = inv;
    f.queue = [inv, ...f.queue].slice(0, 6);
    if (inv.behaviorId === 'rest' && pet.energy < 90) fx.push({ type: 'nap', x: f.world.pet.x, y: f.world.pet.y });
  }
  const st = rt.exec.next(f.world);
  if (isDone(st)) {
    finishInvocation(s, pet, rt, st.done, st.reason, fx);
  } else {
    const prev = { x: f.world.pet.x, y: f.world.pet.y };
    const exec = rt.exec;
    const events = step(f.world, st, opts);
    (exec as { observe?: SkillRun['observe'] }).observe?.call(exec, f.world, prev, events); // skills with notes keep writing them
    handleEvents(s, pet, events, rt, fx);
  }
  rt.claim = claimFor(f.world, rt.inv);
  const resting = rt.inv?.behaviorId === 'rest';
  const bed = s.purchases.includes('bed') ? 2 : 1;
  const nightK = f.world.night ? 1.5 : 1; // night work is tiring, night naps are deep
  if (resting) pet.energy = Math.min(100, pet.energy + 1.5 * bed * nightK);
  else if (st !== 'wait' && rt.inv?.behaviorId !== 'manual') pet.energy = Math.max(0, pet.energy - 0.12 * nightK);
  else if (rt.inv?.behaviorId === 'manual' && st !== 'wait') pet.energy = Math.max(0, pet.energy - 0.05);
}

/** Player tapped a tile in manual mode: queue a walking path (a pet following you is instinct, not a trained skill). */
export function queueManualPath(s: GameState, rt: FarmRuntime, x: number, y: number): boolean {
  const w = s.farm.world;
  const path = bfsPath(w, w.pet.x, w.pet.y, (a, b) => a === x && b === y, false);
  if (!path) return false;
  rt.manual = path.slice(0, 30);
  return true;
}

export function queueManual(rt: FarmRuntime, a: Action): void {
  if (rt.manual.length < 8) rt.manual.push(a);
}

/** Switch a pet to its farm plan, starting from a clean slate (so a preview from here matches reality). */
export function applyPlan(s: GameState, rt: FarmRuntime, petId: string): void {
  const p = petById(s, petId);
  if (!p) return;
  p.plan ??= starterPlan();
  p.assignment.mode = 'auto'; // Auto works on the pet's responsibilities
  p.executive.mode = 'order';
  s.progress.flags.dutiesApplied = true;
  const hi = (s.farm.helpers ?? []).findIndex((h) => h.petId === petId);
  if (hi >= 0) {
    // A helper: it starts its plan from a clean slate; the lead carries on.
    s.farm.helpers![hi].current = null;
    if (rt.crew[hi]) rt.crew[hi] = undefined as unknown as FarmRuntime; // recreated next tick from its saved RNG state
    return;
  }
  s.farm.dutyPetId = petId;
  s.farm.current = null;
  rt.exec = null;
  rt.inv = null;
  rt.recentFail = false;
  rt.manual = [];
  rt.plan = newPlanRuntime();
  rt.claim = null;
  rt.rng.state = s.farm.rngState >>> 0;
  // Helpers start their current decisions afresh too, so previews from here match reality.
  if (rt.crew.length) { rt.crew = []; for (const h of s.farm.helpers ?? []) h.current = null; }
}

