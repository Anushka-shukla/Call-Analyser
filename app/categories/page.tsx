import Link from 'next/link';
import { DayFilter, Empty, Pill } from '@/components/ui';
import { categoryCards } from '@/lib/metrics';
import { dayParam, type SP } from '@/lib/params';
import { fmtDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function Categories({ searchParams }: { searchParams: SP }) {
  const day = dayParam(await searchParams);
  const cards = await categoryCards(day);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p>{fmtDay(day)}. Every analysed call in one bucket, compared with yesterday.</p>
        </div>
        <DayFilter date={day} action="/categories" />
      </div>
      {cards.length === 0 ? <Empty title="No analysed calls for this day" /> : (
        <div className="grid grid-3">
          {cards.map((c) => {
            const change = c.n - c.prev_n;
            const badRate = c.n ? Math.round((100 * c.bad) / c.n) : 0;
            return (
              <div className="card" key={c.category}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                  <h3>{c.category}</h3>
                  {c.category_group && <Pill tone="yellow">{c.category_group}</Pill>}
                </div>
                <div style={{ display: 'flex', gap: 22, margin: '8px 0 12px' }}>
                  <div><div style={{ fontSize: 30, fontWeight: 900, color: 'var(--ink)' }}>{c.n}</div><div className="small">calls</div></div>
                  <div><div style={{ fontSize: 30, fontWeight: 900, color: badRate >= 30 ? 'var(--red)' : 'var(--ink)' }}>{badRate}%</div><div className="small">bad</div></div>
                  <div><div style={{ fontSize: 30, fontWeight: 900, color: change > 0 ? 'var(--red)' : 'var(--green-deep)' }}>{change > 0 ? '+' : ''}{change}</div><div className="small">vs yesterday</div></div>
                </div>
                <p className="small">7-day average {c.avg7} a day</p>
                {c.top_subs.length > 0 && (
                  <ul className="plain" style={{ marginTop: 10 }}>
                    {c.top_subs.map((s) => <li key={s.reason}>{s.reason} ({s.n})</li>)}
                  </ul>
                )}
                <p style={{ marginTop: 12 }}><Link href={`/calls?from=${day}&to=${day}&category=${encodeURIComponent(c.category)}`}>See these calls</Link></p>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
