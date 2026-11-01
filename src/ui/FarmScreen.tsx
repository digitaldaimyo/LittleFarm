import { useEffect, useState } from 'react';
import { PlanMat } from './PlanMat';
import { Tips } from './Tips';
import { farmTips } from '../game/coach';
import { describeRequest } from '../game/requests';
import { store, useStore } from './store';
import { WorldView } from './WorldView';
import { PetSprite, type PetMood } from './art';
import { activePet, activeRevision, customSkills, getSkill, isCertified, petById } from '../game/pets';
import { OBJECT_BY_ID } from '../domain/packs/farm';

const FARM_TARGETS = ['berry', 'carrot', 'egg', 'chicken', 'crow', 'firefly', 'gate', 'bin', 'home', 'well', 'pond', 'bush', 'patch', 'rock', 'tree'];
import { DAY_TICKS, applyPlan, dayInfo, queueManual, queueManualPath, recentProduction, TIRED } from '../game/farm';
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

function jobCards(pet: Pet, unlocks: string[]): JobCard[] {
  const hasNav = !!activeRevision(getSkill(pet, 'Approach')) || !!activeRevision(getSkill(pet, 'Avoid'));
  const hasFetch = !!activeRevision(getSkill(pet, 'Fetch'));
  return [
    { id: 'auto', title: 'Auto', blurb: `${pet.name} decides using their executive — napping at night, unless there are fireflies to catch.` },
    { id: 'plan', title: 'Farm plan', blurb: 'Your own IF/DO rows decide which skill runs when. Preview before applying.' },
    { id: 'forage', title: BEHAVIOR_LABEL.forage, blurb: 'Approach a ripe berry, then gather it. +1 coin.', needs: 'Approach', locked: hasNav ? undefined : 'Needs a saved Approach skill' },
    { id: 'deliver', title: BEHAVIOR_LABEL.deliver, blurb: 'Fetch carrots (+3) and eggs (+2) to the bin.', needs: 'Fetch', locked: hasFetch ? undefined : 'Needs a saved Fetch skill' },
    { id: 'rest', title: 'Nap', blurb: 'Rest to refill energy.' },
    { id: 'skill', title: 'Run a skill', blurb: 'Run one of your own skills, aimed at anything on the farm.', locked: customSkills(pet).length ? undefined : unlocks.includes('custom') ? 'Invent a skill in the pen first (Pet binder → New skill)' : 'Unlocks with a certified Approach' },
    { id: 'manual', title: 'Steer', blurb: 'Guide them yourself: tap tiles or use arrow keys.' },
  ];
}

export function FarmScreen() {
  const s = useStore();
  const g = s.state;
  const pet = petById(g, g.farm.dutyPetId) ?? activePet(g);
  const f = g.farm;
  const fxTypes = s.ui.fx.filter((x) => performance.now() - x.at < 900).map((x) => x.type);
  const mood = pet ? moodFor(pet, fxTypes, f.current?.behaviorId, f.stun) : 'idle';
  const manual = pet?.assignment.mode === 'manual';
  const next = nextUnlock(g);
  const [showPlan, setShowPlan] = useState(false);
  const perMin = recentProduction(f, 214); // ≈ 60s at 1×
  const clock = dayInfo(f.tick);
  // Smooth dusk (60–70% of the day) and dawn (first 5%).
  const darkness = clock.night ? 1 : clock.phase > 0.6 ? (clock.phase - 0.6) / 0.1 : clock.phase < 0.05 && f.tick >= DAY_TICKS ? 1 - clock.phase / 0.05 : 0;

  useEffect(() => {
    if (!manual) return;
    const keys: Record<string, Action> = { ArrowUp: 'N', ArrowRight: 'E', ArrowDown: 'S', ArrowLeft: 'W', ' ': 'pick', p: 'pick', d: 'drop', w: 'water', x: 'shoo', g: 'nudge' };
    const h = (e: KeyboardEvent) => {
      const a = keys[e.key];
      if (!a || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      e.preventDefault();
      queueManual(store.runtime, a);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [manual]);

  if (!pet) return <div className="empty">Adopt a pet to begin.</div>;

  const setJob = (id: JobCard['id']) => {
    store.mutate((st) => {
      const p = st.pets.find((x) => x.id === pet.id)!;
      if (id === 'plan') { applyPlan(st, store.runtime, p.id); st.progress.flags.assignedJob = true; return; }
      if (id === 'auto') p.assignment.mode = 'auto';
      else if (id === 'manual') p.assignment.mode = 'manual';
      else {
        p.assignment.mode = 'job';
        p.assignment.job = id;
        if (id === 'skill' && !customSkills(p).some((k) => k.name === p.assignment.skillName)) {
          const k = customSkills(p)[0];
          p.assignment.skillName = k?.name;
          p.assignment.target = activeRevision(k ?? null)?.focus;
        }
      }
      store.runtime.exec = null; store.runtime.inv = null; st.farm.current = null;
      if (id === 'forage' || id === 'deliver' || id === 'auto') st.progress.flags.assignedJob = true;
    });
  };
  const setNav = (n: NavigatorName) => store.mutate((st) => { st.pets.find((x) => x.id === pet.id)!.assignment.navigator = n; store.runtime.exec = null; store.runtime.inv = null; });
  const selected: JobCard['id'] = pet.assignment.mode === 'job' ? pet.assignment.job : pet.assignment.mode;
  const canAvoid = !!getSkill(pet, 'Avoid');
  const carriedKind = f.world.pet.carrying !== null ? f.world.objects.find((o) => o.id === f.world.pet.carrying)?.kind : null;

  return (
    <div className="screen farm-screen">
      <section className="stage-col">
        <div className="farm-frame">
          <WorldView
            world={f.world} palette={pet.palette} mood={mood} ground="farm" darkness={darkness}
            palette2={f.duty2PetId ? g.pets.find((p) => p.id === f.duty2PetId)?.palette ?? null : null}
            label={`Farm. ${pet.name} is at column ${f.world.pet.x}, row ${f.world.pet.y}.`}
            fx={s.ui.fx}
            onTile={manual ? (x, y) => { if (!queueManualPath(g, store.runtime, x, y)) store.toast('Can’t get there.', 'warn'); } : undefined}
            tileLabel={(x, y) => `Walk to ${x},${y}`}
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
        </div>
        {manual && (
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
            </div>
            <p className="muted small">Tap a tile to walk there. Berries go straight into the basket; carrots must be dropped in the bin. Water at the well to fill up, then on a bush or patch — watered plots regrow twice as fast. Walk into fireflies at night to catch them. Shoo pushes a next-door chicken one tile away and sends crows flying. Chickens only lay eggs inside the coop.</p>
          </div>
        )}
      </section>

      <aside className="side-col">
        <div className="panel pet-card">
          <PetSprite palette={pet.palette} mood={mood} size={56} carrying={carriedKind ?? null} />
          <div className="grow">
            <div className="row between">
              <strong className="pet-name">{pet.name}</strong>
              {g.pets.length > 1 && (
                <label className="small">Also on duty:{' '}
                  <select value={f.duty2PetId ?? ''} onChange={(e) => store.mutate((st) => { st.farm.duty2PetId = e.target.value || null; st.farm.current2 = null; if (store.runtime.second) store.runtime.second = undefined; })}>
                    <option value="">nobody</option>
                    {g.pets.filter((p) => p.id !== f.dutyPetId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {g.pets.length > 1 && (
                <label className="small">On duty:{' '}
                  <select value={f.dutyPetId ?? ''} onChange={(e) => store.mutate((st) => { st.farm.dutyPetId = e.target.value; st.activePetId = e.target.value; store.runtime.exec = null; store.runtime.inv = null; })}>
                    {g.pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <Meter label="Energy" value={pet.energy} warn={pet.energy < TIRED} />
            <Meter label="Mood" value={pet.mood} />
            <div className="activity" aria-live="polite">
              {f.stun > 0 ? <span>Shaking off pond water…</span> : f.current ? (
                <>
                  <strong>{BEHAVIOR_LABEL[f.current.behaviorId]}</strong>
                  {f.current.args.navigator && f.current.behaviorId !== 'rest' && <span className="chip">moves with {f.current.args.navigator}</span>}
                  <span className={`chip by-${f.current.chosenBy}`}>{f.current.chosenBy === 'player' ? 'your call' : f.current.chosenBy === 'rules' ? 'rule-based choice' : f.current.chosenBy === 'plan' ? 'farm plan' : 'learned choice'}</span>
                  <div className="muted small">{f.current.intention}</div>
                </>
              ) : <span className="muted">Thinking…</span>}
            </div>
            {f.duty2PetId && f.current2 && (
              <div className="activity small">
                <strong>{g.pets.find((p) => p.id === f.duty2PetId)?.name}:</strong> {BEHAVIOR_LABEL[f.current2.behaviorId]} <span className="muted">— {f.current2.intention}</span>
                <div className="muted">Pets never chase the same thing; a second pet pays off when it does different work.</div>
                <Tips tips={farmTips(g)} />
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <h3>Jobs</h3>
          <div className="job-deck" role="radiogroup" aria-label="Job assignment">
            {jobCards(pet, g.progress.unlocks).map((j) => (
              <button key={j.id} data-tut={`job-${j.id}`} role="radio" aria-checked={selected === j.id} disabled={!!j.locked} className={`job ${selected === j.id ? 'sel' : ''} ${j.locked ? 'locked' : ''}`} onClick={() => setJob(j.id)}>
                <span className="job-title">{j.title}</span>
                <span className="job-blurb">{j.locked ?? j.blurb}</span>
                {j.needs && !j.locked && <span className="chip">uses {j.needs}</span>}
              </button>
            ))}
          </div>
          {(selected === 'forage' || selected === 'deliver' || selected === 'auto') && (
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
                <select value={pet.assignment.skillName ?? ''} onChange={(e) => store.mutate((st) => { const p = st.pets.find((x) => x.id === pet.id)!; p.assignment.skillName = e.target.value; p.assignment.target = activeRevision(getSkill(p, e.target.value))?.focus; store.runtime.exec = null; store.runtime.inv = null; })}>
                  {customSkills(pet).map((k) => <option key={k.id} value={k.name}>{k.nickname ?? k.name} (r{k.activeRev})</option>)}
                </select>
              </label>
              <label className="small">aimed at{' '}
                <select value={pet.assignment.target ?? ''} onChange={(e) => store.mutate((st) => { st.pets.find((x) => x.id === pet.id)!.assignment.target = e.target.value; store.runtime.exec = null; store.runtime.inv = null; })}>
                  {FARM_TARGETS.map((k) => <option key={k} value={k}>{OBJECT_BY_ID[k]?.name ?? k}</option>)}
                </select>
              </label>
              <span className="small muted">Ends when the skill’s own SUCCESS holds (or time runs out), then repeats.</span>
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
          <button className="btn ghost" onClick={() => setShowPlan(true)}>Edit farm plan…</button>
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
            <span className="small muted">from {r.from} · day {r.day}{r.status === 'open' && r.kind !== 'noPecks' && r.kind !== 'coop' ? ` · ${Math.max(0, r.progress)}/${r.n}` : ''}</span>
            {r.status === 'open' && r.kind !== 'noPecks' && r.kind !== 'coop' && <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={r.n} aria-valuenow={Math.max(0, r.progress)} aria-label="Progress"><i style={{ width: `${(100 * Math.max(0, r.progress)) / r.n}%` }} /></div>}
          </li>
        ))}
      </ul>
      <p className="small muted">New requests arrive each dawn. Missing one costs nothing.</p>
    </div>
  );
}
