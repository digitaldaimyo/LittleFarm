/**
 * Plain-language read-back of cards: "When Pip shoos a chicken: treat 10, end try (judged by SUCCESS)".
 * Built from each card's phrase template, so every card reads the way its chip does.
 */
import type { SpecNode } from './types';
import { REGISTRY } from './registry';
import { isNode, socketActive } from './spec';

export interface DescribeCtx {
  petName: string;
  /** What "the target" is aimed at (object id), if known. */
  target?: string;
}

function paramText(n: SpecNode, id: string): string {
  const card = REGISTRY.cards.get(n.cardId);
  const p = card?.params?.find((x) => x.id === id);
  const v = n.args[id] ?? p?.default;
  if (p?.kind === 'choice') return p.choices?.find((c) => c.value === v)?.label ?? String(v);
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return String(v ?? '');
}

/** One card (and everything inside it) as words. Empty slots read as "…". */
export function describe(n: SpecNode | null | undefined, ctx: DescribeCtx): string {
  if (!n) return '…';
  const card = REGISTRY.cards.get(n.cardId);
  if (!card) return n.cardId;
  if (n.cardId === 'actor.pet') return ctx.petName;
  if (n.cardId === 'ref.target') {
    const o = ctx.target ? REGISTRY.objects.get(ctx.target)?.name : undefined;
    return o && o.toLowerCase() !== 'target' ? `the target (${o.toLowerCase()})` : 'the target';
  }
  if (card.presentation.group === 'kind') return card.presentation.title.toLowerCase();
  if (n.cardId === 'area.named') return `the ${String(n.args.name ?? 'area')}`;
  if (n.cardId === 'cond.and' || n.cardId === 'cond.any') {
    const list = (Array.isArray(n.args[n.cardId === 'cond.and' ? 'all' : 'any']) ? n.args[n.cardId === 'cond.and' ? 'all' : 'any'] : []) as SpecNode[];
    const parts = list.filter(isNode).map((c) => describe(c, ctx));
    if (!parts.length) return '…';
    return parts.length === 1 ? parts[0] : parts.join(n.cardId === 'cond.and' ? ' and ' : ' or ');
  }
  if (n.cardId === 'cond.happened') {
    const count = Number(n.args.count ?? 1);
    return `“${describe(isNode(n.args.event) ? n.args.event : null, ctx)}” has happened${count > 1 ? ` at least ${count} times` : ''}`;
  }
  if (n.cardId === 'cond.just') return `“${describe(isNode(n.args.event) ? n.args.event : null, ctx)}” just happened`;
  const phrase = card.presentation.phrase ?? card.presentation.title;
  return phrase.replace(/\{([a-zA-Z]+)\}/g, (_, id: string) => {
    const sock = card.sockets.find((s) => s.id === id);
    if (sock && !socketActive(n, sock, card.params?.find((p) => p.id === sock.when?.param)?.default)) return '';
    if (sock) {
      const v = n.args[id];
      if (Array.isArray(v)) { const parts = v.filter(isNode).map((c) => describe(c, ctx)); return parts.length ? parts.join(', ') : '…'; }
      return isNode(v) ? describe(v, ctx) : sock.required ? '…' : '';
    }
    return paramText(n, id);
  }).replace(/\s+/g, ' ').trim();
}

/** A whole rule: "When …, if … and …: …, … (once per try)". */
export function describeRule(r: SpecNode, ctx: DescribeCtx): string {
  const conds = (Array.isArray(r.args.if) ? r.args.if : []).filter(isNode).map((c) => describe(c, ctx));
  const thens = (Array.isArray(r.args.then) ? r.args.then : []).filter(isNode).map((c) => describe(c, ctx));
  const lim = isNode(r.args.limit) && r.args.limit.cardId !== 'lim.every' ? ` (${describe(r.args.limit, ctx)})` : '';
  const ev = isNode(r.args.when) ? r.args.when : null;
  const start = ev?.cardId === 'ev.tick' ? 'Every step' : `When ${ev ? describe(ev, ctx) : '…'}`;
  return `${r.args.off === 1 ? '(Switched off) ' : ''}${start}${conds.length ? `, if ${conds.join(' and ')}` : ''}: ${thens.length ? thens.join(', ') : 'nothing yet'}${lim}.`;
}
