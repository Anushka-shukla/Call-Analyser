import Link from 'next/link';

export function Tile({ label, value, sub, tag, trend }: {
  label: string; value: React.ReactNode; sub?: string; tag?: string; trend?: 'up' | 'down';
}) {
  return (
    <div className="tile">
      {tag && <span className="tag">{tag}</span>}
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className={`sub${trend ? ' ' + trend : ''}`}>{sub}</div>}
    </div>
  );
}

export function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'yellow' | 'good' | 'neutral' | 'bad' | 'muted' }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function OutcomePill({ outcome }: { outcome?: string | null }) {
  if (!outcome) return <Pill>Not analysed</Pill>;
  const tone = outcome === 'good' ? 'good' : outcome === 'bad' ? 'bad' : 'neutral';
  return <Pill tone={tone}>{outcome[0].toUpperCase() + outcome.slice(1)}</Pill>;
}

export type BarRow = { label: string; value: number; bad?: number; href?: string };

// Green bar = total, red overlay = bad calls within it (when given).
export function Bars({ rows, empty = 'No calls yet' }: { rows: BarRow[]; empty?: string }) {
  if (rows.length === 0) return <p className="small">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <div className="bar-label" title={r.label}>{r.href ? <Link href={r.href}>{r.label}</Link> : r.label}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(100 * r.value) / max}%` }} />
            {r.bad ? <div className="bar-fill bad" style={{ width: `${(100 * r.bad) / max}%` }} /> : null}
          </div>
          <div className="bar-num">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 320, height = 64, label }: { values: (number | null)[]; width?: number; height?: number; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null) as { v: number; i: number }[];
  if (pts.length < 2) return <p className="small">Not enough days yet</p>;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / (values.length - 1)) * (width - 8) + 4;
  const y = (v: number) => height - 6 - ((v - min) / (max - min || 1)) * (height - 12);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ maxWidth: width }}>
      <path d={d} fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="4" fill="var(--green)" />
    </svg>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function RangeFilter({ from, to, action }: { from: string; to: string; action: string }) {
  return (
    <form className="filters" action={action} method="get">
      <label>From<input type="date" name="from" defaultValue={from} /></label>
      <label>To<input type="date" name="to" defaultValue={to} /></label>
      <button className="btn" type="submit">Show</button>
    </form>
  );
}

export function DayFilter({ date, action }: { date: string; action: string }) {
  return (
    <form className="filters" action={action} method="get">
      <label>Day<input type="date" name="date" defaultValue={date} /></label>
      <button className="btn" type="submit">Show</button>
    </form>
  );
}

export function pct(n: number | null | undefined) {
  return n === null || n === undefined ? '-' : `${n}%`;
}

export function signed(n: number | null | undefined) {
  if (n === null || n === undefined) return '-';
  return `${n > 0 ? '+' : ''}${n}%`;
}
