import type { GameState } from './types';
import { activePet, getSkill, isCertified } from './pets';
import { addJournal } from './journal';

export interface UnlockDef {
  id: string;
  label: string;
  describe: string;
  /** Automatic unlock condition (null = shop only). */
  when: ((s: GameState) => boolean) | null;
  progress?: (s: GameState) => { have: number; need: number; unit: string };
}

const anyPet = (s: GameState, f: (p: GameState['pets'][number]) => boolean) => s.pets.some(f);

export const UNLOCKS: UnlockDef[] = [
  { id: 'custom', label: 'Your own skills', describe: 'Invent skills: name them, choose what your pet senses and can do, and write the rules.',
    when: (s) => anyPet(s, (p) => isCertified(getSkill(p, 'Approach'))),
    progress: (s) => ({ have: anyPet(s, (p) => isCertified(getSkill(p, 'Approach'))) ? 1 : 0, need: 1, unit: 'certified Approach skill' }) },
  { id: 'fetch', label: 'Fetch lessons', describe: 'Teach pets to carry crops to the bin.',
    when: (s) => anyPet(s, (p) => isCertified(getSkill(p, 'Approach'))) && s.progress.totalCoins >= 5,
    progress: (s) => ({ have: Math.min(5, s.progress.totalCoins), need: 5, unit: 'coins earned (with a certified Approach)' }) },
  { id: 'carrots', label: 'Carrot patches', describe: 'Carrots are worth 3 coins each when delivered.',
    when: (s) => anyPet(s, (p) => isCertified(getSkill(p, 'Fetch'))),
    progress: (s) => ({ have: anyPet(s, (p) => !!getSkill(p, 'Fetch')) ? 1 : 0, need: 1, unit: 'certified Fetch skill' }) },
  { id: 'avoid', label: 'Avoid lessons', describe: 'Teach pets to keep out of the pond.',
    when: (s) => s.progress.unlocks.includes('fetch') && s.progress.totalCoins >= 12,
    progress: (s) => ({ have: Math.min(12, s.progress.totalCoins), need: 12, unit: 'coins earned' }) },
];

export interface ShopItem {
  id: string;
  label: string;
  price: number;
  describe: string;
  consumable?: boolean;
  requires?: string;
}

export const SHOP: ShopItem[] = [
  { id: 'snack', label: 'Training snack', price: 3, describe: '+40 energy for the active pet.', consumable: true },
  { id: 'trees', label: 'Tree cards', price: 4, describe: 'Trees for your pens.' },
  { id: 'fences', label: 'Fence cards', price: 6, describe: 'Fences for pen mazes.' },
  { id: 'bushes', label: 'Two more berry bushes', price: 8, describe: 'More berries to forage.' },
  { id: 'bed', label: 'Comfy bed', price: 12, describe: 'Naps restore energy twice as fast.' },
  { id: 'patch2', label: 'Third carrot patch', price: 15, describe: 'More carrots to deliver.', requires: 'carrots' },
  { id: 'adopt', label: 'Adopt another pet', price: 20, describe: 'A second trainee with their own skills.', consumable: true },
];

/** Apply automatic unlocks; returns newly unlocked ids. */
export function checkUnlocks(s: GameState): string[] {
  const out: string[] = [];
  for (const u of UNLOCKS) {
    if (s.progress.unlocks.includes(u.id) || !u.when || !u.when(s)) continue;
    s.progress.unlocks.push(u.id);
    out.push(u.id);
    addJournal(s, activePet(s)?.id ?? null, `unlock-${u.id}`, `Unlocked: ${u.label}. ${u.describe}`, true);
  }
  return out;
}

export function nextUnlock(s: GameState): { def: UnlockDef; have: number; need: number; unit: string } | null {
  for (const u of UNLOCKS) {
    if (s.progress.unlocks.includes(u.id) || !u.progress) continue;
    return { def: u, ...u.progress(s) };
  }
  return null;
}

export type BuyResult = { ok: true } | { ok: false; reason: string };

export function canBuy(s: GameState, id: string): BuyResult {
  const item = SHOP.find((i) => i.id === id);
  if (!item) return { ok: false, reason: 'Unknown item.' };
  if (!item.consumable && s.purchases.includes(id)) return { ok: false, reason: 'Already owned.' };
  if (item.requires && !s.progress.unlocks.includes(item.requires)) return { ok: false, reason: 'Not available yet.' };
  if (s.resources.coins < item.price) return { ok: false, reason: `Needs ${item.price} coins.` };
  return { ok: true };
}

/** Buy an item. `adopt` is handled by the caller (needs a name). */
export function buy(s: GameState, id: string): BuyResult {
  const c = canBuy(s, id);
  if (!c.ok) return c;
  const item = SHOP.find((i) => i.id === id)!;
  s.resources.coins -= item.price;
  if (!item.consumable) {
    s.purchases.push(id);
    if (!s.progress.unlocks.includes(id)) s.progress.unlocks.push(id);
  }
  if (id === 'snack') {
    const p = activePet(s);
    if (p) p.energy = Math.min(100, p.energy + 40);
  }
  addJournal(s, activePet(s)?.id ?? null, `buy-${id}`, `Bought: ${item.label}.`);
  return { ok: true };
}
