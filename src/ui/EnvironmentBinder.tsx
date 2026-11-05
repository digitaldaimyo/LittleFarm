/** Teach screen: the Environment binder — what is in the pen and where (split from TeachScreen.tsx, polish phase 3). */
import { useMemo } from 'react';
import { audio } from '../audio/engine';
import { describe } from '../domain/describe';
import type { SpecNode, StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { isNode, node, paramOf, placedKinds, socketActive } from '../domain/spec';
import { buildHand } from '../domain/hand';
import { generateWorld } from '../sim/compile';
import { trainingSeed } from '../learning/trainer';
import { useStore } from './store';
import { WorldView } from './WorldView';
import { HandCardView, cardOf, withSnapshot } from './cards';
import { ObjectIcon } from './art';
import type { Pet } from '../game/types';
import { kindOf } from './TeachScreen';

export function EnvironmentBinder({ stage }: { stage: StageSpec }) {
  const s = useStore();
  const hand = buildHand(REGISTRY, { socket: { kind: 'nominal', name: 'Kind' }, stage, unlocks: new Set(s.state.progress.unlocks), recent: s.state.recentCards, favorites: s.state.favorites, itBound: false, placing: true });
  const all = [...hand.recommended, ...Object.values(hand.bySheet).flat()];
  const update = (fn: (st: StageSpec) => void) => withSnapshot(stage.id, fn);
  return (
    <div className="binder-body">
      <p className="small muted">Pick a thing, then tap the pen. <b>Scatter</b> puts it somewhere new each try (best for skills that work anywhere). <b>Place here</b> pins it to one tile.</p>
      <div className="seg" role="radiogroup" aria-label="Placement mode">
        <button role="radio" aria-checked={s.ui.placeMode === 'random'} className={s.ui.placeMode === 'random' ? 'on' : ''} onClick={() => s.setUi({ placeMode: 'random' })}>Scatter</button>
        <button role="radio" aria-checked={s.ui.placeMode === 'fixed'} className={s.ui.placeMode === 'fixed' ? 'on' : ''} onClick={() => s.setUi({ placeMode: 'fixed' })}>Place here</button>
      </div>
      <div className="hand-row wrap">
        {all.map((h) => <HandCardView key={h.card.id} h={h} tut={h.card.id === 'kind:berry' ? 'env-berry' : undefined} selected={s.ui.placing === h.card.id} onPick={() => s.setUi({ placing: s.ui.placing === h.card.id ? null : h.card.id, slot: null })} />)}
        <button className={`card g-obj ${s.ui.placing === 'place.pet' ? 'sel' : ''}`} onClick={() => s.setUi({ placing: s.ui.placing === 'place.pet' ? null : 'place.pet', slot: null })}><span className="card-title">Pet start</span><span className="card-sub">placement</span></button>
        <button className={`card g-obj ${s.ui.placing === 'zone.rect' ? 'sel' : ''}`} onClick={() => s.setUi({ placing: s.ui.placing === 'zone.rect' ? null : 'zone.rect', zoneStart: null, slot: null })}><span className="card-title">Area</span><span className="card-sub">paint 2 corners</span></button>
        <button className="card g-obj" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.weather')?.id;
          if (!id) { const t = node('place.weather', { mode: 'rain' }); id = t.id; update((st) => { st.environment.push(t); }); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Weather</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.weather'); return t ? paramOf(t, 'mode', 'dry') : 'dry (default)'; })()}</span></button>
        <button className="card g-obj" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.time')?.id;
          if (!id) { const t = node('place.time', { mode: 'night' }); id = t.id; update((st) => { st.environment.push(t); }); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Time of day</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.time'); return t ? paramOf(t, 'mode', 'day') : 'day (default)'; })()}</span></button>
        <button className="card g-obj" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.obstacles')?.id;
          if (!id) { const t = node('place.obstacles', { amount: 'few', kind: 'rocks' }); id = t.id; update((st) => { st.environment.push(t); }); audio.play('pen.place'); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Obstacles</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.obstacles'); return t ? `${paramOf(t, 'amount', 'few')} ${paramOf(t, 'kind', 'rocks')}` : 'none yet'; })()}</span></button>
        <button className="card g-obj" data-tut="env-energy" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.energy')?.id;
          if (!id) { const t = node('place.energy', { level: 30, vary: 'random' }); id = t.id; update((st) => { st.environment.push(t); }); audio.play('pen.place'); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Energy</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.energy'); return t ? (paramOf(t, 'vary', 'exact') === 'random' ? '10–100 each try' : `${paramOf(t, 'level', 30)} at the start`) : 'none (no tiredness)'; })()}</span></button>
        <button className="card g-obj" data-tut="env-purse" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.purse')?.id;
          if (!id) { const t = node('place.purse', { coins: 5 }); id = t.id; update((st) => { st.environment.push(t); }); audio.play('pen.place'); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Seed money</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.purse'); return t ? `${paramOf(t, 'coins', 5)} coins` : 'none (seeds free)'; })()}</span></button>
        <button className="card g-obj" data-tut="env-gates" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.gates')?.id;
          if (!id) { const t = node('place.gates', { state: 'open' }); id = t.id; update((st) => { st.environment.push(t); }); audio.play('pen.place'); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Gates start</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.gates'); return t ? ({ open: 'open', closed: 'shut', random: 'open or shut' } as Record<string, string>)[paramOf(t, 'state', 'open')] : 'shut (default)'; })()}</span></button>
        <button className="card g-obj" data-tut="env-stocked" onClick={() => {
          const t = node('place.stocked', { kind: node('kind:bin'), item: node(`kind:${stage.learner.focus && stage.learner.focus !== 'bin' ? stage.learner.focus : 'berry'}`), count: 3, vary: 'exact', region: 'anywhere' });
          update((st) => { st.environment.push(t); }); audio.play('pen.place');
          s.setUi({ placing: null, slot: { parentId: t.id, socket: 'kind', index: null } });
        }}><span className="card-title">Stocked storage</span><span className="card-sub">a basket that already holds things</span></button>
      </div>
      <h4>Pen size</h4>
      <div className="seg small-seg" role="radiogroup" aria-label="Pen size" data-tut="pen-size">
        {([[6, false, '6×6'], [8, false, '8×8'], [10, false, '10×10'], [10, true, 'varies (6–10)']] as const).map(([n, vary, label]) => {
          const on = stage.size.w === n && stage.size.h === n && !!stage.varySize === vary;
          return <button key={label} role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => update((st) => { st.size = { w: n, h: n }; st.varySize = vary || undefined; })}>{label}</button>;
        })}
      </div>
      <p className="small muted">{stage.varySize ? 'A new size every try, from 6×6 up to 10×10. (Movement skills already cope with bigger pens; obstacles help more in cluttered places.)' : 'Bigger pens mean longer walks (raise “Time per try” in the Pet binder if tries run out).'}</p>
      <h4>In this pen</h4>
      <ul className="placements" data-tut="placements">
        {stage.environment.map((p) => {
          const card = cardOf(p);
          const kind = isNode(p.args.kind) ? p.args.kind.cardId.slice(5) : null;
          return (
            <li key={p.id} className={s.ui.slot?.parentId === p.id ? 'sel' : ''}>
              {kind && <ObjectIcon kind={kind} size={22} />}
              <button className="link" onClick={() => s.setUi({ slot: { parentId: p.id, socket: 'kind', index: null } })}>
                {placementText(stage, p)}
              </button>
              <span className="chip">{card?.presentation.title}</span>
              {p.cardId === 'place.fixed' && <button className="btn ghost small" onClick={() => update((st) => { const x = st.environment.find((y) => y.id === p.id); if (x) { x.cardId = 'place.random'; x.args = { kind: x.args.kind, count: 1, region: 'anywhere' }; } })}>Scatter this</button>}
              {p.cardId === 'place.pet' && paramOf(p, 'mode', 'random') === 'fixed' && <button className="btn ghost small" onClick={() => update((st) => { const x = st.environment.find((y) => y.id === p.id); if (x) x.args.mode = 'random'; })}>Random start</button>}
              <button className="icon-btn small" aria-label="Remove" onClick={() => { audio.play('card.remove'); update((st) => { st.environment = st.environment.filter((x) => x.id !== p.id); }); s.setUi({ slot: null }); }}>✕</button>
            </li>
          );
        })}
      </ul>
      {s.ui.slot && stage.environment.some((p) => p.id === s.ui.slot!.parentId) && <PlacementSleeve stage={stage} id={s.ui.slot.parentId} />}
    </div>
  );
}

/** One line for a placement card in the "In this pen" list. */
function placementText(stage: StageSpec, p: SpecNode): string {
  const t = describe(p, { petName: 'Pet', target: stage.learner.focus });
  if (p.cardId === 'place.random') return `Scatter ${t}`;
  if (p.cardId === 'place.obstacles') return `Obstacles: ${t}`;
  if (p.cardId === 'place.stocked') return `Stocked: ${t}`;
  if (p.cardId === 'place.energy') return `Energy: ${t}`;
  if (p.cardId === 'place.purse') return `Seed money: ${t}`;
  if (p.cardId === 'place.gates') return `Gates: ${t}`;
  if (p.cardId === 'place.fixed') return `Place ${t}`;
  if (p.cardId === 'zone.rect') return `Area “${paramOf(p, 'name', 'coop')}” ${paramOf(p, 'w', 2)}×${paramOf(p, 'h', 2)} ${paramOf(p, 'where', 'fixed') === 'random' ? '(random spot each try)' : `at (${paramOf(p, 'x', 0)},${paramOf(p, 'y', 0)})`}`;
  if (p.cardId === 'place.pet' && paramOf(p, 'mode', 'random') === 'fixed') return `Pet starts at (${paramOf(p, 'x', 0)},${paramOf(p, 'y', 0)})`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Six layouts the pen makes during practice, to see its variety at a glance. Tap one to show it above. */
export function LayoutStrip({ stage, pet }: { stage: StageSpec; pet: Pet }) {
  const s = useStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seeds = useMemo(() => Array.from({ length: 6 }, (_, i) => trainingSeed(stage, i * 97)), [stage.id, stage.seed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const worlds = useMemo(() => seeds.map((seed) => generateWorld(stage, seed)), [seeds, stage, stage.version]);
  return (
    <div className="layout-strip" data-tut="layout-strip" aria-label="Example practice layouts">
      {worlds.map((w, i) => (
        <button key={seeds[i]} className={s.ui.previewSeed === seeds[i] ? 'on' : ''} aria-label={`Show practice layout ${i + 1}`} onClick={() => s.setUi({ previewSeed: seeds[i] })}>
          <WorldView world={w} palette={pet.palette} label={`Practice layout ${i + 1}`} className="thumb" />
        </button>
      ))}
    </div>
  );
}

function PlacementSleeve({ stage, id }: { stage: StageSpec; id: string }) {
  const p = stage.environment.find((x) => x.id === id);
  if (!p) return null;
  const card = cardOf(p)!;
  const set = (k: string, v: number | string) => withSnapshot(stage.id, (st) => { const t = st.environment.find((x) => x.id === id); if (t) t.args[k] = v; });
  const setNode = (k: string, v: SpecNode) => withSnapshot(stage.id, (st) => { const t = st.environment.find((x) => x.id === id); if (t) t.args[k] = v; });
  return (
    <div className="sleeve panel">
      <div className="eyebrow">Sleeve · {card.presentation.title}</div>
      <div className="params">
        {card.sockets.filter((so) => so.id !== 'kind' && socketActive(p, so, card.params?.find((x) => x.id === so.when?.param)?.default)).map((so) => {
          if (so.type.kind === 'nominal' && so.type.name === 'Area') {
            const names = stage.environment.filter((z) => z.cardId === 'zone.rect').map((z) => String(z.args.name ?? 'coop'));
            const cur = isNode(p.args[so.id]) ? String((p.args[so.id] as SpecNode).args.name ?? '') : '';
            return <label key={so.id} className="param-edit">{so.label}<select value={cur} onChange={(e) => setNode(so.id, node('area.named', { name: e.target.value }))}><option value="" disabled>{names.length ? 'pick an area' : 'paint an Area first'}</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>;
          }
          const kinds = [...placedKinds(stage)].filter((k) => k !== kindOf(p));
          const cur = isNode(p.args[so.id]) ? (p.args[so.id] as SpecNode).cardId.replace(/^kind:/, '') : '';
          return <label key={so.id} className="param-edit">{so.label}<select value={cur} onChange={(e) => setNode(so.id, node(`kind:${e.target.value}`))}><option value="" disabled>pick a thing in the pen</option>{kinds.map((k) => <option key={k} value={k}>{REGISTRY.objects.get(k)?.name ?? k}</option>)}</select></label>;
        })}
        {(card.params ?? []).map((pd) => {
          const v = p.args[pd.id] ?? pd.default;
          if (pd.kind === 'choice') return <label key={pd.id} className="param-edit">{pd.label}<select value={String(v)} onChange={(e) => set(pd.id, e.target.value)}>{pd.choices!.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>;
          if (pd.kind === 'text') return <label key={pd.id} className="param-edit">{pd.label}<input value={String(v)} maxLength={16} onChange={(e) => set(pd.id, e.target.value)} /></label>;
          const max = pd.id === 'x' ? stage.size.w - 1 : pd.id === 'y' ? stage.size.h - 1 : pd.max;
          return <label key={pd.id} className="param-edit">{pd.label}<input type="number" min={pd.min} max={max} value={Number(v)} onChange={(e) => set(pd.id, Math.max(pd.min ?? 0, Math.min(max ?? 99, Number(e.target.value) || 0)))} /></label>;
        })}
      </div>
    </div>
  );
}
