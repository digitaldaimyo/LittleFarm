import { useEffect } from 'react';
import { store, useStore, type Screen } from './store';
import { FarmScreen } from './FarmScreen';
import { TeachScreen } from './TeachScreen';
import { PetsScreen } from './PetsScreen';
import { JournalScreen } from './JournalScreen';
import { SettingsScreen } from './SettingsScreen';
import { AdoptModal, ConfirmReset, ShopModal } from './Modals';
import { currentStep, TUTORIAL } from '../game/tutorial';
import { activePet } from '../game/pets';
import { warmTrainingWorker } from './training';

const NAV: { id: Screen; label: string }[] = [
  { id: 'farm', label: 'Farm' },
  { id: 'teach', label: 'Teach' },
  { id: 'pets', label: 'Pets' },
  { id: 'journal', label: 'Journal' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const s = useStore();
  const g = s.state;
  const step = currentStep(g);
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

  useEffect(() => {
    if (g.pets.length === 0 && !s.ui.modal) s.setUi({ modal: 'adopt' });
  }, [g.pets.length, s, s.ui.modal]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden>▦</span> Pen Deck</div>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.id} className={`nav-btn ${s.ui.screen === n.id ? 'on' : ''} ${step?.screen === n.id && s.ui.screen !== n.id ? 'pulse' : ''}`} aria-current={s.ui.screen === n.id ? 'page' : undefined} onClick={() => s.setUi({ screen: n.id, slot: null, placing: null })}>{n.label}</button>
          ))}
        </nav>
        <div className="top-res" aria-label="Resources">
          <span title="Coins"><b>{g.resources.coins}</b> coins</span>
          {pet && <span className="small muted hide-sm">{pet.name} · {Math.round(pet.energy)}⚡</span>}
        </div>
      </header>

      {step && (
        <div className="tutorial" role="status">
          <span className="tut-step">Step {g.progress.tutorialStep + 1}/{TUTORIAL.length}</span>
          <div className="grow"><strong>{step.title}.</strong> {step.text}</div>
          {step.screen && s.ui.screen !== step.screen && <button className="btn small" onClick={() => s.setUi({ screen: step.screen! })}>Go to {step.screen}</button>}
          <button className="btn ghost small" onClick={() => s.mutate((x) => { x.progress.tutorialDone = true; })}>Skip tutorial</button>
        </div>
      )}

      <main className="main">
        {s.ui.screen === 'farm' && <FarmScreen />}
        {s.ui.screen === 'teach' && <TeachScreen />}
        {s.ui.screen === 'pets' && <PetsScreen />}
        {s.ui.screen === 'journal' && <JournalScreen />}
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
