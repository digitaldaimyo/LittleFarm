import { useEffect, useMemo, useState } from 'react';
import type { EpisodeTrace } from '../learning/episodes';
import { cloneWorld, step, type World } from '../sim/world';

/** Rebuild every frame of a trace by re-simulating its actions (the sim is deterministic). */
export function traceWorlds(t: EpisodeTrace): World[] {
  const w = cloneWorld(t.initial);
  const out = [cloneWorld(w)];
  for (const f of t.frames) {
    step(w, f.a);
    out.push(cloneWorld(w));
  }
  return out;
}

export function useReplay(trace: EpisodeTrace | null, msPerFrame: number) {
  const worlds = useMemo(() => (trace ? traceWorlds(trace) : []), [trace]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => { setI(0); setPlaying(true); }, [trace]);
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
