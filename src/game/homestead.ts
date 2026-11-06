/**
 * The Homestead, minimal (Academy roadmap, phase 2): decorations bought with acorns, and pets at home practising
 * what the Academy certified them in. Decorations are drawn over the farm and never block anyone; phase 3 adds
 * placement, more items and themes.
 */
import type { GameState, Pet } from './types';
import type { Invocation } from '../learning/executive';
import type { Rng } from '../sim/rng';
import { objectsAt, nearest } from '../sim/world';
import { petRecordOf } from './academy';
import { CHALLENGES, challengeBase } from './challenges';
import { getSkill } from './pets';
import { deployedRevision } from './capability';

export interface DecorItem { id: string; label: string; price: number; about: string }

export const DECOR: DecorItem[] = [
  { id: 'flowers', label: 'Flower bed', price: 3, about: 'A splash of colour by the path.' },
  { id: 'lantern', label: 'Lantern', price: 5, about: 'Glows softly at night.' },
  { id: 'bench', label: 'Garden bench', price: 6, about: 'A place to sit and watch your pets.' },
  { id: 'birdhouse', label: 'Birdhouse', price: 7, about: 'Birds visit by day.' },
  { id: 'bunting', label: 'Bunting', price: 8, about: 'Flags for a pet who passed an exam.' },
  { id: 'ribbons', label: 'Ribbon board', price: 10, about: 'Where your pets’ rosettes hang.' },
];

export interface Decoration { id: number; item: string; x: number; y: number }

const decorOf = (s: GameState): Decoration[] => (s.academy!.decor ??= []);
export const decorations = (s: GameState): Decoration[] => s.academy?.decor ?? [];

/** A free spot near the house: no object, no other decoration, not the house's door. */
function freeSpot(s: GameState): { x: number; y: number } | null {
  const w = s.farm.world;
  const home = nearest(w, 'home', 0, 0) ?? { x: 1, y: 1 };
  const taken = new Set(decorations(s).map((d) => `${d.x},${d.y}`));
  const tiles: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
    if (objectsAt(w, x, y).length || taken.has(`${x},${y}`)) continue;
    if (Math.abs(x - home.x) + Math.abs(y - home.y) <= 1) continue; // keep the door clear
    if ((w.areas ?? []).some((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h)) continue; // not in the coop
    tiles.push({ x, y, d: Math.abs(x - home.x) + Math.abs(y - home.y) });
  }
  tiles.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  return tiles[0] ?? null;
}

/** Buy a decoration with acorns; it goes on the nearest free spot by the house. */
export function buyDecoration(s: GameState, itemId: string): { ok: boolean; reason?: string } {
  const it = DECOR.find((d) => d.id === itemId);
  if (!s.academy || !it) return { ok: false, reason: 'Not something the Homestead has.' };
  if (s.academy.acorns < it.price) return { ok: false, reason: `${it.label} costs ${it.price} acorns; you have ${s.academy.acorns}.` };
  const spot = freeSpot(s);
  if (!spot) return { ok: false, reason: 'No free spot left by the house.' };
  s.academy.acorns -= it.price;
  const list = decorOf(s);
  list.push({ id: (list.at(-1)?.id ?? 0) + 1, item: it.id, ...spot });
  return { ok: true };
}

/** What each certified challenge looks like at home: the skill, what it's aimed at, and what the pet is doing. */
const HOME: Record<string, { aim: string; doing: string }> = {
  'fs-berry': { aim: '@crop', doing: 'trotting over to the ripe crops' },
  'fs-practice': { aim: '@crop', doing: 'trotting over to the ripe crops' },
  'fs-lean': { aim: '@crop', doing: 'heading straight for the ripe crops' },
  'fs-exam': { aim: '@crop', doing: 'weaving through the farm to the ripe crops' },
  'fs-pond': { aim: '@crop', doing: 'walking around the pond, not through it' },
  'fs-stay': { aim: 'well', doing: 'sitting nicely by the well' },
  'fs-clear': { aim: 'pond', doing: 'keeping well clear of the pond' },
};

/**
 * Home life (academy edition): when nothing needs doing, now and then a pet practises one of the skills it was
 * certified in, aimed at something on the farm. Null means: nap as usual.
 */
export function homeLife(s: GameState, pet: Pet, rng: Rng): Invocation | null {
  if (!s.academy || rng.next() < 0.5) return null;
  const certs = Object.keys(petRecordOf(s, pet.id).certificates);
  const options = certs.flatMap((id) => {
    const ch = CHALLENGES.find((c) => c.id === id);
    const home = HOME[id];
    if (!ch || !home) return [];
    const skill = challengeBase(ch).learner.skill;
    const rev = deployedRevision(getSkill(pet, skill));
    if (!rev || !nearest(s.farm.world, home.aim)) return [];
    return [{ skill, rev, ...home }];
  });
  if (!options.length) return null;
  const o = options[rng.int(options.length)];
  return {
    behaviorId: 'skill', args: { skill: o.skill, target: o.aim },
    intention: `At home: ${o.doing} (${o.skill}, certified at the Academy)`,
    timeout: Math.round((o.rev.maxTicks ?? 40) * (1 + pet.traits.persistence)), chosenBy: 'plan',
  };
}
