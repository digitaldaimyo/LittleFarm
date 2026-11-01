import { useEffect, useMemo, useState } from 'react';
import type { EpisodeTrace } from '../learning/episodes';
import { cloneWorld, step, type SimEvent, type World } from '../sim/world';
import { audio } from '../audio/engine';

/** Rebuild every frame of a trace by re-simulating its actions (the sim is deterministic), with each frame's events. */
export function traceFrames(t: EpisodeTrace): { worlds: World[]; events: SimEvent[][] } {
  const w = cloneWorld(t.initial);
  const worlds = [cloneWorld(w)];
  const events: SimEvent[][] = [[]];
  for (const f of t.frames) {
    events.push(step(w, f.a));
    worlds.push(cloneWorld(w));
  }
  return { worlds, events };
}

export function traceWorlds(t: EpisodeTrace): World[] {
  return traceFrames(t).worlds;
}

/** `sound`: play each frame's events as it is shown (replays the player watches, not training samples). */
export function useReplay(trace: EpisodeTrace | null, msPerFrame: number, sound = false) {
  const { worlds, events } = useMemo(() => (trace ? traceFrames(trace) : { worlds: [], events: [] }), [trace]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => { setI(0); setPlaying(true); }, [trace]);
  useEffect(() => {
    if (sound && playing && i > 0 && events[i]) audio.playReplay(events[i], worlds[i]?.w ?? 8);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing || worlds.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1 >= worlds.length ? (setPlaying(false), x) : x + 1)), msPerFrame);
    return () => clearInterval(id);
  }, [playing, worlds, msPerFrame]);
  return {
    world: worlds[Math.min(i, worlds.length - 1)] ?? null,
    frame: i,
    frames: worlds.length - 1,
    trail: worlds.slice(0, i + 1).map((w) => ({ x: w.pet.x, y: w.pet.y })),
    playing,
    play: () => { if (i >= worlds.length - 1) setI(0); setPlaying(true); },
    pause: () => setPlaying(false),
    seek: (n: number) => { setPlaying(false); setI(Math.max(0, Math.min(worlds.length - 1, n))); },
  };
}
