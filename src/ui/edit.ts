import type { SocketDef, SpecNode, StageSpec, Template, TypeExpr } from '../domain/types';
import { socketActive } from '../domain/spec';
import { REGISTRY } from '../domain/registry';
import { cloneNode, findInStage, findNode, isNode, newId, node, walk } from '../domain/spec';
import { fits, nominal } from '../domain/typecheck';
import type { SlotRef } from './store';
import type { SlotRole } from '../domain/hand';

/** New node from a card with default params; the only Actor (the pet) is filled in automatically. */
export function createNode(cardId: string, stage?: StageSpec): SpecNode {
  const card = REGISTRY.cards.get(cardId);
  const n = node(cardId);
  if (!card) return n;
  for (const p of card.params ?? []) n.args[p.id] = p.default;
  // Note cards start with a note name the lesson already uses (so a typo can't quietly start a second note).
  if (NOTE_CARDS.includes(cardId) && stage) { const used = noteNames(stage); if (used.length) n.args.name = used[0]; }
  for (const s of card.sockets) {
    if (s.type.name === 'Actor' && s.required) n.args[s.id] = node('actor.pet');
    if (s.many) n.args[s.id] = [];
  }
  if (cardId === 'rule') n.args.label = 'New rule';
  return n;
}

export interface SlotInfo {
  socket: SocketDef;
  current: SpecNode | null;
  parent: SpecNode | null;
  itBound: boolean;
}

const STAGE_SOCKETS: Record<string, SocketDef> = {
  '#success': { id: 'success', label: 'Success', type: nominal('Condition'), required: true },
  '#fail': { id: 'fail', label: 'Fail', type: nominal('Condition'), required: false },
  '#senses': { id: 'senses', label: 'Sense', type: nominal('Sense'), required: false, many: true },
  '#options': { id: 'options', label: 'Option', type: nominal('Option'), required: false, many: true },
  '#watch': { id: 'watch', label: 'Watch', type: nominal('Condition'), required: false, many: true },
};

function stageList(stage: StageSpec, parentId: string): SpecNode[] {
  if (parentId === '#senses') return (stage.learner.senses ??= []);
  const r = (stage.learner.routine ??= { options: [], watch: [] });
  return parentId === '#options' ? r.options : r.watch;
}

/** Is `it` bound at this node? (inside a rule whose WHEN binds an object) */
const NOTE_CARDS = ['eff.note', 'cond.note', 'sense.note'];

/** Note names used anywhere in a lesson (rules, SUCCESS/FAIL, senses), first-written first. */
export function noteNames(stage: StageSpec): string[] {
  const out: string[] = [];
  const roots = [...stage.rules, ...(stage.success ? [stage.success] : []), ...(stage.fail ? [stage.fail] : []), ...(stage.learner.senses ?? [])];
  for (const r of roots) walk(r, (x) => { if (NOTE_CARDS.includes(x.cardId)) { const nm = String(x.args.name ?? '').trim(); if (nm && !out.includes(nm)) out.push(nm); } });
  return out;
}

export function itBoundAt(stage: StageSpec, nodeId: string): boolean {
  for (const r of stage.rules) {
    let inside = false;
    walk(r, (n) => { if (n.id === nodeId) inside = true; });
    if (inside) {
      const ev = r.args.when;
      return isNode(ev) && !!REGISTRY.cards.get(ev.cardId)?.bindsIt;
    }
  }
  return false;
}

export function slotInfo(stage: StageSpec, slot: SlotRef): SlotInfo | null {
  if (slot.parentId === '#senses' || slot.parentId === '#options' || slot.parentId === '#watch') {
    const list = slot.parentId === '#senses' ? stage.learner.senses ?? [] : slot.parentId === '#options' ? stage.learner.routine?.options ?? [] : stage.learner.routine?.watch ?? [];
    return { socket: STAGE_SOCKETS[slot.parentId], current: slot.index !== null ? list[slot.index] ?? null : null, parent: null, itBound: false };
  }
  if (slot.parentId in STAGE_SOCKETS) {
    const current = slot.parentId === '#success' ? stage.success : stage.fail ?? null;
    return { socket: STAGE_SOCKETS[slot.parentId], current, parent: null, itBound: false };
  }
  const parent = findInStage(stage, slot.parentId);
  if (!parent) return null;
  const card = REGISTRY.cards.get(parent.cardId);
  const socket = card?.sockets.find((s) => s.id === slot.socket);
  if (!socket) return null;
  const v = parent.args[slot.socket];
  let current: SpecNode | null = null;
  if (Array.isArray(v)) current = slot.index !== null ? v[slot.index] ?? null : null;
  else if (isNode(v)) current = v;
  return { socket, current, parent, itBound: itBoundAt(stage, parent.id) || parent.cardId === 'rule' && isNode(parent.args.when) && !!REGISTRY.cards.get((parent.args.when as SpecNode).cardId)?.bindsIt };
}

/** Put a node into a slot (or clear it with null). Returns the new slot ref pointing at it. */
export function setSlot(stage: StageSpec, slot: SlotRef, n: SpecNode | null): SlotRef | null {
  if (slot.parentId === '#senses' || slot.parentId === '#options' || slot.parentId === '#watch') {
    const list = stageList(stage, slot.parentId);
    if (slot.index === null) { if (!n) return null; list.push(n); return { ...slot, index: list.length - 1 }; }
    if (n) list[slot.index] = n; else list.splice(slot.index, 1);
    return n ? slot : null;
  }
  if (slot.parentId === '#success') { stage.success = n; return n ? slot : null; }
  if (slot.parentId === '#fail') { stage.fail = n; return n ? slot : null; }
  const parent = findInStage(stage, slot.parentId);
  if (!parent) return null;
  const card = REGISTRY.cards.get(parent.cardId);
  const socket = card?.sockets.find((s) => s.id === slot.socket);
  if (!socket) return null;
  if (socket.many) {
    const list = (Array.isArray(parent.args[slot.socket]) ? parent.args[slot.socket] : []) as SpecNode[];
    if (slot.index === null) {
      if (!n) return null;
      list.push(n);
      parent.args[slot.socket] = list;
      return { ...slot, index: list.length - 1 };
    }
    if (n) list[slot.index] = n;
    else list.splice(slot.index, 1);
    parent.args[slot.socket] = list;
    return n ? slot : null;
  }
  if (n) parent.args[slot.socket] = n;
  else delete parent.args[slot.socket];
  return n ? slot : null;
}

/** Is this slot the senses list itself, or a slot inside one of its sense cards (like the “What” of “How far is…”)? */
export function slotInSenses(stage: StageSpec, slot: SlotRef | null): boolean {
  if (!slot) return false;
  if (slot.parentId === '#senses') return true;
  return (stage.learner.senses ?? []).some((n) => !!findNode(n, slot.parentId));
}

export function templatesFor(templates: Template[], type: TypeExpr): Template[] {
  return templates.filter((t) => fits(type, t.output));
}

/**
 * A fresh copy of a saved card. Its name travels with it (`extensions.card`, shown as a tag on the chip).
 * Blanks (`exposed`: ids of things inside it) are left empty for the player to fill in; `blank` is the first one.
 */
export function instantiateTemplate(t: Template): SpecNode {
  return placeTemplate(t).node;
}
export function placeTemplate(t: Template): { node: SpecNode; blank: SlotRef | null } {
  const blanks = new Set(t.exposed ?? []);
  let blank: SlotRef | null = null;
  const copy = (n: SpecNode): SpecNode => {
    const out = node(n.cardId, {});
    if (n.extensions) out.extensions = structuredClone(n.extensions);
    for (const [k, v] of Object.entries(n.args)) {
      if (Array.isArray(v)) out.args[k] = v.map((x) => (isNode(x) ? copy(x) : x)) as SpecNode[];
      else if (isNode(v)) {
        if (blanks.has(v.id)) { blank ??= { parentId: out.id, socket: k, index: null }; continue; }
        out.args[k] = copy(v);
      } else out.args[k] = v;
    }
    return out;
  };
  const root = copy(t.root);
  root.extensions = { ...(root.extensions ?? {}), card: t.name };
  return { node: root, blank };
}

/** Things inside a saved card that can become blanks ("Treat for reaching ___"): kinds in single slots. */
export function blankCandidates(t: Template): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  const visit = (n: SpecNode) => {
    for (const v of Object.values(n.args)) {
      if (Array.isArray(v)) v.forEach((x) => isNode(x) && visit(x));
      else if (isNode(v)) {
        const c = REGISTRY.cards.get(v.cardId);
        if (c && (c.presentation.group === 'kind' || v.cardId === 'ref.target')) out.push({ id: v.id, title: c.presentation.title });
        else visit(v);
      }
    }
  };
  visit(t.root);
  return out;
}

export function saveTemplate(templates: Template[], name: string, root: SpecNode): Template {
  const card = REGISTRY.cards.get(root.cardId);
  const prev = templates.filter((t) => t.name === name);
  const t: Template = {
    id: newId('tpl'),
    name,
    revision: prev.length ? Math.max(...prev.map((p) => p.revision)) + 1 : 1,
    createdAt: Date.now(),
    output: card?.output ?? nominal('Rule'),
    root: cloneNode(root, false),
    exposed: [],
  };
  templates.push(t);
  return t;
}

/** Which part of the lesson a slot belongs to (the hand ranks cards that make sense there). */
export function slotRole(stage: StageSpec, slot: SlotRef): SlotRole {
  const inTree = (root: SpecNode | null | undefined) => !!root && !!findNode(root, slot.parentId);
  if (slot.parentId === '#success' || inTree(stage.success)) return 'success';
  if (slot.parentId === '#fail' || inTree(stage.fail)) return 'fail';
  if (slot.parentId === '#senses' || (stage.learner.senses ?? []).some((n) => inTree(n))) return 'sense';
  for (const r of stage.rules) {
    if (r.id === slot.parentId) return slot.socket === 'when' ? 'when' : slot.socket === 'if' ? 'if' : slot.socket === 'then' ? 'then' : 'other';
    if (isNode(r.args.when) && inTree(r.args.when)) return 'when';
    if ((Array.isArray(r.args.if) ? r.args.if : []).some((c) => isNode(c) && inTree(c))) return 'if';
  }
  return 'other';
}

/** A node's required, active slots that are still empty — depth first (the order the picker visits them). */
function firstEmptyIn(n: SpecNode, skip?: { slot: SlotRef; node: SpecNode }): SlotRef | null {
  const card = REGISTRY.cards.get(n.cardId);
  if (!card) return null;
  for (const sock of card.sockets) {
    if (!socketActive(n, sock, card.params?.find((p) => p.id === sock.when?.param)?.default)) continue;
    const v = n.args[sock.id];
    const filledHere = skip && skip.slot.parentId === n.id && skip.slot.socket === sock.id;
    const children = (Array.isArray(v) ? v : isNode(v) ? [v] : []).filter(isNode);
    if (filledHere && skip!.slot.index === null && !sock.many) children.splice(0, children.length, skip!.node);
    else if (filledHere && sock.many && skip!.slot.index === null) children.push(skip!.node);
    if (!children.length) { if (sock.required) return { parentId: n.id, socket: sock.id, index: null }; continue; }
    for (const c of children) { const r = firstEmptyIn(c, skip); if (r) return r; }
  }
  return null;
}

/**
 * Where the picker goes next after `node` was put into `slot` (phase 4): the first empty required slot inside it,
 * else the next one inside the card where this chain of picks began (`root`). Null: nothing required is left.
 * `stage` may be from before the pick: the filled slot is read as holding `node`.
 */
export function nextEmptySlot(stage: StageSpec, slot: SlotRef, node: SpecNode, root: SlotRef | null): SlotRef | null {
  const inside = firstEmptyIn(node);
  if (inside) return inside;
  if (!root || (root.parentId === slot.parentId && root.socket === slot.socket && root.index === slot.index)) return null;
  const rootNode = slotInfo(stage, root)?.current;
  return rootNode ? firstEmptyIn(rootNode, { slot, node }) : null;
}
