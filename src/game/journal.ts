import type { GameState, JournalEntry } from './types';
import { newId } from '../domain/spec';

const MAX = 300;

export function addJournal(s: GameState, petId: string | null, kind: string, text: string, milestone = false): JournalEntry {
  const e: JournalEntry = { id: newId('j'), at: Date.now(), petId, kind, text, milestone };
  s.journal.unshift(e);
  if (s.journal.length > MAX) {
    // Milestones are kept; routine notes roll off.
    const keep = s.journal.filter((x, i) => i < MAX - 50 || x.milestone);
    s.journal = keep;
  }
  return e;
}

/** First-time helper: only log once per pet + kind key. */
export function addJournalOnce(s: GameState, petId: string | null, key: string, text: string, milestone = true): boolean {
  if (s.journal.some((j) => j.kind === key && j.petId === petId)) return false;
  addJournal(s, petId, key, text, milestone);
  return true;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
