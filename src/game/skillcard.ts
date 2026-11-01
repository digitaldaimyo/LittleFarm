import type { Pet, Skill, SkillRevision } from './types';
import { REGISTRY } from '../domain/registry';
import { migrateLegacyEndOutcomes, stageRoots, walk } from '../domain/spec';
import { STATE_MAX } from '../learning/senses';
import { addJournal } from './journal';
import type { GameState } from './types';
import { isPreset } from './pets';

/**
 * Skill cards: one skill (its active revision, senses/options and lesson) as a small JSON file
 * to share between saves. Data only — never code — and validated like a save on import.
 */
export interface SkillCard {
  format: 'pen-deck-skill';
  /** 2 since the End try outcomes changed (v5 saves); version 1 cards are migrated on import. */
  version: 1 | 2;
  exportedAt: number;
  skill: Pick<Skill, 'name' | 'kind' | 'template' | 'custom' | 'signature' | 'initiation' | 'termination' | 'navigator' | 'nickname'>;
  revision: SkillRevision;
  from?: string;
}

export function exportSkillCard(p: Pet, skillName: string): SkillCard | null {
  const k = p.skills.find((x) => x.name === skillName);
  const r = k?.revisions.find((x) => x.rev === k.activeRev);
  if (!k || !r) return null;
  return {
    format: 'pen-deck-skill', version: 2, exportedAt: Date.now(),
    skill: { name: k.name, kind: k.kind, template: k.template, custom: k.custom, signature: k.signature, initiation: k.initiation, termination: k.termination, navigator: k.navigator, nickname: k.nickname },
    revision: structuredClone(r),
    from: p.name,
  };
}

export type ImportResult = { ok: true; name: string; notes: string[] } | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validate a card and add it to a pet as a new skill revision (renaming on clash). */
export function importSkillCard(s: GameState, p: Pet, text: string): ImportResult {
  let c: any;
  try { c = JSON.parse(text); } catch { return { ok: false, reason: 'Not valid JSON.' }; }
  if (!isObj(c) || c.format !== 'pen-deck-skill' || (c.version !== 1 && c.version !== 2)) return { ok: false, reason: 'This is not a Pen Deck skill card.' };
  if (c.version === 1) { migrateLegacyEndOutcomes(c.revision); c.version = 2; }
  const k = c.skill, r = c.revision;
  if (!isObj(k) || typeof k.name !== 'string' || !k.name.trim() || !isObj(r)) return { ok: false, reason: 'The card is missing its skill or revision.' };
  const q = r.policy;
  if (!isObj(q) || q.format !== 'double-q/v1' || !Number.isInteger(q.nS) || !Number.isInteger(q.nA) || q.nS < 1 || q.nS > STATE_MAX || q.nA < 1 || q.nA > 16 || !isObj(q.rows)) {
    return { ok: false, reason: 'The card’s learned policy is missing or malformed.' };
  }
  for (const [key, row] of Object.entries(q.rows)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= q.nS || !Array.isArray(row) || row.length !== 2 * q.nA + 1 || row.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      return { ok: false, reason: 'The card’s policy table has bad entries.' };
    }
  }
  const unknown = new Set<string>();
  const check = (n: any) => walk(n, (x) => { if (!REGISTRY.cards.has(x.cardId)) unknown.add(x.cardId); });
  for (const sn of r.learner?.senses ?? []) check(sn);
  if (r.success) check(r.success);
  if (r.stage) for (const root of stageRoots(r.stage)) check(root);
  if (unknown.size) return { ok: false, reason: `The card uses cards this game doesn’t know: ${[...unknown].join(', ')}.` };
  const notes: string[] = [];
  let name = String(k.name).slice(0, 24);
  if (isPreset(name) && !p.skills.some((x) => x.name === name)) {
    // A preset arriving at a pet without it: keep the name.
  } else if (p.skills.some((x) => x.name === name)) {
    let i = 2;
    while (p.skills.some((x) => x.name === `${name} (${i})`)) i++;
    name = `${name} (${i})`;
    notes.push(`${p.name} already has a skill with that name, so it was imported as “${name}”.`);
  }
  if (r.uses?.length) {
    const missing = r.uses.map((u: any) => String(u.skill)).filter((u: string) => !p.skills.some((x) => x.name === u));
    if (missing.length) notes.push(`This routine uses ${missing.join(', ')}, which ${p.name} hasn’t learned — teach or import those too.`);
  }
  if (!isObj(r.eval) || !isObj(r.provenance)) return { ok: false, reason: 'The card is missing its evaluation record.' };
  const rev: SkillRevision = { ...(r as SkillRevision), rev: 1, createdAt: Date.now(), note: `Imported from a skill card${c.from ? ` (${String(c.from).slice(0, 20)})` : ''}.` };
  const skill: Skill = {
    id: `skill_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name, kind: k.kind === 'fetch' || k.kind === 'routine' ? k.kind : 'nav', template: k.template, custom: name !== k.name || !!k.custom || undefined,
    signature: String(k.signature ?? name), initiation: String(k.initiation ?? ''), termination: String(k.termination ?? ''),
    navigator: k.navigator === 'Avoid' ? 'Avoid' : k.navigator === 'Approach' ? 'Approach' : undefined,
    activeRev: 1, revisions: [rev],
  };
  if (isPreset(k.name) && name !== k.name) skill.custom = true;
  p.skills.push(skill);
  addJournal(s, p.id, 'import-skill', `${p.name} picked up “${name}” from a skill card${c.from ? ` shared by ${String(c.from).slice(0, 20)}` : ''}. It was ${Math.round((rev.eval?.successRate ?? 0) * 100)}% on held-out layouts where it was trained.`, true);
  return { ok: true, name, notes };
}
