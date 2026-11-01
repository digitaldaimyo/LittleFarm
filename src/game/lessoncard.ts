/**
 * Lesson cards: one lesson (pen, rules, SUCCESS/FAIL, learner setup) as a small JSON file to share between
 * saves. Data only — never code — and validated like a save on import. Learned skills are not included
 * (share those with skill cards).
 */
import type { StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { cloneStage, newId, stageRoots, walk } from '../domain/spec';
import type { GameState } from './types';

export interface LessonCard {
  format: 'pen-deck-lesson';
  version: 1;
  exportedAt: number;
  lesson: StageSpec;
}

export function exportLessonCard(stage: StageSpec): LessonCard {
  const lesson = structuredClone(stage);
  // Field Guide pens are free to train; a shared copy is an ordinary lesson.
  if (lesson.extensions) delete (lesson.extensions as Record<string, unknown>).guide;
  return { format: 'pen-deck-lesson', version: 1, exportedAt: Date.now(), lesson };
}

export type LessonImport = { ok: true; id: string; name: string; notes: string[] } | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX_BYTES = 200_000;

/** Validate a lesson card and add it as a new lesson (fresh ids; renamed on clash). */
export function importLessonCard(s: GameState, text: string): LessonImport {
  if (text.length > MAX_BYTES) return { ok: false, reason: 'That file is too big to be a lesson card.' };
  let c: any;
  try { c = JSON.parse(text); } catch { return { ok: false, reason: 'Not valid JSON.' }; }
  if (!isObj(c) || c.format !== 'pen-deck-lesson' || c.version !== 1 || !isObj(c.lesson)) return { ok: false, reason: 'This is not a Pen Deck lesson card.' };
  const L = c.lesson;
  if (!Array.isArray(L.environment) || !Array.isArray(L.rules) || !isObj(L.learner) || typeof L.learner.skill !== 'string' || !isObj(L.size) || !isObj(L.evaluation)) {
    return { ok: false, reason: 'The lesson card is missing parts of its lesson.' };
  }
  const w = Number(L.size.w), h = Number(L.size.h), ticks = Number(L.maxTicks), episodes = Number(L.learner.episodes);
  if (![w, h].every((n) => Number.isInteger(n) && n >= 4 && n <= 16)) return { ok: false, reason: 'The lesson’s pen size is out of range.' };
  if (!Number.isFinite(ticks) || ticks < 1 || ticks > 500 || !Number.isFinite(episodes) || episodes < 0 || episodes > 50000) return { ok: false, reason: 'The lesson’s time or practice settings are out of range.' };
  const unknown = new Set<string>();
  let nodes = 0;
  for (const root of stageRoots(L as StageSpec)) {
    if (!isObj(root) || typeof root.cardId !== 'string') return { ok: false, reason: 'The lesson card holds something that isn’t a card.' };
    walk(root, (n) => { nodes++; if (!REGISTRY.cards.has(n.cardId)) unknown.add(n.cardId); });
  }
  if (nodes > 2000) return { ok: false, reason: 'That lesson is too large.' };
  if (unknown.size) return { ok: false, reason: `The lesson uses cards this game doesn’t know: ${[...unknown].join(', ')}.` };
  const st = cloneStage(L as StageSpec, true, newId('stage'));
  const base = String(L.name ?? 'Shared lesson').slice(0, 40) || 'Shared lesson';
  let name = base, n = 2;
  while (s.stages.some((x) => x.name === name)) name = `${base} (${n++})`;
  st.name = name;
  st.version = 1;
  st.recipeId = 'card';
  if (st.extensions) delete (st.extensions as Record<string, unknown>).guide;
  s.stages.push(st);
  s.activeStageId = st.id;
  return { ok: true, id: st.id, name, notes: name !== base ? [`Renamed to “${name}” (you already had a lesson called “${base}”).`] : [] };
}
