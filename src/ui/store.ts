import { useSyncExternalStore } from 'react';
import type { LayoutDraft, LayoutItemId, LayoutPreview } from '../game/layout';
import type { GameState } from '../game/types';
import { newGame } from '../game/state';
import { createRuntime, farmTick, type FarmFx, type FarmRuntime } from '../game/farm';
import { advanceTutorial, chapterById, guide } from '../game/tutorial';
import { saveLocal } from '../persistence/storage';
import { UNLOCKS } from '../game/progression';
import type { TrainingSessionState } from './training';
import type { EpisodeTrace } from '../learning/episodes';
import { audio } from '../audio/engine';

export type Screen = 'farm' | 'teach' | 'pets' | 'journal' | 'settings' | 'guide';
export type Binder = 'environment' | 'rules' | 'pet' | 'curriculum' | 'behaviors' | 'inspect';

export interface SlotRef {
  /** Node id that owns the socket, or '#success' / '#fail' for stage-level slots. */
  parentId: string;
  socket: string;
  /** Index into a many-socket; null = the empty "add" slot. */
  index: number | null;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'warn';
}

export interface FxItem extends FarmFx {
  id: number;
  at: number;
}

export interface UiState {
  screen: Screen;
  binder: Binder;
  slot: SlotRef | null;
  /** Placement card chosen in the Environment binder waiting for a tile tap. */
  placing: string | null;
  placeMode: 'random' | 'fixed';
  /** First corner while painting an area. */
  zoneStart: { x: number; y: number } | null;
  previewSeed: number;
  modal: null | 'adopt' | 'shop' | 'confirm-reset';
  toasts: Toast[];
  fx: FxItem[];
  training: TrainingSessionState | null;
  /** A trace shown in the pen outside of training (e.g. the scripted preflight demo). */
  penReplay: EpisodeTrace | null;
  farmPaused: boolean;
  loadDiagnostics: string[];
  /** Farm layout mode: the draft being edited (the farm pauses while it's open). */
  layout: LayoutUi | null;
}

export interface LayoutUi {
  draft: LayoutDraft;
  /** 'move' / 'remove', or a catalog item to place. */
  tool: 'move' | 'remove' | LayoutItemId;
  /** Move: the tile picked up, waiting for a destination. */
  pick: { x: number; y: number } | null;
  preview: LayoutPreview | null;
}

class GameStore {
  state: GameState = newGame();
  runtime: FarmRuntime = createRuntime(this.state.farm);
  ui: UiState = {
    screen: 'farm', binder: 'environment', slot: null, placing: null, placeMode: 'random', zoneStart: null, previewSeed: 1,
    modal: null, toasts: [], fx: [], training: null, penReplay: null, farmPaused: false, loadDiagnostics: [], layout: null,
  };
  version = 0;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private farmTimer: ReturnType<typeof setInterval> | null = null;
  private toastId = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  load(g: GameState, diagnostics: string[] = []) {
    this.state = g;
    this.runtime = createRuntime(g.farm);
    this.ui.loadDiagnostics = diagnostics;
    this.ui.training = null;
    this.ui.slot = null;
    advanceTutorial(g);
    this.emit();
  }

  /** Mutate game state, re-check tutorial, notify, and schedule an autosave. */
  mutate(fn: (s: GameState) => void, opts: { save?: boolean } = {}) {
    const g0 = guide(this.state);
    const before = `${g0.active}:${g0.step}`;
    const offered0 = new Set(Object.entries(g0.status).filter(([, v]) => v === 'offered').map(([k]) => k));
    const unlocks0 = this.state.progress.unlocks.length;
    const done0 = { status: { ...g0.status } };
    fn(this.state);
    if (this.state.progress.unlocks.length > unlocks0) audio.play('ui.unlock');
    advanceTutorial(this.state);
    const g1 = guide(this.state);
    if (g1.active && `${g1.active}:${g1.step}` !== before && before.startsWith(`${g1.active}:`)) { this.toast('Nice — next step.', 'good'); audio.play('guide.step'); }
    for (const [k, v] of Object.entries(g1.status)) if (v === 'offered' && !offered0.has(k) && g0.status[k] !== 'active') { this.toast(`New Field Guide lesson: ${chapterById(k)?.title ?? k}`, 'info'); audio.play('guide.offer'); }
    if (Object.entries(g1.status).some(([k, v]) => v === 'done' && done0.status[k] !== 'done')) audio.play('guide.done');
    if (opts.save !== false) this.scheduleSave();
    this.emit();
  }

  setUi(patch: Partial<UiState>) {
    Object.assign(this.ui, patch);
    this.emit();
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    if (this.ui.toasts.some((t) => t.text === text)) return;
    const id = ++this.toastId;
    this.ui.toasts = [...this.ui.toasts.slice(-3), { id, text, kind }];
    setTimeout(() => {
      this.ui.toasts = this.ui.toasts.filter((t) => t.id !== id);
      this.emit();
    }, 4200);
    this.emit();
  }

  scheduleSave(delay = 1200) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), delay);
  }

  async saveNow() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await saveLocal(this.state);
  }

  startFarm() {
    if (this.farmTimer) clearInterval(this.farmTimer);
    let acc = 0;
    let saveAcc = 0;
    let last = performance.now();
    this.farmTimer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1000, now - last);
      last = now;
      const w = this.state.farm.world;
      audio.setScene({ night: !!w.night, raining: !!w.raining, onFarm: this.ui.screen === 'farm' });
      if (this.ui.farmPaused || this.ui.layout) return;
      acc += dt * this.state.settings.farmSpeed;
      const tickMs = 280;
      let changed = false;
      while (acc >= tickMs) {
        acc -= tickMs;
        const done0 = (this.state.farm.requests ?? []).filter((x) => x.status === 'done').length;
        const r = farmTick(this.state, this.runtime);
        if ((this.state.farm.requests ?? []).filter((x) => x.status === 'done').length > done0) audio.play('ui.request');
        changed = true;
        for (const f of r.fx) this.ui.fx.push({ ...f, id: ++this.toastId, at: now });
        audio.playFarm(r.fx, this.state.farm.world.w, this.state.settings.farmSpeed, this.ui.screen === 'farm');
        for (const u of r.unlocked) this.toast(`Unlocked: ${UNLOCKS.find((x) => x.id === u)?.label ?? u}!`, 'good');
        if (r.unlocked.length) audio.play('ui.unlock');
      }
      if (changed) {
        this.ui.fx = this.ui.fx.filter((f) => now - f.at < 1400);
        advanceTutorial(this.state);
        saveAcc += dt;
        if (saveAcc > 10000) { saveAcc = 0; this.scheduleSave(0); }
        this.emit();
      }
    }, 70);
  }
}

export const store = new GameStore();

export function useStore(): GameStore {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
