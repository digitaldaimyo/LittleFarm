import type { ArgValue, SpecNode, StageSpec } from './types';

let counter = 0;
export function newId(prefix = 'n'): string {
  counter = (counter + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Deterministic id factory for recipes/tests. */
export function idFactory(prefix: string) {
  let i = 0;
  return () => `${prefix}${++i}`;
}

export function node(cardId: string, args: Record<string, ArgValue> = {}, id?: string): SpecNode {
  return { id: id ?? newId(), cardId, args };
}

export function isNode(v: unknown): v is SpecNode {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as SpecNode).cardId === 'string';
}

export function childNodes(n: SpecNode): SpecNode[] {
  const out: SpecNode[] = [];
  for (const v of Object.values(n.args)) {
    if (Array.isArray(v)) out.push(...v.filter(isNode));
    else if (isNode(v)) out.push(v);
  }
  return out;
}

export function walk(n: SpecNode, fn: (n: SpecNode, parent: SpecNode | null) => void, parent: SpecNode | null = null): void {
  fn(n, parent);
  for (const c of childNodes(n)) walk(c, fn, n);
}

/** Deep clone preserving unknown fields; optionally assigning fresh ids so clones never share identity. */
export function cloneNode(n: SpecNode, freshIds = false): SpecNode {
  const args: Record<string, ArgValue> = {};
  for (const [k, v] of Object.entries(n.args)) {
    if (Array.isArray(v)) args[k] = v.map((c) => cloneNode(c, freshIds));
    else if (isNode(v)) args[k] = cloneNode(v, freshIds);
    else args[k] = v;
  }
  const out: SpecNode = { ...n, id: freshIds ? newId() : n.id, args };
  if (n.extensions) out.extensions = structuredClone(n.extensions);
  return out;
}

export function cloneStage(s: StageSpec, freshIds = false, newStageId?: string): StageSpec {
  const c: StageSpec = structuredClone(s);
  if (freshIds) {
    c.environment = c.environment.map((n) => cloneNode(n, true));
    c.rules = c.rules.map((n) => cloneNode(n, true));
    c.success = c.success ? cloneNode(c.success, true) : null;
    c.fail = c.fail ? cloneNode(c.fail, true) : null;
    if (c.learner.senses) c.learner.senses = c.learner.senses.map((n) => cloneNode(n, true));
    if (c.learner.routine) c.learner.routine = { options: c.learner.routine.options.map((n) => cloneNode(n, true)), watch: c.learner.routine.watch.map((n) => cloneNode(n, true)) };
  }
  if (newStageId) c.id = newStageId;
  return c;
}

export function findNode(root: SpecNode, id: string): SpecNode | null {
  let found: SpecNode | null = null;
  walk(root, (n) => {
    if (!found && n.id === id) found = n;
  });
  return found;
}

export function stageRoots(s: StageSpec): SpecNode[] {
  return [...s.environment, ...s.rules, ...(s.success ? [s.success] : []), ...(s.fail ? [s.fail] : []), ...(s.learner?.senses ?? []), ...(s.learner?.routine?.options ?? []), ...(s.learner?.routine?.watch ?? [])];
}

export function findInStage(s: StageSpec, id: string): SpecNode | null {
  for (const r of stageRoots(s)) {
    const f = findNode(r, id);
    if (f) return f;
  }
  return null;
}

/** Kinds placed in the stage environment. */
export function placedKinds(s: StageSpec): Set<string> {
  const out = new Set<string>();
  for (const p of s.environment) {
    const k = p.args.kind;
    if (isNode(k) && k.cardId.startsWith('kind:')) out.add(k.cardId.slice(5));
  }
  return out;
}

export function paramOf(n: SpecNode, id: string, fallback: number): number;
export function paramOf(n: SpecNode, id: string, fallback: string): string;
export function paramOf(n: SpecNode, id: string, fallback: number | string): number | string {
  const v = n.args[id];
  if (typeof fallback === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return typeof v === 'string' ? v : fallback;
}

/**
 * Saves before v5 (and skill cards before version 2) used "End try (done ✓)" — outcome 'success' — to mean
 * "stop here; SUCCESS decides". Since v5 that is 'judge', and 'success' means "counts as a success" outright.
 * Rewrites old outcomes in place anywhere in a JSON tree; returns how many it changed.
 */
export function migrateLegacyEndOutcomes(v: unknown): number {
  let n = 0;
  const visit = (x: unknown) => {
    if (Array.isArray(x)) { for (const y of x) visit(y); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (o.cardId === 'eff.end' && o.args && typeof o.args === 'object' && (o.args as Record<string, unknown>).outcome === 'success') {
      (o.args as Record<string, unknown>).outcome = 'judge';
      n++;
    }
    for (const k in o) visit(o[k]);
  };
  visit(v);
  return n;
}

/** Is this socket in use for this node? (Sockets with `when` only apply for some parameter values.) */
export function socketActive(n: SpecNode, s: { when?: { param: string; in: string[] } }, paramDefault?: unknown): boolean {
  if (!s.when) return true;
  const v = n.args[s.when.param] ?? paramDefault;
  return s.when.in.includes(String(v));
}
