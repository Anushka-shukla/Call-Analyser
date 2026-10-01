import Link from 'next/link';
import { Empty, OutcomePill, Pill } from '@/components/ui';
import { AS_STAGES } from '@/lib/analysis';
import { callsList, filterOptions } from '@/lib/metrics';
import { maskNumber, rangeParam, str, type SP } from '@/lib/params';
import { fmtDuration, fmtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function Calls({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { from, to } = rangeParam(sp, 1);
  const f = {
    from, to,
    outcome: str(sp.outcome), category: str(sp.category), agent: str(sp.agent), language: str(sp.language),
    churn: str(sp.churn), stage: str(sp.stage), show: str(sp.show),
  };
  const [rows, opts] = await Promise.all([callsList(f), filterOptions()]);

  const select = (name: string, label: string, options: { v: string; t: string }[], value?: string) => (
    <label>{label}
      <select name={name} defaultValue={value ?? ''}>
        <option value="">All</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </label>
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Calls</h1>
          <p>{rows.length} calls{rows.length === 300 ? ' (showing the latest 300)' : ''}.</p>
        </div>
      </div>

      <form className="filters card" action="/calls" method="get" style={{ marginBottom: 20 }}>
        <label>From<input type="date" name="from" defaultValue={from} /></label>
        <label>To<input type="date" name="to" defaultValue={to} /></label>
        {select('outcome', 'Outcome', ['good', 'neutral', 'bad'].map((v) => ({ v, t: v })), f.outcome)}
        {select('category', 'Category', opts.categories.map((v) => ({ v, t: v })), f.category)}
        {select('agent', 'Agent', opts.agents.map((a) => ({ v: a.number, t: a.name ?? a.number })), f.agent)}
        {select('language', 'Language', opts.languages.map((v) => ({ v, t: v })), f.language)}
        {select('churn', 'Churn risk', ['low', 'medium', 'high'].map((v) => ({ v, t: v })), f.churn)}
        {select('stage', 'After-sales stage', AS_STAGES.map((v) => ({ v, t: v })), f.stage)}
        <label>Show
          <select name="show" defaultValue={f.show ?? ''}>
            <option value="">Analysed</option>
            <option value="all">All calls</option>
            <option value="processing">Still processing</option>
            <option value="poor">Unclear transcripts</option>
            <option value="failed">Failed processing</option>
          </select>
        </label>
        <button className="btn" type="submit">Filter</button>
      </form>

      {rows.length === 0 ? <Empty title="No calls match these filters">Widen the dates or clear a filter.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>Customer</th><th>Agent</th><th className="num">Length</th><th>Outcome</th><th>Category</th><th>What happened</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.call_sid}>
                  <td><Link href={`/calls/${r.call_sid}`}>{fmtTime(r.started_at)}</Link></td>
                  <td>{maskNumber(r.customer_number)}</td>
                  <td>{r.agent_name ?? r.agent_number ?? '-'}</td>
                  <td className="num">{fmtDuration(r.duration_s)}</td>
                  <td><OutcomePill outcome={r.outcome} /></td>
                  <td>{r.category ?? <span className="small">{r.status}</span>}</td>
                  <td>{r.sub_reason ?? (r.error ? <span className="small">{r.error}</span> : '')}{r.stage ? <div className="small">Stage: {r.stage}</div> : null}</td>
                  <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {r.is_follow_up && <Pill tone="yellow">Follow-up</Pill>}
                    {r.churn_risk === 'high' && <Pill tone="bad">Churn risk</Pill>}
                    {r.transcript_quality === 'poor' && <Pill>Unclear audio</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
