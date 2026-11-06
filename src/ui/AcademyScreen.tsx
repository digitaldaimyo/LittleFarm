/**
 * Willowbrook Academy (Academy roadmap, phases 0–1): the school's map of courses, their challenges (opened in the Lab)
 * and each rank exam, visible from the start; every pet's rank and certificate board; and the library.
 */
import { useStore } from './store';
import { closeTraining } from './training';
import { COURSES, RANKS, SCHOOL, acornText, petRank, petRecordOf } from '../game/academy';
import { activePet, isCertified } from '../game/pets';
import { challengeStatus, courseChallenges, courseOpen, openChallenge } from '../game/challenges';
import { Glossary, Notebook } from './GuideScreen';

export function AcademyScreen() {
  const s = useStore();
  const g = s.state;
  const a = g.academy;
  const pet = activePet(g);
  if (!a) return <div className="screen single"><div className="panel">This game is from the farm edition.</div></div>;
  return (
    <div className="screen single academy">
      <div className="panel" data-tut="academy-welcome">
        <div className="row between wrap">
          <h2>{SCHOOL.name}</h2>
          <span className="chip" data-tut="acorns">{acornText(a.acorns)}</span>
        </div>
        <p className="mentor small"><b>{SCHOOL.mentor}</b> ({SCHOOL.mentorIs}): “Welcome. Every pet starts as a Novice. Each course ends in an exam, and each exam passed is a rank earned. Train in the Lab whenever you like; earn your rosettes here.”</p>
      </div>

      <div className="panel" data-tut="academy-map">
        <h3>Courses</h3>
        <ol className="courses">
          {COURSES.map((c, i) => {
            const list = courseChallenges(c.id);
            const exam = list.find((x) => x.exam);
            const examPassed = !!pet && petRecordOf(g, pet.id).exams.includes(c.id);
            return (
              <li key={c.id} className="course" data-tut={`course-${c.id}`}>
                <div className="row between wrap">
                  <strong>{i + 1}. {c.title}</strong>
                  <span className={`chip ${examPassed ? 'good' : 'locked'}`}>{examPassed ? '🏵' : '🔒'} {c.exam}{c.earns ? ` → ${c.earns}` : ''}</span>
                </div>
                <div className="small">{c.about}</div>
                <div className="small muted">“{c.hazel}”</div>
                {!courseOpen(g, c.id) && i > 0 && <div className="small" data-tut={`course-locked-${c.id}`}>🔒 Opens when a pet passes {COURSES[i - 1].exam.replace(/^The /, 'the ')}. Its cards then join the Lab.</div>}
                {list.length === 0 && <div className="small muted">Challenges for this course are being written. Its exam is shown so you can see where it leads.</div>}
                {list.length > 0 && (
                  <ul className="challenges">
                    {list.map((ch) => {
                      const status = pet ? challengeStatus(g, pet.id, ch) : 'locked';
                      const cert = pet ? petRecordOf(g, pet.id).certificates[ch.id] : undefined;
                      return (
                        <li key={ch.id} className={`challenge ${status}`} data-tut={`challenge-${ch.id}`}>
                          <div className="row between wrap">
                            <span><b>{ch.exam ? '🎓 ' : ''}{ch.title}</b>{cert && <span className="small"> · 🏵{cert.badges.length ? ` + ${cert.badges.length} badge${cert.badges.length === 1 ? '' : 's'}` : ''}</span>}</span>
                            {status === 'locked'
                              ? <span className="small muted">🔒 after the course’s other challenges</span>
                              : <button className="btn small" data-tut={`open-${ch.id}`} onClick={() => { const t = s.ui.training; if (t && t.status !== 'running' && t.status !== 'paused' && t.stage.id !== `challenge-${ch.id}`) closeTraining(); s.mutate((x) => { openChallenge(x, ch.id); }); s.setUi({ screen: 'teach', binder: 'rules', slot: null, placing: null }); }}>{cert ? 'Try again' : 'Open'}</button>}
                          </div>
                          <div className="small muted">{ch.brief}</div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {exam && !examPassed && pet && <div className="small muted">{pet.name}: {list.filter((x) => !x.exam && petRecordOf(g, pet.id).certificates[x.id]).length} of {list.filter((x) => !x.exam).length} challenges passed before the exam.</div>}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="panel" data-tut="academy-pets">
        <h3>Your pets</h3>
        {g.pets.length === 0 && <p className="small muted">Adopt a pet to begin.</p>}
        <ul className="pet-boards">
          {g.pets.map((p) => {
            const rec = petRecordOf(g, p.id);
            const certs = Object.values(rec.certificates);
            const rank = petRank(g, p);
            return (
              <li key={p.id} className="pet-board" data-tut="pet-board">
                <div className="row between wrap">
                  <strong>{p.name}</strong>
                  <span className="chip good">{rank}</span>
                </div>
                <div className="ranks small" aria-label={`Rank ${RANKS.indexOf(rank) + 1} of ${RANKS.length}`}>
                  {RANKS.map((r, i) => <span key={r} className={i <= RANKS.indexOf(rank) ? 'on' : 'muted'}>{r}{i < RANKS.length - 1 ? ' → ' : ''}</span>)}
                </div>
                <div className="small">{certs.length ? `${certs.length} rosette${certs.length === 1 ? '' : 's'}, ${certs.reduce((n, c) => n + c.badges.length, 0)} merit badges` : 'No rosettes yet.'}</div>
                <div className="small muted">Skills: {p.skills.length ? p.skills.map((k) => `${k.name}${isCertified(k) ? ' ✓' : ''}`).join(', ') : 'none yet. Train one in the Lab.'}</div>
              </li>
            );
          })}
        </ul>
      </div>

      <details className="panel" data-tut="academy-library">
        <summary><h3 style={{ display: 'inline' }}>Library</h3> <span className="small muted">the Trainer’s notebook, a glossary, and every card</span></summary>
        <Notebook />
        <Glossary />
      </details>
    </div>
  );
}
