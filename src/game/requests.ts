import type { GameState } from './types';
import type { SimEvent } from '../sim/world';
import { onGround, inArea } from '../sim/world';
import type { Rng } from '../sim/rng';
import { addJournal, addJournalOnce } from './journal';

/**
 * Neighbours' requests: small, open-ended goals posted each dawn. They only ask for things the
 * farm can do right now, pay coins, and sometimes come with a gift of new cards.
 */
export type RequestKind = 'eggs' | 'carrots' | 'berries' | 'fireflies' | 'water' | 'noPecks' | 'coop' | 'gate';

export interface FarmRequest {
  id: string;
  kind: RequestKind;
  from: string;
  n: number;
  reward: number;
  gift?: string;
  day: number;
  /** 'nightfall' requests are judged when night falls; 'dawn' ones at the next dawn. */
  until: 'nightfall' | 'dawn';
  progress: number;
  status: 'open' | 'done' | 'expired';
}

export const NEIGHBOURS = ['Hazel next door', 'Old Tomas', 'Wren from the mill', 'Bram the baker', 'Juniper Mae'];
const GIFTS = ['trees', 'fences'];

export function describeRequest(r: FarmRequest): string {
  switch (r.kind) {
    case 'eggs': return `Sell ${r.n} egg${r.n > 1 ? 's' : ''} at the house by nightfall`;
    case 'carrots': return `Sell ${r.n} carrot${r.n > 1 ? 's' : ''} at the house by nightfall`;
    case 'berries': return `Sell ${r.n} berries at the house by nightfall`;
    case 'fireflies': return `Catch ${r.n} firefl${r.n > 1 ? 'ies' : 'y'} tonight`;
    case 'water': return `Water ${r.n} bushes or patches by nightfall`;
    case 'noPecks': return 'No crow pecks today';
    case 'coop': return 'Every chicken in the coop when night falls';
    case 'gate': return 'Keep the orchard gate shut at nightfall';
  }
}

/** Side quests: how a request can be met, and which Field Guide lesson helps. */
export function requestHelp(kind: RequestKind): { hint: string; lesson?: string } {
  switch (kind) {
    case 'berries': return { hint: 'Harvest berries with Approach (or Avoid, to stay out of the pond); they count once they reach the house.', lesson: 'where' };
    case 'eggs': return { hint: 'The Haul job uses Fetch to carry eggs (and anything in the basket or shed) to the house.', lesson: 'results' };
    case 'carrots': return { hint: 'Harvest carrots into the basket, then Haul them to the house (Haul needs Fetch).', lesson: 'results' };
    case 'fireflies': return { hint: 'At night, Auto catches fireflies — or add a plan row “IF it’s night DO Catch fireflies”.', lesson: 'plans' };
    case 'water': return { hint: 'Teach the “Water the garden” recipe (Curriculum) and run it on the farm with “Run a skill”.', lesson: 'invent' };
    case 'noPecks': return { hint: 'Invent a guard skill with the Shoo ability (aim it at the crow) — or buy a scarecrow.', lesson: 'invent' };
    case 'coop': return { hint: 'Try the “Herd a chicken” recipe: “Area seen from…” is the sense that makes herding work.', lesson: 'invent' };
    case 'gate': return { hint: 'Add a plan row: IF “Gates are… any open” DO “Mind the gate (closed)”.', lesson: 'plans' };
  }
}

function eligibleKinds(s: GameState): RequestKind[] {
  const w = s.farm.world;
  const out: RequestKind[] = [];
  const pets = s.pets;
  const hasSkill = (name: string) => pets.some((p) => p.skills.some((k) => k.name === name));
  const hasAbility = (a: string) => pets.some((p) => p.skills.some((k) => k.revisions.some((r) => r.stage?.abilities.includes(a) || r.learner?.actions.includes(a as never))));
  const chickens = w.objects.some((o) => o.kind === 'chicken' && onGround(o));
  if (pets.some((p) => p.skills.length)) out.push('berries', 'fireflies');
  if (chickens && hasSkill('Fetch')) out.push('eggs');
  if (chickens) out.push('coop');
  if (s.progress.unlocks.includes('carrots') && hasSkill('Fetch')) out.push('carrots');
  if (hasAbility('water')) out.push('water');
  if (s.progress.unlocks.includes('custom') && s.farm.tick >= 1200) out.push('noPecks');
  if (w.objects.some((o) => o.kind === 'gate' && onGround(o))) out.push('gate');
  return out;
}

/** Called at each dawn (and once at the start of the first day): expire yesterday's, post up to 3 new ones. */
export function postRequests(s: GameState, rng: Rng, day: number): void {
  const f = s.farm;
  f.requests = (f.requests ?? []).filter((r) => r.status === 'open' || day - r.day <= 1);
  for (const r of f.requests) if (r.status === 'open' && r.until === 'dawn' && r.day < day) expire(s, r);
  const kinds = eligibleKinds(s);
  if (!kinds.length) return;
  const open = f.requests.filter((r) => r.status === 'open').length;
  for (let i = open; i < 3 && kinds.length; i++) {
    const kind = kinds.splice(rng.int(kinds.length), 1)[0];
    const n = kind === 'noPecks' || kind === 'coop' || kind === 'gate' ? 1 : kind === 'berries' ? 3 + rng.int(4) : kind === 'fireflies' ? 1 + rng.int(3) : kind === 'water' ? 2 + rng.int(3) : 1 + rng.int(3);
    const base = { eggs: 3, carrots: 4, berries: 1, fireflies: 2, water: 1, noPecks: 6, coop: 6, gate: 5 }[kind];
    const req: FarmRequest = {
      id: `req-${day}-${i}-${kind}`, kind, from: NEIGHBOURS[rng.int(NEIGHBOURS.length)], n,
      reward: kind === 'noPecks' || kind === 'coop' || kind === 'gate' ? base : base * n,
      day, until: kind === 'fireflies' ? 'dawn' : 'nightfall', progress: 0, status: 'open',
    };
    const gift = GIFTS.find((g) => !s.progress.unlocks.includes(g));
    if (gift && rng.next() < 0.35) req.gift = gift;
    f.requests.push(req);
  }
  addJournalOnce(s, null, 'first-requests', 'Neighbours started pinning little requests to the farm gate. They pay in coins — and sometimes in gifts.');
}

function complete(s: GameState, r: FarmRequest) {
  r.status = 'done';
  s.resources.coins += r.reward;
  s.progress.totalCoins += r.reward;
  let giftText = '';
  if (r.gift && !s.progress.unlocks.includes(r.gift)) {
    s.progress.unlocks.push(r.gift);
    giftText = ` and a gift: ${r.gift === 'trees' ? 'Tree' : 'Fence'} cards`;
  }
  addJournal(s, null, 'request-done', `${r.from} is delighted: “${describeRequest(r)}” — done! +${r.reward} coins${giftText}.`, true);
}

function expire(s: GameState, r: FarmRequest) {
  r.status = 'expired';
  addJournal(s, null, 'request-expired', `${r.from}’s request (“${describeRequest(r)}”) wasn’t met this time. No harm done.`);
}

/** Count progress from the tick's farm events. */
export function trackRequests(s: GameState, events: SimEvent[]): void {
  const open = (s.farm.requests ?? []).filter((r) => r.status === 'open');
  if (!open.length) return;
  for (const e of events) {
    for (const r of open) {
      if (r.status !== 'open') continue;
      const sold = e.type === 'deliver' && e.into === 'home';
      const hit = (r.kind === 'eggs' && sold && e.kind === 'egg')
        || (r.kind === 'carrots' && sold && e.kind === 'carrot')
        || (r.kind === 'berries' && sold && e.kind === 'berry')
        || (r.kind === 'fireflies' && e.type === 'reach' && e.kind === 'firefly')
        || (r.kind === 'water' && e.type === 'water');
      if (hit) { r.progress++; if (r.progress >= r.n) complete(s, r); }
      if (r.kind === 'noPecks' && e.type === 'peck') { r.progress = -1; expire(s, r); }
    }
  }
}

/** Judge "by nightfall" requests when night falls. */
export function nightfallRequests(s: GameState): void {
  const w = s.farm.world;
  for (const r of s.farm.requests ?? []) {
    if (r.status !== 'open' || r.until !== 'nightfall') continue;
    if (r.kind === 'noPecks') { complete(s, r); continue; }
    if (r.kind === 'gate') {
      if (w.objects.filter((o) => o.kind === 'gate' && onGround(o)).every((o) => !o.open)) complete(s, r); else expire(s, r);
      continue;
    }
    if (r.kind === 'coop') {
      const coop = w.areas?.find((a) => a.name === 'coop');
      const ok = !!coop && w.objects.filter((o) => o.kind === 'chicken' && onGround(o)).every((o) => inArea(coop, o.x, o.y));
      if (ok) complete(s, r); else expire(s, r);
      continue;
    }
    expire(s, r);
  }
}
