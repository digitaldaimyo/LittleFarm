import { useRef } from 'react';
import { store, useStore } from './store';
import { parseAcademySave, serializeGame } from '../persistence/save';
import { exportMeasures, measuresSummary } from '../game/measures';
import { newAcademyGame } from '../game/state';
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
    const r = parseAcademySave(await f.text());
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
      {g.academy ? <MeasuresSettings /> : <div className="panel">
        <h3>Field Guide</h3>
        <p className="small">Lessons on how to set up training that works — replay any of them, any time.</p>
        <div className="row gap">
          <button className="btn" onClick={() => s.setUi({ screen: 'guide' })}>Open the Guide</button>
          <button className="btn ghost" onClick={() => { s.mutate((x) => startChapter(x, 'first')); s.setUi({ screen: 'teach' }); }}>Replay the first lesson</button>
        </div>
      </div>}
      <div className="panel">
        <h3>Your save</h3>
        <p className="small muted">Everything lives on this device (IndexedDB). No accounts, no servers, no analytics. Auto-saves every few seconds and after lessons.</p>
        <SaveSize />
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
  store.load(newAcademyGame());
  store.setUi({ modal: 'adopt', screen: 'academy' });
}

/** Playtest measures (Academy phase 2): off by default, local, exported only on request, without names or text. */
function MeasuresSettings() {
  const s = useStore();
  const g = s.state;
  const isOn = g.settings.measures === true;
  const download = () => {
    const blob = new Blob([exportMeasures(g)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pen-deck-measures-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="panel" data-tut="measures">
      <h3>Playtest measures</h3>
      <p className="small">Helps the game get better: how long challenges take, how many training runs, which hints appeared and whether the next run improved. It stays on this device. Nothing is sent anywhere; you can export it to share it yourself. It never includes your pets’ names or anything you typed.</p>
      <label className="small"><input type="checkbox" data-tut="measures-on" checked={isOn} onChange={(e) => s.mutate((x) => { x.settings.measures = e.target.checked; })} /> Record playtest measures</label>
      {(isOn || g.academy?.measures) && (
        <>
          <ul className="small" data-tut="measures-summary">{measuresSummary(g).map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="row gap">
            <button className="btn small" data-tut="measures-export" onClick={download}>Export measures</button>
            <button className="btn ghost small" onClick={() => { if (confirm('Clear the recorded measures?')) s.mutate((x) => { delete x.academy!.measures; }); }}>Clear</button>
          </div>
        </>
      )}
    </div>
  );
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
  const slider = (k: 'master' | 'effects' | 'ui' | 'ambience' | 'music', label: string, help: string, test: Parameters<typeof audio.play>[0]) => (
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
      {slider('ambience', 'Background', 'Birds by day, crickets at night, rain. Full on the farm, softer elsewhere.', 'world.dawn')}
      <label className="small"><input type="checkbox" data-tut="music-on" checked={a.musicOn} disabled={!g.settings.sound} onChange={(e) => set({ musicOn: e.target.checked })} /> Music box (gentle tunes that never repeat; brighter by day, sparser at night, lighter while teaching)</label>
      {a.musicOn && slider('music', 'Music', 'The music box’s volume. It dips under result jingles.', 'pet.chirp')}
      <label className="small"><input type="checkbox" checked={a.trainTicks} disabled={!g.settings.sound} onChange={(e) => set({ trainTicks: e.target.checked })} /> Soft ticks at 25%, 50% and 75% of practice (not at Fast speed)</label>
      <label className="small"><input type="checkbox" checked={a.offScreen} disabled={!g.settings.sound} onChange={(e) => set({ offScreen: e.target.checked })} /> Farm sounds on other screens (quieter)</label>
      <p className="small muted">All sounds are made on your device as you play; nothing is downloaded. Pets chirp in their own voice when they pick something up or finish a job.</p>
    </div>
  );
}

/** How big the save is, and what takes the room (Big-brain skills can be hundreds of KB). */
function SaveSize() {
  const s = useStore();
  const g = s.state;
  const total = serializeGame(g).length;
  const skills = g.pets.flatMap((p) => p.skills.map((k) => ({ name: `${p.name}’s ${k.name}`, n: JSON.stringify(k).length })));
  skills.sort((a, b) => b.n - a.n);
  const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  return (
    <p className="small" data-tut="save-size">Save size: <b>{kb(total)}</b>{skills[0] && skills[0].n > 50 * 1024 ? ` — largest: ${skills.slice(0, 2).map((k) => `${k.name} ${kb(k.n)}`).join(', ')}` : ''}.{total > 4 * 1024 * 1024 ? ' Big-brain skills keep their two newest tables; older revisions keep only their reports.' : ''}</p>
  );
}
