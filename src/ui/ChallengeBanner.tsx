/**
 * Academy challenges in the Lab (Academy roadmap, phase 1): the brief and what's fixed, shown above the binders,
 * and certification from a finished training run.
 */
import { store, useStore } from './store';
import { audio } from '../audio/engine';
import { SCHOOL, acornText, petRecordOf } from '../game/academy';
import { measureCertify } from '../game/measures';
import { certify, challengeOf, challengeStatus, courseOf, type CertifyResult } from '../game/challenges';
import { activePet } from '../game/pets';
import type { StageSpec } from '../domain/types';

export function ChallengeBanner({ stage }: { stage: StageSpec }) {
  const s = useStore();
  const ch = challengeOf(stage);
  const pet = activePet(s.state);
  if (!ch) return null;
  const cert = pet ? petRecordOf(s.state, pet.id).certificates[ch.id] : undefined;
  const status = pet ? challengeStatus(s.state, pet.id, ch) : 'open';
  return (
    <div className="panel challenge-banner" data-tut="challenge-banner">
      <div className="row between wrap">
        <strong>{courseOf(ch).title} · {ch.title}</strong>
        <span className={`chip ${cert ? 'good' : status === 'locked' ? 'locked' : ''}`}>{cert ? '🏵 Passed' : status === 'locked' ? '🔒 Pass the course’s other challenges first' : `Pass: ${Math.round(ch.bar * 100)}% on the test layouts`}</span>
      </div>
      <p className="small"><b>{SCHOOL.mentor}:</b> “{ch.brief}”</p>
      <p className="small muted">The pen and SUCCESS / FAIL are set by the challenge (🔒). Everything else is yours: rules, senses, abilities, practice. A loophole is never certified.</p>
      <div className="small badges">
        Merit badges: {ch.stars.map((st) => <span key={st.id} className={`chip ${cert?.badges.includes(st.id) ? 'good' : ''}`}>{cert?.badges.includes(st.id) ? '✓ ' : ''}{st.label}{st.id === 'quick' ? ` (${st.limit} tries or fewer, in one run)` : ''}</span>)}
      </div>
    </div>
  );
}

/** On a finished report: certify this run for the active challenge (saves the skill too). */
export function CertifyButton({ run, petId, stage, report, episodes, resumed, saved, save }: { run: number; petId: string; stage: StageSpec; report: NonNullable<ReturnType<typeof useStore>['ui']['training']>['report']; episodes: number; resumed: boolean; saved: boolean; save: () => void }) {
  const s = useStore();
  // Kept in the store, keyed to this training run (a component's own state doesn't survive the store update).
  const res = s.ui.certify?.run === run ? s.ui.certify.result : null;
  const ch = challengeOf(stage);
  const pet = s.state.pets.find((x) => x.id === petId); // the pet that trained, whichever is active now
  if (!ch || !report || !pet) return null;
  const go = () => {
    let r: CertifyResult | null = null;
    store.mutate((g) => { r = certify(g, pet.id, { stage, report, episodes, resumed }); measureCertify(g, ch.id, !!r?.ok); });
    if (r && (r as CertifyResult).ok && !saved) save(); // the certified skill is the pet's
    if (r) store.setUi({ certify: { run, result: r } });
    audio.play(r && (r as CertifyResult).ok ? 'train.certified' : 'card.reject');
  };
  return (
    <div className="certify" data-tut="certify-area">
      {!res && <button className="btn primary" data-tut="certify" onClick={go}>Certify for “{ch.title}”</button>}
      {res && (res.ok ? (
        <div className="diag info" data-tut="certified">
          <strong>🏵 {pet.name} earned a rosette: {ch.title}</strong>
          <div className="small">{res.badges.length ? `Merit badges: ${res.badges.map((b) => b.label).join(', ')}.` : 'No merit badges this time: try for them on the next run.'} {res.acorns ? `+${acornText(res.acorns)}.` : 'No new acorns (nothing new earned).'}</div>
          {res.rank && <div className="small"><b>{pet.name} is now an {res.rank}!</b></div>}
        </div>
      ) : (
        <div className="diag warning" data-tut="not-certified">
          <strong>Not certified yet</strong>
          <div className="small">{res.reason}</div>
        </div>
      ))}
    </div>
  );
}
