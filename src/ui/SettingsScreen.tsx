import { useRef } from 'react';
import { store, useStore } from './store';
import { parseGame, serializeGame } from '../persistence/save';
import { newGame } from '../game/state';
import { clearLocal } from '../persistence/storage';
import { startChapter } from '../game/tutorial';
import { audio } from '../audio/engine';
import { toggleSound } from './sound';
import type { AudioSettings } from '../game/sound';

export function SettingsScreen() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const g = s.state;
  const exportSave = () => {
    const blob = new Blob([serializeGame(g)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pen-deck-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importSave = async (f: File) => {
    const r = parseGame(await f.text());
    if (!r.ok) return store.toast(`Import failed: ${r.diagnostics.join(' ')}`, 'warn');
    store.load(r.game!, r.diagnostics);
    await store.saveNow();
    store.toast(`Save imported.${r.diagnostics.length ? ` (${r.diagnostics.length} notes)` : ''}`, 'good');
  };
  return (
    <div className="screen single">
      <div className="panel">
        <h3>Settings</h3>
        <label className="param-edit">Motion
          <select value={g.settings.reducedMotion} onChange={(e) => s.mutate((x) => { x.settings.reducedMotion = e.target.value as 'system'; })}>
            <option value="system">Follow system setting</option><option value="on">Reduce motion</option><option value="off">Full animation</option>
          </select>
        </label>
        <label className="param-edit">Default training speed
          <select value={g.settings.trainSpeed} onChange={(e) => s.mutate((x) => { x.settings.trainSpeed = e.target.value as 'normal'; })}>
            <option value="watch">Watch (slow, ~30–60 s)</option><option value="normal">Normal</option><option value="fast">Fast (as fast as your CPU allows)</option>
          </select>
        </label>
      </div>
      <SoundSettings />
      <div className="panel">
        <h3>Field Guide</h3>
        <p className="small">Lessons on how to set up training that works — replay any of them, any time.</p>
        <div className="row gap">
          <button className="btn" onClick={() => s.setUi({ screen: 'guide' })}>Open the Guide</button>
          <button className="btn ghost" onClick={() => { s.mutate((x) => startChapter(x, 'first')); s.setUi({ screen: 'teach' }); }}>Replay the first lesson</button>
        </div>
      </div>
      <div className="panel">
        <h3>Your save</h3>
        <p className="small muted">Everything lives on this device (IndexedDB). No accounts, no servers, no analytics. Auto-saves every few seconds and after lessons.</p>
        {s.ui.loadDiagnostics.length > 0 && <ul className="small">{s.ui.loadDiagnostics.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        <div className="row gap wrap">
          <button className="btn" onClick={exportSave}>Export JSON</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSave(f); e.target.value = ''; }} />
          <button className="btn danger" onClick={() => s.setUi({ modal: 'confirm-reset' })}>Reset game…</button>
        </div>
      </div>
      <div className="panel">
        <h3>About the learning</h3>
        <p className="small">Pets learn with tabular Double Q-learning, run in a Web Worker on your CPU. Movement skills use a compact view (direction and distance to the target, nearby walls and hazards, last heading) so they work on layouts they’ve never seen. Fetch is a small learned controller that calls your saved movement skill. Auto mode uses either simple rules or a tiny bandit that learns which job pays off in which situation. No language models, nothing online.</p>
      </div>
    </div>
  );
}

export async function resetGame() {
  await clearLocal();
  store.load(newGame());
  store.setUi({ modal: 'adopt', screen: 'farm' });
}

function SoundSettings() {
  const s = useStore();
  const g = s.state;
  const a = g.settings.audio;
  const set = (patch: Partial<AudioSettings>, test?: Parameters<typeof audio.play>[0]) => {
    s.mutate((x) => { x.settings.audio = { ...x.settings.audio, ...patch }; });
    audio.configure(store.state.settings.sound, store.state.settings.audio);
    if (test) audio.play(test);
  };
  const slider = (k: 'master' | 'effects' | 'ui', label: string, help: string, test: Parameters<typeof audio.play>[0]) => (
    <label className="trait">
      <span><b>{label}</b> <span className="num">{Math.round(a[k] * 100)}%</span></span>
      <input type="range" min={0} max={1} step={0.05} value={a[k]} disabled={!g.settings.sound} aria-label={`${label} volume`}
        onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<AudioSettings>)}
        onPointerUp={() => audio.play(test)} onKeyUp={() => audio.play(test)} />
      <span className="small muted">{help}</span>
    </label>
  );
  return (
    <div className="panel" data-tut="sound-settings">
      <h3>Sound</h3>
      <div className="row gap wrap">
        <button className={`btn ${g.settings.sound ? '' : 'primary'}`} aria-pressed={g.settings.sound} onClick={toggleSound}>{g.settings.sound ? '🔈 Sound on' : '🔇 Sound off'}</button>
        <span className="small muted">Mute any time with 🔈 at the top or the <kbd>M</kbd> key. Every sound repeats something you can see, so nothing is lost on mute.</span>
      </div>
      {slider('master', 'Master', 'Everything at once.', 'farm.coin')}
      {slider('effects', 'Farm and pen', 'Pickups, coins, splashes, bumps.', 'farm.splash')}
      {slider('ui', 'Cards and jingles', 'Cards snapping, training results, unlocks.', 'train.certified')}
      <label className="small"><input type="checkbox" checked={a.offScreen} disabled={!g.settings.sound} onChange={(e) => set({ offScreen: e.target.checked })} /> Farm sounds on other screens (quieter)</label>
      <p className="small muted">All sounds are made on your device as you play; nothing is downloaded. Background sounds and music are coming in a later update.</p>
    </div>
  );
}
