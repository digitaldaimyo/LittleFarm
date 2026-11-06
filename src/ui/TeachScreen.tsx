import { ChallengeBanner } from './ChallengeBanner';
import { challengeOf } from '../game/challenges';
import { useEffect, useMemo, useState } from 'react';
import { cloneWorld, legalActions, step, type Action, type World } from '../sim/world';
import { probeField, probePath } from '../learning/probe';
import { audio } from '../audio/engine';
import type { SpecNode, StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { isNode, node, paramOf } from '../domain/spec';
import { hasErrors, validateStage } from '../domain/validate';
import { compileStage, generateWorld, type CompiledStage, type RuleState } from '../sim/compile';
import { store, useStore, type Binder } from './store';
import { WorldView } from './WorldView';
import { NodeChip, cardOf, withSnapshot } from './cards';
import { TrainingPanel, traceBadge } from './TrainingPanel';
import { useReplay } from './replay';
import { startTraining } from './training';
import { activePet, activeRevision, getSkill, isPreset, sensePolicyOf } from '../game/pets';
import { templateOf } from '../learning/skilldef';
import { canTrain, trainingCost, undoStage } from '../game/state';
import { currentStep, isGuideStage } from '../game/tutorial';
import { evaluate } from '../learning/episodes';
import { heldOutSeeds } from '../learning/report';
import type { Pet } from '../game/types';
import { EnvironmentBinder, LayoutStrip } from './EnvironmentBinder';
import { RulesBinder, Diagnostics } from './RulesBinder';
import { PetBinder } from './PetBinder';
import { CurriculumBinder, BehaviorsBinder, InspectBinder } from './CurriculumBinder';

const BINDERS: { id: Binder; label: string }[] = [
  { id: 'environment', label: 'Environment' },
  { id: 'rules', label: 'Rules' },
  { id: 'pet', label: 'Pet' },
  { id: 'curriculum', label: 'Curriculum' },
  { id: 'behaviors', label: 'Behaviors' },
  { id: 'inspect', label: 'Inspect' },
];

function useStage(): StageSpec | null {
  const s = useStore();
  return s.state.stages.find((x) => x.id === s.state.activeStageId) ?? s.state.stages[0] ?? null;
}

export function TeachScreen() {
  const s = useStore();
  const stage = useStage();
  const pet = activePet(s.state);
  useEffect(() => {
    if (!s.state.progress.flags.visitedTeach) store.mutate((g) => { g.progress.flags.visitedTeach = true; });
  }, [s.state.progress.flags.visitedTeach]);
  if (!stage || !pet) return <div className="empty">Adopt a pet first.</div>;
  const diags = validateStage(stage, REGISTRY, new Set(s.state.progress.unlocks));
  const training = s.ui.training && s.ui.training.stage.id === stage.id ? s.ui.training : s.ui.training;
  return (
    <div className="screen teach-screen">
      <section className="stage-col">
        <StagePicker stage={stage} />
        <PenView stage={stage} pet={pet} />
        <TrainBar stage={stage} pet={pet} blocked={hasErrors(diags)} />
      </section>
      <aside className="side-col">
        {training ? <TrainingPanel /> : (
          <>
            <ChallengeBanner stage={stage} />
            <div className="tabs" role="tablist" aria-label="Binders">
              {BINDERS.map((b) => (
                <button key={b.id} role="tab" aria-selected={s.ui.binder === b.id} className={`tab ${s.ui.binder === b.id ? 'on' : ''} ${tutorialWants(s.state, b.id) ? 'pulse' : ''}`} onClick={() => s.setUi({ binder: b.id, slot: null, placing: null })}>{b.label}</button>
              ))}
            </div>
            <div role="tabpanel" className="binder">
              {s.ui.binder === 'environment' && <EnvironmentBinder stage={stage} />}
              {s.ui.binder === 'rules' && <RulesBinder stage={stage} />}
              {s.ui.binder === 'pet' && <PetBinder stage={stage} pet={pet} />}
              {s.ui.binder === 'curriculum' && <CurriculumBinder stage={stage} pet={pet} />}
              {s.ui.binder === 'behaviors' && <BehaviorsBinder pet={pet} />}
              {s.ui.binder === 'inspect' && <InspectBinder stage={stage} />}
            </div>
            <Diagnostics stage={stage} />
          </>
        )}
      </aside>
    </div>
  );
}

/** Which binder the current Field Guide step needs (its tab glows). */
function tutorialWants(g: ReturnType<typeof useStore>['state'], b: Binder): boolean {
  const id = currentStep(g)?.id;
  if (!id) return false;
  return ({ 'place-berry': 'environment', 'unpin': 'environment', 'treat-rule': 'rules', 'success': 'rules', 'long': 'pet', 'stay': 'pet', 'patience': 'pet', 'extra': 'pet', 'rules': 'rules', 'watch-bin': 'pet' } as Record<string, Binder>)[id] === b;
}

function StagePicker({ stage }: { stage: StageSpec }) {
  const s = useStore();
  return (
    <div className="stage-picker">
      <label className="small">Lesson{' '}
        <select value={stage.id} onChange={(e) => s.mutate((g) => { g.activeStageId = e.target.value; }) }>
          {s.state.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <span className="chip">teaches {stage.learner.skill}</span>
      <span className="muted small">v{stage.version}</span>
      <button className="btn ghost small" disabled={!(s.state.stageHistory[stage.id]?.length)} onClick={() => { audio.play('card.remove'); s.mutate((g) => { undoStage(g, stage.id); }); }}>Undo</button>
    </div>
  );
}

function PenView({ stage, pet }: { stage: StageSpec; pet: Pet }) {
  const s = useStore();
  const t = s.ui.training;
  const trace = t?.replay && t.stage.id === stage.id ? t.replay : s.ui.penReplay;
  const showingReplay = !!trace;
  const reduced = s.state.settings.reducedMotion === 'on';
  // Replays you watch make the same sounds as the farm; the samples shown while training runs stay quiet.
  const training = !!t && (t.status === 'running' || t.status === 'paused' || t.status === 'evaluating');
  const replay = useReplay(trace, t?.status === 'running' && t.speed === 'fast' ? 40 : reduced ? 260 : 150, !training);
  // Stages are edited in place; `version` bumps on every edit, so it is the real dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => generateWorld(stage, s.ui.previewSeed), [stage, stage.version, s.ui.previewSeed]);
  // Ghosts = objects placed by "Scatter" (random) cards.
  const ghosts = useMemo(() => {
    const fixed = new Set(stage.environment.filter((p) => p.cardId === 'place.fixed').map((p) => `${paramOf(p, 'x', 0)},${paramOf(p, 'y', 0)}`));
    return new Set(preview.objects.filter((o) => !fixed.has(`${o.x},${o.y}`)).map((o) => o.id));
  }, [preview, stage]);
  // "What does Pip do when…?" — probe the saved skill for this lesson on the current layout.
  const [probing, setProbing] = useState(false);
  const [probeAt, setProbeAt] = useState<{ x: number; y: number } | null>(null);
  const probeRev = templateOf(stage) === 'sense' ? activeRevision(getSkill(pet, stage.learner.skill)) : null;
  const probePolicy = probeRev ? sensePolicyOf(probeRev) : null;
  const probeWorld = useMemo(() => {
    if (!probing) return null;
    const w = cloneWorld(preview);
    if (probeAt) { w.pet.x = probeAt.x; w.pet.y = probeAt.y; }
    return w;
  }, [probing, preview, probeAt]);
  const probeCells = useMemo(() => (probeWorld && probePolicy ? probeField(probePolicy, probeWorld, stage.learner.focus) : []), [probeWorld, probePolicy, stage.learner.focus]);
  const probeTrail = useMemo(() => (probeWorld && probePolicy && probeAt ? probePath(probePolicy, probeWorld, stage.learner.focus, Math.min(40, stage.maxTicks)) : undefined), [probeWorld, probePolicy, probeAt, stage.learner.focus, stage.maxTicks]);
  // Soft plucks rising along the traced path when you tap a tile.
  useEffect(() => {
    if (!probeTrail?.length) return;
    const timers = probeTrail.slice(1, 13).map((_, i) => setTimeout(() => audio.play({ id: 'probe.pluck', pitch: 1 + i * 0.06 }), i * 70));
    return () => timers.forEach(clearTimeout);
  }, [probeTrail]);
  // "Play it yourself": steer the pet through the lesson by hand. Same simulator and rules; never training.
  const [play, setPlay] = useState<PlayState | null>(null);
  const startPlay = (seed = s.ui.previewSeed) => {
    const cs = compileStage(stage);
    setProbing(false);
    setPlay({ cs, w: cs.generate(seed), rs: cs.newRuleState(), treats: 0, log: [], ended: null });
    store.mutate((g) => { g.progress.flags.playedLesson = true; }, { save: false });
  };
  const act = (a: Action) => {
    if (!play || play.ended) return;
    if (!legalActions(play.w, stage.abilities).includes(a)) { audio.play('card.reject'); store.toast(`This lesson doesn’t give ${pet.name} that ability.`, 'warn'); return; }
    const w = cloneWorld(play.w);
    const prev = { x: w.pet.x, y: w.pet.y };
    const events = step(w, a);
    const out = play.cs.evalStep(w, prev, events, play.rs);
    audio.playReplay(events, w.w);
    const log = out.hits.map((h) => `${h.label}${h.amount ? ` ${h.amount > 0 ? '+' : '−'}${Math.abs(h.amount)}` : ''}${h.end ? ' · ends the try' : ''}`);
    let ended: string | null = null;
    if (out.end || w.tick >= stage.maxTicks) {
      const ok = play.cs.isSuccess(w);
      ended = ok ? 'Success ✓ — this try counts.' : play.cs.isFail(w) ? 'A miss ✗ — FAIL held (or a rule ended it as a miss).' : out.end ? 'The try ended, but SUCCESS wasn’t true — it counts as a miss.' : 'Time’s up and SUCCESS wasn’t true — a miss.';
      audio.play(ok ? 'train.certified' : 'train.notCertified');
    }
    setPlay({ ...play, w, treats: play.treats + out.reward, log, ended });
  };
  useEffect(() => {
    if (!play) return;
    const keys: Record<string, Action> = { ArrowUp: 'N', ArrowRight: 'E', ArrowDown: 'S', ArrowLeft: 'W', ' ': 'wait', p: 'pick', d: 'drop', w: 'water', x: 'shoo', g: 'nudge', l: 'plant', b: 'lift' };
    const h = (e: KeyboardEvent) => {
      const a = keys[e.key];
      const tag = (e.target as HTMLElement)?.tagName;
      if (!a || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      act(a);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  useEffect(() => { setPlay(null); }, [stage.id, stage.version]);

  const world = play ? play.w : showingReplay && replay.world ? replay.world : probeWorld ?? preview;
  const last = showingReplay ? trace!.frames[replay.frame - 1] : undefined;
  const mood = showingReplay ? (replay.frame >= replay.frames && trace!.success ? 'celebrate' : last?.hits?.length ? 'celebrate' : 'move') : 'idle';

  const onTile = (x: number, y: number) => {
    if (challengeOf(stage)) { store.toast('This pen is set by the challenge. Teach in the Rules and Pet binders.', 'info'); return; }
    if (showingReplay) return;
    if (probing) { setProbeAt({ x, y }); if (!store.state.progress.flags.probePath) store.mutate((g) => { g.progress.flags.probePath = true; }); return; }
    const placing = s.ui.placing;
    if (placing === 'zone.rect') {
      // Two taps paint a rectangle: first corner, then the opposite corner.
      const a = s.ui.zoneStart;
      if (!a) { s.setUi({ zoneStart: { x, y } }); return; }
      const names = new Set(stage.environment.filter((p) => p.cardId === 'zone.rect').map((p) => String(p.args.name)));
      const name = !names.has('coop') ? 'coop' : (prompt('Name this area', 'garden') ?? '').trim().slice(0, 16);
      if (!name || names.has(name)) { s.setUi({ zoneStart: null }); if (name) store.toast(`There is already an area called “${name}”.`, 'warn'); return; }
      const z = node('zone.rect', { name, where: s.ui.placeMode === 'random' ? 'random' : 'fixed', x: Math.min(a.x, x), y: Math.min(a.y, y), w: Math.abs(a.x - x) + 1, h: Math.abs(a.y - y) + 1 });
      withSnapshot(stage.id, (st) => { st.environment.push(z); });
      audio.play('pen.place');
      s.setUi({ zoneStart: null, placing: null, slot: { parentId: z.id, socket: 'kind', index: null } });
      store.toast(s.ui.placeMode === 'random' ? `Area “${name}” painted — it keeps its size but moves to a random spot each try.` : `Area “${name}” painted.`, 'good');
      return;
    }
    if (placing) {
      audio.play('pen.place');
      withSnapshot(stage.id, (st) => {
        if (placing === 'place.pet') {
          st.environment = st.environment.filter((p) => p.cardId !== 'place.pet');
          st.environment.unshift(node('place.pet', { mode: s.ui.placeMode === 'fixed' ? 'fixed' : 'random', x, y }));
        } else if (s.ui.placeMode === 'fixed') {
          st.environment.push(node('place.fixed', { kind: node(placing), x, y }));
        } else {
          const existing = st.environment.find((p) => p.cardId === 'place.random' && isNode(p.args.kind) && p.args.kind.cardId === placing);
          if (existing) existing.args.count = Math.min(8, paramOf(existing, 'count', 1) + 1);
          else st.environment.push(node('place.random', { kind: node(placing), count: 1, region: 'anywhere' }));
        }
      });
      if (s.ui.placeMode === 'random') store.toast('Scattered: it lands somewhere new on every try.', 'info');
      return;
    }
    // Tap an object → open its placement sleeve.
    const fixed = stage.environment.find((p) => p.cardId === 'place.fixed' && paramOf(p, 'x', -1) === x && paramOf(p, 'y', -1) === y);
    const obj = preview.objects.find((o) => o.x === x && o.y === y);
    const target = fixed ?? (obj ? stage.environment.find((p) => p.cardId === 'place.random' && isNode(p.args.kind) && p.args.kind.cardId === `kind:${obj.kind}`) : undefined);
    if (target) s.setUi({ binder: 'environment', slot: { parentId: target.id, socket: 'kind', index: null } });
  };

  return (
    <div className="pen-wrap">
      <div className="pen">
        <WorldView world={world} palette={pet.palette} mood={mood} ghostIds={showingReplay || probing ? undefined : ghosts} trail={showingReplay ? replay.trail : probeTrail}
          arrows={probing && !showingReplay ? probeCells : undefined}
          label={showingReplay ? `Replay: ${traceBadge(trace)}` : `Pen preview, layout ${s.ui.previewSeed}`}
          onTile={showingReplay ? undefined : onTile}
          highlight={s.ui.zoneStart}
          tileLabel={(x, y) => s.ui.placing ? `Place at ${x},${y}` : `Tile ${x},${y}`} />
      </div>
      <div className="pen-foot">
        {play && !showingReplay ? (
          <div className="play" data-tut="play">
            <span className="badge b-scripted">Playing it yourself — not training</span>
            <span className="num small">step {play.w.tick}/{stage.maxTicks} · {play.treats.toFixed(2).replace(/\.?0+$/, '')} treats · SUCCESS now: {play.cs.isSuccess(play.w) ? 'yes ✓' : 'no'}</span>
            <div className="play-log small" aria-live="polite">{play.ended ?? (play.log.length ? `Rules fired: ${play.log.join(' · ')}` : 'Arrow keys to move · Space stay · P pick up · D put down · W water · X shoo · G gate')}</div>
            <div className="play-pad">
              {(['W', 'N', 'S', 'E'] as Action[]).map((a) => <button key={a} className="btn ghost small" aria-label={`Move ${a === 'N' ? 'up' : a === 'S' ? 'down' : a === 'W' ? 'left' : 'right'}`} onClick={() => act(a)}>{a === 'N' ? '↑' : a === 'S' ? '↓' : a === 'W' ? '←' : '→'}</button>)}
              {([['stay', 'wait', 'Stay'], ['pickup', 'pick', 'Pick up'], ['drop', 'drop', 'Put down'], ['water', 'water', 'Water'], ['shoo', 'shoo', 'Shoo'], ['nudge', 'nudge', 'Nudge gate'], ['plant', 'plant', 'Plant'], ['lift', 'lift', 'Lift basket']] as const).filter(([ab]) => stage.abilities.includes(ab)).map(([, a, label]) => <button key={a} className="btn ghost small" onClick={() => act(a as Action)}>{label}</button>)}
              <button className="btn ghost small" onClick={() => startPlay()}>Restart</button>
              <button className="btn ghost small" onClick={() => { s.setUi({ previewSeed: s.ui.previewSeed + 1 }); startPlay(s.ui.previewSeed + 1); }}>Next layout</button>
              <button className="btn ghost small" onClick={() => setPlay(null)}>Stop</button>
            </div>
          </div>
        ) : showingReplay ? (
          <>
            <span className={`badge b-${trace!.label}`}>{traceBadge(trace)}</span>
            <span className="num small">step {replay.frame}/{replay.frames} · {trace!.success ? 'success' : trace!.failed ? 'failed' : replay.frame >= replay.frames ? 'ran out of time' : '…'} · {trace!.reward.toFixed(1)} treats</span>
            <span className="row gap">
              {replay.playing ? <button className="btn ghost small" onClick={replay.pause}>Pause</button> : <button className="btn ghost small" onClick={replay.play}>Play</button>}
              {t?.status !== 'running' && <button className="btn ghost small" onClick={() => { if (t) t.replay = null; s.setUi({ penReplay: null }); }}>Back to pen</button>}
            </span>
          </>
        ) : (
          <>
            <span className="small">{probing ? `Arrows = ${stage.learner.skill} r${probeRev?.rev}'s move on each tile, dots = another action (shoo, stay…). Bigger = surer, grey = never practised exactly. Tap a tile to start ${pet.name} there.` : s.ui.placing === 'zone.rect' ? (s.ui.zoneStart ? 'Now tap the opposite corner' : 'Tap one corner of the area') : s.ui.placing ? `Tap a tile to place ${cardOf(node(s.ui.placing))?.presentation.title ?? 'it'}` : 'Dashed = scattered (moves every try)'}</span>
            <span className="row gap">
              {probePolicy && <button className="btn ghost small" data-tut="probe" aria-pressed={probing} onClick={() => { setProbing(!probing); setProbeAt(null); if (!probing) store.mutate((g) => { g.progress.flags.probed = true; }); }}>{probing ? 'Stop probing' : `What does ${pet.name} do?`}</button>}
              <button className="btn ghost small" data-tut="play-btn" onClick={() => startPlay()}>Play it yourself</button>
              <button className="btn ghost small" onClick={() => s.setUi({ previewSeed: s.ui.previewSeed + 1 })}>Roll layout</button>
            </span>
          </>
        )}
      </div>
      {!showingReplay && !play && <LayoutStrip stage={stage} pet={pet} />}
    </div>
  );
}

function TrainBar({ stage, pet, blocked }: { stage: StageSpec; pet: Pet; blocked: boolean }) {
  const s = useStore();
  const t = s.ui.training;
  const busy = !!t && (t.status === 'running' || t.status === 'paused' || t.status === 'evaluating');
  const can = canTrain(pet, stage, s.state);
  const needsNav = templateOf(stage) === 'fetch' && !activeRevision(getSkill(pet, 'Approach')) && !activeRevision(getSkill(pet, 'Avoid'));
  const preflight = () => {
    const seeds = heldOutSeeds(stage).slice(0, 10);
    const rnd = evaluate(stage, { kind: 'random' }, seeds, 'baseline', pet.traits, 1);
    if (!isPreset(stage.learner.skill)) {
      store.toast(`Preflight: there’s no scripted demo for your own skills. Random wandering succeeds ${rnd.successes}/${rnd.episodes} and earns ${rnd.meanReward.toFixed(1)} treats per try${rnd.successes === rnd.episodes ? ' — the task may be too easy to need learning' : ''}. Watch how it differs once ${pet.name} has practised.`, 'info');
      s.setUi({ penReplay: rnd.traces[0] ?? null });
      return;
    }
    const demo = evaluate(stage, { kind: 'scripted' }, seeds, 'scripted', pet.traits, 1);
    const msg = `Preflight: a scripted demonstrator (not ${pet.name}) succeeded ${demo.successes}/${demo.episodes} — the goal is reachable. Random wandering: ${rnd.successes}/${rnd.episodes}, ${rnd.meanReward.toFixed(1)} treats per try vs ${demo.meanReward.toFixed(1)} for the demo.${rnd.meanReward > demo.meanReward ? ' ⚠ Wandering earns more than finishing — check your rules!' : ''}`;
    store.toast(msg, rnd.meanReward > demo.meanReward || demo.successRate < 0.9 ? 'warn' : 'info');
    s.setUi({ penReplay: demo.traces[0] ?? null });
  };
  const existing = getSkill(pet, stage.learner.skill);
  return (
    <div className="train-bar">
      <div className="small muted">
        {isGuideStage(stage) && <span className="badge-exp">Field Guide · free</span>}{' '}
        {pet.name}: {Math.round(pet.energy)} energy · lesson costs {trainingCost(stage, s.state)} · {stage.learner.episodes} tries
        {existing ? ` · has ${stage.learner.skill} r${existing.activeRev}` : ''}
      </div>
      <div className="row gap wrap">
        <button className="btn" disabled={busy || blocked} onClick={preflight}>Preflight test</button>
        <button data-tut="train-btn" className="btn primary" disabled={busy || blocked || !can.ok || needsNav}
          onClick={() => { const err = startTraining(pet, stage, { resume: false }); if (err) { audio.play('card.reject'); store.toast(err, 'warn'); } }}>
          {existing ? `Train fresh` : `Train ${stage.learner.skill}`}
        </button>
        {existing && <button className="btn" disabled={busy || blocked || !can.ok || needsNav} onClick={() => { const err = startTraining(pet, stage, { resume: true }); if (err) { audio.play('card.reject'); store.toast(err, 'warn'); } }}>Refine r{existing.activeRev}</button>}
      </div>
      {blocked && <div className="small warn-text">Fix the errors below before training.</div>}
      {!can.ok && <div className="small warn-text">{can.reason}</div>}
      {needsNav && <div className="small warn-text">Fetch reuses a movement skill — teach Approach first.</div>}
    </div>
  );
}

export const kindOf = (p: SpecNode) => (isNode(p.args.kind) ? p.args.kind.cardId.replace(/^kind:/, '') : null);

interface PlayState { cs: CompiledStage; w: World; rs: RuleState; treats: number; log: string[]; ended: string | null }

export { NodeChip };
