import { useEffect, useState } from 'react';
import { PlanMat } from './PlanMat';
import { Tips } from './Tips';
import { LayoutPanel, layoutTap, openLayout } from './LayoutPanel';
import { farmTips } from '../game/coach';
import { describeRequest, requestHelp } from '../game/requests';
import { chapterById, startChapter } from '../game/tutorial';
import { store, useStore } from './store';
import { WorldView } from './WorldView';
import { PetSprite, type PetMood } from './art';
import { activePet, activeRevision, getSkill, isCertified, petById } from '../game/pets';
import { capabilityOf, deployedRevision, eligibility, jobCapability, kindOfSkill } from '../game/capability';
import { TRAIT_AIMS } from '../sim/world';
import type { Skill } from '../game/types';

/** Skills and routines with a revision that can run (the capabilities a player can assign directly). */
const runnable = (p: Pet): Skill[] => p.skills.filter((k) => !!deployedRevision(k));
import { OBJECT_BY_ID } from '../domain/packs/farm';

const FARM_TARGETS = ['berry', 'carrot', 'egg', 'chicken', 'crow', 'firefly', 'gate', 'bin', 'home', 'well', 'pond', 'bush', 'patch', 'rock', 'tree'];
import { DAY_TICKS, MAX_ON_DUTY, applyPlan, crewSummary, dayInfo, describeTile, dutyPets, makeLead, petActivity, queueManual, queueManualPath, recentProduction, restartPet, setOnDuty, TIRED } from '../game/farm';
import { RosterStrip, toggleDuty, leadPet, petStatus } from './Roster';
import { nextUnlock } from '../game/progression';
import { BEHAVIOR_LABEL } from '../learning/executive';
import type { JobId, NavigatorName, Pet } from '../game/types';
import type { Action } from '../sim/world';

function moodFor(pet: Pet, fxTypes: string[], behavior: string | undefined, stun: number): PetMood {
  if (stun > 0 || fxTypes.includes('splash')) return 'wet';
  if (fxTypes.includes('celebrate') || fxTypes.includes('coin')) return 'celebrate';
  if (fxTypes.includes('confused')) return 'confused';
  if (behavior === 'rest' && pet.energy < 97) return 'nap';
  if (behavior && behavior !== 'rest') return 'move';
  return 'idle';
}

interface JobCard {
  id: 'auto' | JobId | 'manual' | 'plan';
  title: string;
  blurb: string;
  needs?: string;
  locked?: string;
}

function jobCards(pet: Pet): JobCard[] {
  const hasNav = !!activeRevision(getSkill(pet, 'Approach')) || !!activeRevision(getSkill(pet, 'Avoid'));
  const cap = (job: string) => jobCapability(pet, job);
  const runs = (job: string) => (cap(job) ? ` (${cap(job)!.name} r${cap(job)!.rev})` : '');
  return [
    { id: 'auto', title: 'Auto', blurb: `${pet.name} decides using their executive — napping at night, unless there are fireflies to catch.` },
    { id: 'plan', title: 'Farm plan', blurb: 'Your own IF/DO rows decide which skill runs when. Preview before applying.' },
    { id: 'forage', title: BEHAVIOR_LABEL.forage, blurb: `Runs ${pet.name}’s own Harvest${runs('forage')}: any ripe crop to the house, where it sells (berry +2, carrot +5, sunflower +7, pumpkin +12). With a Harvest to storage routine too, crops go into a basket or shed with room while someone can empty it.`, needs: 'Harvest', locked: cap('forage') ? undefined : 'Needs a Harvest skill — teach it in the Field Guide (Teach a job: Harvest)' },
    { id: 'deliver', title: BEHAVIOR_LABEL.deliver, blurb: `Runs ${pet.name}’s own Fetch${runs('deliver')}: eggs and whatever is in the basket or shed to the house, where it sells.`, needs: 'Fetch', locked: cap('deliver') ? undefined : 'Needs a certified Fetch skill' },
    { id: 'plant', title: BEHAVIOR_LABEL.plant, blurb: 'Plant empty soil: carrots (seed 1), sunflowers (2), pumpkins (3). Seeds are paid from your coins.', needs: 'Approach', locked: hasNav ? undefined : 'Needs a saved Approach skill' },
    { id: 'tote', title: BEHAVIOR_LABEL.tote, blurb: `Runs ${pet.name}’s own Basket run${runs('tote')}: lift a basket that’s half full, empty it at the house, and set it down beside the crops — six crops in one trip. Also moves an empty basket next to the fields.`, needs: 'Basket run', locked: cap('tote') ? undefined : 'Needs a Basket run routine — train the Basket run recipe in Train' },
    { id: 'rest', title: 'Nap', blurb: 'Rest to refill energy.' },
    { id: 'skill', title: 'Run a skill', blurb: 'Run any skill or routine it has learned, aimed at anything on the farm — or at any ripe crop, or storage with room.', locked: runnable(pet).length ? undefined : 'Teach a skill in the pen first' },
    { id: 'manual', title: 'Steer', blurb: 'Guide them yourself: tap tiles or use arrow keys.' },
  ];
}

export function FarmScreen() {
  const s = useStore();
  const g = s.state;
  const f = g.farm;
  const lead = petById(g, f.dutyPetId) ?? activePet(g);
  // The pet whose card is shown: tapped on the farm or in the strip (default: the lead).
  const pet = petById(g, s.ui.farmPet) ?? lead;
  const fxTypes = s.ui.fx.filter((x) => performance.now() - x.at < 900).map((x) => x.type);
  const mood = lead ? moodFor(lead, fxTypes, f.current?.behaviorId, f.stun) : 'idle';
  const act = pet ? petActivity(g, pet.id) : null;
  const petMood: PetMood = !pet ? 'idle' : pet.id === lead?.id ? mood : act?.current?.behaviorId === 'rest' && pet.energy < 97 ? 'nap' : act ? 'move' : 'nap';
  const manual = lead?.assignment.mode === 'manual';
  const onDuty = new Set(dutyPets(g).map((p) => p.id));
  const crew = (f.helpers ?? []).map((h) => { const p = petById(g, h.petId); const body = f.world.crew?.[(f.helpers ?? []).indexOf(h)]; return p ? { palette: p.palette, name: p.name, mood: (body?.carrying !== null && body?.carrying !== undefined ? 'carry' : h.current?.behaviorId === 'rest' && p.energy < 97 ? 'nap' : 'move') as PetMood } : { palette: 'meadow' as const, name: '?', mood: 'idle' as PetMood }; });
  const layout = s.ui.layout;
  const next = nextUnlock(g);
  const [showPlan, setShowPlan] = useState(false);
  const perMin = recentProduction(f, 214); // ≈ 60s at 1×
  const clock = dayInfo(f.tick);
  // Smooth dusk (60–70% of the day) and dawn (first 5%).
  const darkness = clock.night ? 1 : clock.phase > 0.6 ? (clock.phase - 0.6) / 0.1 : clock.phase < 0.05 && f.tick >= DAY_TICKS ? 1 - clock.phase / 0.05 : 0;

  useEffect(() => {
    if (!manual) return;
    const keys: Record<string, Action> = { ArrowUp: 'N', ArrowRight: 'E', ArrowDown: 'S', ArrowLeft: 'W', ' ': 'pick', p: 'pick', d: 'drop', w: 'water', x: 'shoo', g: 'nudge', l: 'plant', b: 'lift' };
    const h = (e: KeyboardEvent) => {
      const a = keys[e.key];
      if (!a || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      e.preventDefault();
      queueManual(store.runtime, a);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [manual]);

  if (!pet || !lead) return <div className="empty">Adopt a pet to begin.</div>;

  /** Tap on the farm (not steering, not editing the layout): a pet → its card; the house → the roster; else what's there. */
  const tapTile = (x: number, y: number) => {
    const w = f.world;
    // The house first: pets napping there are "at home", and the house is where the roster lives.
    if (w.objects.some((o) => o.kind === 'home' && o.x === x && o.y === y && !o.delivered)) { s.setUi({ modal: 'roster', inspect: null }); return; }
    const hit = w.pet.x === x && w.pet.y === y ? lead.id : (f.helpers ?? []).find((_, i) => w.crew?.[i]?.x === x && w.crew?.[i]?.y === y)?.petId;
    if (hit) {
      s.setUi({ farmPet: hit, inspect: null });
      if (window.innerWidth < 900) document.querySelector('.pet-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const text = describeTile(g, x, y);
    s.setUi({ inspect: text ? { x, y, text } : null });
  };

  const setJob = (id: JobCard['id']) => {
    let warn: string | null = null;
    store.mutate((st) => {
      const p = st.pets.find((x) => x.id === pet.id)!;
      // Choosing a job for an off-duty pet puts it to work (if there's room).
      if (!onDuty.has(p.id)) warn = setOnDuty(st, p.id, true, store.runtime);
      // Only the lead can be steered: steering a helper makes it the lead.
      if (id === 'manual' && st.farm.dutyPetId !== p.id && !warn) makeLead(st, p.id, store.runtime);
      if (id === 'plan') { applyPlan(st, store.runtime, p.id); st.progress.flags.assignedJob = true; return; }
      if (id === 'auto') p.assignment.mode = 'auto';
      else if (id === 'manual') p.assignment.mode = 'manual';
      else {
        p.assignment.mode = 'job';
        p.assignment.job = id;
        if (id === 'skill' && !runnable(p).some((k) => k.name === p.assignment.skillName)) {
          const k = runnable(p).find((x) => x.custom) ?? runnable(p)[0];
          p.assignment.skillName = k?.name;
          p.assignment.target = activeRevision(k ?? null)?.focus;
        }
      }
      restartPet(st, store.runtime, p.id);
      if (id === 'forage' || id === 'deliver' || id === 'auto') st.progress.flags.assignedJob = true;
    });
    if (warn) store.toast(warn, 'warn');
  };
  const setNav = (n: NavigatorName) => store.mutate((st) => { st.pets.find((x) => x.id === pet.id)!.assignment.navigator = n; restartPet(st, store.runtime, pet.id); });
  const selected: JobCard['id'] = pet.assignment.mode === 'job' ? pet.assignment.job : pet.assignment.mode;
  const canAvoid = !!getSkill(pet, 'Avoid');
  const body = pet.id === lead.id ? f.world.pet : f.world.crew?.[(f.helpers ?? []).findIndex((h) => h.petId === pet.id)];
  const carriedKind = body && body.carrying !== null ? f.world.objects.find((o) => o.id === body.carrying)?.kind : null;

  return (
    <div className="screen farm-screen">
      <section className="stage-col">
        <div className="farm-frame">
          <WorldView
            world={layout ? layout.draft.world : f.world} palette={lead.palette} mood={mood} crew={crew} ground="farm" darkness={layout ? 0 : darkness}
            highlight={layout ? layout.pick : g.pets.length > 1 && body ? { x: body.x, y: body.y } : null}
            label={`Farm. ${lead.name} is at column ${f.world.pet.x}, row ${f.world.pet.y}.`}
            fx={s.ui.fx}
            onTile={layout ? layoutTap : manual ? (x, y) => { if (!queueManualPath(g, store.runtime, x, y)) store.toast('Can’t get there.', 'warn'); } : tapTile}
            tileLabel={(x, y) => (layout ? `Layout: tile ${x},${y}` : manual ? `Walk to ${x},${y}` : `Farm tile ${x},${y}`)}
          />
        </div>
        <div className="farm-bar">
          <div className="speed" role="group" aria-label="Farm speed">
            <button className={s.ui.farmPaused ? 'on' : ''} onClick={() => s.setUi({ farmPaused: !s.ui.farmPaused })} aria-pressed={s.ui.farmPaused}>{s.ui.farmPaused ? '▶ Resume' : '⏸ Pause'}</button>
            {[1, 2, 4].map((v) => (
              <button key={v} className={g.settings.farmSpeed === v ? 'on' : ''} aria-pressed={g.settings.farmSpeed === v} onClick={() => store.mutate((st) => { st.settings.farmSpeed = v; })}>{v}×</button>
            ))}
          </div>
          <span className={`clock ${clock.night ? 'night' : ''}`} aria-label={`Day ${clock.day}, ${clock.label}`}>{clock.night ? '☾' : '☀'} Day {clock.day} · {clock.label}</span>
          {f.world.raining && <span className="clock rain" aria-label="Raining">☂ Rain — plots watered</span>}
          <span className="muted small">{perMin} coins in the last minute</span>
          {!layout && <button className="btn ghost small" data-tut="layout-btn" onClick={openLayout}>Layout…</button>}
        </div>
        {s.ui.inspect && !layout && (
          <div className="inspect small" role="status" aria-live="polite">
            <span>{s.ui.inspect.text}</span>
            <button className="icon-btn" aria-label="Close" onClick={() => s.setUi({ inspect: null })}>✕</button>
          </div>
        )}
        {!manual && !layout && !s.ui.inspect && <p className="small muted farm-hint">Tap a pet for its card, the house for your pets, or anything else to see what it is.</p>}
        {manual && !layout && (
          <div className="manual-pad" aria-label="Steering controls">
            <button onClick={() => queueManual(store.runtime, 'N')} aria-label="Up">▲</button>
            <div>
              <button onClick={() => queueManual(store.runtime, 'W')} aria-label="Left">◀</button>
              <button onClick={() => queueManual(store.runtime, 'S')} aria-label="Down">▼</button>
              <button onClick={() => queueManual(store.runtime, 'E')} aria-label="Right">▶</button>
            </div>
            <div>
              <button className="wide" onClick={() => queueManual(store.runtime, 'pick')}>Pick up (P)</button>
              <button className="wide" onClick={() => queueManual(store.runtime, 'drop')}>Put down (D)</button>
              <button className="wide" onClick={() => queueManual(store.runtime, 'water')}>Water (W)</button>
              <button className="wide" onClick={() => queueManual(store.runtime, 'shoo')}>Shoo (X)</button>
              <button className="wide" onClick={() => queueManual(store.runtime, 'nudge')}>Nudge gate (G)</button>
              <button className="wide" onClick={() => queueManual(store.runtime, 'plant')}>Plant (L)</button>
              <button className="wide" onClick={() => queueManual(store.runtime, 'lift')}>Lift basket (B)</button>
            </div>
            <p className="muted small">Tap a tile to walk there. Pick up (P) and put down (D) to carry crops: put them down in the basket or shed to store them, or in the house to sell them. Water at the well to fill up, then on a bush or patch — watered plots regrow twice as fast. Stand on empty soil and Plant (L) to sow it — the seed is paid from your coins. Lift (B) a basket to carry it: put it down (D) by the crops, or at the house or a shed to empty it there. Walk into fireflies at night to catch them. Shoo pushes a next-door chicken one tile away and sends crows flying. Chickens only lay eggs inside the coop.</p>
          </div>
        )}
      </section>

      <aside className="side-col">
        <LayoutPanel />
        {g.pets.length > 1 && <RosterStrip selected={pet.id} />}
        <div className="panel pet-card" data-tut="pet-card">
          <PetSprite palette={pet.palette} mood={petMood} size={56} carrying={carriedKind ?? null} />
          <div className="grow">
            <div className="row between wrap">
              <strong className="pet-name">{pet.name}</strong>
              <span className="row gap">
                {pet.id === f.dutyPetId ? <span className="chip good" title="The lead is the pet you can steer">lead</span>
                  : onDuty.has(pet.id) ? <button className="btn ghost small" onClick={() => leadPet(pet.id)}>Make lead</button> : null}
                {g.pets.length > 1 && (
                  <button className="btn small" data-tut="duty-toggle" disabled={!onDuty.has(pet.id) && onDuty.size >= MAX_ON_DUTY} title={!onDuty.has(pet.id) && onDuty.size >= MAX_ON_DUTY ? `At most ${MAX_ON_DUTY} pets work at once` : undefined}
                    onClick={() => toggleDuty(pet.id, !onDuty.has(pet.id))}>{onDuty.has(pet.id) ? 'Off duty' : 'On duty'}</button>
                )}
              </span>
            </div>
            <Meter label="Energy" value={pet.energy} warn={pet.energy < TIRED} />
            <Meter label="Mood" value={pet.mood} />
            <div className="activity" aria-live="polite">
              {!act ? <span className="muted">{petStatus(pet.id)}</span> : act.stun > 0 ? <span>Shaking off pond water…</span> : act.current ? (
                <>
                  <strong>{BEHAVIOR_LABEL[act.current.behaviorId]}</strong>
                  {act.current.args.navigator && act.current.behaviorId !== 'rest' && <span className="chip">moves with {act.current.args.navigator}</span>}
                  <span className={`chip by-${act.current.chosenBy}`}>{act.current.chosenBy === 'player' ? 'your call' : act.current.chosenBy === 'rules' ? 'rule-based choice' : act.current.chosenBy === 'plan' ? 'farm plan' : 'learned choice'}</span>
                  <div className="muted small">{act.current.intention}</div>
                </>
              ) : <span className="muted">Thinking…</span>}
            </div>
            <div className="row gap small">
              <button className="link" onClick={() => { store.mutate((st) => { st.activePetId = pet.id; }); s.setUi({ screen: 'pets' }); }}>{pet.name}’s skills →</button>
              <button className="link" onClick={() => { store.mutate((st) => { st.activePetId = pet.id; }); s.setUi({ screen: 'teach' }); }}>Teach {pet.name} →</button>
            </div>
            {onDuty.size > 1 && <div className="muted small">On duty: {crewSummary(g)}. Pets never chase the same thing; extra pets pay off doing different work.</div>}
            <Tips tips={farmTips(g)} />
          </div>
        </div>

        <div className="panel">
          <h3>Jobs</h3>
          <div className="job-deck" role="radiogroup" aria-label="Job assignment">
            {jobCards(pet).map((j) => (
              <button key={j.id} data-tut={`job-${j.id}`} role="radio" aria-checked={selected === j.id} disabled={!!j.locked} className={`job ${selected === j.id ? 'sel' : ''} ${j.locked ? 'locked' : ''}`} onClick={() => setJob(j.id)}>
                <span className="job-title">{j.title}</span>
                <span className="job-blurb">{j.locked ?? j.blurb}</span>
                {j.needs && !j.locked && <span className="chip">uses {j.needs}</span>}
              </button>
            ))}
          </div>
          {(selected === 'forage' || selected === 'deliver' || selected === 'plant' || selected === 'tote' || selected === 'auto') && (
            <div className="sleeve-inline">
              <span className="small">Move with</span>
              <div className="seg" role="radiogroup" aria-label="Navigation skill">
                {(['Approach', 'Avoid'] as NavigatorName[]).map((n) => (
                  <button key={n} data-tut={`nav-${n.toLowerCase()}`} role="radio" aria-checked={pet.assignment.navigator === n} className={pet.assignment.navigator === n ? 'on' : ''} disabled={n === 'Avoid' && !canAvoid} onClick={() => setNav(n)} title={n === 'Avoid' && !canAvoid ? 'Teach Avoid first' : undefined}>{n}</button>
                ))}
              </div>
            </div>
          )}
          {selected === 'skill' && (
            <div className="sleeve-inline">
              <label className="small">Skill{' '}
                <select value={pet.assignment.skillName ?? ''} onChange={(e) => store.mutate((st) => { const p = st.pets.find((x) => x.id === pet.id)!; p.assignment.skillName = e.target.value; p.assignment.target = deployedRevision(getSkill(p, e.target.value))?.focus; store.runtime.exec = null; store.runtime.inv = null; })}>
                  {runnable(pet).map((k) => <option key={k.id} value={k.name}>{k.nickname ?? k.name} (r{deployedRevision(k)?.rev}{k.pinnedRev !== undefined ? ', pinned' : ''}){kindOfSkill(k) === 'routine' ? ' · routine' : ''}</option>)}
                </select>
              </label>
              <label className="small">aimed at{' '}
                <select value={pet.assignment.target ?? ''} onChange={(e) => store.mutate((st) => { st.pets.find((x) => x.id === pet.id)!.assignment.target = e.target.value; store.runtime.exec = null; store.runtime.inv = null; })}>
                  {Object.entries(TRAIT_AIMS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  {FARM_TARGETS.map((k) => <option key={k} value={k}>{OBJECT_BY_ID[k]?.name ?? k}</option>)}
                </select>
              </label>
              {(() => {
                const k = getSkill(pet, pet.assignment.skillName ?? '');
                const cap = k ? capabilityOf(k, pet.assignment.target) : null;
                const el = cap ? eligibility(g, pet, cap) : null;
                return el && (!el.ok ? <span className="small warn-text" data-tut="skill-eligibility">Can’t run now: {el.text}</span> : el.warnings.map((x, i) => <span key={i} className="small warn-text">{x}</span>));
              })()}
              <span className="small muted">Ends when the skill’s own SUCCESS holds — or time runs out, which counts as a timeout, not a success — then repeats.</span>
            </div>
          )}
          {selected === 'auto' && (
            <div className="sleeve-inline">
              <span className="small">Executive</span>
              <div className="seg" role="radiogroup" aria-label="Executive selector">
                {(['rules', 'learned'] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={pet.executive.mode === m} className={pet.executive.mode === m ? 'on' : ''} onClick={() => store.mutate((st) => { st.pets.find((x) => x.id === pet.id)!.executive.mode = m; })}>{m === 'rules' ? 'Simple rules' : 'Learns from results'}</button>
                ))}
              </div>
            </div>
          )}
          {f.queue.length > 0 && (
            <details className="queue">
              <summary>Recent decisions</summary>
              <ol>{f.queue.map((q, i) => <li key={i}><strong>{BEHAVIOR_LABEL[q.behaviorId]}</strong> <span className="muted small">— {q.intention}</span></li>)}</ol>
            </details>
          )}
        </div>

        {(selected === 'plan' || showPlan) && <PlanMat pet={pet} />}
        {selected !== 'plan' && !showPlan && (
          <button className="btn ghost" data-tut="plan-edit" onClick={() => setShowPlan(true)}>Edit farm plan…</button>
        )}

        <RequestsBoard />

        <div className="panel">
          <div className="resources">
            <span><b>{g.resources.coins}</b> coins</span>
            <span><b>{g.resources.berries}</b> berries</span>
            <span><b>{g.resources.carrots}</b> carrots</span>
            {(g.resources.fireflies ?? 0) > 0 && <span><b>{g.resources.fireflies}</b> fireflies</span>}
            {(g.resources.eggs ?? 0) > 0 && <span><b>{g.resources.eggs}</b> eggs</span>}
          </div>
          {next ? (
            <div className="unlock">
              <div className="small">Next: <strong>{next.def.label}</strong> — {next.def.describe}</div>
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={next.need} aria-valuenow={next.have} aria-label={`${next.have} of ${next.need} ${next.unit}`}><i style={{ width: `${(100 * next.have) / next.need}%` }} /></div>
              <div className="muted small">{next.have}/{next.need} {next.unit}{next.def.id === 'fetch' && !g.pets.some((p) => isCertified(getSkill(p, 'Approach'))) ? ' — certify Approach in the pen first' : ''}</div>
            </div>
          ) : <div className="small muted">All main unlocks earned. Try the shop!</div>}
          <button className="btn" onClick={() => s.setUi({ modal: 'shop' })}>Open shop</button>
        </div>
      </aside>
    </div>
  );
}

export function Meter({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="meter">
      <span className="small">{label}</span>
      <div className={`bar ${warn ? 'warn' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={label}><i style={{ width: `${value}%` }} /></div>
      <span className="small num">{Math.round(value)}{warn ? ' · tired' : ''}</span>
    </div>
  );
}

function RequestsBoard() {
  const s = useStore();
  const reqs = (s.state.farm.requests ?? []).slice(-6).reverse();
  if (!reqs.length) return null;
  return (
    <div className="panel">
      <h3>Requests board</h3>
      <ul className="requests">
        {reqs.map((r) => (
          <li key={r.id} className={r.status}>
            <div className="row between"><strong>{describeRequest(r)}</strong><span className="chip">{r.status === 'done' ? '✓ done' : r.status === 'expired' ? 'missed' : `+${r.reward} coins${r.gift ? ' + gift' : ''}`}</span></div>
            <span className="small muted">from {r.from} · day {r.day}{r.status === 'open' && r.kind !== 'noPecks' && r.kind !== 'coop' && r.kind !== 'gate' ? ` · ${Math.max(0, r.progress)}/${r.n}` : ''}</span>
            {r.status === 'open' && (() => { const h = requestHelp(r.kind); const ch = h.lesson ? chapterById(h.lesson) : null; return (
              <span className="small muted">How: {h.hint}{ch && <> <button className="link" onClick={() => { store.mutate((g) => startChapter(g, ch.id)); store.setUi({ screen: 'guide' }); }}>Lesson: {ch.title}</button></>}</span>
            ); })()}
            {r.status === 'open' && r.kind !== 'noPecks' && r.kind !== 'coop' && r.kind !== 'gate' && <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={r.n} aria-valuenow={Math.max(0, r.progress)} aria-label="Progress"><i style={{ width: `${(100 * Math.max(0, r.progress)) / r.n}%` }} /></div>}
          </li>
        ))}
      </ul>
      <p className="small muted">New requests arrive each dawn. Missing one costs nothing.</p>
    </div>
  );
}
