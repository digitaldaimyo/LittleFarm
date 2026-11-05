import { useEffect, useMemo, useState } from 'react';
import { LESSON_ROW } from '../game/tutorial';
import type { SpecNode, StageSpec } from '../domain/types';
import { node, paramOf, isNode } from '../domain/spec';
import { nominal } from '../domain/typecheck';
import { nodesWithErrors, validateNodes } from '../domain/validate';
import { FARM_OBJECTS } from '../domain/packs/farm';
import { store, useStore } from './store';
import { ManySlot, SlotChip, Sleeve } from './cards';
import { applyPlan, previewPlan, type PlanPreview } from '../game/farm';
import { COOLDOWN, MIN_COMMIT, compilePlan, planWarnings, starterPlan, type PlanRuntime } from '../game/plan';
import type { FarmRuntime } from '../game/farm';
import type { Pet } from '../game/types';

const FARM_KINDS = FARM_OBJECTS.map((o) => o.id);

/** A stand-in lesson so plan rows can reuse the card/sleeve editor (its rule list *is* the plan's rows). */
function planStage(pet: Pet): StageSpec {
  return {
    id: '#plan', name: 'Responsibilities', version: 1, size: { w: 12, h: 9 },
    environment: [...FARM_KINDS.map((k) => node('place.fixed', { kind: node(`kind:${k}`), x: 0, y: 0 })), node('zone.rect', { name: 'coop' })],
    abilities: ['move', 'stay', 'pickup', 'drop', 'water', 'shoo'],
    rules: (pet.plan ??= starterPlan()).rows,
    success: null, fail: null, seed: 1, maxTicks: 1,
    learner: { skill: 'Responsibilities', template: 'sense', focus: 'berry', episodes: 0 },
    evaluation: { episodes: 0, seedSet: [], minimumSuccessRate: 0 },
  };
}

export function PlanMat({ pet }: { pet: Pet }) {
  const s = useStore();
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const plan = pet.plan ?? starterPlan();
  const stage = planStage(pet);
  const diags = validateNodes(plan.rows, nominal('Responsibility'), { placed: new Set(FARM_KINDS), areas: new Set(['coop']) });
  const errs = nodesWithErrors(diags);
  const warnings = planWarnings(pet, plan);
  const rows = useMemo(() => compilePlan(plan), [plan, plan.rows.length, s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rt = runtimeOf(pet.id);
  const pr: PlanRuntime | null = rt?.plan ?? null;
  const current = pet.id === s.state.farm.dutyPetId ? s.state.farm.current : (s.state.farm.helpers ?? []).find((h) => h.petId === pet.id)?.current ?? null;
  const currentRow = current?.chosenBy === 'plan' ? current.args.row : null;
  const fires = pr?.fires ?? {};
  const tick = s.state.farm.tick;
  const ev = (key: string) => { const e = pet.evidence?.[key]; return e && e.n > 0 ? `${Math.round(e.ok)}/${Math.round(e.n)} worked · ~${Math.round(e.ticks / e.n)} ticks` : 'not tried yet'; };

  const edit = (fn: (p: Pet) => void) => {
    store.mutate((g) => { const p = g.pets.find((x) => x.id === pet.id)!; p.plan ??= starterPlan(); fn(p); });
    setPreview(null);
  };
  const onChange = (fn: (st: StageSpec) => void) => edit((p) => fn(planStage(p)));
  const move = (i: number, d: number) => edit((p) => { const r = p.plan!.rows; const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; });

  const runPreview = () => {
    const pv = previewPlan(s.state, pet.id, plan, 300);
    setPreview(pv);
    store.mutate((g) => { g.progress.flags.planPreviewed = true; if ((pv.fires[LESSON_ROW] ?? 0) > 0) g.progress.flags.planRowFired = true; });
  };
  useEffect(() => { if (!store.state.progress.flags.planOpened) store.mutate((g) => { g.progress.flags.planOpened = true; }); }, []);

  return (
    <div className="panel plan-mat">
      <div className="row between wrap">
        <h3>Responsibilities</h3>
        <span className="row gap">
          <button className="btn ghost small" onClick={() => { if (confirm('Replace these with the starter responsibilities?')) edit((p) => { p.plan = starterPlan(); }); }}>Starter set</button>
          <button className="btn small" data-tut="plan-preview" onClick={runPreview}>Preview 300 ticks</button>
        </span>
      </div>
      <p className="small muted">Needs come first: {pet.name} rests when tired (until refreshed) and sleeps at night — unless a responsibility’s WHEN mentions night. Then the highest responsibility that needs doing wins. With UNTIL, {pet.name} sticks with it until that holds (only a need, or a failed job after {MIN_COMMIT} ticks, pulls them away); each job it may USE is picked by how well it has worked, and one that fails 3 times in a row rests for {COOLDOWN} ticks.</p>
      <label className="small"><input type="checkbox" checked={plan.guard} onChange={(e) => edit((p) => { p.plan!.guard = e.target.checked; })} /> anti-dithering guard</label>
      <ol className="plan-rows" data-tut="plan-rows">
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
                  {currentRow === r.id && <span className="chip good">working on it</span>}
                  {pr && (pr.cooldown[r.id] ?? -1) > tick && <span className="chip warn" title="No progress for a while">set aside</span>}
                  {fired > 0 && <span className="chip" title="Times this row started since the plan was applied">×{fired}</span>}
                  <button className="icon-btn small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="icon-btn small" aria-label="Move down" disabled={i === plan.rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="icon-btn small" aria-label="Delete row" onClick={() => { edit((p) => { p.plan!.rows.splice(i, 1); }); s.setUi({ slot: null }); }}>✕</button>
                </span>
              </div>
              <div className="rule-line"><span className="kw">WHEN</span><ManySlot stage={stage} parent={r} socket="if" label="condition" errors={errs} />{!(Array.isArray(r.args.if) && r.args.if.length) && <span className="small muted">(always)</span>}</div>
              <div className="rule-line"><span className="kw">USE</span><SlotChip stage={stage} slot={{ parentId: r.id, socket: 'do', index: null }} label="job" errors={errs} />
                {job?.cardId === 'job.skill' && <SkillPicker pet={pet} value={String(job.args.skill ?? '')} onPick={(v) => edit((p) => { const jj = p.plan!.rows[i].args.do as SpecNode; jj.args.skill = v; })} />}
              </div>
              <label className="small night-opt"><input type="checkbox" checked={paramOf(r, 'night', 'sleep') === 'work'} onChange={(e) => edit((p) => { p.plan!.rows[i].args.night = e.target.checked ? 'work' : 'sleep'; })} /> keep at it at night (instead of sleeping)</label>
              <div className="rule-line"><span className="kw">OR USE</span><ManySlot stage={stage} parent={r} socket="also" label="job" errors={errs} /></div>
              <div className="rule-line"><span className="kw">UNTIL</span>{isNode(r.args.until) ? <SlotChip stage={stage} slot={{ parentId: r.id, socket: 'until', index: null }} label="condition" errors={errs} /> : <><SlotChip stage={stage} slot={{ parentId: r.id, socket: 'until', index: null }} label="condition" errors={errs} /><span className="small muted">(none: each finished job counts)</span></>}</div>
              {rows[i] && <div className="small muted evidence">{rows[i].jobs.map((j) => <span key={j.key} className={`chip ${pr && (pr.cooldown[`${r.id}|${j.key}`] ?? -1) > tick ? 'warn' : ''}`}>{j.label}: {ev(j.key)}{pr && (pr.cooldown[`${r.id}|${j.key}`] ?? -1) > tick ? ' · resting' : ''}</span>)}</div>}
            </li>
          );
        })}
      </ol>
      <button className="btn ghost small" onClick={() => edit((p) => { p.plan!.rows.push(node('plan.responsibility', { label: `Responsibility ${p.plan!.rows.length + 1}`, if: [], do: node('job.nap') })); })}>+ Add responsibility</button>
      {s.ui.slot && plan.rows.some((r) => r.id === s.ui.slot!.parentId || JSON.stringify(r).includes(`"id":"${s.ui.slot!.parentId}"`)) && <Sleeve stage={stage} onChange={onChange} />}
      {(diags.length > 0 || warnings.length > 0) && (
        <div className="diags">
          {diags.map((d, i) => <div key={`d${i}`} className={`diag ${d.severity}`}>{d.message}</div>)}
          {warnings.map((w, i) => <div key={`w${i}`} className="diag warning">{w.message}</div>)}
        </div>
      )}
      {preview && <PreviewCard preview={preview} rows={rows} />}
      <details className="queue" data-tut="duty-trace" open>
        <summary>Why {pet.name} is doing what they do</summary>
        {pr && pr.trace.length > 0
          ? <ol>{pr.trace.slice(-8).reverse().map((t, i) => <li key={i} className="small"><span className="muted">tick {t.tick}:</span> {t.text}</li>)}</ol>
          : <p className="small muted">No decisions yet — {pet.name} explains each choice here once they’re on Auto and the farm is running.</p>}
      </details>
      <button className="btn primary" data-tut="plan-apply" onClick={() => { store.mutate((g) => applyPlan(g, store.runtime, pet.id)); store.toast(`${pet.name} is working on these responsibilities (Auto).`, 'good'); }}>Use these responsibilities</button>
    </div>
  );
}

/** The farm runtime that decides for this pet (the lead's, or its helper slot's). */
function runtimeOf(petId: string): FarmRuntime | null {
  const g = store.state;
  if (g.farm.dutyPetId === petId) return store.runtime;
  const i = (g.farm.helpers ?? []).findIndex((h) => h.petId === petId);
  return i >= 0 ? store.runtime.crew[i] ?? null : null;
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
        <div className="stat"><span className="small muted">Switches/min</span><b className="num">{preview.switchesPerMinute.toFixed(1)}</b></div>
        <div className="stat"><span className="small muted">Pond dips</span><b className="num">{preview.dips}</b></div>
        <div className="stat"><span className="small muted">Guard steps in</span><b className="num">{preview.guarded}</b></div>
      </div>
      <ul className="small fires">
        {rows.map((r) => <li key={r.id}><b>{r.index + 1}. {r.label}</b> — {preview.fires[r.id] ? `ran ${preview.fires[r.id]}×` : 'never ran'}</li>)}
      </ul>
      {never.length > 0 && <div className="diag info small">{never.length === 1 ? `Responsibility ${never[0].index + 1} never ran` : `Responsibilities ${never.map((r) => r.index + 1).join(', ')} never ran`} in this preview. That can be fine (e.g. night ones during the day), or a sign one above it always wins.</div>}
      {fight && <div className="diag warning small">Responsibilities are fighting each other ({preview.switchesPerMinute.toFixed(0)} switches a minute{preview.guarded ? `; the guard stepped in ${preview.guarded}×` : ''}). Make their WHENs exclusive, give one an UNTIL, or reorder them.</div>}
      <div className="small muted">The farm is deterministic, so if you use these now, the real farm will do exactly this.</div>
    </div>
  );
}
