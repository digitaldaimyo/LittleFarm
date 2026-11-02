import { store, useStore, type LayoutUi } from './store';
import { LAYOUT_ITEMS, applyLayout, fixedReason, layoutObjectAt, move, place, plotBudget, previewLayout, remove, startLayout } from '../game/layout';
import { ObjectGlyph } from './art';
import { def } from '../sim/world';

/** Open layout mode: a draft copy of the farm; the farm pauses until you apply or cancel. */
export function openLayout(): void {
  store.mutate((st) => { st.progress.flags.layoutOpened = true; });
  store.setUi({ layout: { draft: startLayout(store.state), tool: 'move', pick: null, preview: null } });
}

function update(l: LayoutUi, patch: Partial<LayoutUi> = {}): void {
  store.setUi({ layout: { ...l, ...patch } });
}

/** A tile was tapped on the farm while the layout panel is open. */
export function layoutTap(x: number, y: number): void {
  const l = store.ui.layout;
  if (!l) return;
  const s = store.state;
  const d = l.draft;
  const fail = (reason: string) => store.toast(reason, 'warn');
  if (l.tool === 'move') {
    if (!l.pick) {
      const o = layoutObjectAt(d.world, x, y);
      const why = fixedReason(o);
      if (why) return fail(why);
      return update(l, { pick: { x, y } });
    }
    if (l.pick.x === x && l.pick.y === y) return update(l, { pick: null });
    const moved = layoutObjectAt(d.world, l.pick.x, l.pick.y);
    const from = l.pick;
    const r = move(d, l.pick.x, l.pick.y, x, y);
    if (!r.ok) return fail(r.reason);
    // Field Guide: a crop plot moved nearer the house.
    const toHouse = (p: { x: number; y: number }) => Math.abs(p.x - 1) + Math.abs(p.y - 1);
    if (moved && ['bush', 'patch', 'soil'].includes(moved.kind) && toHouse({ x, y }) < toHouse(from)) store.mutate((st) => { st.progress.flags.layoutCropCloser = true; });
    return update(l, { pick: null, preview: null });
  }
  if (l.tool === 'remove') {
    const r = remove(d, x, y);
    if (!r.ok) return fail(r.reason);
    return update(l, { preview: null });
  }
  const r = place(s, d, l.tool, x, y);
  if (!r.ok) return fail(r.reason);
  // Field Guide: a basket within two steps of a berry bush.
  if (l.tool === 'bin' && d.world.objects.some((o) => o.kind === 'bush' && !o.delivered && Math.abs(o.x - x) + Math.abs(o.y - y) <= 2)) {
    store.mutate((st) => { st.progress.flags.layoutBasketByBushes = true; });
  }
  update(l, { preview: null });
}

export function LayoutPanel() {
  const s = useStore();
  const l = s.ui.layout;
  if (!l) return null;
  const g = s.state;
  const d = l.draft;
  const budget = plotBudget(d.world);
  const picked = l.pick ? layoutObjectAt(d.world, l.pick.x, l.pick.y) : undefined;
  const afford = g.resources.coins >= d.cost;
  const apply = () => {
    const out: { reason: string | null } = { reason: null };
    store.mutate((st) => {
      const res = applyLayout(st, d);
      if (!res.ok) out.reason = res.reason;
      else {
        st.progress.flags.layoutApplied = true;
        st.farm.current = null;
        st.farm.current2 = null;
      }
    });
    if (out.reason) { store.toast(out.reason, 'warn'); return; }
    store.runtime.exec = null; store.runtime.inv = null; store.runtime.claim = null; store.runtime.second = undefined;
    store.setUi({ layout: null });
    store.toast('New layout applied.', 'good');
  };
  return (
    <div className="panel layout-panel" data-tut="layout-panel">
      <div className="row between"><h3>Farm layout</h3><span className="chip">farm paused</span></div>
      <p className="small muted">Change the draft, preview it, then apply. You pay for what you add when you apply; removing something refunds half its price.</p>
      <div className="layout-tools" role="radiogroup" aria-label="Layout tool">
        {(['move', 'remove'] as const).map((t) => (
          <button key={t} role="radio" aria-checked={l.tool === t} className={`btn small ${l.tool === t ? '' : 'ghost'}`} data-tut={`layout-${t}`} onClick={() => update(l, { tool: t, pick: null })}>{t === 'move' ? 'Move' : 'Remove'}</button>
        ))}
      </div>
      <div className="layout-palette" role="radiogroup" aria-label="Place">
        {LAYOUT_ITEMS.map((it) => {
          const locked = it.requires && !g.progress.unlocks.includes(it.requires);
          return (
            <button key={it.id} role="radio" aria-checked={l.tool === it.id} disabled={!!locked} data-tut={`layout-${it.id}`}
              className={`layout-item ${l.tool === it.id ? 'sel' : ''}`} title={locked ? 'Not unlocked yet' : it.describe}
              onClick={() => update(l, { tool: it.id, pick: null })}>
              <svg width="26" height="26" viewBox="0 0 40 40" aria-hidden="true"><ObjectGlyph kind={it.crop && it.crop !== 'berry' ? it.crop : it.kind} /></svg>
              <span>{it.label}</span><span className="chip">{it.price}</span>
            </button>
          );
        })}
      </div>
      <p className="small" aria-live="polite">
        {l.tool === 'move' ? (picked ? `Moving the ${def(picked.kind).name.toLowerCase()} — tap where it should go (tap it again to cancel).` : 'Tap something to pick it up, then tap where it should go.')
          : l.tool === 'remove' ? 'Tap something to remove it (refunds half its price).'
          : `Tap a free tile to place: ${LAYOUT_ITEMS.find((i) => i.id === l.tool)?.describe}`}
      </p>
      <div className="row wrap small">
        <span>Crop plots: <b>{d.plots.length}</b>/{budget}</span>
        <span>· {d.cost >= 0 ? <>Costs <b>{d.cost}</b></> : <>Refunds <b>{-d.cost}</b></>} coin{Math.abs(d.cost) === 1 ? '' : 's'} (you have {g.resources.coins})</span>
      </div>
      {d.changes.length > 0 && <ul className="small layout-changes">{d.changes.slice(-5).map((c, i) => <li key={i}>{c}</li>)}</ul>}
      {l.preview && (
        <div className="layout-preview small" data-tut="layout-result">
          Over {l.preview.ticks} ticks (half a day), with the same pets and jobs: <b>as it is {l.preview.current}</b> coins · <b>your layout {l.preview.draft}</b> coins
          {l.preview.draft > l.preview.current ? ' — better.' : l.preview.draft < l.preview.current ? ' — worse.' : ' — the same.'}
          {d.cost > 0 ? ` (It costs ${d.cost} to build.)` : ''}
        </div>
      )}
      <div className="row">
        <button className="btn ghost" data-tut="layout-preview" disabled={!d.changes.length} onClick={() => {
          const pv = previewLayout(store.state, d, 600);
          store.mutate((st) => { st.progress.flags.layoutPreviewed = true; if (st.progress.flags.layoutCropCloser) st.progress.flags.layoutPreviewedCloser = true; });
          update(l, { preview: pv });
        }}>Preview half a day</button>
        <button className="btn" data-tut="layout-apply" disabled={!d.changes.length || !afford} onClick={apply}>Apply layout{d.cost > 0 ? ` (${d.cost})` : ''}</button>
        <button className="btn ghost" onClick={() => store.setUi({ layout: null })}>Cancel</button>
      </div>
    </div>
  );
}
