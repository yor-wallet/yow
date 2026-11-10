import { HudCorners } from '@/components/ui/HudCorners';
import { cn } from '@/lib/cn';

/**
 * Lightweight inline-SVG charts (no chart library). Accessible: each chart is an `img` with a
 * label AND a visually hidden data table carrying the exact values. Colours come from DOOM tokens
 * (currentColor / CSS vars) so both themes work; `vector-effect` keeps strokes crisp when scaled.
 */

export type Point = { label: string; value: number; display?: string };

export function ChartFrame({ title, children, className, summary }: { title: string; children: React.ReactNode; className?: string; summary?: React.ReactNode }) {
  return (
    <figure className={cn('glass relative min-w-0 rounded-card p-4 sm:p-5', className)}>
      <HudCorners />
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="hud-label">{title}</span>
        {summary ? <span className="font-display text-sm text-muted">{summary}</span> : null}
      </figcaption>
      {children}
    </figure>
  );
}

function DataTableSr({ caption, points }: { caption: string; points: Point[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {points.map((p) => (
          <tr key={p.label}>
            <th scope="row">{p.label}</th>
            <td>{p.display ?? p.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Vertical bars (e.g. revenue per day). */
export function BarChart({ points, label, height = 160, testId }: { points: Point[]; label: string; height?: number; testId?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = Math.max(points.length, 1);
  const w = 100 / n;
  const step = Math.max(1, Math.ceil(n / 6));
  return (
    <div data-testid={testId}>
      <svg role="img" aria-label={label} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block h-40 w-full text-cyan" focusable="false">
        <defs>
          <linearGradient id="doom-bar" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#087BFF" stopOpacity="0.55" />
            <stop offset="1" stopColor="#00D9FF" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2="100" y1={height * g} y2={height * g} stroke="currentColor" strokeOpacity="0.12" vectorEffect="non-scaling-stroke" />
        ))}
        {points.map((p, i) => {
          const h = (p.value / max) * (height - 4);
          return <rect key={p.label} x={i * w + w * 0.15} width={w * 0.7} y={height - h} height={Math.max(h, p.value > 0 ? 1 : 0)} rx="0.6" fill="url(#doom-bar)" />;
        })}
      </svg>
      <div className="mt-1 flex justify-between gap-1 text-[11px] text-muted" dir="ltr" aria-hidden="true">
        {points.filter((_, i) => i % step === 0).map((p) => (
          <span key={p.label} className="truncate">
            {p.label}
          </span>
        ))}
      </div>
      <DataTableSr caption={label} points={points} />
    </div>
  );
}

/** Horizontal labelled bars (e.g. orders by status). */
export function HBars({ points, label, testId }: { points: (Point & { tone?: 'blue' | 'cyan' | 'orange' | 'amber' | 'success' | 'error' })[]; label: string; testId?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const tones = { blue: 'bg-blue', cyan: 'bg-cyan', orange: 'bg-orange', amber: 'bg-amber', success: 'bg-success', error: 'bg-error' } as const;
  return (
    <ul className="grid gap-2" aria-label={label} data-testid={testId}>
      {points.map((p) => (
        <li key={p.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted">{p.label}</span>
          <span className="h-2 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
            <span className={cn('block h-full rounded-pill', tones[p.tone ?? 'cyan'])} style={{ width: `${(p.value / max) * 100}%` }} />
          </span>
          <span className="font-display tabular-nums">{p.display ?? p.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tiny trend line for tables (CTR per day…). */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const w = 120;
  const h = 32;
  if (values.length === 0) return <span className="text-xs text-muted">—</span>;
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${values.length === 1 ? w / 2 : (i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(' ');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${h}`} className={cn('h-8 w-28 text-cyan', className)} focusable="false">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
