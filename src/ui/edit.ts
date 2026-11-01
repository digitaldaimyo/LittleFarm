import type { SocketDef, SpecNode, StageSpec, Template, TypeExpr } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { cloneNode, findInStage, isNode, newId, node, walk } from '../domain/spec';
import { fits, nominal } from '../domain/typecheck';
import type { SlotRef } from './store';

/** New node from a card with default params; the only Actor (the pet) is filled in automatically. */
export function createNode(cardId: string): SpecNode {
  const card = REGISTRY.cards.get(cardId);
  const n = node(cardId);
  if (!card) return n;
  for (const p of card.params ?? []) n.args[p.id] = p.default;
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

export function templatesFor(templates: Template[], type: TypeExpr): Template[] {
  return templates.filter((t) => fits(type, t.output));
}

export function instantiateTemplate(t: Template): SpecNode {
  return cloneNode(t.root, true);
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
