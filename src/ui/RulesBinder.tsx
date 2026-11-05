/** Teach screen: the Rules binder — treats, SUCCESS and FAIL, and what is wrong with them (split from TeachScreen.tsx, polish phase 3). */
import { useMemo } from 'react';
import { audio } from '../audio/engine';
import { describe, describeRule } from '../domain/describe';
import { rolloutChecks } from '../learning/lint';
import type { SpecNode, StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { suggestedRules } from '../domain/recipes';
import { cloneNode, newId, node, paramOf } from '../domain/spec';
import { nodesWithErrors, validateStage } from '../domain/validate';
import { applyRepair } from '../domain/repairs';
import { store, useStore } from './store';
import { ManySlot, Sleeve, SlotChip, withSnapshot } from './cards';
import { placeTemplate } from './edit';
import { activePet } from '../game/pets';
import { currentStep } from '../game/tutorial';

export function RulesBinder({ stage }: { stage: StageSpec }) {
  const s = useStore();
  const diags = validateStage(stage, REGISTRY, new Set(s.state.progress.unlocks));
  const errs = nodesWithErrors(diags);
  const update = (fn: (st: StageSpec) => void) => withSnapshot(stage.id, fn);
  const sugg = suggestedRules(stage);
  const building = ['treat-rule', 'success'].includes(currentStep(s.state)?.id ?? '');
  const suggestions = sugg.map((g) => (
        <button key={g.label} className="suggest" onClick={() => update((st) => { st.rules = g.rules; st.success = g.success; })}>
          <span className="eyebrow">Suggested recipe</span>
          <strong>{g.label}</strong>
          <span className="small muted">{stage.rules.length ? 'Replaces the current rules.' : 'One tap: treats for success, a tiny nudge each step.'}</span>
        </button>
      ));
  return (
    <div className="binder-body">
      <div data-tut="suggested">{building ? <details className="more"><summary>Stuck? Use the suggested recipe</summary>{suggestions}</details> : suggestions}</div>
      <h4>Rule mat</h4>
      {stage.rules.length === 0 && <p className="small muted">No rules yet.</p>}
      {stage.rules.map((r) => <RuleRow key={r.id} stage={stage} r={r} errs={errs} />)}
      <button className="btn ghost" data-tut="add-rule" onClick={() => { let id = ''; update((st) => { const n = node('rule', { label: `Rule ${st.rules.length + 1}`, then: [], if: [] }); id = n.id; st.rules.push(n); }); s.setUi({ slot: { parentId: id, socket: 'when', index: null } }); }}>+ Add rule</button>
      {s.state.templates.some((t) => t.output.name === 'Rule') && (
        <div className="row gap wrap">
          <span className="small">From your cards:</span>
          {s.state.templates.filter((t) => t.output.name === 'Rule').map((t) => (
            <button key={t.id} className="chip-btn" onClick={() => { const { node: n, blank } = placeTemplate(t); update((st) => { st.rules.push(n); }); audio.play('card.snap'); if (blank) s.setUi({ slot: blank }); }}>{t.name} r{t.revision}</button>
          ))}
        </div>
      )}
      <h4>Success & fail</h4>
      <div className="rule success-row" data-tut="success-slot">
        <ConditionList stage={stage} which="success" errs={errs} />
      </div>
      <div className="rule fail-row">
        <ConditionList stage={stage} which="fail" errs={errs} />
      </div>
      {s.ui.slot && <Sleeve stage={stage} onChange={update} />}
    </div>
  );
}

/**
 * SUCCESS / FAIL as a list: one card, or several joined by an all/any switch (stored as All of / Any of).
 * "+ and…" turns a single card into a list without hunting for the All of card.
 */
function ConditionList({ stage, which, errs }: { stage: StageSpec; which: 'success' | 'fail'; errs: Set<string> }) {
  const s = useStore();
  const update = (fn: (st: StageSpec) => void) => withSnapshot(stage.id, fn);
  const root = which === 'success' ? stage.success : stage.fail;
  const slotId = which === 'success' ? '#success' : '#fail';
  const kw = which === 'success' ? <span className="kw good">SUCCESS when</span> : <span className="kw bad">FAIL when</span>;
  const isList = !!root && (root.cardId === 'cond.and' || root.cardId === 'cond.any');
  const pet = activePet(s.state);
  const read = root ? describe(root, { petName: pet?.name ?? 'your pet', target: stage.learner.focus }) : null;
  const setRoot = (st: StageSpec, n: SpecNode | null) => { if (which === 'success') st.success = n; else st.fail = n; };
  const getRoot = (st: StageSpec) => (which === 'success' ? st.success : st.fail);
  if (!isList) {
    return (
      <>
        <div className="rule-line">{kw}
          <SlotChip stage={stage} slot={{ parentId: slotId, socket: which, index: null }} label={which === 'success' ? 'condition' : '(optional)'} errors={errs} />
          {root && <button className="btn ghost small" aria-label={`Add another ${which.toUpperCase()} condition`} onClick={() => {
            let id = '';
            update((st) => { const cur = getRoot(st); if (!cur) return; const list = node('cond.and', { all: [cur] }); id = list.id; setRoot(st, list); });
            if (id) { audio.play('card.flick'); s.setUi({ slot: { parentId: id, socket: 'all', index: null } }); }
          }}>+ and…</button>}
        </div>
        {read && <div className="small muted reads">Reads: {which === 'success' ? 'success' : 'fail'} when {read}.</div>}
      </>
    );
  }
  const any = root!.cardId === 'cond.any';
  return (
    <>
      <div className="rule-line">{kw}
        <span className="seg small-seg" role="radiogroup" aria-label={`${which.toUpperCase()} needs`}>
          {(['all', 'any'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={(m === 'any') === any} className={(m === 'any') === any ? 'on' : ''} onClick={() => update((st) => {
              const cur = getRoot(st);
              if (!cur || (m === 'any') === (cur.cardId === 'cond.any')) return;
              const kids = (cur.args.all ?? cur.args.any ?? []) as SpecNode[];
              setRoot(st, node(m === 'any' ? 'cond.any' : 'cond.and', { [m]: kids }, cur.id));
            })}>{m === 'all' ? 'all of these' : 'any of these'}</button>
          ))}
        </span>
      </div>
      <div className="rule-line"><span className="kw" />
        <ManySlot stage={stage} parent={root!} socket={any ? 'any' : 'all'} label="condition" errors={errs} />
      </div>
      {read && <div className="small muted reads">Reads: {which === 'success' ? 'success' : 'fail'} when {read}.</div>}
    </>
  );
}

function RuleRow({ stage, r, errs }: { stage: StageSpec; r: SpecNode; errs: Set<string> }) {
  const s = useStore();
  const update = (fn: (st: StageSpec) => void) => withSnapshot(stage.id, fn);
  return (
    <div className={`rule ${errs.has(r.id) ? 'err' : ''} ${r.args.off === 1 ? 'off' : ''}`}>
      <div className="row between">
        <input className="rule-label" aria-label="Rule name" value={paramOf(r, 'label', '')} onChange={(e) => update((st) => { const x = st.rules.find((y) => y.id === r.id); if (x) x.args.label = e.target.value.slice(0, 40); })} />
        <span className="row gap rule-tools">
          <button className="icon-btn small" title={r.args.off === 1 ? 'Switch this rule back on' : 'Switch off (keep it, but don’t use it)'} aria-label={r.args.off === 1 ? 'Switch rule on' : 'Switch rule off'} aria-pressed={r.args.off === 1}
            onClick={() => update((st) => { const x = st.rules.find((y) => y.id === r.id); if (!x) return; if (x.args.off === 1) delete x.args.off; else x.args.off = 1; })}>{r.args.off === 1 ? '▶' : '⏸'}</button>
          <button className="icon-btn small" aria-label="Move rule up" disabled={stage.rules[0]?.id === r.id} onClick={() => update((st) => { const i = st.rules.findIndex((y) => y.id === r.id); if (i > 0) [st.rules[i - 1], st.rules[i]] = [st.rules[i], st.rules[i - 1]]; })}>↑</button>
          <button className="icon-btn small" aria-label="Move rule down" disabled={stage.rules.at(-1)?.id === r.id} onClick={() => update((st) => { const i = st.rules.findIndex((y) => y.id === r.id); if (i >= 0 && i < st.rules.length - 1) [st.rules[i + 1], st.rules[i]] = [st.rules[i], st.rules[i + 1]]; })}>↓</button>
          <button className="icon-btn small" title="Duplicate rule" aria-label="Duplicate rule" onClick={() => { audio.play('card.snap'); update((st) => { const i = st.rules.findIndex((y) => y.id === r.id); if (i < 0) return; const c = cloneNode(st.rules[i], true); c.args.label = `${paramOf(st.rules[i], 'label', 'Rule')} (copy)`.slice(0, 40); st.rules.splice(i + 1, 0, c); }); }}>⎘</button>
          <button className="icon-btn small" title="Save rule as one of your cards" aria-label="Save rule as one of your cards" onClick={() => { const name = prompt('Template name', paramOf(r, 'label', 'Rule')); if (name) store.mutate((g) => { const prev = g.templates.filter((t) => t.name === name); g.templates.push({ id: newId('tpl'), name, revision: prev.length + 1, createdAt: Date.now(), output: { kind: 'nominal', name: 'Rule' }, root: structuredClone(r), exposed: [] }); store.toast(`Template “${name}” saved.`, 'good'); }); }}>⧉</button>
          <button className="icon-btn small" aria-label="Delete rule" onClick={() => { update((st) => { st.rules = st.rules.filter((x) => x.id !== r.id); }); s.setUi({ slot: null }); }}>✕</button>
        </span>
      </div>
      <div className="rule-line"><span className="kw">WHEN</span><SlotChip stage={stage} slot={{ parentId: r.id, socket: 'when', index: null }} label="event" errors={errs} /></div>
      <div className="rule-line"><span className="kw">IF</span><ManySlot stage={stage} parent={r} socket="if" label="condition" errors={errs} /></div>
      <div className="rule-line"><span className="kw">THEN</span><ManySlot stage={stage} parent={r} socket="then" label="effect" errors={errs} /></div>
      <div className="rule-line"><span className="kw">LIMIT</span><SlotChip stage={stage} slot={{ parentId: r.id, socket: 'limit', index: null }} label="every time" errors={errs} /></div>
      <div className="small muted reads">Reads: {describeRule(r, { petName: activePet(s.state)?.name ?? 'your pet', target: stage.learner.focus })}</div>
    </div>
  );
}

export function Diagnostics({ stage }: { stage: StageSpec }) {
  const s = useStore();
  const base = validateStage(stage, REGISTRY, new Set(s.state.progress.unlocks));
  const valid = !base.some((x) => x.severity === 'error');
  // Measured checks (quick random tries) once the lesson is valid; recomputed when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const measured = useMemo(() => (valid ? rolloutChecks(stage) : []), [stage, stage.version, valid]);
  const d = [...base, ...measured];
  if (!d.length) return <div className="diag good small">✓ Lesson is valid. Ready to train.</div>;
  return (
    <div className="diags" aria-live="polite">
      {d.map((x, i) => (
        <div key={i} className={`diag ${x.severity}`}>
          <strong>{x.severity === 'error' ? 'Error' : x.severity === 'warning' ? 'Heads up' : 'Note'}:</strong> {x.message}
          {x.repair && <button className="btn ghost small" onClick={() => withSnapshot(stage.id, (st) => { applyRepair(st, x.repair!.action, x.repair!.ruleId); st.version--; })}>Repair: {x.repair.label}</button>}
        </div>
      ))}
      <div className="small muted">Warnings are hints from simple checks — not proof a reward is safe. Training will show what the pet really learns.</div>
    </div>
  );
}
