import { useRef, useState } from 'react';
import { BehaviorSummaryView } from './Summary';
import { exportSkillCard, importSkillCard } from '../game/skillcard';
import { useStore, store } from './store';
import { PetSprite } from './art';
import { activePet, activeRevision, isCertified, rollbackSkill, staleUses, subskillsFor } from '../game/pets';
import { LEARNED_JOBS, allowedOnFarm, deployedRevision, jobSkill } from '../game/capability';
import { RECIPES } from '../domain/recipes';
import { recipeStage } from '../domain/recipes';
import { evaluate } from '../learning/episodes';
import { heldOutSeeds, policySpecFor } from '../learning/report';
import type { Pet, Skill } from '../game/types';
import { Meter } from './FarmScreen';

export function PetsScreen() {
  const s = useStore();
  const pet = activePet(s.state);
  if (!pet) return <div className="empty">No pets yet.</div>;
  return (
    <div className="screen pets-screen">
      <section className="stage-col">
        <div className="panel">
          <h3>Your pets</h3>
          <div className="pet-list">
            {s.state.pets.map((p) => (
              <button key={p.id} className={`pet-pick ${p.id === pet.id ? 'sel' : ''}`} aria-pressed={p.id === pet.id} onClick={() => s.mutate((g) => { g.activePetId = p.id; })}>
                <PetSprite palette={p.palette} size={48} />
                <span>{p.name}</span>
                <span className="small muted">{p.skills.length} skills{p.id === s.state.farm.dutyPetId ? ' · on duty' : ''}</span>
              </button>
            ))}
            <button className="pet-pick add" onClick={() => s.setUi({ modal: 'shop' })}>+ Adopt (shop)</button>
          </div>
        </div>
        <div className="panel">
          <div className="row gap">
            <PetSprite palette={pet.palette} size={72} mood="celebrate" />
            <div className="grow">
              <input className="rule-label big" aria-label="Pet name" value={pet.name} onChange={(e) => s.mutate((g) => { g.pets.find((x) => x.id === pet.id)!.name = e.target.value.slice(0, 20); })} />
              <Meter label="Energy" value={pet.energy} />
              <Meter label="Mood" value={pet.mood} />
            </div>
          </div>
          <div className="stats-grid">
            <span>Coins earned <b>{pet.stats.coins}</b></span>
            <span>Berries <b>{pet.stats.berries}</b></span>
            <span>Deliveries <b>{pet.stats.deliveries}</b></span>
            <span>Pond dips <b>{pet.stats.dips}</b></span>
            <span>Lessons <b>{pet.stats.trainingRuns}</b></span>
            <span>Practice tries <b>{pet.stats.episodes.toLocaleString()}</b></span>
          </div>
          <div className="small muted">On Auto: {pet.executive.mode === 'order' ? 'picks in your order' : 'learns what pays off'} · {pet.executive.decisions} decisions · {Object.keys(pet.executive.values?.upper ?? {}).length} situations learned</div>
        </div>
      </section>
      <aside className="side-col">
        <FarmReadiness pet={pet} />
        <div className="panel">
          <div className="row between"><h3>Repertoire</h3><ImportCard pet={pet} /></div>
          {pet.skills.length === 0 && <p className="muted small">Nothing learned yet — head to Teach.</p>}
          {pet.skills.map((k) => <SkillHistory key={k.id} pet={pet} k={k} />)}
        </div>
      </aside>
    </div>
  );
}

function SkillHistory({ pet, k }: { pet: Pet; k: Skill }) {
  const s = useStore();
  const [cmp, setCmp] = useState<string | null>(null);
  const compare = () => {
    if (k.revisions.length < 2) return;
    // Presets compare on their standard lesson; your own skills on the lesson of their latest revision.
    const own = k.revisions.at(-1)?.stage ?? s.state.stages.find((x) => x.id === k.revisions.at(-1)?.stageId) ?? s.state.stages.find((x) => x.learner.skill === k.name);
    const stage = k.custom ? own : recipeStage(k.name === 'Approach' ? 'go-to-berry' : k.name === 'Avoid' ? 'avoid-pond' : 'bring-it-home');
    if (!stage) { setCmp('The lesson this skill was trained in was deleted, so there’s nothing to compare on.'); return; }
    const seeds = heldOutSeeds(stage);
    const navRev = k.name === 'Fetch' ? activeRevision(pet.skills.find((x) => x.name === (k.navigator ?? 'Approach')) ?? null) : null;
    const rows = k.revisions.slice(-4).map((r) => {
      const e = evaluate(stage, policySpecFor(stage, r.policy, navRev?.policy ?? null, navRev?.learner, r.learner, subskillsFor(pet), pet.traits), seeds, 'evaluation', pet.traits, 0);
      return `r${r.rev}: ${e.successes}/${e.episodes}`;
    });
    setCmp(`Same ${seeds.length} held-out layouts of the standard “${stage.name}” lesson → ${rows.join(' · ')}`);
  };
  return (
    <div className="behavior-card">
      <div className="row between">
        <strong>{k.name}{k.custom && <span className="chip">your own</span>}</strong>
        <span className={`chip ${isCertified(k) ? 'good' : ''}`}>active r{k.activeRev}</span>
      </div>
      {k.custom && <code className="small">{k.signature}</code>}
      {staleUses(pet, activeRevision(k)).length > 0 && <div className="diag warning small">Certified with {staleUses(pet, activeRevision(k)).map((u) => `${u.skill} r${u.trained}`).join(', ')}, which {staleUses(pet, activeRevision(k)).length > 1 ? 'have' : 'has'} changed since. Press “Compare revisions now” or re-test it in Curriculum.</div>}
      <div className="row gap wrap small" data-tut="farm-use">
        <label>On the farm{' '}
          <select value={k.farmUse ?? 'auto'} onChange={(e) => s.mutate((g) => { const kk = g.pets.find((p) => p.id === pet.id)!.skills.find((x) => x.id === k.id)!; const v = e.target.value; if (v === 'auto') delete kk.farmUse; else kk.farmUse = v as 'on' | 'off'; })}>
            <option value="auto">{isCertified(k) ? 'usable (certified)' : 'not yet (uncertified)'}</option>
            <option value="on">always usable{isCertified(k) ? '' : ' (opt in)'}</option>
            <option value="off">never on its own</option>
          </select>
        </label>
        <label>Runs{' '}
          <select value={k.pinnedRev ?? ''} onChange={(e) => s.mutate((g) => { const kk = g.pets.find((p) => p.id === pet.id)!.skills.find((x) => x.id === k.id)!; if (e.target.value === '') delete kk.pinnedRev; else kk.pinnedRev = Number(e.target.value); store.runtime.exec = null; })}>
            <option value="">the active revision (follows retraining)</option>
            {k.revisions.filter((r) => !r.tableDropped).map((r) => <option key={r.rev} value={r.rev}>pinned to r{r.rev}</option>)}
          </select>
        </label>
        <span className="muted">{allowedOnFarm(k) ? `The farm may use ${k.name} on its own.` : `The farm won’t use ${k.name} unless you assign it.`}</span>
      </div>
      <label className="small">Nickname <input value={k.nickname ?? ''} placeholder={k.name} maxLength={24} onChange={(e) => s.mutate((g) => { const kk = g.pets.find((p) => p.id === pet.id)!.skills.find((x) => x.id === k.id)!; kk.nickname = e.target.value || undefined; })} /></label>
      <table className="ledger">
        <thead><tr><th>Rev</th><th>Lesson</th><th>Tries</th><th>Held-out</th><th>Before</th><th>Transfer</th><th /></tr></thead>
        <tbody>
          {[...k.revisions].reverse().map((r) => (
            <tr key={r.rev} className={r.rev === k.activeRev ? 'sel' : ''}>
              <td>r{r.rev}{r.eval.passed ? ' ✓' : ''}</td>
              <td className="small">{r.stageName}</td>
              <td className="num">{r.episodes}</td>
              <td className="num">{Math.round(r.eval.successRate * 100)}% <span className="muted">n={r.eval.episodes}</span></td>
              <td className="num">{Math.round(r.eval.beforeRate * 100)}%</td>
              <td className="num">{Math.round(r.eval.transferRate * 100)}%</td>
              <td>{r.tableDropped ? <span className="small muted" title="Big-brain tables are kept for the active and newest revisions only, to keep saves small">table not kept</span> : r.rev !== k.activeRev && <button className="btn ghost small" onClick={() => s.mutate((g) => { rollbackSkill(g, g.pets.find((p) => p.id === pet.id)!, k.name, r.rev); store.runtime.exec = null; })}>Use</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(k.revisions.length > 1 || staleUses(pet, activeRevision(k)).length > 0) && <button className="btn ghost small" onClick={compare}>Compare revisions now</button>}
      {cmp && <div className="small">{cmp}</div>}
      {!activeRevision(k)?.summary && (
        <button className="btn ghost small" data-tut="summary" onClick={() => {
          const r = activeRevision(k)!;
          const own = r.stage ?? s.state.stages.find((x) => x.id === r.stageId) ?? s.state.stages.find((x) => x.learner.skill === k.name);
          const stage = k.custom ? own : recipeStage(k.name === 'Approach' ? 'go-to-berry' : k.name === 'Avoid' ? 'avoid-pond' : 'bring-it-home');
          if (!stage) return store.toast('The lesson this skill was trained in is gone, so there’s nothing to re-test on.', 'warn');
          const navRev = k.name === 'Fetch' ? activeRevision(pet.skills.find((x) => x.name === (k.navigator ?? 'Approach')) ?? null) : null;
          const e = evaluate(stage, policySpecFor(stage, r.policy, navRev?.policy ?? null, navRev?.learner, r.learner, subskillsFor(pet), pet.traits), heldOutSeeds(stage), 'evaluation', pet.traits, 0);
          store.mutate((g) => { const rr = g.pets.find((p) => p.id === pet.id)!.skills.find((x) => x.id === k.id)!.revisions.find((x) => x.rev === r.rev)!; rr.summary = e.summary; });
        }}>What does it actually do? (work it out now)</button>
      )}
      {activeRevision(k)?.summary && (
        <details className="small" data-tut="summary" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) store.mutate((g) => { g.progress.flags[k.custom ? 'viewedSummaryCustom' : 'viewedSummaryPreset'] = true; }); }}><summary>What it actually does (r{k.activeRev}, held-out tries)</summary>
          <BehaviorSummaryView s={activeRevision(k)!.summary!} target={activeRevision(k)!.focus ?? activeRevision(k)!.stage?.learner.focus ?? 'target'} />
        </details>
      )}
      <div className="row gap wrap">
        <button className="btn ghost small" data-tut="export-card" onClick={() => {
          const card = exportSkillCard(pet, k.name);
          if (!card) return;
          store.mutate((g) => { g.progress.flags.exportedCard = true; });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(card)], { type: 'application/json' }));
          a.download = `${k.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-r${k.activeRev}.skill.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }}>Export skill card</button>
      </div>
      <details className="small"><summary>Provenance</summary>
        {(() => { const r = activeRevision(k); return r ? <ul><li>Trainer: {r.provenance.trainer}</li><li>State: {r.provenance.features}</li><li>Training seeds: {r.provenance.trainSeeds}</li><li>Eval seeds: {r.provenance.evalSeeds[0]}…{r.provenance.evalSeeds.at(-1)}</li>{r.provenance.navigator && <li>Trained with {r.provenance.navigator.skill} r{r.provenance.navigator.rev}; uses whichever revision is active now</li>}<li>{r.provenance.simTicks.toLocaleString()} sim ticks, {(r.provenance.durationMs / 1000).toFixed(1)}s compute</li></ul> : null; })()}
      </details>
    </div>
  );
}

function ImportCard({ pet }: { pet: Pet }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn ghost small" onClick={() => ref.current?.click()}>Import skill card…</button>
      <input ref={ref} type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const text = await f.text();
        let result = { ok: false, reason: '' } as ReturnType<typeof importSkillCard>;
        store.mutate((g) => { result = importSkillCard(g, g.pets.find((p) => p.id === pet.id)!, text); });
        if (result.ok) store.toast(`${pet.name} learned “${result.name}” from the card.${result.notes.length ? ' ' + result.notes.join(' ') : ''}`, 'good');
        else store.toast(`Couldn’t import: ${result.reason}`, 'warn');
      }} />
    </>
  );
}

/**
 * Farm readiness (learned-farm phase 6): every farm job is done by one of the pet's own skills or routines. For each:
 * which one, its revision, whether the farm may use it, and how it has gone on the farm — or which recipe teaches it.
 */
function FarmReadiness({ pet }: { pet: Pet }) {
  const rows = [
    ...Object.entries(LEARNED_JOBS).map(([job, spec]) => ({ job, label: spec.label, recipe: spec.recipes.at(-1)!, k: jobSkill(pet, job), key: job.startsWith('gate') ? `gate:${job === 'gateOpen' ? 'open' : 'closed'}` : job })),
    { job: 'walk', label: 'Walking (errands, fireflies, the walk home)', recipe: 'go-to-berry', k: pet.skills.find((x) => x.name === 'Approach') ?? null, key: 'catch' },
  ];
  const recipeName = (id: string) => RECIPES.find((r) => r.id === id)?.name ?? id;
  return (
    <div className="panel" data-tut="farm-readiness">
      <h3>Ready for the farm</h3>
      <p className="small muted">{pet.name} only does on the farm what {pet.name} has learned. Each job runs one of these skills; certified ones are used on their own, others once you allow them below.</p>
      <ul className="readiness">
        {rows.map((r) => {
          const rev = deployedRevision(r.k);
          const e = pet.evidence?.[r.key];
          return (
            <li key={r.job} className={`small ${rev && r.k && allowedOnFarm(r.k) ? 'ready' : 'not-ready'}`}>
              <b>{r.label}</b>{' — '}
              {!r.k || !rev ? <span className="muted">not learned — train “{recipeName(r.recipe)}”</span>
                : <>
                    {r.k.nickname ?? r.k.name} r{rev.rev}{r.k.pinnedRev !== undefined ? ' (pinned)' : ''}
                    {' · '}{allowedOnFarm(r.k) ? (isCertified(r.k) ? 'certified' : 'allowed') : <span className="warn-text">not certified — allow it on the farm to use it</span>}
                    {e && e.n > 0 ? ` · on the farm: ${Math.round(e.ok)}/${Math.round(e.n)} worked, ~${Math.round(e.ticks / e.n)} ticks` : ''}
                  </>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
