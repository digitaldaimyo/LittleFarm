import type { GameState } from '../game/types';
import { parseAcademySave, serializeGame } from './save';

/** Local-only storage: IndexedDB with a localStorage fallback. Nothing leaves the device. */
const DB = 'pen-deck';
const STORE = 'saves';
// Academy edition (Academy roadmap): a fresh slot, so a farm-edition save is left alone and never loaded.
const KEY = 'academy1';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveLocal(g: GameState): Promise<void> {
  g.updatedAt = Date.now();
  const text = serializeGame(g);
  const db = await openDb();
  if (db) {
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(text, KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    db.close();
    return;
  }
  try { localStorage.setItem(`${DB}:${KEY}`, text); } catch { /* storage full or blocked */ }
}

export async function loadLocal(): Promise<{ game: GameState | null; diagnostics: string[] }> {
  let text: string | null = null;
  const db = await openDb();
  if (db) {
    text = await new Promise<string | null>((res) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => res(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => res(null);
    });
    db.close();
  }
  if (!text) {
    try { text = localStorage.getItem(`${DB}:${KEY}`); } catch { text = null; }
  }
  if (!text) return { game: null, diagnostics: [] };
  const r = parseAcademySave(text);
  return { game: r.ok ? r.game! : null, diagnostics: r.diagnostics };
}

export async function clearLocal(): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    db.close();
  }
  try { localStorage.removeItem(`${DB}:${KEY}`); } catch { /* ignore */ }
}
