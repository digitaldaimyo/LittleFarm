import { useState } from 'react';
import { store, useStore } from './store';
import { CHAPTERS, currentStep, guide, guideComparison, startChapter, skipChapter, pauseChapter, ackStep } from '../game/tutorial';

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
            {CHAPTERS.map((c) => {
              const st = g.status[c.id];
              return (
                <li key={c.id} className={`guide-item ${st ?? 'locked'}`}>
                  <div className="row between wrap">
                    <div>
                      <strong>{c.title}</strong> <span className="small muted">· {c.minutes} min</span>
                      <div className="small muted">{c.blurb}</div>
                    </div>
                    <span className="row gap">
                      <span className={`chip ${st === 'done' ? 'good' : ''}`}>{st === 'done' ? '✓ done' : st === 'active' ? 'in progress' : st === 'offered' ? 'new' : st === 'skipped' ? 'skipped' : '🔒 later'}</span>
                      {st === 'active' && <button className="btn ghost small" onClick={() => s.mutate((x) => pauseChapter(x))}>Pause</button>}
                      {(st === 'offered' || st === 'skipped' || st === 'done') && <button className="btn small" onClick={() => { s.mutate((x) => startChapter(x, c.id)); const first = currentStep(store.state); if (first?.screen && first.screen !== 'guide') store.setUi({ screen: first.screen }); }}>{st === 'done' ? 'Replay' : 'Start'}</button>}
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
          <p className="small muted">More lessons — paying for results, practising where skills will be used, inventing skills, reading your pet, routines and farm plans — are on their way.</p>
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
  return (
    <div className="panel compare-card" data-tut="guide-compare">
      <h3>Your two runs</h3>
      <div className="compare" role="table" aria-label="Comparison of your runs">
        <div className="cmp-row head small muted" role="row"><span role="columnheader" /><span role="columnheader">new layouts</span><span role="columnheader" className="num">score</span><span role="columnheader" className="num">random</span></div>
        {rows.map((r) => (
          <div key={r.label} className="cmp-row" role="row">
            <span role="cell" className="cmp-name">{r.label}<span className="muted small"> bigger pens {pct(r.run.transfer)}</span></span>
            <span role="cell" className="cmp-bar"><i className="after" style={{ width: `${r.run.after * 100}%` }} /></span>
            <span role="cell" className="num">{pct(r.run.after)}</span>
            <span role="cell" className="num muted">{pct(r.run.random)}</span>
          </div>
        ))}
      </div>
      {chapter === 'practice' && <p className="small">Same pen, same rules — only the amount of practice changed. A lesson that looks broken at a few hundred tries often just needs more.</p>}
      {chapter === 'scatter' && <p className="small">The pinned pet practised one layout perfectly — and that’s exactly why it stumbles on new ones. Scatter anything whose position changes in real life.</p>}
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
        <li><b>Senses</b> (your own skills): the fewest that decide the move. Extra senses multiply the situations to practise (watering fell from 60% to 10% with one unneeded sense).</li>
        <li><b>Practice.</b> Below ~700 tries most lessons look broken (300 tries: ~35%; 1,500: ~95%). Use <em>Refine</em> to keep going.</li>
        <li><b>Judge.</b> Compare with Random (and “Random choices” for routines), check Bigger pens, then open the summary and “What does Pip do?”. If treats rise but success doesn’t, look for a loophole.</li>
        <li><b>Deploy and watch.</b> Run it on the farm, preview plans, and retrain when the farm changes.</li>
      </ol>
    </div>
  );
}

const GLOSSARY: [string, string][] = [
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
