import type { CardDef, Diagnostic, SpecNode, StageSpec, TypeExpr } from './types';
import type { Registry } from './registry';
import { REGISTRY, kindOfCard } from './registry';
import { fits, generic, nominal, typeToString } from './typecheck';
import { isNode, paramOf, placedKinds, socketActive, walk } from './spec';

interface Ctx {
  reg: Registry;
  itBound: boolean;
  placed: Set<string> | null; // null → don't check references (e.g. environment)
  out: Diagnostic[];
  /** What “the target” means in this stage (its traits decide which sockets it fits). */
  target?: string;
  /** Area names defined in the pen (null → don't check). */
  areas?: Set<string>;
}

/** The type a card produces here; “the target” takes on the traits of whatever the skill is aimed at. */
export function effectiveOutput(reg: Registry, card: CardDef, target?: string): TypeExpr {
  if (card.id === 'ref.target' && target) {
    const o = reg.objects.get(target);
    if (o) return generic('Kind', ...o.traits);
  }
  return card.output;
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
  const outT = effectiveOutput(ctx.reg, card, ctx.target);
  if (!fits(expected, outT)) {
    ctx.out.push({ severity: 'error', code: 'type-mismatch', nodeId: n.id, message: card.id === 'ref.target' ? `“The target” is aimed at ${ctx.reg.objects.get(ctx.target ?? '')?.name ?? 'something'}, which doesn't fit a ${typeToString(expected)} slot.` : `“${card.presentation.title}” makes a ${typeToString(outT)}, but this slot needs a ${typeToString(expected)}.` });
  }
  if (card.id === 'ref.it' && !ctx.itBound) {
    ctx.out.push({ severity: 'error', code: 'scope', nodeId: n.id, message: '“It” only means something inside a rule whose WHEN event is about an object (reach, pick up, put down, deliver).' });
  }
  if (card.id === 'area.named' && ctx.areas && !ctx.areas.has(String(n.args.name ?? ''))) {
    ctx.out.push({ severity: 'error', code: 'missing-reference', nodeId: n.id, message: `There is no area called “${String(n.args.name ?? '')}” in the pen. Add one with the Area card (on the farm, the coop is called “coop”).` });
  }
  const kind = kindOfCard(card.id);
  if (kind && ctx.placed && !ctx.placed.has(kind)) {
    ctx.out.push({ severity: 'error', code: 'missing-reference', nodeId: n.id, message: `This refers to ${card.presentation.title}, but no ${card.presentation.title} is placed in the pen.` });
  }
  const known = new Set<string>([...card.sockets.map((s) => s.id), ...(card.params ?? []).map((p) => p.id), ...(card.id === 'rule' ? ['off'] : [])]);
  if (card.id === 'rule' && n.args.off !== undefined && n.args.off !== 0 && n.args.off !== 1) ctx.out.push({ severity: 'error', code: 'bad-param', nodeId: n.id, message: 'A rule is either on or off.' });
  for (const k of Object.keys(n.args)) {
    if (!known.has(k)) ctx.out.push({ severity: 'warning', code: 'unknown-field', nodeId: n.id, message: `Field “${k}” isn't used by ${card.presentation.title}; it is kept as-is.` });
  }
  for (const s of card.sockets) {
    if (!socketActive(n, s, card.params?.find((p) => p.id === s.when?.param)?.default)) continue; // e.g. "next to …" when the region isn't "next to"
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
  const areas = new Set(stage.environment.filter((p) => p.cardId === 'zone.rect').map((p) => String(p.args.name ?? 'coop')));
  const envAreas = new Set(stage.environment.filter((p) => p.cardId === 'zone.rect').map((p) => String(p.args.name ?? 'coop')));
  const envCtx: Ctx = { reg, itBound: false, placed: null, out, target: stage.learner.focus, areas: envAreas };
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
    if (p.cardId === 'place.obstacles' && paramOf(p, 'kind', 'rocks') !== 'rocks' && unlocks && !unlocks.has('fences')) out.push({ severity: 'error', code: 'locked', nodeId: p.id, message: 'Fence obstacles need the Fence cards from the shop. Use rocks for now.' });
    const ref = p.args.ref;
    const refMode = p.cardId === 'place.random' ? paramOf(p, 'region', 'anywhere') : p.cardId === 'place.pet' ? paramOf(p, 'mode', 'random') : '';
    if ((refMode === 'nextTo' || refMode === 'awayFrom') && isNode(ref)) {
      const rk = ref.cardId === 'ref.target' ? stage.learner.focus : kindOfCard(ref.cardId);
      if (rk && !placedKinds(stage).has(rk)) out.push({ severity: 'warning', code: 'placement-ref-missing', nodeId: p.id, message: `This is placed relative to ${reg.objects.get(rk)?.name ?? rk}, but there's none in the pen — it falls back to anywhere.` });
    }
    if (p.cardId === 'place.fixed' || p.cardId === 'place.pet') {
      const x = paramOf(p, 'x', 0), y = paramOf(p, 'y', 0);
      if ((p.cardId === 'place.fixed' || paramOf(p, 'mode', 'random') === 'fixed') && (x >= stage.size.w || y >= stage.size.h)) out.push({ severity: 'error', code: 'out-of-bounds', nodeId: p.id, message: 'That tile is outside the pen.' });
    }
  }
  const names = stage.environment.filter((p) => p.cardId === 'zone.rect').map((p) => String(p.args.name ?? ''));
  if (new Set(names).size !== names.length) out.push({ severity: 'error', code: 'duplicate-area', message: 'Two areas share a name — give each area its own name.' });
  if (names.some((n) => !n.trim())) out.push({ severity: 'error', code: 'unnamed-area', message: 'Every area needs a name.' });
  const ruleCtx: Ctx = { reg, itBound: false, placed, out, target: stage.learner.focus, areas };
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
  const template = L.template ?? (L.skill === 'Fetch' ? 'fetch' : 'sense');
  if (!L.skill.trim()) out.push({ severity: 'error', code: 'no-name', message: 'Give this skill a name.' });
  if (template === 'sense') {
    const senses = L.senses ?? [];
    if (L.senses && senses.length === 0) out.push({ severity: 'error', code: 'no-senses', message: 'Pick at least one Sense — otherwise the pet is learning blindfolded.' });
    if (senses.length > 5) out.push({ severity: 'error', code: 'too-many-senses', message: 'At most 5 senses per skill.' });
    const senseCtx: Ctx = { reg, itBound: false, placed: null, out, target: L.focus, areas };
    let size = 1;
    for (const sn of senses) {
      validateNode(sn, nominal('Sense'), senseCtx);
      size *= reg.cards.get(sn.cardId)?.radix ?? 1;
      const w = sn.args.what;
      const k = isNode(w) ? kindOfCard(w.cardId) : null;
      if (k && !placed.has(k)) out.push({ severity: 'warning', code: 'sense-missing', nodeId: sn.id, message: `This skill watches for ${reg.objects.get(k)?.name ?? k}, but none is in the pen, so it can't learn what that sense means.` });
    }
    if (size > 100000) out.push({ severity: 'error', code: 'state-budget', message: `These senses make ${size.toLocaleString()} situations to learn — too many for one pet (max 100,000). Drop a sense or use a cheaper one (e.g. “How far is…” instead of “Where is…”).` });
    else if (size > 50000) out.push({ severity: 'warning', code: 'state-budget', message: `${size.toLocaleString()} situations to learn — this will need lots of practice tries.` });
    if (!stage.abilities.length) out.push({ severity: 'error', code: 'no-abilities', message: 'Give the skill at least one ability (Move, Stay…).' });
  }
  if (template === 'routine') {
    const R = L.routine ?? { options: [], watch: [] };
    if (R.options.length < 1) out.push({ severity: 'error', code: 'no-options', message: 'Give the routine at least one option (Use skill / Do action) to choose from.' });
    if (R.options.length > 6) out.push({ severity: 'error', code: 'too-many-options', message: 'At most 6 options per routine.' });
    if (R.watch.length > 4) out.push({ severity: 'error', code: 'too-many-watch', message: 'A routine can watch at most 4 conditions (16 situations).' });
    if (R.watch.length === 0) out.push({ severity: 'warning', code: 'no-watch', message: 'The routine watches nothing, so it can only learn one fixed order. Add a condition to watch (e.g. “chicken in coop”).' });
    const optCtx: Ctx = { reg, itBound: false, placed, out, target: L.focus, areas };
    for (const o of R.options) {
      validateNode(o, nominal('Option'), optCtx);
      if (o.cardId === 'opt.skill' && !String(o.args.skill ?? '').trim()) out.push({ severity: 'error', code: 'no-skill', nodeId: o.id, message: 'Pick which saved skill this option uses.' });
      if (o.cardId === 'opt.skill' && String(o.args.skill) === L.skill) out.push({ severity: 'error', code: 'self-reference', nodeId: o.id, message: 'A routine can’t use itself as an option.' });
    }
    for (const c of R.watch) validateNode(c, nominal('Condition'), optCtx);
  }
  if (!placed.has(L.focus)) out.push({ severity: 'error', code: 'missing-reference', message: `${L.skill} is pointed at ${reg.objects.get(L.focus)?.name ?? L.focus}, but none is placed in the pen.` });
  if (template === 'fetch' && (!L.destination || !placed.has(L.destination))) out.push({ severity: 'error', code: 'missing-reference', message: 'Fetch needs a destination (like a Bin) placed in the pen.' });
  if (template === 'fetch' && !reg.objects.get(L.focus)?.carryable) out.push({ severity: 'error', code: 'type-mismatch', message: 'Fetch can only carry Carryable things.' });

  memoryChecks(stage, reg, out, template);

  // ---- Static reward warnings (heuristics, not proofs) ----
  const onRules = stage.rules.filter((r) => r.args.off !== 1); // switched-off rules don't run
  if (onRules.length === 0) out.push({ severity: 'warning', code: 'no-rules', message: 'No rules yet — the pet gets no treats, so it has nothing to learn from.' });
  if (!onRules.some((r) => rewardTotal(r) > 0)) out.push({ severity: 'warning', code: 'no-reward', message: 'Nothing gives a treat. Pets learn much faster when success pays.' });
  let pickPay = false, dropPay = false;
  for (const r of onRules) {
    const ev = r.args.when;
    if (!isNode(ev)) continue;
    const reward = rewardTotal(r);
    const lim = limitOf(r);
    const label = paramOf(r, 'label', 'rule');
    const ends = effectsOf(r).some((e) => e.cardId === 'eff.end') || lim === 'lim.once' || lim === 'lim.perObject';
    if (ev.cardId === 'ev.tick' && reward > 0 && !ends && stage.outcome !== 'survive') out.push({ severity: 'warning', code: 'unbounded-reward', nodeId: r.id, message: `“${label}” pays every step. The pet can earn it forever by dawdling.`, repair: { label: 'Make it a nudge (−)', action: 'flip-tick', ruleId: r.id } });
    if (['ev.pickup', 'ev.drop', 'ev.reach', 'ev.shoo', 'ev.entersArea', 'ev.leavesArea', 'ev.stay'].includes(ev.cardId) && ev.cardId !== 'ev.stay' && reward > 0 && (lim === 'lim.every' || lim === 'lim.cooldown')) {
      // A rule that ends the try can only pay once per try, whatever its event.
      const repeat = !effectsOf(r).some((e) => e.cardId === 'eff.end');
      if (repeat) out.push({ severity: 'warning', code: 'repeatable-reward', nodeId: r.id, message: `“${label}” can pay again and again for the same thing. The pet may learn to repeat it instead of finishing the job.`, repair: { label: 'Limit: once per object', action: 'limit-per-object', ruleId: r.id } });
    }
    if (ev.cardId === 'ev.pickup' && reward > 0 && lim !== 'lim.once' && lim !== 'lim.perObject') pickPay = true;
    if (ev.cardId === 'ev.drop' && reward > 0 && lim !== 'lim.once' && lim !== 'lim.perObject') dropPay = true;
    const fetchT = (L.template ?? (L.skill === 'Fetch' ? 'fetch' : 'sense')) !== 'sense';
    const needs: Record<string, string> = { 'ev.pickup': 'pickup', 'ev.drop': 'drop', 'ev.deliver': 'drop', 'ev.stay': 'stay', 'ev.fill': 'water', 'ev.water': 'water', 'ev.shoo': 'shoo', 'ev.gate': 'nudge', 'ev.plant': 'plant' };
    const need = needs[ev.cardId];
    if (need && !fetchT && !stage.abilities.includes(need)) out.push({ severity: 'info', code: 'unusable-event', nodeId: r.id, message: `“${label}” needs the ${need === 'pickup' ? 'Pick up' : need === 'drop' ? 'Put down' : need === 'water' ? 'Water' : need === 'shoo' ? 'Shoo' : need === 'nudge' ? 'Nudge gate' : need === 'plant' ? 'Plant' : 'Stay'} ability, which ${L.skill} doesn’t have — it will never fire.` });
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

/** Validate free-standing nodes (e.g. farm-plan rows) against a type, with a known set of kinds and areas. */
export function validateNodes(nodes: SpecNode[], type: TypeExpr, opts: { placed: Set<string>; areas: Set<string>; reg?: Registry }): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ctx: Ctx = { reg: opts.reg ?? REGISTRY, itBound: false, placed: opts.placed, out, target: 'berry', areas: opts.areas };
  for (const n of nodes) validateNode(n, type, ctx);
  // In farm plans, "Has done…" counts from the start of the job that is finishing (rows are tried between jobs).
  for (const n of nodes) walk(n, (x) => {
    const ev = x.args.event;
    if ((x.cardId === 'cond.happened' || x.cardId === 'cond.just') && isNode(ev) && ev.cardId === 'ev.tick') out.push({ severity: 'warning', code: 'memory-every-step', nodeId: x.id, message: '“Every step” always happens — pick a real event.' });
  });
  return out;
}

/** Cards that remember what happened (this try). */
export const MEMORY = new Set(['cond.happened', 'cond.just', 'sense.did']);

/** An event card's meaning, ignoring node ids (to compare a "Has …" condition with a "Done … yet?" sense). */
export function eventSignature(n: unknown): string {
  return JSON.stringify(n, (k, v) => (k === 'id' ? undefined : v));
}

/**
 * Memory checks: "Has …" / "Just …" need a real event, and when a reward or a still-running try depends on
 * something the pet can't sense ("have I shooed yet?"), suggest the matching "Done … yet?" sense.
 */
function memoryChecks(stage: StageSpec, reg: Registry, out: Diagnostic[], template: string): void {
  const sensed = new Set((stage.learner.senses ?? []).filter((s) => s.cardId === 'sense.did').map((s) => eventSignature(s.args.event)));
  const seen = new Set<string>();
  const check = (n: SpecNode, matters: boolean) => {
    if (n.cardId !== 'cond.happened' && n.cardId !== 'cond.just') return;
    const ev = n.args.event;
    if (isNode(ev) && ev.cardId === 'ev.tick') out.push({ severity: 'warning', code: 'memory-every-step', nodeId: n.id, message: `“Every step” always happens, so “${title(reg, n.cardId)}” would always be true. Pick a real event (Shoos, Picks up…).` });
    if (!matters || template !== 'sense' || n.cardId !== 'cond.happened' || !isNode(ev)) return;
    const sig = eventSignature(ev);
    if (sensed.has(sig) || seen.has(sig)) return;
    seen.add(sig);
    out.push({ severity: 'warning', code: 'memory-unsensed', nodeId: n.id,
      message: `${stage.learner.skill} is judged or paid on whether “${title(reg, ev.cardId)}” has happened, but it can’t sense that — so “before” and “after” look the same to it. Add the “Done … yet?” sense for it.`,
      repair: { label: 'Add the “Done … yet?” sense', action: 'add-did-sense', ruleId: n.id } });
  };
  // In a rule's IF it gates a treat, and the try goes on afterwards: the pet needs to know.
  for (const r of stage.rules) for (const c of Array.isArray(r.args.if) ? r.args.if : []) if (isNode(c)) walk(c, (x) => check(x, true));
  // As the whole SUCCESS (counted once) the try simply ends when it happens; nested or counted more, it goes on.
  for (const root of [stage.success, stage.fail]) {
    if (!root) continue;
    walk(root, (x) => check(x, x !== root || paramOf(x, 'count', 1) > 1));
  }
}
