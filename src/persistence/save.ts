import type { GameState } from '../game/types';
import { SAVE_VERSION } from '../game/types';
import { newGame } from '../game/state';
import { REGISTRY } from '../domain/registry';
import { stageRoots, walk } from '../domain/spec';
import type { SpecNode } from '../domain/types';

export interface SaveEnvelope {
  format: 'pen-deck-save';
  version: number;
  exportedAt: number;
  game: GameState;
}

export interface LoadResult {
  ok: boolean;
  game?: GameState;
  diagnostics: string[];
}

export function serializeGame(g: GameState): string {
  const env: SaveEnvelope = { format: 'pen-deck-save', version: SAVE_VERSION, exportedAt: Date.now(), game: g };
  return JSON.stringify(env);
}

type Migration = (g: any) => any;
/** version N → N+1 migrations. Add new entries here; never edit old ones. */
const MIGRATIONS: Record<number, Migration> = {};

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Parse and sanitise a save. Unknown fields are preserved (round-trip), unknown card ids
 * are reported with a diagnostic (never silently dropped), and no code is ever executed.
 */
export function parseGame(text: string): LoadResult {
  const diagnostics: string[] = [];
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, diagnostics: ['This file is not valid JSON.'] };
  }
  if (!isObj(raw) || raw.format !== 'pen-deck-save' || !isObj(raw.game)) return { ok: false, diagnostics: ['This is not a Pen Deck save file.'] };
  let g: any = raw.game;
  let v = Number(g.version) || 1;
  if (v > SAVE_VERSION) return { ok: false, diagnostics: [`This save is from a newer version (v${v}). Please update the game.`] };
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return { ok: false, diagnostics: [`No migration from save v${v}.`] };
    g = m(g);
    v++;
    diagnostics.push(`Migrated save to v${v}.`);
  }
  // Fill missing top-level sections from a fresh game; keep everything else (including unknown keys).
  const base = newGame();
  for (const k of Object.keys(base) as (keyof GameState)[]) {
    if (g[k] === undefined) {
      g[k] = base[k];
      diagnostics.push(`Missing “${k}” — using defaults.`);
    }
  }
  const required: [string, (x: any) => boolean][] = [
    ['pets', Array.isArray], ['stages', Array.isArray], ['journal', Array.isArray], ['templates', Array.isArray],
    ['resources', isObj], ['progress', isObj], ['farm', isObj], ['settings', isObj],
  ];
  for (const [k, ok] of required) if (!ok(g[k])) return { ok: false, diagnostics: [...diagnostics, `Save field “${k}” is malformed.`] };
  for (const key of ['coins', 'berries', 'carrots']) {
    const n = Number(g.resources[key]);
    g.resources[key] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (!isObj(g.farm.world) || !Array.isArray(g.farm.world.objects)) return { ok: false, diagnostics: [...diagnostics, 'Farm world is malformed.'] };
  for (const p of g.pets) {
    if (!isObj(p) || typeof p.id !== 'string' || !Array.isArray(p.skills)) return { ok: false, diagnostics: [...diagnostics, 'A pet entry is malformed.'] };
    p.name = String(p.name ?? 'Pet').slice(0, 20);
    p.energy = clamp(Number(p.energy), 0, 100, 100);
    p.mood = clamp(Number(p.mood), 0, 100, 60);
    for (const k of p.skills) {
      if (!Array.isArray(k.revisions)) return { ok: false, diagnostics: [...diagnostics, `Skill ${k.name} is malformed.`] };
      for (const r of k.revisions) if (!isObj(r.policy) || r.policy.format !== 'double-q/v1') return { ok: false, diagnostics: [...diagnostics, `Skill ${k.name} r${r.rev} has an unknown policy format.`] };
    }
  }
  for (const s of g.stages) {
    if (!isObj(s) || !Array.isArray(s.environment) || !Array.isArray(s.rules)) return { ok: false, diagnostics: [...diagnostics, 'A stage is malformed.'] };
    for (const root of stageRoots(s as any)) {
      walk(root as SpecNode, (n) => {
        if (!REGISTRY.cards.has(n.cardId)) diagnostics.push(`Stage “${s.name}”: unknown card “${n.cardId}” kept but disabled (from a newer or missing pack).`);
      });
    }
  }
  g.version = SAVE_VERSION;
  return { ok: true, game: g as GameState, diagnostics };
}

function clamp(x: number, lo: number, hi: number, d: number): number {
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
}
