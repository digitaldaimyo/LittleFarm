import { audio } from '../audio/engine';
import { CertifyButton } from './ChallengeBanner';
import { useEffect } from 'react';
import { isGuideStage } from '../game/tutorial';
import { Tips } from './Tips';
import { reportTips } from '../game/coach';
import { CHAPTERS } from '../game/tutorial';
import type { LearnFinding } from '../learning/diagnose';

const FINDING_TITLE: Record<LearnFinding['id'], string> = { 'never-happened': 'The big treat never happened.', 'cant-tell': 'It can’t tell two situations apart.', loops: 'It gets stuck in a loop.', 'long-chain': 'This is a long chain for one skill.' };
const CHAPTER_NAME = (id: string) => CHAPTERS.find((c) => c.id === id)?.title ?? 'the Guide';
import { BehaviorSummaryView } from './Summary';
import { curiosities } from '../learning/summary';
import { store, useStore } from './store';
import { LineChart } from './Chart';
import { SPEEDS, type TrainSpeed } from '../learning/session';
import { cancelTraining, closeTraining, pauseTraining, resumeTraining, setTrainingSpeed, startTraining } from './training';
import { getSkill, saveRevision } from '../game/pets';
import type { EpisodeTrace, EvalResult } from '../learning/episodes';
import { applyRepair } from '../domain/repairs';
import { snapshotStage } from '../game/state';
import { cloneWorld, step } from '../sim/world';
import { compileEncoder } from '../learning/senses';
import { senseDefFor, templateOf } from '../learning/skilldef';
import type { StageSpec } from '../domain/types';
import { feedbackKey, CAUTION_LABEL, FEEDBACK_LABEL } from '../learning/trainer';

const TRACE_NAMES: Record<string, string> = {
  training: 'Training try (exploring)', evaluation: 'Evaluation (held-out layout)', before: 'Before training', baseline: 'Random baseline', scripted: 'Scripted demo — not your pet', transfer: 'Transfer (bigger, unseen pen)',
};

export function traceBadge(t: EpisodeTrace | null): string {
  return t ? TRACE_NAMES[t.label] ?? t.label : '';
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** (state, action) keys along a replayed try, using the same encoder the trainer uses. */
function feedbackKeys(t: EpisodeTrace, stage: StageSpec): string[] {
  const def = senseDefFor(stage);
  const enc = compileEncoder(def.senses, stage.learner.focus);
  const w = cloneWorld(t.initial);
  const keys: string[] = [];
  for (const f of t.frames) {
    const a = def.actions.indexOf(f.a);
    if (a >= 0) keys.push(feedbackKey(enc.index(enc.encode(w)), a));
    step(w, f.a);
  }
  return keys;
}

export function TrainingPanel() {
  const s = useStore();
  const t = s.ui.training!;
  const pet = s.state.pets.find((p) => p.id === t.petId);
  const p = t.progress;
  const running = t.status === 'running' || t.status === 'paused';
  const nextRev = (getSkill(pet!, t.stage.learner.skill)?.revisions.at(-1)?.rev ?? 0) + 1;

  useEffect(() => {
    if (t.status === 'done' && !s.state.progress.flags.sawReport) store.mutate((g) => { g.progress.flags.sawReport = true; });
  }, [t.status, s.state.progress.flags.sawReport]);

  const save = () => {
    if (!pet || !t.report || !t.policy) return;
    audio.play('skill.save');
    store.mutate((g) => {
      const pp = g.pets.find((x) => x.id === pet.id)!;
      const rev = saveRevision(g, pp, { stage: t.stage, policy: t.policy!, report: t.report!, episodes: p?.episode ?? 0, durationMs: t.ms, simTicks: p?.simTicks ?? 0, resumedFrom: t.resumedFrom ?? undefined, navigator: t.navigator ?? undefined, uses: t.uses });
      const k = getSkill(pp, t.stage.learner.skill)!;
      store.toast(k.activeRev === rev.rev ? `Saved ${t.stage.learner.skill} r${rev.rev}${rev.eval.passed ? ' — certified!' : ''}` : `Saved r${rev.rev}, but certified r${k.activeRev} stays active. Switch in Pets if you want.`, k.activeRev === rev.rev ? 'good' : 'info');
    });
    t.saved = true;
    store.emit();
  };

  const giveFeedback = (sign: 1 | -1) => {
    const tr = t.replay;
    if (!tr || !pet) return;
    const keys = feedbackKeys(tr, t.stage);
    store.mutate((g) => {
      const pp = g.pets.find((x) => x.id === pet.id)!;
      const fb = (pp.feedback[t.stage.id] ??= {});
      for (const k of keys) fb[k] = Math.max(-1, Math.min(1, (fb[k] ?? 0) + 0.5 * sign));
    });
    store.toast(sign > 0 ? `Noted: you liked that path. ${pet.name} gets a small bonus for those moves next lesson.` : `Noted: not like that. Those moves cost a little next lesson.`, 'info');
  };

  const repair = (ruleId: string, action: string) => {
    store.mutate((g) => {
      const st = g.stages.find((x) => x.id === t.stage.id);
      if (!st) return;
      snapshotStage(g, st);
      if (applyRepair(st, action, ruleId)) store.toast('Repair card applied. Train again to see the difference.', 'good');
    });
    closeTraining();
    store.setUi({ binder: 'rules' });
  };

  return (
    <div className="training panel" aria-live="polite">
      <div className="row between">
        <div>
          {!s.state.academy && isGuideStage(t.stage) && <span className="badge-exp">{t.stage.id === 'stage-tutorial' ? 'Field Guide lesson · free' : 'Field Guide experiment · free · saved only if you choose'}</span>}
          <div className="eyebrow">{t.status === 'evaluating' ? 'Testing on held-out layouts…' : running ? `${pet?.name} is learning ${t.stage.learner.skill} — real tries, real treats` : t.status === 'done' ? 'Lesson report' : t.status}</div>
          <strong>{t.stage.name}</strong>
          {t.navigator && <div className="small muted">Movement option: {t.navigator.skill} r{t.navigator.rev} (reused, not retrained)</div>}
          {t.uses && <div className="small muted">Uses {t.uses.map((u) => `${u.skill} r${u.rev}`).join(', ')} (reused, not retrained)</div>}
          {t.resumedFrom && <div className="small muted">Continuing from r{t.resumedFrom}</div>}
        </div>
        {running && (
          <div className="row gap">
            {t.status === 'running' ? <button className="btn" onClick={pauseTraining}>Pause</button> : <button className="btn" onClick={resumeTraining}>Resume</button>}
            <button className="btn ghost" onClick={cancelTraining}>Cancel</button>
          </div>
        )}
      </div>
      {running && (
        <div className="seg small-seg" role="radiogroup" aria-label="Training speed">
          {(Object.keys(SPEEDS) as TrainSpeed[]).map((k) => <button key={k} role="radio" aria-checked={t.speed === k} className={t.speed === k ? 'on' : ''} onClick={() => setTrainingSpeed(k)}>{SPEEDS[k].label}</button>)}
        </div>
      )}
      <div className="hud">
        <Stat label="Try" value={p ? `${p.episode} / ${p.total}` : '…'} />
        <Stat label="Success (last 50)" value={p ? pct(p.successMA) : '…'} />
        <Stat label="Treats per try" value={p ? p.rewardMA.toFixed(1) : '…'} />
        <Stat label="Exploring" value={p ? pct(p.epsilon) : '…'} />
        <Stat label="Sim ticks" value={p ? p.simTicks.toLocaleString() : '…'} />
        <Stat label="Saves as" value={`r${nextRev}`} />
      </div>
      {p && p.episode > 0 && (
        <div className="progress-bar" role="progressbar" aria-valuenow={p.episode} aria-valuemax={p.total} aria-valuemin={0} aria-label="Training progress"><i style={{ width: `${(100 * p.episode) / p.total}%` }} /></div>
      )}
      {p && p.curve.length > 0 && (
        <div className="charts">
          <LineChart title="Success while practising" points={p.curve.map((c) => ({ x: c.episode, y: c.success }))} yMax={1} format={pct} unit="moving avg of 50" tone="leaf" />
          <LineChart title="Treats per try (reward)" points={p.curve.map((c) => ({ x: c.episode, y: c.reward }))} yMax={Math.max(1, ...p.curve.map((c) => c.reward))} yMin={Math.min(0, ...p.curve.map((c) => c.reward))} format={(y) => y.toFixed(1)} unit="moving avg of 50" tone="amber" />
        </div>
      )}
      <p className="small muted">Success = the task actually done (SUCCESS condition). Treats = reward the rules paid. They usually rise together — when they don’t, look for a loophole.</p>
      {t.status === 'error' && <div className="diag error">Training failed: {t.error}</div>}
      {t.status === 'cancelled' && (
        <div className="diag info">Lesson cancelled after {p?.episode ?? 0} tries. Nothing was saved. <button className="btn ghost" onClick={closeTraining}>Close</button></div>
      )}
      {t.status === 'done' && t.report && <Report />}
    </div>
  );

  function Report() {
    const r = t.report!;
    const rows: [string, EvalResult, string][] = [
      ['Before', r.before, t.resumedFrom ? `r${t.resumedFrom}` : 'untrained'],
      ['Random wandering', r.random, 'baseline'],
      ...(r.randomOptions ? [['Random choices', r.randomOptions, 'same skills, picked at random'] as [string, EvalResult, string]] : []),
      ...(r.scattered ? [['Scattered layouts', r.scattered, 'target & start moved'] as [string, EvalResult, string]] : []),
      ['After', r.after, `r${nextRev}`],
      ['Transfer', r.transfer, 'bigger unseen pens'],
    ];
    const ledger = new Map<string, { label: string; train: number; evalN: number }>();
    for (const e of p?.ledger ?? []) ledger.set(e.ruleId, { label: e.label, train: e.count / Math.max(1, p!.episode), evalN: 0 });
    for (const e of r.after.ledger) {
      const x = ledger.get(e.ruleId) ?? { label: e.label, train: 0, evalN: 0 };
      x.evalN = e.count / r.after.episodes;
      ledger.set(e.ruleId, x);
    }
    const isNav = templateOf(t.stage) === 'sense';
    return (
      <div className="report">
        <div className={`verdict ${r.passed ? 'good' : 'warn'}`}>
          {r.passed ? '✓ Certified' : '△ Not certified yet'}: {r.after.successes}/{r.after.episodes} successes on held-out layouts (needs {pct(t.stage.evaluation.minimumSuccessRate)}).
        </div>
        <div className="compare" role="table" aria-label="Before and after comparison" data-tut="report-compare">
          {rows.map(([name, e, sub]) => (
            <div key={name} className="cmp-row" role="row">
              <span role="cell" className="cmp-name">{name}<span className="muted small"> {sub}</span></span>
              <span role="cell" className="cmp-bar"><i className={name === 'After' ? 'after' : ''} style={{ width: `${e.successRate * 100}%` }} /></span>
              <span role="cell" className="num">{e.successes}/{e.episodes}</span>
              <button className="icon-btn small" onClick={() => { t.replay = e.traces[0] ?? null; store.emit(); }} aria-label={`Replay ${name}`} disabled={!e.traces.length}>▶</button>
              {(r.scattered ? name === 'Scattered layouts' : name === 'After') && e.traces.some((x) => !x.success) && (
                <button className="btn ghost small cmp-miss" data-tut="replay-miss" onClick={() => { t.replay = e.traces.find((x) => !x.success) ?? null; store.mutate((g) => { g.progress.flags.replayedMiss = true; }); }}>▶ a miss</button>
              )}
            </div>
          ))}
        </div>
        {r.scattered && r.scattered.successRate < r.after.successRate - 0.15 && (
          <div className="diag warning small">This pen pins the {t.stage.learner.focus}{t.stage.environment.some((p) => p.cardId === 'place.pet' && p.args.mode === 'fixed') ? ' and the start' : ''}, so every test layout looks the same ({Math.round(r.after.successRate * 100)}%). When they move, it manages {Math.round(r.scattered.successRate * 100)}%. Scatter them to teach a skill instead of a route.</div>
        )}
        <div className="small muted">Held-out seeds {r.evalSeeds[0]}…{r.evalSeeds.at(-1)} (n={r.evalSeeds.length}) are never used in training. Lesson took {(t.ms / 1000).toFixed(1)}s of compute.</div>

        <Tips tips={reportTips(t.stage, r, p?.episode ?? t.stage.learner.episodes)} />
        {(r.findings ?? []).map((f) => (
          <div key={f.id} className="diag info" data-tut={`finding-${f.id}`}>
            <strong>{FINDING_TITLE[f.id]}</strong> {f.text}
            <div className="row gap">
              {f.replay && <button className="btn ghost small" onClick={() => { t.replay = f.replay!; store.emit(); }}>Watch it</button>}
              {f.lesson && <button className="btn ghost small" onClick={() => s.setUi({ screen: 'guide' })}>Field Guide: {CHAPTER_NAME(f.lesson)}</button>}
            </div>
          </div>
        ))}
        {r.exploits.map((x) => (
          <div key={x.ruleId} className="diag warn" data-tut="report-exploit">
            <strong>Loophole found!</strong> {x.diagnostic.message}
            <div className="row gap">
              {x.replay && <button className="btn ghost" onClick={() => { t.replay = x.replay!; store.emit(); }}>Watch the replay</button>}
              {x.diagnostic.repair && <button className="btn" data-tut="repair-card" onClick={() => { audio.play('card.repair'); repair(x.ruleId, x.diagnostic.repair!.action); }}>Repair card: {x.diagnostic.repair.label}</button>}
            </div>
          </div>
        ))}

        {r.after.summary && (
          <details open={(r.exploits.length > 0) || curiosities(t.stage, r.after.summary, pet?.name ?? 'Your pet').length > 0}>
            <summary>What {pet?.name} actually did (all {r.after.episodes} held-out tries)</summary>
            <BehaviorSummaryView s={r.after.summary} target={t.stage.learner.focus} curiosities={curiosities(t.stage, r.after.summary, pet?.name ?? 'Your pet')} />
          </details>
        )}
        <details>
          <summary>Reward ledger (which rule paid, how often)</summary>
          <table className="ledger">
            <thead><tr><th>Rule</th><th>per try (practice)</th><th>per try (test)</th></tr></thead>
            <tbody>{[...ledger.values()].map((l) => <tr key={l.label}><td>{l.label}{l.label === CAUTION_LABEL || l.label === FEEDBACK_LABEL ? ' ✱' : ''}</td><td className="num">{l.train.toFixed(2)}</td><td className="num">{l.evalN.toFixed(2)}</td></tr>)}</tbody>
          </table>
          <div className="small muted">✱ not one of your rules: added by temperament or your thumbs feedback.</div>
        </details>

        <div className="row gap wrap">
          {isNav && t.replay && (
            <span className="feedback">
              <span className="small">This replay:</span>
              <button className="btn ghost" onClick={() => giveFeedback(1)} aria-label="Good path">👍 Good</button>
              <button className="btn ghost" onClick={() => giveFeedback(-1)} aria-label="Not like that">👎 Not like that</button>
            </span>
          )}
        </div>
        <CertifyButton run={t.startedAt} petId={t.petId} stage={t.stage} report={t.report} episodes={p?.episode ?? 0} resumed={!!t.resumedFrom} saved={t.saved} save={save} />
        <div className="row gap wrap actions">
          <button className="btn primary" data-tut="save-skill" disabled={t.saved} onClick={save}>{t.saved ? `Saved r${nextRev - 1}` : r.passed ? `Save skill as r${nextRev}` : `Save anyway as r${nextRev}`}</button>
          <button className="btn" onClick={() => { const err = pet && startTraining(pet, store.state.stages.find((x) => x.id === t.stage.id) ?? t.stage, { resume: !!getSkill(pet, t.stage.learner.skill) }); if (err) { audio.play('card.reject'); store.toast(err, 'warn'); } }}>Train more</button>
          <button className="btn ghost" onClick={closeTraining}>{t.saved ? 'Close' : 'Discard'}</button>
        </div>
      </div>
    );
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><span className="small muted">{label}</span><b className="num">{value}</b></div>;
}
