import { useState } from 'react';
import { store, useStore } from './store';
import { closeTraining } from './training';
import { CHAPTERS, chapterById, currentStep, guide, guideComparison, startChapter, skipChapter, pauseChapter, ackStep } from '../game/tutorial';

type Tab = 'lessons' | 'notebook' | 'glossary';

export function GuideScreen() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('lessons');
  const g = guide(s.state);
  const step = currentStep(s.state);
  const compareChapter = step && step.highlight === 'guide-compare' ? step.chapter.id : null;
  return (
    <div className="screen single">
      <div className="panel">
        <div className="row between wrap">
          <h3>Trainer’s Field Guide</h3>
          <div className="seg" role="tablist" aria-label="Guide sections">
            {(['lessons', 'notebook', 'glossary'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'lessons' ? 'Lessons' : t === 'notebook' ? 'Trainer’s notebook' : 'Glossary'}</button>
            ))}
          </div>
        </div>
        <p className="small muted">Short lessons that show how a good trainer thinks — usually by trying something the wrong way first and comparing your pet’s own numbers. Lessons are free (no energy) and new ones appear when they become useful.</p>
      </div>

      {compareChapter && <Comparison chapter={compareChapter} />}

      {tab === 'lessons' && (
        <div className="panel">
          <ol className="guide-list">
            {CHAPTERS.map((c, n) => {
              const st = g.status[c.id];
              return (
                <li key={c.id} className={`guide-item ${st ?? 'locked'}`}>
                  <div className="row between wrap">
                    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                      <strong>{n + 1}. {c.title}</strong> <span className="small muted">· {c.minutes} min</span>
                      <div className="small muted">{c.blurb}</div>
                      {!st && c.opensWhen && <div className="small muted">🔒 {c.opensWhen}</div>}
                    </div>
                    <span className="row gap">
                      <span className={`chip ${st === 'done' ? 'good' : ''}`}>{st === 'done' ? '✓ done' : st === 'active' ? 'in progress' : st === 'offered' ? 'new' : st === 'skipped' ? 'skipped' : '🔒 later'}</span>
                      {st === 'active' && <button className="btn ghost small" onClick={() => s.mutate((x) => pauseChapter(x))}>Pause</button>}
                      {(st === 'offered' || st === 'skipped' || st === 'done') && <button className="btn small" onClick={() => { s.mutate((x) => startChapter(x, c.id)); closeFinishedReport(); const first = currentStep(store.state); if (first?.screen && first.screen !== 'guide') store.setUi({ screen: first.screen }); }}>{st === 'done' ? 'Replay' : 'Start'}</button>}
                      {(st === 'offered' || st === 'active') && <button className="btn ghost small" onClick={() => s.mutate((x) => skipChapter(x, c.id))}>Skip</button>}
                    </span>
                  </div>
                  {st === 'active' && (
                    <ol className="small guide-steps">
                      {c.steps.map((x, i) => <li key={x.id} className={i < g.step ? 'done' : i === g.step ? 'now' : ''}>{x.title}</li>)}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="small muted">Lessons appear as your farm grows. Neighbours’ requests on the farm sometimes point to a lesson that helps.</p>
        </div>
      )}
      {tab === 'notebook' && <Notebook />}
      {tab === 'glossary' && <Glossary />}
    </div>
  );
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

function Comparison({ chapter }: { chapter: string }) {
  const s = useStore();
  const rows = guideComparison(s.state, chapter);
  const showTreats = rows.some((r) => r.run.treats !== undefined) && chapter === 'results';
  const note = chapterById(chapter)?.compare?.note;
  return (
    <div className="panel compare-card" data-tut="guide-compare">
      <h3>Your two runs</h3>
      <div className="compare" role="table" aria-label="Comparison of your runs">
        <div className="cmp-row head small muted" role="row"><span role="columnheader" /><span role="columnheader">success on new layouts</span><span role="columnheader" className="num">score</span><span role="columnheader" className="num">{showTreats ? 'treats' : chapter === 'routines' ? 'random choices' : 'random'}</span></div>
        {rows.map((r) => (
          <div key={r.label} className="cmp-row" role="row">
            <span role="cell" className="cmp-name">{r.label}<span className="muted small"> bigger pens {pct(r.run.transfer)}</span></span>
            <span role="cell" className="cmp-bar"><i className="after" style={{ width: `${r.run.after * 100}%` }} /></span>
            <span role="cell" className="num">{pct(r.run.after)}</span>
            <span role="cell" className="num muted">{showTreats ? (r.run.treats ?? 0).toFixed(1) : pct(r.run.random)}</span>
          </div>
        ))}
      </div>
      {chapter === 'practice' && <p className="small">Same pen, same rules — only the amount of practice changed. A lesson that looks broken at a few hundred tries often just needs more.</p>}
      {chapter === 'scatter' && <p className="small">The pinned pet practised one layout perfectly — and that’s exactly why it stumbles on new ones. Scatter anything whose position changes in real life.</p>}
      {note && <p className="small">{note}</p>}
      <button className="btn primary" onClick={() => s.mutate((x) => ackStep(x))}>Got it</button>
    </div>
  );
}

export function Notebook() {
  return (
    <div className="panel notebook">
      <h3>Trainer’s notebook</h3>
      <p className="small muted">Measured in this game: each line comes from training real pets and testing them on layouts they never practised.</p>
      <p><b>Before you build, ask:</b> What job is this for? Where will it run? What counts as done?</p>
      <ol>
        <li><b>Pen.</b> Scatter things. One pinned layout scored ~15% on new layouts; pinning just the berry ~75%; scattering ~95%. Include what the job will meet — rocks, ponds, fences, gates, creatures. Some variety, not a maze: practising with no rocks scored 70% in cluttered pens, a few rocks 86%, lots of rocks 80%.</li>
        <li><b>Treats.</b> Pay for the result and end the try there. A tiny “hurry up” nudge helps a little (92% → 96%); a nudge alone with no treat for finishing teaches almost nothing (12%).</li>
        <li><b>Careful with paying for actions.</b> A treat every pickup or every shoo gets exploited (~30 per try, the job forgotten). Add <em>once per object</em>. Paying for “getting closer” quietly misleads (96% → 87%).</li>
        <li><b>Success.</b> The condition you judge by. It must mean the job is done — not just that treats were earned.</li>
        <li><b>Senses</b> (your own skills): the fewest that decide the move. Extra senses multiply the situations to practise (watering fell from 60% to 10% with one unneeded sense; Wait for it from ~90% to ~40% with “How far is rock”). A sense that never changes in the pen (hazards with no pond) costs nothing — and teaches nothing.</li>
        <li><b>Practice.</b> Below ~700 tries most lessons look broken (300 tries: ~35%; 1,500: ~95%). Use <em>Refine</em> to keep going.</li>
        <li><b>Judge.</b> Compare with Random (and “Random choices” for routines), check Bigger pens, then open the summary and “What does Pip do?”. If treats rise but success doesn’t, look for a loophole.</li>
        <li><b>Deploy and watch.</b> Run it on the farm, preview plans, and retrain when the farm changes.</li>
      </ol>
    </div>
  );
}

const GLOSSARY: [string, string][] = [
  ['House (selling)', 'On the farm, produce only earns coins when a pet brings it to the house. Fireflies are the exception (+1 when caught).'],
  ['Basket / shed', 'Farm storage. A basket holds 6 of one kind; a shed holds 4 kinds, 10 each. Harvesters drop crops there; a hauler (Fetch) takes them to the house.'],
  ['Plant', 'Walk to empty soil and plant its crop. The seed is paid from your coins (carrot 1, sunflower 2, pumpkin 3); field crops need replanting after each harvest, berry bushes regrow by themselves.'],
  ['Layout', 'Farm → Layout…: place bushes, crop patches, baskets, sheds, scarecrows and fences; move or remove them (half the price back). Preview the draft against the farm as it is, then apply. Everything must stay reachable from the house; up to 8 crop plots (14 with the orchard).'],
  ['Harvest / Haul', 'Harvest: pick a ripe crop and carry it to storage with room, or the house. Haul: carry eggs and stored goods to the house (needs Fetch).'],
  ['Pen / lesson', 'A practice world plus rules. What’s in the pen is all your pet sees while learning.'],
  ['Try', 'One attempt in the pen, from the start until the try ends or time runs out.'],
  ['Treats', 'Reward. How your pet learns which actions are good.'],
  ['Success', 'The SUCCESS condition — how you check the job was really done. The report judges by this, never by treats.'],
  ['Scatter / Place here', 'Random spot each try vs. always the same tile.'],
  ['New layouts', 'Held-out tests: layouts your pet never practised on. The honest score.'],
  ['Random wandering', 'A baseline: what random moves achieve. A skill must beat it clearly.'],
  ['Bigger pens', 'Transfer: larger, more cluttered pens never seen in practice.'],
  ['Senses', 'What a skill pays attention to (where the target is, walls nearby…).'],
  ['Abilities', 'What a skill may do (move, stay, pick up, water, shoo, nudge…).'],
  ['Situations', 'How many different combinations of senses your pet must learn. More = more practice.'],
  ['Revision', 'A saved version of a skill (r1, r2…). You can switch back any time.'],
  ['Experiment', 'A Field Guide run: free, for comparing, not saved unless you choose.'],
  ['Routine', 'A skill that chooses between your other skills.'],
  ['Farm plan', 'IF/DO rows deciding which job runs when on the farm.'],
];

function Glossary() {
  return (
    <div className="panel">
      <h3>Glossary</h3>
      <dl className="glossary">{GLOSSARY.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="small">{v}</dd></div>)}</dl>
    </div>
  );
}

/** A saved (or stopped) report from another pen would cover the new lesson's binder, so close it. Unsaved results stay. */
function closeFinishedReport() {
  const t = store.ui.training;
  if (t && t.stage.id !== store.state.activeStageId && (t.saved || t.status === 'cancelled' || t.status === 'error')) closeTraining();
}
