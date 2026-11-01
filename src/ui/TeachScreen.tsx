import { useEffect, useMemo, useRef, useState } from 'react';
import { cloneWorld, legalActions, step, type Action, type World } from '../sim/world';
import { probeField, probePath } from '../learning/probe';
import { audio } from '../audio/engine';
import { describe, describeRule } from '../domain/describe';
import { exportLessonCard, importLessonCard } from '../game/lessoncard';
import { rolloutChecks } from '../learning/lint';
import type { SpecNode, StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { RECIPES, instantiateRecipe, suggestedRules } from '../domain/recipes';
import { cloneNode, cloneStage, findNode, isNode, newId, node, paramOf, placedKinds, socketActive } from '../domain/spec';
import { hasErrors, nodesWithErrors, validateStage } from '../domain/validate';
import { buildHand } from '../domain/hand';
import { applyRepair } from '../domain/repairs';
import { compileStage, generateWorld, type CompiledStage, type RuleState } from '../sim/compile';
import { trainingSeed } from '../learning/trainer';
import { store, useStore, type Binder } from './store';
import { WorldView } from './WorldView';
import { HandCardView, ManySlot, NodeChip, Sleeve, SlotChip, cardOf, withSnapshot } from './cards';
import { blankCandidates, placeTemplate, slotInSenses } from './edit';
import { TrainingPanel, traceBadge } from './TrainingPanel';
import { useReplay } from './replay';
import { startTraining } from './training';
import { activePet, activeRevision, getSkill, isCertified, isPreset, sensePolicyOf, staleUses, subskillsFor } from '../game/pets';
import { MAX_OPTIONS, MAX_WATCH } from '../learning/routine';
import { ABILITY_LABELS, ABILITY_ORDER, MAX_SENSES, STATE_MAX, STATE_WARN, presetSenses, stateSpaceSize } from '../learning/senses';
import { templateOf } from '../learning/skilldef';
import { canTrain, trainingCost, undoStage } from '../game/state';
import { currentStep, isGuideStage } from '../game/tutorial';
import { evaluate, DEFAULT_TRAITS } from '../learning/episodes';
import { policySpecFor, heldOutSeeds } from '../learning/report';
import { ObjectIcon } from './art';
import type { Pet } from '../game/types';
import { addJournal } from '../game/journal';

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
    const keys: Record<string, Action> = { ArrowUp: 'N', ArrowRight: 'E', ArrowDown: 'S', ArrowLeft: 'W', ' ': 'wait', p: 'pick', d: 'drop', w: 'water', x: 'shoo', g: 'nudge' };
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
              {([['stay', 'wait', 'Stay'], ['pickup', 'pick', 'Pick up'], ['drop', 'drop', 'Put down'], ['water', 'water', 'Water'], ['shoo', 'shoo', 'Shoo'], ['nudge', 'nudge', 'Nudge gate']] as const).filter(([ab]) => stage.abilities.includes(ab)).map(([, a, label]) => <button key={a} className="btn ghost small" onClick={() => act(a as Action)}>{label}</button>)}
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
  const can = canTrain(pet, stage);
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
        {pet.name}: {Math.round(pet.energy)} energy · lesson costs {trainingCost(stage)} · {stage.learner.episodes} tries
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

function EnvironmentBinder({ stage }: { stage: StageSpec }) {
  const s = useStore();
  const hand = buildHand(REGISTRY, { socket: { kind: 'nominal', name: 'Kind' }, stage, unlocks: new Set(s.state.progress.unlocks), recent: s.state.recentCards, favorites: s.state.favorites, itBound: false, placing: true });
  const all = [...hand.recommended, ...Object.values(hand.bySheet).flat()];
  const update = (fn: (st: StageSpec) => void) => withSnapshot(stage.id, fn);
  return (
    <div className="binder-body">
      <p className="small muted">Pick a thing, then tap the pen. <b>Scatter</b> puts it somewhere new each try (best for skills that work anywhere). <b>Place here</b> pins it to one tile.</p>
      <div className="seg" role="radiogroup" aria-label="Placement mode">
        <button role="radio" aria-checked={s.ui.placeMode === 'random'} className={s.ui.placeMode === 'random' ? 'on' : ''} onClick={() => s.setUi({ placeMode: 'random' })}>Scatter</button>
        <button role="radio" aria-checked={s.ui.placeMode === 'fixed'} className={s.ui.placeMode === 'fixed' ? 'on' : ''} onClick={() => s.setUi({ placeMode: 'fixed' })}>Place here</button>
      </div>
      <div className="hand-row wrap">
        {all.map((h) => <HandCardView key={h.card.id} h={h} tut={h.card.id === 'kind:berry' ? 'env-berry' : undefined} selected={s.ui.placing === h.card.id} onPick={() => s.setUi({ placing: s.ui.placing === h.card.id ? null : h.card.id, slot: null })} />)}
        <button className={`card g-obj ${s.ui.placing === 'place.pet' ? 'sel' : ''}`} onClick={() => s.setUi({ placing: s.ui.placing === 'place.pet' ? null : 'place.pet', slot: null })}><span className="card-title">Pet start</span><span className="card-sub">placement</span></button>
        <button className={`card g-obj ${s.ui.placing === 'zone.rect' ? 'sel' : ''}`} onClick={() => s.setUi({ placing: s.ui.placing === 'zone.rect' ? null : 'zone.rect', zoneStart: null, slot: null })}><span className="card-title">Area</span><span className="card-sub">paint 2 corners</span></button>
        <button className="card g-obj" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.weather')?.id;
          if (!id) { const t = node('place.weather', { mode: 'rain' }); id = t.id; update((st) => { st.environment.push(t); }); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Weather</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.weather'); return t ? paramOf(t, 'mode', 'dry') : 'dry (default)'; })()}</span></button>
        <button className="card g-obj" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.time')?.id;
          if (!id) { const t = node('place.time', { mode: 'night' }); id = t.id; update((st) => { st.environment.push(t); }); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Time of day</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.time'); return t ? paramOf(t, 'mode', 'day') : 'day (default)'; })()}</span></button>
        <button className="card g-obj" onClick={() => {
          let id = stage.environment.find((p) => p.cardId === 'place.obstacles')?.id;
          if (!id) { const t = node('place.obstacles', { amount: 'few', kind: 'rocks' }); id = t.id; update((st) => { st.environment.push(t); }); audio.play('pen.place'); }
          s.setUi({ placing: null, slot: { parentId: id, socket: 'kind', index: null } });
        }}><span className="card-title">Obstacles</span><span className="card-sub">{(() => { const t = stage.environment.find((p) => p.cardId === 'place.obstacles'); return t ? `${paramOf(t, 'amount', 'few')} ${paramOf(t, 'kind', 'rocks')}` : 'none yet'; })()}</span></button>
      </div>
      <h4>Pen size</h4>
      <div className="seg small-seg" role="radiogroup" aria-label="Pen size" data-tut="pen-size">
        {([[6, false, '6×6'], [8, false, '8×8'], [10, false, '10×10'], [10, true, 'varies (6–10)']] as const).map(([n, vary, label]) => {
          const on = stage.size.w === n && stage.size.h === n && !!stage.varySize === vary;
          return <button key={label} role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => update((st) => { st.size = { w: n, h: n }; st.varySize = vary || undefined; })}>{label}</button>;
        })}
      </div>
      <p className="small muted">{stage.varySize ? 'A new size every try, from 6×6 up to 10×10. (Movement skills already cope with bigger pens; obstacles help more in cluttered places.)' : 'Bigger pens mean longer walks (raise “Time per try” in the Pet binder if tries run out).'}</p>
      <h4>In this pen</h4>
      <ul className="placements" data-tut="placements">
        {stage.environment.map((p) => {
          const card = cardOf(p);
          const kind = isNode(p.args.kind) ? p.args.kind.cardId.slice(5) : null;
          return (
            <li key={p.id} className={s.ui.slot?.parentId === p.id ? 'sel' : ''}>
              {kind && <ObjectIcon kind={kind} size={22} />}
              <button className="link" onClick={() => s.setUi({ slot: { parentId: p.id, socket: 'kind', index: null } })}>
                {placementText(stage, p)}
              </button>
              <span className="chip">{card?.presentation.title}</span>
              {p.cardId === 'place.fixed' && <button className="btn ghost small" onClick={() => update((st) => { const x = st.environment.find((y) => y.id === p.id); if (x) { x.cardId = 'place.random'; x.args = { kind: x.args.kind, count: 1, region: 'anywhere' }; } })}>Scatter this</button>}
              {p.cardId === 'place.pet' && paramOf(p, 'mode', 'random') === 'fixed' && <button className="btn ghost small" onClick={() => update((st) => { const x = st.environment.find((y) => y.id === p.id); if (x) x.args.mode = 'random'; })}>Random start</button>}
              <button className="icon-btn small" aria-label="Remove" onClick={() => { audio.play('card.remove'); update((st) => { st.environment = st.environment.filter((x) => x.id !== p.id); }); s.setUi({ slot: null }); }}>✕</button>
            </li>
          );
        })}
      </ul>
      {s.ui.slot && stage.environment.some((p) => p.id === s.ui.slot!.parentId) && <PlacementSleeve stage={stage} id={s.ui.slot.parentId} />}
    </div>
  );
}

const kindOf = (p: SpecNode) => (isNode(p.args.kind) ? p.args.kind.cardId.replace(/^kind:/, '') : null);

/** One line for a placement card in the "In this pen" list. */
function placementText(stage: StageSpec, p: SpecNode): string {
  const t = describe(p, { petName: 'Pet', target: stage.learner.focus });
  if (p.cardId === 'place.random') return `Scatter ${t}`;
  if (p.cardId === 'place.obstacles') return `Obstacles: ${t}`;
  if (p.cardId === 'place.fixed') return `Place ${t}`;
  if (p.cardId === 'zone.rect') return `Area “${paramOf(p, 'name', 'coop')}” ${paramOf(p, 'w', 2)}×${paramOf(p, 'h', 2)} ${paramOf(p, 'where', 'fixed') === 'random' ? '(random spot each try)' : `at (${paramOf(p, 'x', 0)},${paramOf(p, 'y', 0)})`}`;
  if (p.cardId === 'place.pet' && paramOf(p, 'mode', 'random') === 'fixed') return `Pet starts at (${paramOf(p, 'x', 0)},${paramOf(p, 'y', 0)})`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface PlayState { cs: CompiledStage; w: World; rs: RuleState; treats: number; log: string[]; ended: string | null }

/** Six layouts the pen makes during practice, to see its variety at a glance. Tap one to show it above. */
function LayoutStrip({ stage, pet }: { stage: StageSpec; pet: Pet }) {
  const s = useStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seeds = useMemo(() => Array.from({ length: 6 }, (_, i) => trainingSeed(stage, i * 97)), [stage.id, stage.seed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const worlds = useMemo(() => seeds.map((seed) => generateWorld(stage, seed)), [seeds, stage, stage.version]);
  return (
    <div className="layout-strip" data-tut="layout-strip" aria-label="Example practice layouts">
      {worlds.map((w, i) => (
        <button key={seeds[i]} className={s.ui.previewSeed === seeds[i] ? 'on' : ''} aria-label={`Show practice layout ${i + 1}`} onClick={() => s.setUi({ previewSeed: seeds[i] })}>
          <WorldView world={w} palette={pet.palette} label={`Practice layout ${i + 1}`} className="thumb" />
        </button>
      ))}
    </div>
  );
}

function PlacementSleeve({ stage, id }: { stage: StageSpec; id: string }) {
  const p = stage.environment.find((x) => x.id === id);
  if (!p) return null;
  const card = cardOf(p)!;
  const set = (k: string, v: number | string) => withSnapshot(stage.id, (st) => { const t = st.environment.find((x) => x.id === id); if (t) t.args[k] = v; });
  const setNode = (k: string, v: SpecNode) => withSnapshot(stage.id, (st) => { const t = st.environment.find((x) => x.id === id); if (t) t.args[k] = v; });
  return (
    <div className="sleeve panel">
      <div className="eyebrow">Sleeve · {card.presentation.title}</div>
      <div className="params">
        {card.sockets.filter((so) => so.id !== 'kind' && socketActive(p, so, card.params?.find((x) => x.id === so.when?.param)?.default)).map((so) => {
          if (so.type.kind === 'nominal' && so.type.name === 'Area') {
            const names = stage.environment.filter((z) => z.cardId === 'zone.rect').map((z) => String(z.args.name ?? 'coop'));
            const cur = isNode(p.args[so.id]) ? String((p.args[so.id] as SpecNode).args.name ?? '') : '';
            return <label key={so.id} className="param-edit">{so.label}<select value={cur} onChange={(e) => setNode(so.id, node('area.named', { name: e.target.value }))}><option value="" disabled>{names.length ? 'pick an area' : 'paint an Area first'}</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>;
          }
          const kinds = [...placedKinds(stage)].filter((k) => k !== kindOf(p));
          const cur = isNode(p.args[so.id]) ? (p.args[so.id] as SpecNode).cardId.replace(/^kind:/, '') : '';
          return <label key={so.id} className="param-edit">{so.label}<select value={cur} onChange={(e) => setNode(so.id, node(`kind:${e.target.value}`))}><option value="" disabled>pick a thing in the pen</option>{kinds.map((k) => <option key={k} value={k}>{REGISTRY.objects.get(k)?.name ?? k}</option>)}</select></label>;
        })}
        {(card.params ?? []).map((pd) => {
          const v = p.args[pd.id] ?? pd.default;
          if (pd.kind === 'choice') return <label key={pd.id} className="param-edit">{pd.label}<select value={String(v)} onChange={(e) => set(pd.id, e.target.value)}>{pd.choices!.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>;
          if (pd.kind === 'text') return <label key={pd.id} className="param-edit">{pd.label}<input value={String(v)} maxLength={16} onChange={(e) => set(pd.id, e.target.value)} /></label>;
          const max = pd.id === 'x' ? stage.size.w - 1 : pd.id === 'y' ? stage.size.h - 1 : pd.max;
          return <label key={pd.id} className="param-edit">{pd.label}<input type="number" min={pd.min} max={max} value={Number(v)} onChange={(e) => set(pd.id, Math.max(pd.min ?? 0, Math.min(max ?? 99, Number(e.target.value) || 0)))} /></label>;
        })}
      </div>
    </div>
  );
}

function RulesBinder({ stage }: { stage: StageSpec }) {
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

function Diagnostics({ stage }: { stage: StageSpec }) {
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

function PetBinder({ stage, pet }: { stage: StageSpec; pet: Pet }) {
  const s = useStore();
  const kinds = [...placedKinds(stage)].filter((k) => !REGISTRY.objects.get(k)?.solid || !!REGISTRY.objects.get(k)?.mover);
  const update = (fn: (st: StageSpec) => void) => withSnapshot(stage.id, fn);
  const skills: string[] = ['Approach', 'Avoid', 'Fetch'];
  const custom = !isPreset(stage.learner.skill);
  const template = templateOf(stage);
  const canInvent = s.state.progress.unlocks.includes('custom');
  const lockedSkill = (k: string) => (k === 'Fetch' && !s.state.progress.unlocks.includes('fetch') ? 'Unlocks after earning 5 coins with a certified Approach' : k === 'Avoid' && !s.state.progress.unlocks.includes('avoid') ? 'Unlocks after earning 12 coins' : null);
  const newSkill = () => {
    const name = prompt('Name your new skill (e.g. “Guard the bin”, “Wait for it”)', '');
    if (!name?.trim()) return;
    const clean = name.trim().slice(0, 24);
    if (isPreset(clean)) return store.toast(`“${clean}” is a built-in skill — pick another name.`, 'warn');
    store.mutate((g) => {
      const st = cloneStage(stage, true, newId('stage'));
      st.name = clean;
      st.version = 1;
      st.recipeId = 'custom';
      st.learner = { skill: clean, template: 'sense', focus: stage.learner.focus, episodes: 2000, senses: [node('sense.nearest', { what: node('ref.target') }), node('sense.blocked'), node('sense.heading')] };
      st.abilities = ['move', 'stay'];
      st.outcome = 'reach';
      st.rules = [];
      st.success = null;
      st.fail = null;
      st.maxTicks = 50;
      st.evaluation.minimumSuccessRate = 0.7;
      g.stages.push(st);
      g.activeStageId = st.id;
    });
    store.setUi({ binder: 'pet', slot: null });
    store.toast(`New skill “${clean}”. Choose what it senses and can do, then write its rules.`, 'good');
  };
  return (
    <div className="binder-body">
      <div className="row between">
        <h4>This lesson teaches</h4>
        <span className="row gap">
          <button className="btn ghost small" disabled={!canInvent} title={canInvent ? undefined : 'Unlocks once your pet has a certified Approach'} onClick={newSkill}>+ New skill…</button>
          <button className="btn ghost small" disabled={!s.state.progress.unlocks.includes('routines')} title={s.state.progress.unlocks.includes('routines') ? undefined : 'Unlocks with a certified Approach and 2 saved skills'} onClick={() => newRoutine(stage, pet)}>+ New routine…</button>
        </span>
      </div>
      {custom ? (
        <label className="param-edit">Skill name
          <input value={stage.learner.skill} maxLength={24} onChange={(e) => { const v = e.target.value; if (isPreset(v.trim())) return; update((st) => { st.learner.skill = v; st.name = v || st.name; }); }} />
          <span className="small muted">Your own skill. Pets keep a separate history for every name.</span>
        </label>
      ) : (
        <div className="seg" role="radiogroup" aria-label="Skill">
          {skills.map((k) => <button key={k} role="radio" aria-checked={stage.learner.skill === k} className={stage.learner.skill === k ? 'on' : ''} disabled={!!lockedSkill(k)} title={lockedSkill(k) ?? undefined} onClick={() => update((st) => {
            st.learner.skill = k;
            st.learner.template = k === 'Fetch' ? 'fetch' : 'sense';
            st.abilities = k === 'Fetch' ? ['move', 'pickup', 'drop'] : ['move'];
            if (k !== 'Fetch') st.learner.senses = presetSenses();
            if (k === 'Fetch') { st.learner.destination ??= 'bin'; st.learner.navigator ??= 'Approach'; st.maxTicks = Math.max(st.maxTicks, 80); st.learner.episodes = 400; st.evaluation.minimumSuccessRate = 0.65; }
            else { st.learner.episodes = k === 'Avoid' ? 8000 : 1500; st.evaluation.minimumSuccessRate = 0.8; }
          })}>{k}</button>)}
        </div>
      )}
      <label className="param-edit">Aimed at <span className="small muted">(“the target” in cards — re-aim it later without retraining)</span>
        <select value={stage.learner.focus} onChange={(e) => update((st) => { st.learner.focus = e.target.value; })}>
          {[...new Set([stage.learner.focus, ...kinds])].map((k) => <option key={k} value={k}>{REGISTRY.objects.get(k)?.name ?? k}</option>)}
        </select>
      </label>
      {template === 'sense' && <SenseEditor stage={stage} update={update} custom={custom} />}
      {template === 'routine' && <RoutineEditor stage={stage} pet={pet} update={update} />}
      {template === 'fetch' && (
        <>
          <label className="param-edit">Deliver into
            <select value={stage.learner.destination ?? 'bin'} onChange={(e) => update((st) => { st.learner.destination = e.target.value; })}>
              {[...new Set(['bin', ...kinds])].map((k) => <option key={k} value={k}>{REGISTRY.objects.get(k)?.name ?? k}</option>)}
            </select>
          </label>
          <label className="param-edit">Moves using
            <select value={stage.learner.navigator ?? 'Approach'} onChange={(e) => update((st) => { st.learner.navigator = e.target.value as 'Approach' | 'Avoid'; })}>
              <option value="Approach">Approach {activeRevision(getSkill(pet, 'Approach')) ? `(r${getSkill(pet, 'Approach')!.activeRev})` : '(not learned)'}</option>
              <option value="Avoid" disabled={!getSkill(pet, 'Avoid')}>Avoid {getSkill(pet, 'Avoid') ? `(r${getSkill(pet, 'Avoid')!.activeRev})` : '(not learned)'}</option>
            </select>
          </label>
        </>
      )}
      <label className="param-edit" data-tut="practice-slider">Practice tries
        <input type="range" min={template === 'fetch' ? 100 : 300} max={template === 'fetch' ? 4000 : 12000} step={100} value={stage.learner.episodes} onChange={(e) => update((st) => { st.learner.episodes = Number(e.target.value); })} />
        <span className="num">{stage.learner.episodes}</span>
      </label>
      <label className="param-edit">Time per try
        <input type="range" min={10} max={120} step={5} value={stage.maxTicks} onChange={(e) => update((st) => { st.maxTicks = Number(e.target.value); })} />
        <span className="num">{stage.maxTicks} steps</span>
      </label>
      <h4>{pet.name}’s temperament</h4>
      <p className="small muted">Stable tendencies, separate from learned skills. Each slider changes real learning parameters.</p>
      <Trait pet={pet} k="curiosity" label="Curiosity" help="How much they keep exploring: exploration floor during lessons (2–12%) and how often Auto tries new jobs." />
      <Trait pet={pet} k="persistence" label="Persistence" help="How long they keep trying before giving up: movement time limit scales 1×–2×." />
      <Trait pet={pet} k="caution" label="Caution" help="During lessons, stepping into hazards costs up to 3 extra treats (shown in the ledger)." />
    </div>
  );
}

function newRoutine(stage: StageSpec, pet: Pet) {
  const name = prompt('Name your routine (e.g. “Morning chores”)', '')?.trim().slice(0, 24);
  if (!name) return;
  if (isPreset(name)) return store.toast(`“${name}” is a built-in skill — pick another name.`, 'warn');
  const usable = pet.skills.filter((k) => (k.template ?? 'sense') === 'sense' && activeRevision(k));
  store.mutate((g) => {
    const st = cloneStage(stage, true, newId('stage'));
    st.name = name;
    st.version = 1;
    st.recipeId = 'custom';
    st.learner = {
      skill: name, template: 'routine', focus: stage.learner.focus, episodes: 500,
      routine: { options: usable.slice(0, 2).map((k) => node('opt.skill', { skill: k.name, aim: node('ref.target') })), watch: [] },
    };
    st.abilities = ['move', 'stay', 'pickup', 'drop', 'water', 'shoo'];
    st.outcome = 'reach';
    st.rules = [];
    st.success = null;
    st.fail = null;
    st.maxTicks = 100;
    st.evaluation.minimumSuccessRate = 0.6;
    g.stages.push(st);
    g.activeStageId = st.id;
  });
  store.setUi({ binder: 'pet', slot: null });
  store.toast(`New routine “${name}”. Pick its options, what it watches, then write rules and a SUCCESS condition.`, 'good');
}

function RoutineEditor({ stage, pet, update }: { stage: StageSpec; pet: Pet; update: (fn: (st: StageSpec) => void) => void }) {
  const s = useStore();
  const R = stage.learner.routine ?? { options: [], watch: [] };
  const errs = nodesWithErrors(validateStage(stage, REGISTRY, new Set(s.state.progress.unlocks)));
  const usable = pet.skills.filter((k) => (k.template ?? (k.name === 'Fetch' ? 'fetch' : 'sense')) === 'sense' && activeRevision(k));
  const kinds = [...placedKinds(stage)];
  const setOpt = (i: number, fn: (o: SpecNode) => void) => update((st) => { const o = st.learner.routine?.options[i]; if (o) fn(o); });
  return (
    <>
      <h4>Options <span className="muted small">— what the routine can choose to do</span></h4>
      <div className="options-deck">
        {R.options.map((o, i) => {
          const skillName = String(o.args.skill ?? '');
          const k = o.cardId === 'opt.skill' ? getSkill(pet, skillName) : null;
          const aim = isNode(o.args.aim) ? o.args.aim.cardId : 'ref.target';
          return (
            <div key={o.id} className={`option-row ${errs.has(o.id) ? 'err' : ''}`}>
              <select aria-label="Option" value={o.cardId === 'opt.action' ? '@action' : skillName} onChange={(e) => setOpt(i, (x) => {
                if (e.target.value === '@action') { x.cardId = 'opt.action'; x.args = { action: 'pick', when: x.args.when }; }
                else { x.cardId = 'opt.skill'; x.args = { skill: e.target.value, aim: isNode(x.args.aim) ? x.args.aim : node('ref.target'), when: x.args.when }; }
              })}>
                {usable.map((u) => <option key={u.id} value={u.name}>Use {u.nickname ?? u.name}</option>)}
                {o.cardId === 'opt.skill' && !k && <option value={skillName}>{skillName} (not learned)</option>}
                <option value="@action">Do an action…</option>
              </select>
              {o.cardId === 'opt.skill' ? (
                <>
                  <select aria-label="Aimed at" value={aim} onChange={(e) => setOpt(i, (x) => { x.args.aim = node(e.target.value); })}>
                    <option value="ref.target">→ the target</option>
                    {kinds.map((kk) => <option key={kk} value={`kind:${kk}`}>→ {REGISTRY.objects.get(kk)?.name ?? kk}</option>)}
                  </select>
                  <span className={`chip ${k ? '' : 'bad'}`}>{k ? `r${k.activeRev}` : 'missing'}</span>
                </>
              ) : (
                <select aria-label="Action" value={String(o.args.action ?? 'pick')} onChange={(e) => setOpt(i, (x) => { x.args.action = e.target.value; })}>
                  {REGISTRY.cards.get('opt.action')!.params![0].choices!.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              )}
              <span className="small muted">only when</span>
              <SlotChip stage={stage} slot={{ parentId: o.id, socket: 'when', index: null }} label="always" errors={errs} />
              <button className="icon-btn small" aria-label="Remove option" onClick={() => { update((st) => { st.learner.routine!.options.splice(i, 1); }); s.setUi({ slot: null }); }}>✕</button>
            </div>
          );
        })}
        {R.options.length < MAX_OPTIONS && (
          <button className="btn ghost small" onClick={() => update((st) => { (st.learner.routine ??= { options: [], watch: [] }).options.push(usable[0] ? node('opt.skill', { skill: usable[0].name, aim: node('ref.target') }) : node('opt.action', { action: 'pick' })); })}>+ Add option</button>
        )}
      </div>
      <h4>Watches <span className="muted small">— what it notices when choosing</span></h4>
      <div className="many" data-tut="watches">
        {R.watch.map((n, i) => <NodeChip key={n.id} stage={stage} n={n} slot={{ parentId: '#watch', socket: 'watch', index: i }} errors={errs} />)}
        {R.watch.length < MAX_WATCH && <SlotChip stage={stage} slot={{ parentId: '#watch', socket: 'watch', index: null }} label="+ condition" errors={errs} />}
      </div>
      <p className="small muted"><b className="num">{1 << R.watch.length}</b> situations · <b className="num">{R.options.length}</b> options. Options use each skill’s <em>current</em> revision, so improving a skill improves every routine that uses it.</p>
      {s.ui.slot && (s.ui.slot.parentId === '#watch' || R.options.some((o) => findNode(o, s.ui.slot!.parentId)) || R.watch.some((o) => findNode(o, s.ui.slot!.parentId))) && <Sleeve stage={stage} onChange={update} />}
    </>
  );
}

function SenseEditor({ stage, update, custom }: { stage: StageSpec; update: (fn: (st: StageSpec) => void) => void; custom: boolean }) {
  const s = useStore();
  const senses = stage.learner.senses ?? presetSenses();
  const size = stateSpaceSize(senses);
  const errs = nodesWithErrors(validateStage(stage, REGISTRY, new Set(s.state.progress.unlocks)));
  const pctBudget = Math.min(100, (100 * Math.log10(Math.max(1, size))) / Math.log10(STATE_MAX));
  return (
    <>
      <h4>Senses <span className="muted small">— what {custom ? 'it' : 'this skill'} pays attention to</span></h4>
      <div className="many senses" data-tut="senses">
        {senses.map((n, i) => <NodeChip key={n.id} stage={stage} n={n} slot={{ parentId: '#senses', socket: 'senses', index: i }} errors={errs} />)}
        {senses.length < MAX_SENSES && <SlotChip stage={stage} slot={{ parentId: '#senses', socket: 'senses', index: null }} label="+ sense" errors={errs} />}
      </div>
      <div className="budget" aria-label={`${size} situations to learn`}>
        <div className={`bar ${size > STATE_WARN ? 'warn' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={STATE_MAX} aria-valuenow={size}><i style={{ width: `${pctBudget}%` }} /></div>
        <span className="small"><b className="num">{size.toLocaleString()}</b> situations to learn {size > STATE_MAX ? '— too many!' : size > STATE_WARN ? '— needs lots of practice' : ''}</span>
      </div>
      <p className="small muted">More senses = smarter but slower to learn. Each sense multiplies the situations your pet must practise.</p>
      <h4>Abilities</h4>
      <div className="row gap wrap" role="group" aria-label="Abilities" data-tut="abilities">
        {ABILITY_ORDER.map((a) => {
          const on = stage.abilities.includes(a);
          return <button key={a} className={`chip-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => update((st) => { st.abilities = on ? st.abilities.filter((x) => x !== a) : ABILITY_ORDER.filter((x) => x === a || st.abilities.includes(x)); })}>{on ? '✓ ' : ''}{ABILITY_LABELS[a]}</button>;
        })}
      </div>
      <h4>Judging success</h4>
      <div className="seg" role="radiogroup" aria-label="Outcome">
        <button role="radio" aria-checked={stage.outcome !== 'survive'} className={stage.outcome !== 'survive' ? 'on' : ''} onClick={() => update((st) => { st.outcome = 'reach'; })}>Done when SUCCESS happens</button>
        <button role="radio" aria-checked={stage.outcome === 'survive'} className={stage.outcome === 'survive' ? 'on' : ''} onClick={() => update((st) => { st.outcome = 'survive'; })}>Judge when time is up</button>
      </div>
      {/* Also for slots *inside* a sense card (e.g. the “What” of “How far is…”), which is where picking a sense moves the focus. */}
      {slotInSenses(stage, s.ui.slot) && <Sleeve stage={stage} onChange={update} />}
    </>
  );
}

function Trait({ pet, k, label, help }: { pet: Pet; k: 'curiosity' | 'persistence' | 'caution'; label: string; help: string }) {
  return (
    <label className="trait">
      <span><b>{label}</b> <span className="num">{Math.round(pet.traits[k] * 100)}</span></span>
      <input type="range" min={0} max={1} step={0.05} value={pet.traits[k]} onChange={(e) => store.mutate((g) => { g.pets.find((p) => p.id === pet.id)!.traits[k] = Number(e.target.value); })} />
      <span className="small muted">{help}</span>
    </label>
  );
}

function CurriculumBinder({ stage, pet }: { stage: StageSpec; pet: Pet }) {
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
          const locked = r.unlock && !unlocks.has(r.unlock);
          return (
            <button key={r.id} className="suggest" disabled={!!locked} onClick={() => s.mutate((g) => { const st = instantiateRecipe(r.id); g.stages.push(st); g.activeStageId = st.id; store.ui.slot = null; })}>
              <strong>{r.name}</strong>{r.optional && <span className="chip">experiment</span>}
              <span className="small muted">{locked ? `🔒 Unlocks with ${r.unlock === 'fetch' ? 'Fetch lessons' : 'Avoid lessons'}` : r.blurb}</span>
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

function BehaviorsBinder({ pet }: { pet: Pet }) {
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

function InspectBinder({ stage }: { stage: StageSpec }) {
  const json = JSON.stringify(stage, null, 2);
  return (
    <div className="binder-body">
      <p className="small muted">The canonical, serialisable lesson spec. The simulator and learner compile from exactly this.</p>
      <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(json)}>Copy JSON</button>
      <pre className="spec">{json}</pre>
    </div>
  );
}

export { NodeChip };
