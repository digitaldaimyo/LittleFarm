import type { CardDef, SpecNode, StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { isNode } from '../domain/spec';
import { buildHand, type HandCard } from '../domain/hand';
import { typeToString } from '../domain/typecheck';
import { ObjectIcon } from './art';
import type { SlotRef } from './store';
import { store, useStore } from './store';
import { createNode, instantiateTemplate, saveTemplate, setSlot, slotInfo, templatesFor } from './edit';
import { snapshotStage } from '../game/state';

const GROUP_CLASS: Record<string, string> = {
  kind: 'g-obj', actor: 'g-obj', reference: 'g-obj', event: 'g-event', condition: 'g-cond', effect: 'g-val',
  limit: 'g-lim', quantity: 'g-prop', placement: 'g-obj', rule: 'g-rule',
};

export function cardOf(n: SpecNode): CardDef | undefined {
  return REGISTRY.cards.get(n.cardId);
}

function paramText(card: CardDef, n: SpecNode, id: string): string {
  const p = card.params?.find((x) => x.id === id);
  const v = n.args[id] ?? p?.default;
  if (p?.kind === 'choice') return p.choices?.find((c) => c.value === v)?.label ?? String(v);
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  return String(v ?? '');
}

/** Is this slot currently selected? */
function same(a: SlotRef | null, b: SlotRef): boolean {
  return !!a && a.parentId === b.parentId && a.socket === b.socket && a.index === b.index;
}

/** A clickable socket chip: shows the card in it (recursively) or an empty dashed slot. */
export function SlotChip({ stage, slot, label, errors }: { stage: StageSpec; slot: SlotRef; label: string; errors: Set<string> }) {
  const s = useStore();
  const info = slotInfo(stage, slot);
  const n = info?.current ?? null;
  const sel = same(s.ui.slot, slot);
  if (!n) {
    return (
      <button className={`slot empty ${sel ? 'sel' : ''}`} onClick={() => s.setUi({ slot: slot, placing: null })} aria-label={`Empty slot: ${label}. Choose a card.`} aria-pressed={sel}>
        {label}
      </button>
    );
  }
  return <NodeChip stage={stage} n={n} slot={slot} errors={errors} />;
}

export function NodeChip({ stage, n, slot, errors }: { stage: StageSpec; n: SpecNode; slot: SlotRef; errors: Set<string> }) {
  const s = useStore();
  const card = cardOf(n);
  const sel = same(s.ui.slot, slot);
  if (!card) return <span className="chip bad">unknown card “{n.cardId}”</span>;
  const cls = `node ${GROUP_CLASS[card.presentation.group] ?? ''} ${sel ? 'sel' : ''} ${errors.has(n.id) ? 'err' : ''}`;
  const phrase = card.presentation.phrase;
  const select = (e: React.MouseEvent) => { e.stopPropagation(); s.setUi({ slot, placing: null }); };
  if (card.presentation.group === 'kind' || card.presentation.group === 'actor') {
    return (
      <button className={cls} onClick={select} aria-pressed={sel} title={card.presentation.hint}>
        {card.presentation.icon && card.presentation.icon !== 'pet' && <ObjectIcon kind={card.presentation.icon} size={16} />}
        {card.id === 'actor.pet' ? (store.state.pets.find((p) => p.id === store.state.activePetId)?.name ?? 'pet') : card.presentation.title}
      </button>
    );
  }
  if (!phrase) {
    return <button className={cls} onClick={select} aria-pressed={sel}>{card.presentation.title}</button>;
  }
  const parts = phrase.split(/(\{[a-zA-Z]+\})/g).filter(Boolean);
  return (
    <span className={cls} role="group" aria-label={card.presentation.title}>
      <button className="node-handle" onClick={select} aria-pressed={sel} aria-label={`Edit ${card.presentation.title}`} title={`${card.presentation.title}${card.presentation.hint ? `: ${card.presentation.hint}` : ''}`}>✎</button>
      {parts.map((p, i) => {
        const m = p.match(/^\{([a-zA-Z]+)\}$/);
        if (!m) return <span key={i} className="ptext">{p}</span>;
        const id = m[1];
        const sock = card.sockets.find((x) => x.id === id);
        if (sock) return <SlotChip key={i} stage={stage} slot={{ parentId: n.id, socket: id, index: null }} label={sock.label} errors={errors} />;
        return <button key={i} className="param" onClick={select}>{paramText(card, n, id)}</button>;
      })}
    </span>
  );
}

/** Many-socket row: existing cards + an add slot. */
export function ManySlot({ stage, parent, socket, label, errors }: { stage: StageSpec; parent: SpecNode; socket: string; label: string; errors: Set<string> }) {
  const v = parent.args[socket];
  const list = (Array.isArray(v) ? v : isNode(v) ? [v] : []) as SpecNode[];
  return (
    <span className="many">
      {list.map((c, i) => <NodeChip key={c.id} stage={stage} n={c} slot={{ parentId: parent.id, socket, index: i }} errors={errors} />)}
      <SlotChip stage={stage} slot={{ parentId: parent.id, socket, index: null }} label={`+ ${label}`} errors={errors} />
    </span>
  );
}

/** The open sleeve: edit params of the selected card and swap it from the hand. */
export function Sleeve({ stage, onChange }: { stage: StageSpec; onChange: (fn: (st: StageSpec) => void) => void }) {
  const s = useStore();
  const slot = s.ui.slot;
  if (!slot) return null;
  const info = slotInfo(stage, slot);
  if (!info) return null;
  const n = info.current;
  const card = n ? cardOf(n) : undefined;
  return (
    <div className="sleeve panel" aria-label="Sleeve">
      <div className="row between">
        <div>
          <div className="eyebrow">Sleeve · slot “{info.socket.label}” takes <code>{typeToString(info.socket.type)}</code></div>
          <strong>{card ? card.presentation.title : 'Empty — pick a card below'}</strong>
          {card?.presentation.hint && <div className="muted small">{card.presentation.hint}</div>}
        </div>
        <button className="icon-btn" onClick={() => s.setUi({ slot: null })} aria-label="Close sleeve">✕</button>
      </div>
      {n && card && (card.params?.length ?? 0) > 0 && (
        <div className="params">
          {card.params!.map((p) => {
            const v = n.args[p.id] ?? p.default;
            const set = (val: number | string) => onChange((st) => {
              const target = slotInfo(st, slot)?.current;
              if (target) target.args[p.id] = val;
            });
            if (p.kind === 'number') {
              return (
                <label key={p.id} className="param-edit">{p.label}
                  <span className="stepper">
                    <button onClick={() => set(Math.max(p.min ?? -1e9, Math.round(((v as number) - (p.step ?? 1)) * 100) / 100))} aria-label={`Decrease ${p.label}`}>−</button>
                    <input type="number" value={v as number} min={p.min} max={p.max} step={p.step} onChange={(e) => { const x = Number(e.target.value); if (Number.isFinite(x)) set(x); }} />
                    <button onClick={() => set(Math.min(p.max ?? 1e9, Math.round(((v as number) + (p.step ?? 1)) * 100) / 100))} aria-label={`Increase ${p.label}`}>+</button>
                  </span>
                </label>
              );
            }
            if (p.kind === 'choice') {
              return (
                <label key={p.id} className="param-edit">{p.label}
                  <select value={String(v)} onChange={(e) => set(e.target.value)}>{p.choices!.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                </label>
              );
            }
            return <label key={p.id} className="param-edit">{p.label}<input value={String(v)} maxLength={40} onChange={(e) => set(e.target.value)} /></label>;
          })}
        </div>
      )}
      {n && (
        <div className="row gap">
          {(!info.socket.required || info.socket.many || slot.parentId === '#fail' || slot.parentId === '#success') && (
            <button className="btn ghost" onClick={() => { onChange((st) => { setSlot(st, slot, null); }); s.setUi({ slot: null }); }}>Remove</button>
          )}
          <button className="btn ghost" onClick={() => {
            const name = prompt('Template name', card?.presentation.title ?? 'Template');
            if (!name) return;
            store.mutate((g) => { const t = saveTemplate(g.templates, name.slice(0, 40), n); store.toast(`Saved template “${t.name}” r${t.revision}.`, 'good'); });
          }}>Save as template</button>
        </div>
      )}
      <Hand stage={stage} slot={slot} onPick={(node) => {
        let next: SlotRef | null = null;
        onChange((st) => { next = setSlot(st, slot, node); });
        store.mutate((g) => { g.recentCards = [node.cardId, ...g.recentCards.filter((x) => x !== node.cardId)].slice(0, 12); }, { save: false });
        // Move focus to the first empty required child, else keep the filled slot selected.
        const card2 = cardOf(node);
        const empty = card2?.sockets.find((x) => x.required && !node.args[x.id]);
        s.setUi({ slot: empty ? { parentId: node.id, socket: empty.id, index: null } : next });
      }} />
    </div>
  );
}

export function Hand({ stage, slot, onPick }: { stage: StageSpec; slot: SlotRef; onPick: (n: SpecNode) => void }) {
  const s = useStore();
  const info = slotInfo(stage, slot);
  if (!info) return null;
  const hand = buildHand(REGISTRY, {
    socket: info.socket.type, stage, unlocks: new Set(s.state.progress.unlocks), recent: s.state.recentCards,
    favorites: s.state.favorites, itBound: info.itBound, placing: false,
  });
  const tpls = templatesFor(s.state.templates, info.socket.type);
  return (
    <div className="hand" aria-label="Your hand">
      <div className="eyebrow">Recommended</div>
      <div className="hand-row">{hand.recommended.map((h) => <HandCardView key={h.card.id} h={h} onPick={() => onPick(createNode(h.card.id))} />)}</div>
      {tpls.length > 0 && (
        <>
          <div className="eyebrow">Your templates</div>
          <div className="hand-row">{tpls.map((t) => <button key={t.id} className="card g-tpl" onClick={() => onPick(instantiateTemplate(t))}><span className="card-title">{t.name}</span><span className="card-sub">template r{t.revision}</span></button>)}</div>
        </>
      )}
      {Object.keys(hand.bySheet).length > 0 && (
        <details className="more">
          <summary>More cards ({hand.total - hand.recommended.length})</summary>
          {Object.entries(hand.bySheet).map(([sheet, cards]) => (
            <div key={sheet}>
              <div className="eyebrow">{sheet}</div>
              <div className="hand-row wrap">{cards.map((h) => <HandCardView key={h.card.id} h={h} onPick={() => onPick(createNode(h.card.id))} />)}</div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

export function HandCardView({ h, onPick, selected }: { h: HandCard; onPick: () => void; selected?: boolean }) {
  const c = h.card;
  return (
    <button className={`card ${GROUP_CLASS[c.presentation.group] ?? ''} ${h.status === 'locked' ? 'locked' : ''} ${selected ? 'sel' : ''}`} disabled={h.status === 'locked'} onClick={onPick} title={h.reason ?? c.presentation.hint} aria-pressed={selected}>
      {c.presentation.icon && c.presentation.icon !== 'pet' && <ObjectIcon kind={c.presentation.icon} size={26} />}
      <span className="card-title">{c.presentation.title}</span>
      <span className="card-sub">{h.status === 'locked' ? `🔒 ${h.reason}` : c.presentation.group}</span>
    </button>
  );
}

export function withSnapshot(stageId: string, fn: (st: StageSpec) => void) {
  store.mutate((g) => {
    const st = g.stages.find((x) => x.id === stageId);
    if (!st) return;
    snapshotStage(g, st);
    fn(st);
    st.version++;
  });
}
