import { useMemo, useState } from 'react';
import type { SpecNode, StageSpec } from '../domain/types';
import { node, paramOf, isNode } from '../domain/spec';
import { nominal } from '../domain/typecheck';
import { nodesWithErrors, validateNodes } from '../domain/validate';
import { FARM_OBJECTS } from '../domain/packs/farm';
import { store, useStore } from './store';
import { ManySlot, SlotChip, Sleeve } from './cards';
import { applyPlan, previewPlan, type PlanPreview } from '../game/farm';
import { compilePlan, planWarnings, starterPlan } from '../game/plan';
import type { Pet } from '../game/types';

const FARM_KINDS = FARM_OBJECTS.map((o) => o.id);

/** A stand-in lesson so plan rows can reuse the card/sleeve editor (its rule list *is* the plan's rows). */
function planStage(pet: Pet): StageSpec {
  return {
    id: '#plan', name: 'Farm plan', version: 1, size: { w: 12, h: 9 },
    environment: [...FARM_KINDS.map((k) => node('place.fixed', { kind: node(`kind:${k}`), x: 0, y: 0 })), node('zone.rect', { name: 'coop' })],
    abilities: ['move', 'stay', 'pickup', 'drop', 'water', 'shoo'],
    rules: (pet.plan ??= starterPlan()).rows,
    success: null, fail: null, seed: 1, maxTicks: 1,
    learner: { skill: 'Farm plan', template: 'sense', focus: 'berry', episodes: 0 },
    evaluation: { episodes: 0, seedSet: [], minimumSuccessRate: 0 },
  };
}

export function PlanMat({ pet }: { pet: Pet }) {
  const s = useStore();
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const plan = pet.plan ?? starterPlan();
  const stage = planStage(pet);
  const diags = validateNodes(plan.rows, nominal('PlanRow'), { placed: new Set(FARM_KINDS), areas: new Set(['coop']) });
  const errs = nodesWithErrors(diags);
  const warnings = planWarnings(pet, plan);
  const rows = useMemo(() => compilePlan(plan), [plan, plan.rows.length, s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentRow = s.state.farm.current?.chosenBy === 'plan' ? s.state.farm.current.args.row : null;
  const fires = store.runtime.plan.fires;

  const edit = (fn: (p: Pet) => void) => {
    store.mutate((g) => { const p = g.pets.find((x) => x.id === pet.id)!; p.plan ??= starterPlan(); fn(p); });
    setPreview(null);
  };
  const onChange = (fn: (st: StageSpec) => void) => edit((p) => fn(planStage(p)));
  const move = (i: number, d: number) => edit((p) => { const r = p.plan!.rows; const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; });

  const runPreview = () => setPreview(previewPlan(s.state, pet.id, plan, 300));

  return (
    <div className="panel plan-mat">
      <div className="row between wrap">
        <h3>Farm plan</h3>
        <span className="row gap">
          <button className="btn ghost small" onClick={() => { if (confirm('Replace this plan with the starter plan (the built-in rules)?')) edit((p) => { p.plan = starterPlan(); }); }}>Starter plan</button>
          <button className="btn small" onClick={runPreview}>Preview 300 ticks</button>
        </span>
      </div>
      <p className="small muted">Rows are tried top to bottom: {pet.name} does the first row whose conditions hold <em>and</em> whose job is possible right now.</p>
      <div className="row gap wrap">
        <div className="seg small-seg" role="radiogroup" aria-label="How rows are chosen">
          <button role="radio" aria-checked={plan.chooser === 'first'} className={plan.chooser === 'first' ? 'on' : ''} onClick={() => edit((p) => { p.plan!.chooser = 'first'; })}>First match</button>
          <button role="radio" aria-checked={plan.chooser === 'learned'} className={plan.chooser === 'learned' ? 'on' : ''} onClick={() => edit((p) => { p.plan!.chooser = 'learned'; })}>Learn among matches</button>
        </div>
        <label className="small"><input type="checkbox" checked={plan.guard} onChange={(e) => edit((p) => { p.plan!.guard = e.target.checked; })} /> anti-dithering guard</label>
      </div>
      <ol className="plan-rows">
        {plan.rows.map((r, i) => {
          const fired = fires[r.id] ?? 0;
          const job = isNode(r.args.do) ? r.args.do : null;
          return (
            <li key={r.id} className={`rule plan-row ${currentRow === r.id ? 'now' : ''} ${errs.has(r.id) ? 'err' : ''}`}>
              <div className="row between">
                <span className="row gap">
                  <span className="chip">{i + 1}</span>
                  <input className="rule-label" aria-label="Row name" value={paramOf(r, 'label', '')} onChange={(e) => edit((p) => { p.plan!.rows[i].args.label = e.target.value.slice(0, 40); })} />
                </span>
                <span className="row gap">
                  {currentRow === r.id && <span className="chip good">running</span>}
                  {fired > 0 && <span className="chip" title="Times this row started since the plan was applied">×{fired}</span>}
                  <button className="icon-btn small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="icon-btn small" aria-label="Move down" disabled={i === plan.rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="icon-btn small" aria-label="Delete row" onClick={() => { edit((p) => { p.plan!.rows.splice(i, 1); }); s.setUi({ slot: null }); }}>✕</button>
                </span>
              </div>
              <div className="rule-line"><span className="kw">IF</span><ManySlot stage={stage} parent={r} socket="if" label="condition" errors={errs} />{!(Array.isArray(r.args.if) && r.args.if.length) && <span className="small muted">(always)</span>}</div>
              <div className="rule-line"><span className="kw">DO</span><SlotChip stage={stage} slot={{ parentId: r.id, socket: 'do', index: null }} label="job" errors={errs} />
                {job?.cardId === 'job.skill' && <SkillPicker pet={pet} value={String(job.args.skill ?? '')} onPick={(v) => edit((p) => { const jj = p.plan!.rows[i].args.do as SpecNode; jj.args.skill = v; })} />}
              </div>
            </li>
          );
        })}
      </ol>
      <button className="btn ghost small" onClick={() => edit((p) => { p.plan!.rows.push(node('plan.row', { label: `Row ${p.plan!.rows.length + 1}`, if: [], do: node('job.nap') })); })}>+ Add row</button>
      {s.ui.slot && plan.rows.some((r) => r.id === s.ui.slot!.parentId || JSON.stringify(r).includes(`"id":"${s.ui.slot!.parentId}"`)) && <Sleeve stage={stage} onChange={onChange} />}
      {(diags.length > 0 || warnings.length > 0) && (
        <div className="diags">
          {diags.map((d, i) => <div key={`d${i}`} className={`diag ${d.severity}`}>{d.message}</div>)}
          {warnings.map((w, i) => <div key={`w${i}`} className="diag warning">{w.message}</div>)}
        </div>
      )}
      {preview && <PreviewCard preview={preview} rows={rows} />}
      {pet.assignment.mode !== 'plan' && <button className="btn primary" onClick={() => { store.mutate((g) => applyPlan(g, store.runtime, pet.id)); store.toast(`${pet.name} is following the farm plan.`, 'good'); }}>Use this plan</button>}
    </div>
  );
}

function SkillPicker({ pet, value, onPick }: { pet: Pet; value: string; onPick: (v: string) => void }) {
  const runnable = pet.skills.filter((k) => k.custom);
  return (
    <select aria-label="Skill to run" value={value} onChange={(e) => onPick(e.target.value)}>
      <option value="">choose a skill…</option>
      {runnable.map((k) => <option key={k.id} value={k.name}>{k.nickname ?? k.name}{k.kind === 'routine' ? ' (routine)' : ''}</option>)}
      {value && !runnable.some((k) => k.name === value) && <option value={value}>{value} (not learned)</option>}
    </select>
  );
}

function PreviewCard({ preview, rows }: { preview: PlanPreview; rows: ReturnType<typeof compilePlan> }) {
  const never = rows.filter((r) => !preview.fires[r.id]);
  const fight = preview.switchesPerMinute > 20 || preview.guarded > 0;
  return (
    <div className="preview">
      <div className="eyebrow">Dry run on a copy of the farm · next {preview.ticks} ticks (≈{Math.round((preview.ticks * 0.28) / 6) / 10} min at 1×)</div>
      <div className="hud">
        <div className="stat"><span className="small muted">Coins</span><b className="num">+{preview.coins}</b></div>
        <div className="stat"><span className="small muted">Energy</span><b className="num">{Math.round(preview.energyStart)}→{Math.round(preview.energyEnd)}</b></div>
        <div className="stat"><span className="small muted">Naps</span><b className="num">{preview.naps}</b></div>
        <div className="stat"><span className="small muted">Row switches/min</span><b className="num">{preview.switchesPerMinute.toFixed(1)}</b></div>
        <div className="stat"><span className="small muted">Pond dips</span><b className="num">{preview.dips}</b></div>
        <div className="stat"><span className="small muted">Guard steps in</span><b className="num">{preview.guarded}</b></div>
      </div>
      <ul className="small fires">
        {rows.map((r) => <li key={r.id}><b>{r.index + 1}. {r.label}</b> — {preview.fires[r.id] ? `ran ${preview.fires[r.id]}×` : 'never ran'}</li>)}
      </ul>
      {never.length > 0 && <div className="diag info small">{never.length === 1 ? `Row ${never[0].index + 1} never fired` : `Rows ${never.map((r) => r.index + 1).join(', ')} never fired`} in this preview. That can be fine (e.g. night rows during the day), or a sign the row is shadowed by one above it.</div>}
      {fight && <div className="diag warning small">Rows are fighting each other ({preview.switchesPerMinute.toFixed(0)} switches a minute{preview.guarded ? `; the guard stepped in ${preview.guarded}×` : ''}). Make their conditions exclusive, or reorder them.</div>}
      <div className="small muted">The farm is deterministic, so if you apply this plan now, the real farm will do exactly this.</div>
    </div>
  );
}
