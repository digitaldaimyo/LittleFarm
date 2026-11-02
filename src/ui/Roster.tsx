import { store, useStore } from './store';
import { PetSprite } from './art';
import { MAX_ON_DUTY, crewSummary, dutyPets, makeLead, petActivity, setOnDuty } from '../game/farm';
import { BEHAVIOR_LABEL } from '../learning/executive';
import { SHOP } from '../game/progression';
import type { Pet } from '../game/types';

const ADOPT_PRICE = SHOP.find((i) => i.id === 'adopt')?.price ?? 20;

/** One line about what a pet is up to. */
export function petStatus(petId: string): string {
  const g = store.state;
  const a = petActivity(g, petId);
  if (!a) return 'Off duty — resting at home';
  if (a.stun) return 'Shaking off pond water…';
  if (!a.current) return 'Thinking…';
  return BEHAVIOR_LABEL[a.current.behaviorId];
}

function jobName(p: Pet): string {
  const a = p.assignment;
  return a.mode === 'auto' ? 'Auto' : a.mode === 'plan' ? 'Farm plan' : a.mode === 'manual' ? 'Steer' : BEHAVIOR_LABEL[a.job === 'skill' ? 'skill' : a.job];
}

export function toggleDuty(petId: string, on: boolean): void {
  let why: string | null = null;
  store.mutate((g) => { why = setOnDuty(g, petId, on, store.runtime); });
  if (why) store.toast(why, 'warn');
}

export function leadPet(petId: string): void {
  store.mutate((g) => makeLead(g, petId, store.runtime));
}

/** Tap the house: every pet, who's on duty, and what they do. */
export function RosterModal() {
  const s = useStore();
  const g = s.state;
  const duty = new Set(dutyPets(g).map((p) => p.id));
  const close = () => store.setUi({ modal: null });
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal roster" role="dialog" aria-modal="true" aria-label="Pets" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
        <div className="row between"><h2>Your pets</h2><button className="icon-btn" onClick={close} aria-label="Close">✕</button></div>
        <p className="small muted">On duty ({duty.size}/{MAX_ON_DUTY}): {crewSummary(g)}. Off-duty pets rest at home and recover energy.</p>
        <ul className="roster-list">
          {g.pets.map((p) => {
            const on = duty.has(p.id);
            const lead = g.farm.dutyPetId === p.id;
            return (
              <li key={p.id} className={on ? 'on' : ''} data-tut={`roster-${p.name}`}>
                <PetSprite palette={p.palette} size={40} mood={petActivity(g, p.id)?.current?.behaviorId === 'rest' ? 'nap' : 'idle'} />
                <div className="grow">
                  <div className="row gap wrap">
                    <input className="roster-name" aria-label={`Name of ${p.name}`} value={p.name} maxLength={20} onChange={(e) => store.mutate((st) => { st.pets.find((x) => x.id === p.id)!.name = e.target.value || p.name; })} />
                    {lead && <span className="chip good">lead</span>}
                    {on && <span className="chip">{jobName(p)}</span>}
                  </div>
                  <div className="small muted">{petStatus(p.id)} · energy {Math.round(p.energy)}</div>
                </div>
                <div className="roster-actions">
                  <button className="btn small" data-tut={`duty-${p.name}`} onClick={() => toggleDuty(p.id, !on)}>{on ? 'Off duty' : 'On duty'}</button>
                  {on && !lead && <button className="btn ghost small" onClick={() => leadPet(p.id)} title="The lead is the pet you can steer">Make lead</button>}
                  <button className="btn ghost small" onClick={() => { store.setUi({ modal: null, farmPet: p.id }); }}>Card</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="row between">
          <span className="small muted">{g.resources.coins} coins</span>
          <button className="btn" disabled={g.resources.coins < ADOPT_PRICE} onClick={() => store.setUi({ modal: 'adopt-paid' })}>Adopt another pet ({ADOPT_PRICE})</button>
        </div>
      </div>
    </div>
  );
}

/** A compact strip of pets under the farm: tap one to see its card. */
export function RosterStrip({ selected }: { selected: string }) {
  const s = useStore();
  const g = s.state;
  const duty = new Set(dutyPets(g).map((p) => p.id));
  return (
    <div className="roster-strip" role="tablist" aria-label="Pets">
      {g.pets.map((p) => (
        <button key={p.id} role="tab" aria-selected={selected === p.id} className={`roster-chip ${selected === p.id ? 'sel' : ''} ${duty.has(p.id) ? 'on' : 'off'}`} onClick={() => store.setUi({ farmPet: p.id })} title={petStatus(p.id)}>
          <PetSprite palette={p.palette} size={24} mood="idle" />
          <span>{p.name}</span>
          <i className="dot" aria-label={duty.has(p.id) ? 'on duty' : 'off duty'} />
        </button>
      ))}
      <button className="btn ghost small" data-tut="roster-btn" onClick={() => store.setUi({ modal: 'roster' })}>Roster…</button>
    </div>
  );
}
