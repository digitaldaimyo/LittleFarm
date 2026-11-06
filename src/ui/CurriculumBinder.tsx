/** Teach screen: the Curriculum, Behaviors and Inspect binders, lesson cards and Your cards (split from TeachScreen.tsx, polish phase 3). */
import { useRef } from 'react';
import { audio } from '../audio/engine';
import { describe, describeRule } from '../domain/describe';
import { exportLessonCard, importLessonCard } from '../game/lessoncard';
import type { StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { RECIPES, instantiateRecipe } from '../domain/recipes';
import { recipeLock } from '../game/challenges';
import { cloneStage, newId } from '../domain/spec';
import { store, useStore } from './store';
import { blankCandidates } from './edit';
import { activeRevision, getSkill, isCertified, staleUses, subskillsFor } from '../game/pets';
import { templateOf } from '../learning/skilldef';
import { evaluate, DEFAULT_TRAITS } from '../learning/episodes';
import { policySpecFor, heldOutSeeds } from '../learning/report';
import type { Pet } from '../game/types';
import { addJournal } from '../game/journal';

export function CurriculumBinder({ stage, pet }: { stage: StageSpec; pet: Pet }) {
  const s = useStore();
  const unlocks = new Set(s.state.progress.unlocks);
  const revisit = (st: StageSpec) => {
    const skill = getSkill(pet, st.learner.skill);
    const rev = activeRevision(skill);
    if (!rev) return store.toast(`${pet.name} has no ${st.learner.skill} skill yet.`, 'warn');
    const navRev = templateOf(st) === 'fetch' ? activeRevision(getSkill(pet, st.learner.navigator ?? 'Approach')) : null;
    const r = evaluate(st, policySpecFor(st, rev.policy, navRev?.policy ?? null, navRev?.learner, rev.learner, subskillsFor(pet), pet.traits), heldOutSeeds(st), 'evaluation', pet.traits ?? DEFAULT_TRAITS);
    store.mutate((g) => {
      const p = g.pets.find((x) => x.id === pet.id)!;
      const m = p.mastery[st.id];
      if (m) m.retention = { rate: r.successRate, at: Date.now() };
      else p.mastery[st.id] = { rate: r.successRate, episodes: r.episodes, rev: rev.rev, skill: st.learner.skill, at: Date.now(), retention: { rate: r.successRate, at: Date.now() } };
      addJournal(g, p.id, 'revisit', `${p.name} revisited “${st.name}” with ${st.learner.skill} r${rev.rev}: ${r.successes}/${r.episodes} on held-out layouts.`);
    });
    store.toast(`Re-test: ${r.successes}/${r.episodes} with ${st.learner.skill} r${rev.rev}.`, 'info');
  };
  return (
    <div className="binder-body">
      <p className="small muted">Each lesson is promoted when the pet passes on held-out layouts (not by treat totals). Mastery = when saved; Retention = latest re-test; Transfer = bigger unseen pens.</p>
      <ol className="curriculum">
        {s.state.stages.map((st) => {
          const m = pet.mastery[st.id];
          const passed = m && m.rate >= st.evaluation.minimumSuccessRate;
          return (
            <li key={st.id} className={st.id === stage.id ? 'sel' : ''}>
              <div className="row between">
                <button className="link" onClick={() => s.mutate((g) => { g.activeStageId = st.id; })}><strong>{st.name}</strong></button>
                <span className={`chip ${passed ? 'good' : ''}`}>{passed ? '✓ promoted' : m ? 'practising' : 'new'}</span>
              </div>
              <div className="small muted">{st.learner.skill} · {m ? `mastery ${Math.round(m.rate * 100)}% (n=${m.episodes}, r${m.rev})` : 'not trained'}{m?.retention ? ` · retention ${Math.round(m.retention.rate * 100)}%` : ''}{m?.transfer !== undefined ? ` · transfer ${Math.round(m.transfer * 100)}%` : ''}</div>
              <div className="row gap">
                <button className="btn ghost small" onClick={() => revisit(st)}>Re-test</button>
                <button className="btn ghost small" data-tut="export-lesson" onClick={() => downloadJson(exportLessonCard(st), `pen-deck-lesson-${st.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`)}>Export lesson card</button>
                <button className="btn ghost small" onClick={() => s.mutate((g) => { const c = cloneStage(st, true, newId('stage')); c.name = `${st.name} (copy)`; c.version = 1; g.stages.push(c); g.activeStageId = c.id; })}>Clone</button>
                {s.state.stages.length > 1 && st.id !== 'stage-tutorial' && <button className="btn ghost small" onClick={() => { if (confirm(`Delete lesson “${st.name}”? Skills already learned are kept.`)) s.mutate((g) => { g.stages = g.stages.filter((x) => x.id !== st.id); if (g.activeStageId === st.id) g.activeStageId = g.stages[0].id; }); }}>Delete</button>}
              </div>
            </li>
          );
        })}
      </ol>
      <LessonCardImport />
      <YourCards stage={stage} pet={pet} />
      <h4>New lesson from a recipe</h4>
      <div className="recipes">
        {RECIPES.map((r) => {
          const academyLock = recipeLock(s.state, r.id); // academy edition: recipes are rewards, not spoilers
          const locked = academyLock ?? (r.unlock && !unlocks.has(r.unlock) ? `Unlocks with ${r.unlock === 'fetch' ? 'Fetch lessons' : 'Avoid lessons'}` : null);
          return (
            <button key={r.id} className="suggest" data-tut={`recipe-${r.id}`} disabled={!!locked} onClick={() => s.mutate((g) => { const st = instantiateRecipe(r.id); g.stages.push(st); g.activeStageId = st.id; store.ui.slot = null; })}>
              <strong>{r.name}</strong>{r.optional && <span className="chip">experiment</span>}
              <span className="small muted">{locked ? `🔒 ${locked}` : r.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function downloadJson(data: unknown, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function LessonCardImport() {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="row gap wrap">
      <button className="btn ghost small" data-tut="import-lesson" onClick={() => ref.current?.click()}>Import lesson card…</button>
      <span className="small muted">Lesson cards share a pen and its rules (not what a pet learned — that’s a skill card).</span>
      <input ref={ref} type="file" accept="application/json,.json" hidden data-tut="import-lesson-file" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const text = await f.text();
        let r = { ok: false, reason: '' } as ReturnType<typeof importLessonCard>;
        store.mutate((g) => { r = importLessonCard(g, text); });
        if (r.ok) { audio.play('card.snap'); store.toast(`Lesson “${r.name}” added.${r.notes.length ? ` ${r.notes.join(' ')}` : ''}`, 'good'); store.setUi({ binder: 'rules', slot: null }); }
        else { audio.play('card.reject'); store.toast(`Couldn’t import: ${r.reason}`, 'warn'); }
      }} />
    </div>
  );
}

/** "Your cards": saved cards (from “Save as one of your cards” in a sleeve), with blanks and housekeeping. */
function YourCards({ stage, pet }: { stage: StageSpec; pet: Pet }) {
  const s = useStore();
  const tpls = s.state.templates;
  return (
    <div data-tut="your-cards-shelf">
      <h4>Your cards</h4>
      {tpls.length === 0 ? (
        <p className="small muted">Open any card in a lesson (✎) and press “Save as one of your cards”. It then appears first in the hand wherever it fits — rules, SUCCESS, routines, farm plans — under its own name.</p>
      ) : (
        <ul className="placements">
          {tpls.map((t) => {
            const cands = blankCandidates(t);
            return (
              <li key={t.id} className="your-card">
                <div className="grow">
                  <strong>{t.name}</strong> <span className="small muted">r{t.revision} · {REGISTRY.cards.get(t.root.cardId)?.presentation.group ?? ''}</span>
                  <div className="small">{t.root.cardId === 'rule' ? describeRule(t.root, { petName: pet.name, target: stage.learner.focus }) : describe(t.root, { petName: pet.name, target: stage.learner.focus })}</div>
                  {cands.length > 0 && (
                    <div className="row gap wrap small">
                      <span className="muted">Blanks to fill in each time:</span>
                      {cands.map((c) => (
                        <label key={c.id}><input type="checkbox" checked={t.exposed.includes(c.id)} onChange={(e) => s.mutate((g) => { const x = g.templates.find((y) => y.id === t.id); if (!x) return; x.exposed = e.target.checked ? [...x.exposed, c.id] : x.exposed.filter((id) => id !== c.id); })} /> {c.title}</label>
                      ))}
                    </div>
                  )}
                </div>
                <button className="icon-btn small" aria-label={`Delete your card ${t.name}`} onClick={() => { if (confirm(`Delete your card “${t.name}” r${t.revision}? Lessons that used it keep their copy.`)) s.mutate((g) => { g.templates = g.templates.filter((y) => y.id !== t.id); }); }}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function BehaviorsBinder({ pet }: { pet: Pet }) {
  const s = useStore();
  return (
    <div className="binder-body">
      <h4>{pet.name}’s behaviors</h4>
      {pet.skills.length === 0 && <p className="small muted">No saved skills yet. Train a lesson and press “Save skill”.</p>}
      {pet.skills.map((k) => {
        const r = activeRevision(k);
        return (
          <div key={k.id} className="behavior-card">
            <div className="row between"><strong>{k.nickname ?? k.name}{k.custom && <span className="chip">your own</span>}</strong><span className={`chip ${isCertified(k) ? 'good' : ''}`}>r{k.activeRev}{isCertified(k) ? ' · certified' : ''}</span></div>
            <code className="small">{k.signature}</code>
            <div className="small muted">Starts when: {k.initiation} Ends: {k.termination}</div>
            {k.kind === 'routine' && r?.uses && <div className="small">Uses {r.uses.map((u) => `${u.skill} r${u.rev}`).join(', ')}</div>}
            {staleUses(pet, r).length > 0 && <div className="diag warning small">Certified with {staleUses(pet, r).map((u) => `${u.skill} r${u.trained}`).join(', ')}; now {staleUses(pet, r).map((u) => `${u.skill} ${u.now ? `r${u.now}` : 'missing'}`).join(', ')}. Behaviour may differ — re-test it in Curriculum.</div>}
            {r && <div className="small">Held-out success {Math.round(r.eval.successRate * 100)}% (n={r.eval.episodes}) · trained on “{r.stageName}”{r.provenance.navigator ? ` · uses ${r.provenance.navigator.skill} (currently r${getSkill(pet, r.provenance.navigator.skill)?.activeRev ?? '?'})` : ''}</div>}
          </div>
        );
      })}
      <h4>Templates</h4>
      {s.state.templates.length === 0 && <p className="small muted">Open any card’s sleeve and press “Save as template” to reuse it. Templates are immutable revisions; using one makes a copy.</p>}
      <ul className="placements">
        {s.state.templates.map((t) => (
          <li key={t.id}><strong>{t.name}</strong> <span className="chip">r{t.revision}</span> <span className="small muted">{t.output.name}</span>
            <button className="icon-btn small" aria-label="Delete template" onClick={() => s.mutate((g) => { g.templates = g.templates.filter((x) => x.id !== t.id); })}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InspectBinder({ stage }: { stage: StageSpec }) {
  const json = JSON.stringify(stage, null, 2);
  return (
    <div className="binder-body">
      <p className="small muted">The canonical, serialisable lesson spec. The simulator and learner compile from exactly this.</p>
      <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(json)}>Copy JSON</button>
      <pre className="spec">{json}</pre>
    </div>
  );
}
