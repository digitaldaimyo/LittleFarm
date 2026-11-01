import { useState } from 'react';
import { useStore, store } from './store';
import { PetSprite } from './art';
import { activePet, activeRevision, isCertified, rollbackSkill } from '../game/pets';
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
          <div className="small muted">Executive: {pet.executive.mode === 'rules' ? 'simple rules' : 'learns from results'} · {pet.executive.decisions} decisions · {Object.keys(pet.executive.table).length} learned context/behavior values</div>
        </div>
      </section>
      <aside className="side-col">
        <div className="panel">
          <h3>Repertoire</h3>
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
    const own = s.state.stages.find((x) => x.id === k.revisions.at(-1)?.stageId);
    const stage = k.custom ? own : recipeStage(k.name === 'Approach' ? 'go-to-berry' : k.name === 'Avoid' ? 'avoid-pond' : 'bring-it-home');
    if (!stage) { setCmp('The lesson this skill was trained in was deleted, so there’s nothing to compare on.'); return; }
    const seeds = heldOutSeeds(stage);
    const navRev = k.name === 'Fetch' ? activeRevision(pet.skills.find((x) => x.name === (k.navigator ?? 'Approach')) ?? null) : null;
    const rows = k.revisions.slice(-4).map((r) => {
      const e = evaluate(stage, policySpecFor(stage, r.policy, navRev?.policy ?? null, navRev?.learner, r.learner), seeds, 'evaluation', pet.traits, 0);
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
              <td>{r.rev !== k.activeRev && <button className="btn ghost small" onClick={() => s.mutate((g) => { rollbackSkill(g, g.pets.find((p) => p.id === pet.id)!, k.name, r.rev); store.runtime.exec = null; })}>Use</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {k.revisions.length > 1 && <button className="btn ghost small" onClick={compare}>Compare revisions now</button>}
      {cmp && <div className="small">{cmp}</div>}
      <details className="small"><summary>Provenance</summary>
        {(() => { const r = activeRevision(k); return r ? <ul><li>Trainer: {r.provenance.trainer}</li><li>State: {r.provenance.features}</li><li>Training seeds: {r.provenance.trainSeeds}</li><li>Eval seeds: {r.provenance.evalSeeds[0]}…{r.provenance.evalSeeds.at(-1)}</li>{r.provenance.navigator && <li>Trained with {r.provenance.navigator.skill} r{r.provenance.navigator.rev}; uses whichever revision is active now</li>}<li>{r.provenance.simTicks.toLocaleString()} sim ticks, {(r.provenance.durationMs / 1000).toFixed(1)}s compute</li></ul> : null; })()}
      </details>
    </div>
  );
}
