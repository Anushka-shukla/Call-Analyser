import Link from 'next/link';
import { Bars, RangeFilter, Tile } from '@/components/ui';
import { STUCK_DAYS } from '@/lib/config';
import { returnsData } from '@/lib/metrics';
import { maskNumber, rangeParam, type SP } from '@/lib/params';
import { fmtDay, fmtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

function CaseTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) return <p className="small">None right now.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Case</th><th>Customer</th><th>Product</th><th>Request</th><th>Stage</th><th>Timeline promised</th><th className="num">Calls</th><th className="num">Days open</th><th>Latest call</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.case_id}>
              <td>#{r.case_id}{r.order_id ? <div className="small">Order {r.order_id}</div> : null}</td>
              <td>{maskNumber(r.customer_number)}</td>
              <td>{r.product ?? '-'}</td>
              <td>{r.request_type ?? '-'}{r.reason ? <div className="small">{r.reason}</div> : null}</td>
              <td>{r.latest_stage ?? '-'}</td>
              <td>{r.timeline_given ?? '-'}{r.promise_missed ? <div className="small" style={{ color: 'var(--red)' }}>Missed</div> : null}</td>
              <td className="num">{r.call_count}</td>
              <td className="num">{r.days_open}</td>
              <td>{r.call_sids?.length ? <Link href={`/calls/${r.call_sids[r.call_sids.length - 1]}`}>{fmtTime(r.last_call_at)}</Link> : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Returns({ searchParams }: { searchParams: SP }) {
  const { from, to } = rangeParam(await searchParams, 7);
  const d = await returnsData(from, to);
  const total = d.byType.reduce((s, r) => s + r.n, 0);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Returns and replacements</h1>
          <p>{fmtDay(from)} to {fmtDay(to)}. Stages come from what's said on the call, not the order system.</p>
        </div>
        <RangeFilter from={from} to={to} action="/returns" />
      </div>

      <section className="grid grid-4">
        <Tile label="After-sales calls" value={total} sub="Returns, replacements, refunds, exchanges, cancellations" />
        <Tile label="Stuck cases" value={d.stuck.length} tag={d.stuck.length ? 'Needs follow-up' : undefined} sub={`Open over ${STUCK_DAYS} days at pickup, inspection or refund`} />
        <Tile label="Customers calling again" value={d.repeat.length} tag={d.repeat.length ? 'Needs follow-up' : undefined} sub="Open cases with 2+ calls" />
        <Tile label="Promises missed" value={`${d.promises?.missed ?? 0} of ${d.promises?.given ?? 0}`} sub="Timeline given, then a follow-up call" />
      </section>

      <section className="section grid grid-3">
        <div className="card"><h3>By request type</h3><Bars rows={d.byType.map((r) => ({ label: r.label, value: r.n }))} /></div>
        <div className="card"><h3>By reason</h3><Bars rows={d.byReason.map((r) => ({ label: r.label, value: r.n }))} /></div>
        <div className="card"><h3>Why requests were rejected</h3><Bars rows={d.rejections.map((r) => ({ label: r.label, value: r.n }))} empty="No rejections" /></div>
      </section>

      <section className="section">
        <h2>Reasons by product</h2>
        {d.reasonByProduct.length === 0 ? <p className="small">No products named yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product as said on the call</th><th>Reason</th><th className="num">Calls</th></tr></thead>
              <tbody>{d.reasonByProduct.map((r, i) => <tr key={i}><td>{r.product}</td><td>{r.reason ?? '-'}</td><td className="num">{r.n}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section"><h2>Stuck cases</h2><CaseTable rows={d.stuck} /></section>
      <section className="section"><h2>Customers calling again</h2><CaseTable rows={d.repeat} /></section>
    </main>
  );
}
