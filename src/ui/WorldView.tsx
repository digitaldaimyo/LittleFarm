import type { World } from '../sim/world';
import type { PaletteId } from '../game/types';
import { ObjectGlyph, PetSprite, type PetMood } from './art';
import type { FxItem } from './store';
import { OBJECT_BY_ID } from '../domain/packs/farm';

const C = 40;

export interface WorldViewProps {
  world: World;
  palette: PaletteId | null;
  mood?: PetMood;
  label: string;
  onTile?: (x: number, y: number) => void;
  tileLabel?: (x: number, y: number) => string;
  /** Object ids drawn as "random each try" ghosts. */
  ghostIds?: Set<number>;
  trail?: { x: number; y: number }[];
  fx?: FxItem[];
  highlight?: { x: number; y: number } | null;
  className?: string;
  ground?: 'pen' | 'farm';
  /** 0 = full day, 1 = deep night. */
  darkness?: number;
  /** Probe overlay: the policy's choice on each tile. */
  arrows?: { x: number; y: number; action: string; confidence: number; guessed: boolean }[];
  /** A second pet on duty. */
  palette2?: PaletteId | null;
}

const ARROW_ROT: Record<string, number> = { N: 0, E: 90, S: 180, W: 270 };

export function WorldView({ world, palette, mood = 'idle', label, onTile, tileLabel, ghostIds, trail, fx, highlight, className, ground = 'pen', darkness, arrows, palette2 }: WorldViewProps) {
  const dark = darkness ?? (world.night ? 1 : 0);
  const W = world.w * C, H = world.h * C;
  const tiles = [];
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const alt = (x + y) % 2 === 0;
      tiles.push(
        <rect key={`t${x},${y}`} x={x * C + 1} y={y * C + 1} width={C - 2} height={C - 2} rx="6"
          className={`tile ${ground} ${alt ? 'alt' : ''}`}
          {...(onTile ? {
            role: 'button', tabIndex: 0, 'aria-label': tileLabel?.(x, y) ?? `Tile ${x},${y}`,
            onClick: () => onTile(x, y),
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTile(x, y); } },
          } : {})}
        />,
      );
    }
  }
  const carried = world.pet.carrying !== null ? world.objects.find((o) => o.id === world.pet.carrying) : null;
  const order = (k: string) => (k === 'bush' || k === 'patch' || k === 'pond' ? 0 : 1);
  const all = world.objects.filter((o) => !o.carried && !o.delivered).sort((a, b) => order(a.kind) - order(b.kind));
  const objs = all.filter((o) => o.kind !== 'firefly');
  const glows = all.filter((o) => o.kind === 'firefly');
  return (
    <svg className={`world ${className ?? ''}`} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
      {tiles}
      {(world.areas ?? []).map((a) => (
        <g key={`area-${a.name}`} pointerEvents="none" className="area">
          <rect x={a.x * C + 2} y={a.y * C + 2} width={a.w * C - 4} height={a.h * C - 4} rx="8" className="area-rect" />
          <text x={a.x * C + 6} y={a.y * C + 13} className="area-label">{a.name}</text>
        </g>
      ))}
      {highlight && <rect x={highlight.x * C + 2} y={highlight.y * C + 2} width={C - 4} height={C - 4} rx="6" className="tile-hl" />}
      {trail && trail.length > 1 && (
        <polyline className="trail" points={trail.map((p) => `${p.x * C + C / 2},${p.y * C + C / 2}`).join(' ')} />
      )}
      {objs.map((o) => (
        <g key={o.id} transform={`translate(${o.x * C} ${o.y * C})`} className={ghostIds?.has(o.id) ? 'ghost' : 'obj'} pointerEvents="none">
          <g transform={o.kind === 'pond' ? undefined : 'translate(4 4) scale(0.8)'}><ObjectGlyph kind={o.kind === 'gate' && o.open ? 'gate-open' : o.kind} /></g>
          {ghostIds?.has(o.id) && <rect x="2" y="2" width={C - 4} height={C - 4} rx="7" className="ghost-ring" />}
          {o.wet && <g aria-hidden="true"><rect x="3" y="3" width={C - 6} height={C - 6} rx="7" className="wet-ring" /><path d="M31 5 q3 5 0 7 q-3 -2 0 -7z" className="drop" /></g>}
        </g>
      ))}
      {palette2 && world.pet2 && (
        <g className="pet-pos" style={{ transform: `translate(${world.pet2.x * C}px, ${world.pet2.y * C}px)` }} pointerEvents="none">
          <g transform="translate(0 -2)"><PetSprite palette={palette2} mood="move" size={C} carrying={world.pet2.carrying !== null ? world.objects.find((o) => o.id === world.pet2!.carrying)?.kind ?? null : null} /></g>
        </g>
      )}
      {arrows?.map((a) => (
        <g key={`ar${a.x},${a.y}`} transform={`translate(${a.x * C + C / 2} ${a.y * C + C / 2})`} pointerEvents="none" aria-hidden="true">
          {a.action in ARROW_ROT ? (
            <path d="M0 -12 L7 0 L2.5 0 L2.5 10 L-2.5 10 L-2.5 0 L-7 0 Z" transform={`rotate(${ARROW_ROT[a.action]}) scale(${0.45 + 0.55 * a.confidence})`} className={`probe-arrow ${a.guessed ? 'guessed' : ''}`} />
          ) : (
            <circle r={4 + 6 * a.confidence} className={`probe-arrow ${a.guessed ? 'guessed' : ''}`} />
          )}
        </g>
      ))}
      {palette && (
        <g className="pet-pos" style={{ transform: `translate(${world.pet.x * C}px, ${world.pet.y * C}px)` }} pointerEvents="none">
          <g transform="translate(0 -2)"><PetSprite palette={palette} mood={carried ? (mood === 'idle' ? 'carry' : mood) : mood} size={C} carrying={carried?.kind ?? null} /></g>
          {(world.pet.water ?? 0) > 0 && (
            <g aria-hidden="true" transform="translate(2 22)">
              {Array.from({ length: world.pet.water ?? 0 }, (_, i) => <path key={i} transform={`translate(${i * 5} 0)`} d="M3 0 q3 5 0 7 q-3 -2 0 -7z" className="drop" />)}
            </g>
          )}
        </g>
      )}
      {world.raining && (
        <g pointerEvents="none" aria-hidden="true">
          <defs>
            <pattern id="rain" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M4 0 l-4 12 M16 8 l-4 12 M22 -4 l-4 12" stroke="#5B8FC4" strokeWidth="1.5" opacity="0.55" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill="rgba(70, 100, 140, 0.12)" />
          <rect x="0" y="0" width={W} height={H} fill="url(#rain)" className="rain" />
        </g>
      )}
      {dark > 0 && <rect x="0" y="0" width={W} height={H} className="night" style={{ opacity: 0.5 * dark }} pointerEvents="none" />}
      {glows.map((o) => (
        <g key={o.id} transform={`translate(${o.x * C} ${o.y * C})`} pointerEvents="none">
          <g transform="translate(4 4) scale(0.8)"><ObjectGlyph kind="firefly" /></g>
          {ghostIds?.has(o.id) && <rect x="2" y="2" width={C - 4} height={C - 4} rx="7" className="ghost-ring" />}
        </g>
      ))}
      {objs.filter((o) => o.store).map((o) => {
        // Farm storage: how full it is, and with what.
        const n = o.store!.reduce((a, s) => a + s.n, 0);
        const cap = (OBJECT_BY_ID[o.kind]?.storage?.slots ?? 1) * (OBJECT_BY_ID[o.kind]?.storage?.perSlot ?? 0);
        const top = o.store!.filter((s) => s.n > 0).sort((a, b) => b.n - a.n)[0]?.kind;
        return (
          <g key={`st${o.id}`} transform={`translate(${o.x * C + C - 30} ${o.y * C + 1})`} pointerEvents="none" className={`store-badge ${n >= cap ? 'full' : ''}`} aria-label={`${OBJECT_BY_ID[o.kind]?.name}: ${n} of ${cap}`}>
            <rect width="29" height="13" rx="6.5" />
            {top && <g transform="translate(1 0) scale(0.32)"><ObjectGlyph kind={top} /></g>}
            <text x={top ? 19 : 14.5} y="10" textAnchor="middle">{n}/{cap}</text>
          </g>
        );
      })}
      {fx?.map((f) => (
        <g key={f.id} transform={`translate(${f.x * C + C / 2} ${f.y * C})`} className={`fx fx-${f.type}`} pointerEvents="none">
          {f.type === 'coin' && <g className="fx-coin"><circle cx="-10" cy="-4" r="6" /><text x="-1" y="0">+{f.amount}</text></g>}
          {f.type === 'splash' && <text textAnchor="middle" className="fx-splash">splash!</text>}
          {f.type === 'confused' && <text textAnchor="middle" className="fx-confused">?</text>}
          {f.type === 'drop' && f.text && <text textAnchor="middle" className="fx-water">{f.text === 'filled' ? 'filled up' : 'splash'}</text>}
          {f.text?.startsWith('gate') && <text textAnchor="middle" className="fx-coin">{f.text}</text>}
          {f.text === 'shoo!' && <text textAnchor="middle" className="fx-coin">shoo!</text>}
          {f.text === 'pecked' && <text textAnchor="middle" className="fx-splash" dy="-10">peck!</text>}
        </g>
      ))}
    </svg>
  );
}
