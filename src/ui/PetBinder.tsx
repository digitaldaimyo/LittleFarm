/** Teach screen: the Pet binder — senses, abilities, routines and temperament (split from TeachScreen.tsx, polish phase 3). */
import { useMemo } from 'react';
import { Trainer } from '../learning/trainer';
import { TRAIT_AIMS } from '../sim/world';
import type { SpecNode, StageSpec } from '../domain/types';
import { REGISTRY } from '../domain/registry';
import { cloneStage, findNode, isNode, newId, node, placedKinds } from '../domain/spec';
import { nodesWithErrors, validateStage } from '../domain/validate';
import { store, useStore } from './store';
import { NodeChip, Sleeve, SlotChip, withSnapshot } from './cards';
import { slotInSenses } from './edit';
import { activeRevision, getSkill, isPreset } from '../game/pets';
import { MAX_OPTIONS, MAX_WATCH } from '../learning/routine';
import { ABILITY_LABELS, ABILITY_ORDER, BRAINS, MAX_EPISODES, MAX_TICKS, brainOf, presetSenses, stateSpaceSize, type Brain } from '../learning/senses';
import { templateOf } from '../learning/skilldef';
import { DEFAULT_TRAITS } from '../learning/episodes';
import type { Pet } from '../game/types';

export function PetBinder({ stage, pet }: { stage: StageSpec; pet: Pet }) {
  const s = useStore();
  const kinds = [...placedKinds(stage)].filter((k) => !REGISTRY.objects.get(k)?.solid || !!REGISTRY.objects.get(k)?.mover);
  const update = (fn: (st: StageSpec) => void) => withSnapshot(stage.id, fn);
  const skills: string[] = ['Approach', 'Avoid', 'Fetch'];
  const custom = !isPreset(stage.learner.skill);
  const template = templateOf(stage);
  const maxEps = template === 'sense' ? MAX_EPISODES.sense : MAX_EPISODES.composite;
  const canInvent = s.state.progress.unlocks.includes('custom');
  const lockedSkill = (k: string) => (k === 'Fetch' && !s.state.progress.unlocks.includes('fetch') ? 'Unlocks after earning 5 coins with a certified Approach' : k === 'Avoid' && !s.state.progress.unlocks.includes('avoid') ? 'Unlocks after earning 12 coins' : null);
  const newSkill = () => {
    const name = prompt('Name your new skill (e.g. “Guard the basket”, “Wait for it”)', '');
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
          {[...new Set([stage.learner.focus, ...Object.keys(TRAIT_AIMS), ...kinds])].map((k) => <option key={k} value={k}>{REGISTRY.objects.get(k)?.name ?? REGISTRY.cards.get(`kind:${k}`)?.presentation.title ?? k}</option>)}
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
        <input type="range" min={template === 'fetch' ? 100 : 300} max={maxEps} step={100} value={Math.min(maxEps, stage.learner.episodes)} onChange={(e) => update((st) => { st.learner.episodes = Number(e.target.value); })} />
        <input className="num-input" type="number" aria-label="Practice tries (exact)" min={100} max={maxEps} step={100} value={stage.learner.episodes} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) update((st) => { st.learner.episodes = Math.max(100, Math.min(maxEps, v)); }); }} />
      </label>
      <label className="param-edit">Time per try
        <input type="range" min={10} max={MAX_TICKS} step={5} value={stage.maxTicks} onChange={(e) => update((st) => { st.maxTicks = Number(e.target.value); })} />
        <input className="num-input" type="number" aria-label="Time per try in steps (exact)" min={10} max={MAX_TICKS} step={5} value={stage.maxTicks} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) update((st) => { st.maxTicks = Math.max(10, Math.min(MAX_TICKS, v)); }); }} />
        <span className="small muted">steps</span>
      </label>
      <TrainingEstimate stage={stage} />
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
                    {Object.keys(TRAIT_AIMS).map((kk) => <option key={kk} value={`kind:${kk}`}>→ {REGISTRY.cards.get(`kind:${kk}`)?.presentation.title ?? kk}</option>)}
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

/** A quick timing of a few practice tries on this device, scaled to the whole run (sense skills). */
function TrainingEstimate({ stage }: { stage: StageSpec }) {
  const shape = JSON.stringify([stage.environment, stage.rules, stage.learner.senses, stage.abilities, stage.maxTicks, stage.size, stage.success, stage.fail]);
  const perTry = useMemo(() => {
    if (templateOf(stage) !== 'sense') return null;
    try {
      const probe = structuredClone(stage);
      const t = new Trainer({ stage: probe, episodes: 30, traits: { ...DEFAULT_TRAITS } });
      const t0 = performance.now();
      while (!t.done) t.runChunk(30, false);
      return (performance.now() - t0) / 30;
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  if (perTry === null) return null;
  const secs = (perTry * stage.learner.episodes) / 1000;
  const text = secs < 2 ? 'a moment' : secs < 90 ? `about ${Math.round(secs)} s` : `about ${Math.round(secs / 60)} min`;
  return <p className="small muted" data-tut="estimate">Training time on this device: {text} (at most — tries get shorter as {stage.learner.skill} learns). You can stop early and keep what it learned.</p>;
}

function SenseEditor({ stage, update, custom }: { stage: StageSpec; update: (fn: (st: StageSpec) => void) => void; custom: boolean }) {
  const s = useStore();
  const senses = stage.learner.senses ?? presetSenses();
  const size = stateSpaceSize(senses);
  const errs = nodesWithErrors(validateStage(stage, REGISTRY, new Set(s.state.progress.unlocks)));
  const brain = BRAINS[brainOf(stage.learner)];
  const pctBudget = Math.min(100, (100 * Math.log10(Math.max(1, size))) / Math.log10(brain.states));
  return (
    <>
      {custom && (
        <>
          <h4>Brain</h4>
          <div className="seg" role="radiogroup" aria-label="Brain" data-tut="brain">
            {(Object.keys(BRAINS) as Brain[]).map((b) => (
              <button key={b} role="radio" aria-checked={brainOf(stage.learner) === b} className={brainOf(stage.learner) === b ? 'on' : ''}
                onClick={() => update((st) => { if (b === 'big') st.learner.brain = 'big'; else delete st.learner.brain; })}>{BRAINS[b].label}</button>
            ))}
          </div>
          <p className="small muted">{brain.hint}</p>
        </>
      )}
      <h4>Senses <span className="muted small">— what {custom ? 'it' : 'this skill'} pays attention to</span></h4>
      <div className="many senses" data-tut="senses">
        {senses.map((n, i) => <NodeChip key={n.id} stage={stage} n={n} slot={{ parentId: '#senses', socket: 'senses', index: i }} errors={errs} />)}
        {senses.length < brain.senses && <SlotChip stage={stage} slot={{ parentId: '#senses', socket: 'senses', index: null }} label="+ sense" errors={errs} />}
      </div>
      <div className="budget" aria-label={`${size} situations to learn`}>
        <div className={`bar ${size > brain.warn ? 'warn' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={brain.states} aria-valuenow={size}><i style={{ width: `${pctBudget}%` }} /></div>
        <span className="small"><b className="num">{size.toLocaleString()}</b> of {brain.states.toLocaleString()} situations {size > brain.states ? '— too many!' : size > brain.warn ? '— needs lots of practice' : ''}</span>
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
