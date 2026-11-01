import { useState } from 'react';

/** Single-series line chart with crosshair tooltip. One measure per chart (no dual axes). */
export function LineChart({ title, points, yMax, yMin = 0, format, unit, tone }: {
  title: string;
  points: { x: number; y: number }[];
  yMax: number;
  yMin?: number;
  format: (y: number) => string;
  unit: string;
  tone: 'leaf' | 'amber';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 300, H = 110, L = 34, R = 8, T = 10, B = 20;
  const xMax = Math.max(1, ...points.map((p) => p.x));
  const span = yMax - yMin || 1;
  const sx = (x: number) => L + ((W - L - R) * x) / xMax;
  const sy = (y: number) => T + (H - T - B) * (1 - (Math.max(yMin, Math.min(yMax, y)) - yMin) / span);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const hp = hover !== null ? points[hover] : points.at(-1);
  const ticks = [yMin, yMin + span / 2, yMax];
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="num">{hp ? `${format(hp.y)} at try ${hp.x}` : '—'}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: latest ${points.length ? format(points.at(-1)!.y) : 'none'}`}
        onMouseMove={(e) => {
          if (!points.length) return;
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const ep = ((x - L) / (W - L - R)) * xMax;
          let best = 0;
          points.forEach((p, i) => { if (Math.abs(p.x - ep) < Math.abs(points[best].x - ep)) best = i; });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={L - 4} y={sy(t) + 3} textAnchor="end" className="axis">{format(t)}</text>
          </g>
        ))}
        <text x={W - R} y={H - 4} textAnchor="end" className="axis">tries ({unit})</text>
        {points.length > 1 && <path d={path} className={`line ${tone}`} />}
        {hp && (
          <g>
            {hover !== null && <line x1={sx(hp.x)} x2={sx(hp.x)} y1={T} y2={H - B} className="cross" />}
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r="4" className={`dot ${tone}`} />
          </g>
        )}
      </svg>
    </figure>
  );
}
