import { useState } from 'react';
import type { BehaviorSummary } from '../learning/summary';
import { HEAT_N, HEAT_R } from '../learning/summary';

const ACTION_LABEL: Record<string, string> = { N: 'north', E: 'east', S: 'south', W: 'west', wait: 'stay', pick: 'pick up', drop: 'put down', water: 'water', shoo: 'shoo', nudge: 'nudge', plant: 'plant' };

/** "What it actually did" — heatmap around the target, action mix, endings, which rules paid. */
export function BehaviorSummaryView({ s, target, curiosities }: { s: BehaviorSummary; target: string; curiosities?: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...s.heat, 1e-9);
  const C = 14;
  const hv = hover !== null ? { dx: (hover % HEAT_N) - HEAT_R, dy: Math.floor(hover / HEAT_N) - HEAT_R, v: s.heat[hover] } : null;
  const actions = Object.entries(s.actions).sort((a, b) => b[1] - a[1]);
  return (
    <div className="summary">
      <div className="summary-grid">
        <figure className="heat">
          <figcaption className="small"><b>Where it spends time</b>, relative to the {target}</figcaption>
          <svg viewBox={`0 0 ${HEAT_N * C} ${HEAT_N * C}`} role="img" aria-label={`Heatmap: ${Math.round(s.onTargetShare * 100)}% of the time on the ${target}, ${Math.round(s.besideShare * 100)}% right next to it`} onMouseLeave={() => setHover(null)}>
            {s.heat.map((v, i) => (
              <rect key={i} x={(i % HEAT_N) * C + 1} y={Math.floor(i / HEAT_N) * C + 1} width={C - 2} height={C - 2} rx="2"
                className="heat-cell" style={{ fillOpacity: v > 0 ? 0.12 + 0.88 * (v / max) : 0.04 }} onMouseEnter={() => setHover(i)} />
            ))}
            <rect x={HEAT_R * C} y={HEAT_R * C} width={C} height={C} className="heat-centre" />
          </svg>
          <div className="small muted num">{hv ? `${hv.dx === 0 && hv.dy === 0 ? `on the ${target}` : `${Math.abs(hv.dx)} ${hv.dx < 0 ? 'west' : 'east'}, ${Math.abs(hv.dy)} ${hv.dy < 0 ? 'north' : 'south'}`}: ${(hv.v * 100).toFixed(1)}% of steps` : `outlined = the ${target}; darker = more time`}</div>
        </figure>
        <div className="summary-facts">
          <div className="small"><b>How tries ended</b> (n={s.episodes})</div>
          <div className="endings small">
            <span className="chip good">✓ {s.endings.success} done</span>
            <span className="chip">⌛ {s.endings.timeout} ran out of time</span>
            {s.endings.fail > 0 && <span className="chip bad">✗ {s.endings.fail} failed</span>}
          </div>
          <div className="small muted">~{Math.round(s.meanTicks)} steps per try</div>
          <div className="small"><b>What it did</b></div>
          {actions.map(([a, v]) => (
            <div key={a} className="mix-row small"><span>{ACTION_LABEL[a] ?? a}</span><span className="mix-bar"><i style={{ width: `${v * 100}%` }} /></span><span className="num">{Math.round(v * 100)}%</span></div>
          ))}
          {s.rewardShare.length > 0 && <div className="small"><b>Treats came from</b></div>}
          {s.rewardShare.map((r) => (
            <div key={r.label} className="mix-row small"><span>{r.label}</span><span className="mix-bar"><i className="amber" style={{ width: `${r.share * 100}%` }} /></span><span className="num">{Math.round(r.share * 100)}%</span></div>
          ))}
        </div>
      </div>
      {curiosities && curiosities.length > 0 && (
        <div className="diag info small">
          <strong>Curious…</strong>
          {curiosities.map((c, i) => <span key={i}>{c}</span>)}
        </div>
      )}
    </div>
  );
}
