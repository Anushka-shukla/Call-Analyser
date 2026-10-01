import Link from 'next/link';
import { Empty, RangeFilter } from '@/components/ui';
import { agentsData } from '@/lib/metrics';
import { rangeParam, type SP } from '@/lib/params';
import { fmtDay, fmtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

const cell = (v: number | null) => (v === null ? '-' : v.toFixed(1));

export default async function Agents({ searchParams }: { searchParams: SP }) {
  const { from, to } = rangeParam(await searchParams, 7);
  const { rows, review } = await agentsData(from, to);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p>{fmtDay(from)} to {fmtDay(to)}. Scores are out of 5. Add agent names to the agents table to show them here.</p>
        </div>
        <RangeFilter from={from} to={to} action="/agents" />
      </div>

      {rows.length === 0 ? <Empty title="No analysed calls in this range" /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th><th className="num">Calls</th><th className="num">Bad rate</th><th className="num">Resolved</th>
                <th className="num">Greeting</th><th className="num">Understood</th><th className="num">Next step</th>
                <th className="num">Empathy</th><th className="num">Hold</th><th>Calls to review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mine = review.filter((x) => x.agent_number === r.agent_number);
                return (
                  <tr key={r.agent_number ?? 'unknown'}>
                    <td>
                      {r.agent_number ? <Link href={`/calls?from=${from}&to=${to}&agent=${encodeURIComponent(r.agent_number)}`}>{r.agent_name ?? r.agent_number}</Link> : 'Unknown agent'}
                    </td>
                    <td className="num">{r.calls}</td>
                    <td className="num" style={{ color: r.calls && r.bad / r.calls >= 0.3 ? 'var(--red)' : undefined }}>{r.calls ? Math.round((100 * r.bad) / r.calls) : 0}%</td>
                    <td className="num">{r.calls ? Math.round((100 * r.resolved) / r.calls) : 0}%</td>
                    <td className="num">{cell(r.greeting)}</td>
                    <td className="num">{cell(r.understood)}</td>
                    <td className="num">{cell(r.next_step)}</td>
                    <td className="num">{cell(r.empathy)}</td>
                    <td className="num">{cell(r.hold)}</td>
                    <td>
                      {mine.length === 0 ? <span className="small">None</span> : mine.map((m) => (
                        <div key={m.call_sid}><Link href={`/calls/${m.call_sid}`}>{fmtTime(m.started_at)}</Link> <span className="small">{m.category}</span></div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
