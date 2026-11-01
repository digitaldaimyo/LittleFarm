import { useState } from 'react';
import { useStore } from './store';

export function JournalScreen() {
  const s = useStore();
  const [only, setOnly] = useState<'all' | 'scrapbook'>('all');
  const [petId, setPetId] = useState<string>('all');
  const entries = s.state.journal.filter((j) => (only === 'all' || j.milestone) && (petId === 'all' || j.petId === petId));
  const name = (id: string | null) => s.state.pets.find((p) => p.id === id)?.name;
  return (
    <div className="screen single">
      <div className="panel">
        <div className="row between wrap">
          <h3>Journal</h3>
          <div className="row gap">
            <div className="seg" role="radiogroup" aria-label="Filter">
              <button role="radio" aria-checked={only === 'all'} className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>All notes</button>
              <button role="radio" aria-checked={only === 'scrapbook'} className={only === 'scrapbook' ? 'on' : ''} onClick={() => setOnly('scrapbook')}>Scrapbook</button>
            </div>
            {s.state.pets.length > 1 && <select aria-label="Pet" value={petId} onChange={(e) => setPetId(e.target.value)}><option value="all">All pets</option>{s.state.pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          </div>
        </div>
        <p className="small muted">Written from what actually happened on the farm and in lessons — no made-up feelings.</p>
        {entries.length === 0 && <p className="muted">Nothing here yet.</p>}
        <ol className="journal">
          {entries.map((j) => (
            <li key={j.id} className={j.milestone ? 'milestone' : ''}>
              <time className="small muted">{new Date(j.at).toLocaleString()}{name(j.petId) ? ` · ${name(j.petId)}` : ''}</time>
              <p>{j.milestone && <span aria-label="milestone">★ </span>}{j.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
