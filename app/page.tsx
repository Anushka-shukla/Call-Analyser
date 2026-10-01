import Link from 'next/link';
import { Bars, DayFilter, Empty, Pill, Sparkline, Tile, pct, signed } from '@/components/ui';
import { byHour, categoryCards, countBy, dayCounts, directionSplit, getSummary, outcomeStats, trend } from '@/lib/metrics';
import { dayParam, type SP } from '@/lib/params';
import { fmtDay, fmtDuration } from '@/lib/time';
import type { DayBrief } from '@/lib/rollup';

export const dynamic = 'force-dynamic';

export default async function Today({ searchParams }: { searchParams: SP }) {
  const day = dayParam(await searchParams);
  const [counts, o, days, hours, cats, groups, langs, dirs, summary] = await Promise.all([
    dayCounts(day), outcomeStats(day, day), trend(day, 30), byHour(day), categoryCards(day),
    countBy('category_group', day, day), countBy('language', day, day), directionSplit(day), getSummary(day),
  ]);

  const prior = days.slice(-8, -1);
  const avg7 = prior.length ? Math.round(prior.reduce((s, d) => s + d.received, 0) / prior.length) : 0;
  const lastWeek = days.length >= 8 ? days[days.length - 8].received : null;
  const cxSeries = days.map((d) => (d.n ? Math.round((100 * (d.good - d.bad)) / d.n) : null));
  const brief: DayBrief | null = summary?.brief ?? null;
  const answerRate = counts.received ? Math.round((100 * counts.answered) / counts.received) : null;
  const missedShare = counts.received ? counts.missed / counts.received : 0;
  const hourMap = new Map(hours.map((h) => [h.h, h]));
  const hourMax = Math.max(1, ...hours.map((h) => h.answered + h.missed));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p>{fmtDay(day)}. Customer experience from every support call.</p>
        </div>
        <DayFilter date={day} action="/" />
      </div>

      <section className="hero" aria-label="CX score">
        <div className="hero-score">{o.cx === null ? '-' : signed(o.cx)}</div>
        <div>
          <div className="hero-word">CX score</div>
          <div className="hero-line">
            {o.n ? `${o.good} good, ${o.neutral} neutral, ${o.bad} bad out of ${o.n} calls analysed` : 'No calls analysed for this day yet'}
          </div>
          <span className="hero-badge">
            {counts.in_progress ? `${counts.in_progress} calls still processing` : 'All answered calls processed'}
          </span>
        </div>
      </section>

      <div className="brief">
        <div className="brief-icon" aria-hidden>i</div>
        <p className="brief-text">
          {brief?.summary ?? 'The day brief is written at 11:30 PM IST. It shows here once the nightly rollup has run.'}
        </p>
      </div>

      <section className="section">
        <div className="grid grid-4">
          <Tile label="Calls received" value={counts.received} sub={`7-day avg ${avg7}${lastWeek !== null ? `, same day last week ${lastWeek}` : ''}`} />
          <Tile label="Answered" value={counts.answered} sub={`Answer rate ${pct(answerRate)}`} />
          <Tile label="Missed" value={counts.missed} tag={missedShare >= 0.1 ? 'Needs follow-up' : undefined} sub="Busy, no answer or failed" />
          <Tile label="Analysed" value={counts.analysed} sub={`${counts.dropped} dropped under 20s`} />
          <Tile label="Resolution rate" value={pct(o.resolution_rate)} sub={`First-call resolution ${pct(o.fcr_rate)}`} />
          <Tile label="Bad call rate" value={pct(o.bad_rate)} sub={`${o.bad} bad calls`} />
          <Tile label="Repeat callers" value={counts.repeat_callers} tag={counts.repeat_callers ? 'Needs follow-up' : undefined} sub="Called 2+ times in 7 days" />
          <Tile label="Average agent score" value={o.avg_agent ?? '-'} sub="Out of 5" />
          <Tile label="Average call length" value={fmtDuration(counts.avg_duration) || '-'} sub="Answered calls" />
          <Tile label="Unclear transcripts" value={o.poor} sub="Left out of scores" />
          <Tile label="Failed processing" value={counts.failed} tag={counts.failed ? 'Check' : undefined} sub="After 3 attempts" />
        </div>
      </section>

      {brief && (
        <section className="section grid grid-3">
          <div className="card">
            <h3>Top issues</h3>
            <ul className="plain">
              {brief.top_issues.map((t, i) => (
                <li key={i}><strong style={{ color: 'var(--ink)' }}>{t.issue}</strong> ({t.calls} calls). {t.detail}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3>What's new versus last week</h3>
            {brief.whats_new.length ? <ul className="plain">{brief.whats_new.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="small">Nothing stood out.</p>}
          </div>
          <div className="card mint">
            <h3>Calls to listen to</h3>
            <ul className="plain">
              {brief.calls_to_listen.map((c) => (
                <li key={c.call_sid}><Link href={`/calls/${c.call_sid}`}>Open call</Link>. {c.why}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="section grid grid-2">
        <div className="card">
          <h3>CX score, last 30 days</h3>
          <Sparkline values={cxSeries} label="CX score trend" />
          <p className="small" style={{ marginTop: 8 }}>Latest {o.cx === null ? '-' : signed(o.cx)}</p>
        </div>
        <div className="card">
          <h3>Calls received, last 30 days</h3>
          <Sparkline values={days.map((d) => d.received)} label="Calls received trend" />
          <p className="small" style={{ marginTop: 8 }}>{days.reduce((s, d) => s + d.received, 0)} calls in 30 days</p>
        </div>
      </section>

      <section className="section card">
        <h3>Calls by hour</h3>
        {hours.length === 0 ? <p className="small">No calls yet</p> : (
          <>
            <div className="hours" role="img" aria-label="Answered and missed calls by hour">
              {Array.from({ length: 24 }, (_, h) => {
                const r = hourMap.get(h);
                return (
                  <div className="hour" key={h} title={`${h}:00, ${r?.answered ?? 0} answered, ${r?.missed ?? 0} missed`}>
                    <div className="a" style={{ height: `${(100 * (r?.answered ?? 0)) / hourMax}%` }} />
                    <div className="m" style={{ height: `${(100 * (r?.missed ?? 0)) / hourMax}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="hour-labels">{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? h : ''}</span>)}</div>
            <div className="legend"><span><i style={{ background: 'var(--green)' }} />Answered</span><span><i style={{ background: 'var(--yellow-strong)' }} />Missed</span></div>
          </>
        )}
      </section>

      <section className="section grid grid-2">
        <div className="card">
          <h3>Top categories</h3>
          <Bars rows={cats.slice(0, 8).map((c) => ({ label: c.category, value: c.n, bad: c.bad, href: `/calls?from=${day}&to=${day}&category=${encodeURIComponent(c.category)}` }))} />
          <div className="legend"><span><i style={{ background: 'var(--green)' }} />All calls</span><span><i style={{ background: 'var(--red)' }} />Bad calls</span></div>
        </div>
        <div className="card">
          <h3>Category groups</h3>
          <Bars rows={groups.map((g) => ({ label: g.label, value: g.n, bad: g.bad }))} />
        </div>
        <div className="card">
          <h3>Languages</h3>
          <Bars rows={langs.map((l) => ({ label: l.label, value: l.n }))} />
        </div>
        <div className="card">
          <h3>Inbound and outbound</h3>
          <Bars rows={dirs.map((d) => ({ label: d.label, value: d.n }))} />
        </div>
      </section>

      {counts.received === 0 && (
        <section className="section">
          <Empty title="No calls for this day">
            <p>Check the Exotel webhook is set, or backfill with /api/cron/pull-exotel?date={day}.</p>
          </Empty>
        </section>
      )}
    </main>
  );
}
