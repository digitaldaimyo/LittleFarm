import type { TypeExpr } from './types';

export const nominal = (name: string): TypeExpr => ({ kind: 'nominal', name });
export const generic = (name: string, ...args: string[]): TypeExpr => ({
  kind: 'generic',
  name,
  args: args.map((a) => nominal(a)),
});

/**
 * Does a card producing `out` fit a socket expecting `socket`?
 * Base names must match; a generic socket `Kind<Carryable>` requires the
 * produced type to carry every listed trait argument.
 */
export function fits(socket: TypeExpr, out: TypeExpr): boolean {
  // Qualifiers (one specific object) fit wherever a kind of thing does: "the nearest basket", "the furthest berry".
  if (socket.name === 'Kind' && out.name === 'Object' && out.kind === 'generic' && out.args.some((a) => a.name === 'Qualifier')) return true;
  if (socket.name !== out.name) return false;
  if (socket.kind === 'nominal') return true;
  const have = out.kind === 'generic' ? out.args.map((a) => a.name) : [];
  return socket.args.every((a) => have.includes(a.name));
}

export function typeToString(t: TypeExpr): string {
  if (t.kind === 'nominal') return t.name;
  return `${t.name}<${t.args.map(typeToString).join(', ')}>`;
}
