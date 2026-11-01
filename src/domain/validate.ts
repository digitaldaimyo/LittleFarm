import type { Diagnostic, SpecNode, StageSpec, TypeExpr } from './types';
import type { Registry } from './registry';
import { REGISTRY, kindOfCard } from './registry';
import { fits, nominal, typeToString } from './typecheck';
import { isNode, paramOf, placedKinds, walk } from './spec';

interface Ctx {
  reg: Registry;
  itBound: boolean;
  placed: Set<string> | null; // null → don't check references (e.g. environment)
  out: Diagnostic[];
}

function title(reg: Registry, cardId: string) {
  return reg.cards.get(cardId)?.presentation.title ?? cardId;
}

export function validateNode(n: SpecNode, expected: TypeExpr, ctx: Ctx): void {
  const card = ctx.reg.cards.get(n.cardId);
  if (!card) {
    ctx.out.push({ severity: 'error', code: 'unknown-card', nodeId: n.id, message: `Unknown card “${n.cardId}”. It may come from a newer pack; it was kept but cannot run.` });
    return;
  }
  if (!fits(expected, card.output)) {
    ctx.out.push({ severity: 'error', code: 'type-mismatch', nodeId: n.id, message: `“${card.presentation.title}” makes a ${typeToString(card.output)}, but this slot needs a ${typeToString(expected)}.` });
  }
  if (card.id === 'ref.it' && !ctx.itBound) {
    ctx.out.push({ severity: 'error', code: 'scope', nodeId: n.id, message: '“It” only means something inside a rule whose WHEN event is about an object (reach, pick up, put down, deliver).' });
  }
  const kind = kindOfCard(card.id);
  if (kind && ctx.placed && !ctx.placed.has(kind)) {
    ctx.out.push({ severity: 'error', code: 'missing-reference', nodeId: n.id, message: `This refers to ${card.presentation.title}, but no ${card.presentation.title} is placed in the pen.` });
  }
  const known = new Set<string>([...card.sockets.map((s) => s.id), ...(card.params ?? []).map((p) => p.id)]);
  for (const k of Object.keys(n.args)) {
    if (!known.has(k)) ctx.out.push({ severity: 'warning', code: 'unknown-field', nodeId: n.id, message: `Field “${k}” isn't used by ${card.presentation.title}; it is kept as-is.` });
  }
  for (const s of card.sockets) {
    const v = n.args[s.id];
    const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
    if (list.some((x) => !isNode(x))) {
      ctx.out.push({ severity: 'error', code: 'bad-input', nodeId: n.id, message: `${card.presentation.title}: “${s.label}” holds something that isn't a card.` });
      continue;
    }
    if (!s.many && Array.isArray(v)) {
      ctx.out.push({ severity: 'error', code: 'bad-input', nodeId: n.id, message: `${card.presentation.title}: “${s.label}” takes only one card.` });
    }
    if (s.required && list.length === 0) {
      ctx.out.push({ severity: 'error', code: 'missing-input', nodeId: n.id, message: `${card.presentation.title} needs a card in “${s.label}”.` });
    }
    for (const c of list as SpecNode[]) validateNode(c, s.type, ctx);
  }
  for (const p of card.params ?? []) {
    const v = n.args[p.id];
    if (v === undefined) continue;
    if (p.kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) ctx.out.push({ severity: 'error', code: 'bad-param', nodeId: n.id, message: `${card.presentation.title}: “${p.label}” must be a number.` });
      else if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) ctx.out.push({ severity: 'error', code: 'bad-param', nodeId: n.id, message: `${card.presentation.title}: “${p.label}” must be between ${p.min} and ${p.max}.` });
    } else if (p.kind === 'choice') {
      if (!p.choices?.some((c) => c.value === v)) ctx.out.push({ severity: 'error', code: 'bad-param', nodeId: n.id, message: `${card.presentation.title}: “${String(v)}” isn't a valid choice for ${p.label}.` });
    } else if (typeof v !== 'string') {
      ctx.out.push({ severity: 'error', code: 'bad-param', nodeId: n.id, message: `${card.presentation.title}: “${p.label}” must be text.` });
    }
  }
}

function eventBindsIt(reg: Registry, rule: SpecNode): boolean {
  const ev = rule.args.when;
  return isNode(ev) && !!reg.cards.get(ev.cardId)?.bindsIt;
}

function effectsOf(rule: SpecNode): SpecNode[] {
  const t = rule.args.then;
  return (Array.isArray(t) ? t : isNode(t) ? [t] : []) as SpecNode[];
}

function rewardTotal(rule: SpecNode): number {
  let r = 0;
  for (const e of effectsOf(rule)) {
    if (e.cardId === 'eff.reward') r += paramOf(e, 'amount', 0);
    if (e.cardId === 'eff.penalty') r -= paramOf(e, 'amount', 0);
  }
  return r;
}

function limitOf(rule: SpecNode): string {
  const l = rule.args.limit;
  return isNode(l) ? l.cardId : 'lim.every';
}

export function validateStage(stage: StageSpec, reg: Registry = REGISTRY, unlocks?: Set<string>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const placed = placedKinds(stage);
  const envCtx: Ctx = { reg, itBound: false, placed: null, out };
  if (stage.size.w < 4 || stage.size.h < 4 || stage.size.w > 16 || stage.size.h > 16) out.push({ severity: 'error', code: 'bad-size', message: 'Pens must be between 4×4 and 16×16 tiles.' });
  for (const p of stage.environment) {
    validateNode(p, nominal('Placement'), envCtx);
    const k = p.args.kind;
    if (isNode(k)) {
      const card = reg.cards.get(k.cardId);
      const obj = reg.objects.get(kindOfCard(k.cardId) ?? '');
      if (obj && !obj.penPlaceable) out.push({ severity: 'error', code: 'not-placeable', nodeId: p.id, message: `${obj.name} can only exist on the farm.` });
      if (card?.unlock && unlocks && !unlocks.has(card.unlock)) out.push({ severity: 'error', code: 'locked', nodeId: p.id, message: `${card.presentation.title} isn't unlocked yet.` });
    }
    if (p.cardId === 'place.fixed' || p.cardId === 'place.pet') {
      const x = paramOf(p, 'x', 0), y = paramOf(p, 'y', 0);
      if ((p.cardId === 'place.fixed' || paramOf(p, 'mode', 'random') === 'fixed') && (x >= stage.size.w || y >= stage.size.h)) out.push({ severity: 'error', code: 'out-of-bounds', nodeId: p.id, message: 'That tile is outside the pen.' });
    }
  }
  const ruleCtx: Ctx = { reg, itBound: false, placed, out };
  for (const r of stage.rules) {
    if (r.cardId !== 'rule') {
      out.push({ severity: 'error', code: 'type-mismatch', nodeId: r.id, message: 'Only Rule cards go on the rule mat.' });
      continue;
    }
    validateNode(r, nominal('Rule'), { ...ruleCtx, itBound: eventBindsIt(reg, r) });
  }
  if (!stage.success) out.push({ severity: 'error', code: 'no-success', message: 'Add a SUCCESS condition so we can tell when the pet got it right.' });
  else validateNode(stage.success, nominal('Condition'), ruleCtx);
  if (stage.fail) validateNode(stage.fail, nominal('Condition'), ruleCtx);

  const L = stage.learner;
  if (!placed.has(L.focus)) out.push({ severity: 'error', code: 'missing-reference', message: `${L.skill} is pointed at ${reg.objects.get(L.focus)?.name ?? L.focus}, but none is placed in the pen.` });
  if (L.skill === 'Fetch' && (!L.destination || !placed.has(L.destination))) out.push({ severity: 'error', code: 'missing-reference', message: 'Fetch needs a destination (like a Bin) placed in the pen.' });
  if (L.skill === 'Fetch' && !reg.objects.get(L.focus)?.carryable) out.push({ severity: 'error', code: 'type-mismatch', message: 'Fetch can only carry Carryable things.' });

  // ---- Static reward warnings (heuristics, not proofs) ----
  if (stage.rules.length === 0) out.push({ severity: 'warning', code: 'no-rules', message: 'No rules yet — the pet gets no treats, so it has nothing to learn from.' });
  if (!stage.rules.some((r) => rewardTotal(r) > 0)) out.push({ severity: 'warning', code: 'no-reward', message: 'Nothing gives a treat. Pets learn much faster when success pays.' });
  let pickPay = false, dropPay = false;
  for (const r of stage.rules) {
    const ev = r.args.when;
    if (!isNode(ev)) continue;
    const reward = rewardTotal(r);
    const lim = limitOf(r);
    const label = paramOf(r, 'label', 'rule');
    if (ev.cardId === 'ev.tick' && reward > 0) out.push({ severity: 'warning', code: 'unbounded-reward', nodeId: r.id, message: `“${label}” pays every step. The pet can earn it forever by dawdling.`, repair: { label: 'Make it a nudge (−)', action: 'flip-tick', ruleId: r.id } });
    if ((ev.cardId === 'ev.pickup' || ev.cardId === 'ev.drop' || ev.cardId === 'ev.reach') && reward > 0 && (lim === 'lim.every' || lim === 'lim.cooldown')) {
      const repeat = ev.cardId === 'ev.reach' ? effectsOf(r).some((e) => e.cardId === 'eff.end') ? false : true : true;
      if (repeat) out.push({ severity: 'warning', code: 'repeatable-reward', nodeId: r.id, message: `“${label}” can pay again and again for the same thing. The pet may learn to repeat it instead of finishing the job.`, repair: { label: 'Limit: once per object', action: 'limit-per-object', ruleId: r.id } });
    }
    if (ev.cardId === 'ev.pickup' && reward > 0 && lim !== 'lim.once' && lim !== 'lim.perObject') pickPay = true;
    if (ev.cardId === 'ev.drop' && reward > 0 && lim !== 'lim.once' && lim !== 'lim.perObject') dropPay = true;
    if (L.skill !== 'Fetch' && (ev.cardId === 'ev.pickup' || ev.cardId === 'ev.drop' || ev.cardId === 'ev.deliver')) out.push({ severity: 'info', code: 'unusable-event', nodeId: r.id, message: `${L.skill} only moves around, so “${label}” will never fire while training it.` });
    const conds = r.args.if;
    const hasCloser = (Array.isArray(conds) ? conds : []).some((c) => isNode(c) && c.cardId === 'cond.closer');
    if (hasCloser && reward > 0 && !stage.rules.some((o) => rewardTotal(o) < 0)) out.push({ severity: 'warning', code: 'shaping-loop', nodeId: r.id, message: `“${label}” pays for getting closer but nothing costs moving away — wiggling back and forth may pay.`, repair: { label: 'Add a step nudge', action: 'add-tick-penalty' } });
  }
  if (pickPay && dropPay) out.push({ severity: 'warning', code: 'inverse-loop', message: 'Both picking up and putting down pay. Doing one then the other is an endless treat loop.' });

  // Reachability with fixed solids only (random placements are re-rolled by the simulator).
  const fixedSolid = new Set<string>();
  for (const p of stage.environment) {
    const k = p.args.kind;
    if (p.cardId === 'place.fixed' && isNode(k) && reg.objects.get(kindOfCard(k.cardId) ?? '')?.solid) fixedSolid.add(`${paramOf(p, 'x', 0)},${paramOf(p, 'y', 0)}`);
  }
  const free = stage.size.w * stage.size.h - fixedSolid.size;
  if (free < 4) out.push({ severity: 'error', code: 'unreachable', message: 'The pen is almost entirely blocked.' });
  for (const p of stage.environment) {
    const k = p.args.kind;
    if (p.cardId !== 'place.fixed' || !isNode(k) || kindOfCard(k.cardId) !== L.focus) continue;
    const x = paramOf(p, 'x', 0), y = paramOf(p, 'y', 0);
    const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < stage.size.w && b < stage.size.h && !fixedSolid.has(`${a},${b}`));
    if (nb.length === 0) out.push({ severity: 'error', code: 'unreachable', nodeId: p.id, message: `The ${reg.objects.get(L.focus)?.name} at (${x},${y}) is walled in — the goal is unreachable.` });
  }
  return out;
}

export function hasErrors(d: Diagnostic[]): boolean {
  return d.some((x) => x.severity === 'error');
}

/** All nodes in a stage with their nearest rule (for UI highlighting). */
export function nodesWithErrors(d: Diagnostic[]): Set<string> {
  return new Set(d.filter((x) => x.nodeId && x.severity === 'error').map((x) => x.nodeId!));
}

export { walk, title };
