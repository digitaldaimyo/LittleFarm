import { audio } from '../audio/engine';
import { useState } from 'react';
import { store, useStore } from './store';
import { PetSprite } from './art';
import { NAME_SUGGESTIONS, PALETTES, adoptPet } from '../game/pets';
import { SHOP, buy, canBuy } from '../game/progression';
import type { PaletteId } from '../game/types';
import { resetGame } from './SettingsScreen';

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }}>
        <div className="row between"><h2>{title}</h2>{onClose && <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}</div>
        {children}
      </div>
    </div>
  );
}

export function AdoptModal({ paid }: { paid?: boolean }) {
  const s = useStore();
  const used = new Set(s.state.pets.map((p) => p.name));
  const [name, setName] = useState(NAME_SUGGESTIONS.find((n) => !used.has(n)) ?? 'Pip');
  const [pal, setPal] = useState<PaletteId>(s.state.pets.length ? 'plum' : 'meadow');
  const first = s.state.pets.length === 0;
  const done = () => {
    store.mutate((g) => {
      if (paid) { if (!buy(g, 'adopt').ok) return; }
      adoptPet(g, name, pal);
    });
    audio.unlock(); // the first click of a new game is a user gesture: sound can start here
    audio.play('pet.adopt');
    store.setUi({ modal: null });
    void store.saveNow();
  };
  return (
    <Dialog title={first ? 'Welcome to Pen Deck' : 'Adopt another pet'} onClose={first ? undefined : () => store.setUi({ modal: null })}>
      {first && <p>You run a little farm. Your pet can learn real skills in the training pen — then put them to work. Let’s meet your first trainee.</p>}
      <div className="adopt">
        <PetSprite palette={pal} size={96} mood="celebrate" />
        <div className="grow">
          <label className="param-edit">Name <input autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></label>
          <div className="row gap wrap">{NAME_SUGGESTIONS.filter((n) => !used.has(n)).slice(0, 5).map((n) => <button key={n} className="chip-btn" onClick={() => setName(n)}>{n}</button>)}</div>
          <div className="seg" role="radiogroup" aria-label="Colours">
            {PALETTES.map((p) => <button key={p.id} role="radio" aria-checked={pal === p.id} className={pal === p.id ? 'on' : ''} onClick={() => setPal(p.id)}><span className="swatch" style={{ background: p.body }} /> {p.label}</button>)}
          </div>
        </div>
      </div>
      <div className="row gap end">
        <button className="btn primary" disabled={!name.trim()} onClick={done}>{paid ? 'Adopt (20 coins)' : `Adopt ${name || ''}`}</button>
      </div>
    </Dialog>
  );
}

export function ShopModal() {
  const s = useStore();
  const [adopting, setAdopting] = useState(false);
  if (adopting) return <AdoptModal paid />;
  return (
    <Dialog title="Farm shop" onClose={() => store.setUi({ modal: null })}>
      <p className="small">You have <b>{s.state.resources.coins}</b> coins.</p>
      <ul className="shop">
        {SHOP.map((it) => {
          const c = canBuy(s.state, it.id);
          const owned = !it.consumable && s.state.purchases.includes(it.id);
          return (
            <li key={it.id}>
              <div><strong>{it.label}</strong><div className="small muted">{it.describe}</div></div>
              <button className="btn" disabled={!c.ok} title={c.ok ? undefined : c.reason} onClick={() => {
                if (it.id === 'adopt') return setAdopting(true);
                store.mutate((g) => { const r = buy(g, it.id); if (r.ok) { audio.play('ui.shop'); store.toast(`Bought ${it.label}!`, 'good'); } else audio.play('card.reject'); });
              }}>{owned ? 'Owned' : `${it.price} coins`}</button>
              {!c.ok && !owned && <span className="small muted">{c.reason}</span>}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

export function ConfirmReset() {
  return (
    <Dialog title="Reset everything?" onClose={() => store.setUi({ modal: null })}>
      <p>This deletes your farm, pets, skills and lessons from this device. Export a save first if you might want them back.</p>
      <div className="row gap end">
        <button className="btn" onClick={() => store.setUi({ modal: null })}>Keep playing</button>
        <button className="btn danger" onClick={() => void resetGame()}>Yes, reset</button>
      </div>
    </Dialog>
  );
}
