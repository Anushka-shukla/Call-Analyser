import { Bars, Empty, RangeFilter } from '@/components/ui';
import { ROOT_CAUSE_OWNER } from '@/lib/config';
import { rootCauses } from '@/lib/metrics';
import { rangeParam, type SP } from '@/lib/params';
import { fmtDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function RootCauses({ searchParams }: { searchParams: SP }) {
  const { from, to } = rangeParam(await searchParams, 7);
  const { byCause, products, actions } = await rootCauses(from, to);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Root causes</h1>
          <p>{fmtDay(from)} to {fmtDay(to)}. What's behind the problem calls, and which team owns the fix.</p>
        </div>
        <RangeFilter from={from} to={to} action="/root-causes" />
      </div>

      {byCause.length === 0 ? <Empty title="No problem calls in this range" /> : (
        <>
          <section className="grid grid-2">
            <div className="card">
              <h3>Calls by root cause</h3>
              <Bars rows={byCause.map((r) => ({ label: r.root_cause, value: r.n, bad: r.bad }))} />
              <div className="legend"><span><i style={{ background: 'var(--green)' }} />All calls with a problem</span><span><i style={{ background: 'var(--red)' }} />Bad calls</span></div>
            </div>
            <div className="card">
              <h3>Who owns it</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Root cause</th><th>Team</th><th className="num">Bad calls</th></tr></thead>
                  <tbody>
                    {byCause.map((r) => (
                      <tr key={r.root_cause}><td>{r.root_cause}</td><td>{ROOT_CAUSE_OWNER[r.root_cause] ?? '-'}</td><td className="num">{r.bad}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="section">
            <h2>Products behind bad calls</h2>
            {products.length === 0 ? <p className="small">No products named on bad calls in this range.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Product as said on the call</th><th>Root cause</th><th className="num">Bad calls</th></tr></thead>
                  <tbody>{products.map((p, i) => <tr key={i}><td>{p.product}</td><td>{p.root_cause}</td><td className="num">{p.n}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <h2>What to fix</h2>
            {actions.length === 0 ? <p className="small">No action items yet.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Action</th><th>Root cause</th><th>Team</th><th className="num">Calls</th></tr></thead>
                  <tbody>
                    {actions.map((a, i) => (
                      <tr key={i}><td>{a.item}</td><td>{a.root_cause}</td><td>{ROOT_CAUSE_OWNER[a.root_cause] ?? '-'}</td><td className="num">{a.n}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
