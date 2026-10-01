import Link from 'next/link';
import { DayFilter } from '@/components/ui';
import { ALERT_SPIKE_RATIO, STUCK_DAYS } from '@/lib/config';
import { alerts } from '@/lib/metrics';
import { dayParam, maskNumber, type SP } from '@/lib/params';
import { fmtDay, fmtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function Alerts({ searchParams }: { searchParams: SP }) {
  const day = dayParam(await searchParams);
  const a = await alerts(day);
  const total = a.spikes.length + a.otherLabels.length + a.highChurn.length + a.stuck.length + a.failed.length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p>{fmtDay(day)}. {total === 0 ? 'Nothing needs attention.' : `${total} things need attention.`}</p>
        </div>
        <DayFilter date={day} action="/alerts" />
      </div>

      <section>
        <h2 style={{ marginBottom: 12 }}>Category spikes</h2>
        {a.spikes.length === 0 ? <p className="small">No category is above {ALERT_SPIKE_RATIO}x its 7-day average.</p> : a.spikes.map((s) => (
          <div className="alert" key={s.category}>
            <strong>{s.category}</strong>: {s.n} calls today against a 7-day average of {s.avg7}.
            {s.top_subs[0] ? ` Most common: ${s.top_subs[0].reason}.` : ''}{' '}
            <Link href={`/calls?from=${day}&to=${day}&category=${encodeURIComponent(s.category)}`}>See calls</Link>
          </div>
        ))}
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 12 }}>New topics in Other</h2>
        {a.otherLabels.length === 0 ? <p className="small">No repeating label in the Other bucket this week.</p> : a.otherLabels.map((o) => (
          <div className="alert warn" key={o.label}>
            <strong>{o.label}</strong> came up {o.n} times in 7 days. Consider adding it as a category.
          </div>
        ))}
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 12 }}>High churn risk calls</h2>
        {a.highChurn.length === 0 ? <p className="small">None today.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Time</th><th>Category</th><th>Why</th></tr></thead>
            <tbody>{a.highChurn.map((c) => (
              <tr key={c.call_sid}><td><Link href={`/calls/${c.call_sid}`}>{fmtTime(c.started_at)}</Link></td><td>{c.category}</td><td>{c.bad_reason ?? c.sub_reason}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 12 }}>Stuck after-sales cases</h2>
        {a.stuck.length === 0 ? <p className="small">No case open over {STUCK_DAYS} days.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Case</th><th>Customer</th><th>Product</th><th>Stage</th><th className="num">Days open</th></tr></thead>
            <tbody>{a.stuck.map((c) => (
              <tr key={c.case_id}><td>#{c.case_id}</td><td>{maskNumber(c.customer_number)}</td><td>{c.product ?? '-'}</td><td>{c.latest_stage}</td><td className="num">{c.days_open}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <p style={{ marginTop: 10 }}><Link href="/returns">Open Returns and replacements</Link></p>
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 12 }}>Failed processing, last 7 days</h2>
        {a.failed.length === 0 ? <p className="small">No failed calls.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Time</th><th>Error</th></tr></thead>
            <tbody>{a.failed.map((c) => (
              <tr key={c.call_sid}><td><Link href={`/calls/${c.call_sid}`}>{fmtTime(c.started_at)}</Link></td><td className="small">{c.error}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}
