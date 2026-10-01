import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CallPlayer from '@/components/CallPlayer';
import { OutcomePill, Pill } from '@/components/ui';
import { callDetail } from '@/lib/metrics';
import { maskNumber } from '@/lib/params';
import { fmtDuration, fmtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

const AS_LABELS: Record<string, string> = {
  request_type: 'Request', reason: 'Reason', product_mentioned: 'Product', order_id_mentioned: 'Order ID',
  stage: 'Stage', days_waiting: 'Days waiting', is_follow_up: 'Called before', resolution_offered: 'Offered',
  refund_mode: 'Refund to', timeline_given: 'Timeline promised', rejection_reason: 'Rejection reason',
  customer_accepted: 'Customer accepted',
};

export default async function CallPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const d = await callDetail(sid);
  if (!d) notFound();
  const { call: c, analysis: a, segments, caseRow } = d;
  const scores: [string, number | null][] = a ? [
    ['Greeting', a.score_greeting], ['Understood the issue', a.score_understood], ['Clear next step', a.score_next_step],
    ['Empathy', a.score_empathy], ['Hold handling', a.score_hold],
  ] : [];

  return (
    <main className="page">
      <p className="small"><Link href="/calls">All calls</Link></p>
      <div className="page-head">
        <div>
          <h1>{a?.category ?? 'Call'}</h1>
          <p>
            {fmtTime(c.started_at)}. {c.direction?.startsWith('inbound') ? 'Inbound' : 'Outbound'}, {fmtDuration(c.duration_s)}.
            Customer {maskNumber(c.customer_number)}. Agent {c.agent_name ?? c.agent_number ?? 'unknown'}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <OutcomePill outcome={a?.outcome} />
          {a?.churn_risk === 'high' && <Pill tone="bad">High churn risk</Pill>}
          {a?.is_follow_up && <Pill tone="yellow">Follow-up call</Pill>}
          {a?.third_party_on_call && <Pill>Someone else on the call</Pill>}
          {a?.transcript_quality && a.transcript_quality !== 'good' && <Pill>Transcript {a.transcript_quality}</Pill>}
        </div>
      </div>

      {!a && (
        <div className="alert warn" style={{ marginBottom: 20 }}>
          This call is at the <strong>{c.status}</strong> step.{c.error ? ` Last error: ${c.error}` : ''}
        </div>
      )}

      <div className="detail">
        <section aria-label="Recording and transcript">
          <CallPlayer src={c.recording_blob || c.recording_url ? `/api/recording/${c.call_sid}` : null} segments={segments} agentSpeaker={a?.agent_speaker ?? null} />
        </section>

        {a && (
          <aside className="grid" style={{ gap: 16 }}>
            <div className="card mint">
              <h3>What happened</h3>
              <ul className="plain">{(a.key_pointers as string[]).map((p, i) => <li key={i}>{p}</li>)}</ul>
              {(a.customer_quotes as { timestamp: string; quote: string }[]).map((qt, i) => (
                <p className="quote" key={i}>{qt.timestamp}: "{qt.quote}"</p>
              ))}
            </div>
            <div className="card">
              <h3>Summary</h3>
              <dl className="kv">
                <dt>Sub-reason</dt><dd>{a.sub_reason}</dd>
                {a.bad_reason && <><dt>Why bad</dt><dd>{a.bad_reason}</dd></>}
                <dt>Root cause</dt><dd>{a.root_cause}</dd>
                <dt>Resolved</dt><dd>{a.resolved}{a.pending_items ? `. Pending: ${a.pending_items}` : ''}</dd>
                <dt>Mood</dt><dd>{a.sentiment_start} to {a.sentiment_end} out of 5</dd>
                <dt>Language</dt><dd>{a.language}</dd>
                {a.secondary_categories?.length > 0 && <><dt>Also about</dt><dd>{a.secondary_categories.join(', ')}</dd></>}
                {a.suggested_category && <><dt>Suggested label</dt><dd>{a.suggested_category}</dd></>}
              </dl>
            </div>
            <div className="card">
              <h3>Agent scores</h3>
              <dl className="kv">{scores.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v ?? '-'} / 5</dd></Fragment>)}</dl>
            </div>
            {(a.action_items as string[]).length > 0 && (
              <div className="card">
                <h3>What to fix</h3>
                <ul className="plain">{(a.action_items as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {a.after_sales && (
              <div className="card">
                <h3>Return, replacement or refund</h3>
                <dl className="kv">
                  {Object.entries(a.after_sales as Record<string, unknown>).map(([k, v]) => (
                    <Fragment key={k}><dt>{AS_LABELS[k] ?? k}</dt><dd>{typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}</dd></Fragment>
                  ))}
                </dl>
                {caseRow && (
                  <p className="small" style={{ marginTop: 10 }}>
                    Case #{caseRow.case_id}: {caseRow.call_count} calls, latest stage {caseRow.latest_stage ?? 'unknown'}
                    {caseRow.promise_missed ? '. A promised timeline was missed.' : '.'}
                  </p>
                )}
              </div>
            )}
            <p className="small">Analysed by {a.model}, prompt {a.prompt_version}.</p>
          </aside>
        )}
      </div>
    </main>
  );
}