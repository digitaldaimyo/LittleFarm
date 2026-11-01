import { useEffect } from 'react';
import { store, useStore, type Screen } from './store';
import { FarmScreen } from './FarmScreen';
import { TeachScreen } from './TeachScreen';
import { PetsScreen } from './PetsScreen';
import { JournalScreen } from './JournalScreen';
import { SettingsScreen } from './SettingsScreen';
import { AdoptModal, ConfirmReset, ShopModal } from './Modals';
import { ackStep, currentStep, guide, pauseChapter } from '../game/tutorial';
import { GuideScreen } from './GuideScreen';
import { activePet } from '../game/pets';
import { warmTrainingWorker } from './training';

const NAV: { id: Screen; label: string }[] = [
  { id: 'farm', label: 'Farm' },
  { id: 'teach', label: 'Teach' },
  { id: 'pets', label: 'Pets' },
  { id: 'guide', label: 'Guide' },
  { id: 'journal', label: 'Journal' },
  { id: 'settings', label: 'Settings' },
];
const SCREEN_LABEL: Record<string, string> = { farm: 'the Farm', teach: 'Teach', pets: 'Pets', guide: 'the Guide', journal: 'the Journal' };

export function App() {
  const s = useStore();
  const g = s.state;
  const step = currentStep(g);
  const offered = Object.values(guide(g).status).filter((x) => x === 'offered').length;
  const pet = activePet(g);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const reduce = g.settings.reducedMotion === 'on' || (g.settings.reducedMotion === 'system' && !!mq?.matches);
      document.documentElement.dataset.motion = reduce ? 'reduced' : 'full';
    };
    apply();
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, [g.settings.reducedMotion]);

  // Bring the control a lesson step is about into view (once per step).
  const stepKey = step ? `${step.chapter.id}:${step.id}:${s.ui.screen}` : '';
  useEffect(() => {
    if (!step?.highlight) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-tut="${step.highlight}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight - 20) el.scrollIntoView({ block: 'center', behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth' });
    }, 250);
    return () => clearTimeout(t);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (g.pets.length === 0 && !s.ui.modal) s.setUi({ modal: 'adopt' });
  }, [g.pets.length, s, s.ui.modal]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden>▦</span> Pen Deck</div>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.id} data-tut={`nav-${n.id}`} className={`nav-btn ${s.ui.screen === n.id ? 'on' : ''} ${step?.screen === n.id && s.ui.screen !== n.id ? 'pulse' : ''}`} aria-current={s.ui.screen === n.id ? 'page' : undefined} onClick={() => s.setUi({ screen: n.id, slot: null, placing: null })}>{n.label}</button>
          ))}
        </nav>
        <div className="top-res" aria-label="Resources">
          <span title="Coins"><b>{g.resources.coins}</b> coins</span>
          {pet && <span className="small muted hide-sm">{pet.name} · {Math.round(pet.energy)}⚡</span>}
        </div>
      </header>

      {step && (
        <div className="tutorial" role="status">
          <span className="tut-step">{step.chapter.title} · {step.index + 1}/{step.chapter.steps.length}</span>
          <div className="grow">
            <div><strong>{step.title}.</strong> {step.text}</div>
            {step.why && <div className="tut-why">Why: {step.why}</div>}
          </div>
          {step.screen && s.ui.screen !== step.screen && <button className="btn small" onClick={() => s.setUi({ screen: step.screen! })}>Go to {SCREEN_LABEL[step.screen] ?? step.screen}</button>}
          {step.action && <button className="btn small primary" onClick={() => s.mutate((x) => step.action!.run(x))}>{step.action.label}</button>}
          {step.ack && step.highlight !== 'guide-compare' && <button className="btn small primary" onClick={() => s.mutate((x) => ackStep(x))}>I’ve looked</button>}
          <button className="btn ghost small" onClick={() => s.mutate((x) => pauseChapter(x))}>{step.chapter.id === 'first' ? 'Skip for now' : 'Pause lesson'}</button>
        </div>
      )}
      {!step && offered > 0 && s.ui.screen !== 'guide' && (
        <div className="tutorial quiet" role="status">
          <span className="grow small"><b>Field Guide:</b> {offered} new lesson{offered > 1 ? 's' : ''} — short, free, and they make your pets better trainees.</span>
          <button className="btn small" onClick={() => s.setUi({ screen: 'guide' })}>Open the Guide</button>
        </div>
      )}
      {step?.highlight && <style>{`[data-tut="${step.highlight}"]{outline:3px solid #F0B44C;outline-offset:3px;border-radius:10px;animation:tutglow 1.6s ease-in-out infinite}`}</style>}

      <main className="main">
        {s.ui.screen === 'farm' && <FarmScreen />}
        {s.ui.screen === 'teach' && <TeachScreen />}
        {s.ui.screen === 'pets' && <PetsScreen />}
        {s.ui.screen === 'journal' && <JournalScreen />}
        {s.ui.screen === 'guide' && <GuideScreen />}
        {s.ui.screen === 'settings' && <SettingsScreen />}
      </main>

      <div className="toasts" aria-live="polite">
        {s.ui.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>

      {s.ui.modal === 'adopt' && <AdoptModal />}
      {s.ui.modal === 'shop' && <ShopModal />}
      {s.ui.modal === 'confirm-reset' && <ConfirmReset />}
    </div>
  );
}

export function boot() {
  store.startFarm();
  warmTrainingWorker();
  window.addEventListener('beforeunload', () => void store.saveNow());
  document.addEventListener('visibilitychange', () => { if (document.hidden) void store.saveNow(); });
}
