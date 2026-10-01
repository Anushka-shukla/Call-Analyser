import type Anthropic from '@anthropic-ai/sdk';
import { q } from './db';
import { TZ } from './config';
import { callTool } from './claude';
import { categoryCards, countBy, dayCounts, outcomeStats } from './metrics';

export type DayBrief = {
  summary: string;
  top_issues: { issue: string; calls: number; detail: string }[];
  whats_new: string[];
  calls_to_listen: { call_sid: string; why: string }[];
};

const briefTool: Anthropic.Tool = {
  name: 'record_day_brief',
  description: 'Record the daily customer experience brief.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '2 or 3 plain sentences on how the day went.' },
      top_issues: {
        type: 'array', maxItems: 3,
        items: {
          type: 'object',
          properties: { issue: { type: 'string' }, calls: { type: 'integer' }, detail: { type: 'string' } },
          required: ['issue', 'calls', 'detail'],
        },
      },
      whats_new: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'What changed compared with the last 7 days.' },
      calls_to_listen: {
        type: 'array', maxItems: 3,
        items: { type: 'object', properties: { call_sid: { type: 'string' }, why: { type: 'string' } }, required: ['call_sid', 'why'] },
      },
    },
    required: ['summary', 'top_issues', 'whats_new', 'calls_to_listen'],
  },
};

export async function buildDailySummary(day: string) {
  const [counts, outcomes, categories, groups, causes, languages] = await Promise.all([
    dayCounts(day), outcomeStats(day, day), categoryCards(day),
    countBy('category_group', day, day), countBy('root_cause', day, day), countBy('language', day, day),
  ]);
  const data = { counts, outcomes, categories, groups, causes, languages };

  const calls = await q<any>(
    `SELECT c.call_sid, a.outcome, a.category, a.sub_reason, a.root_cause, a.churn_risk, a.bad_reason,
            a.key_pointers->>0 AS p1, a.key_pointers->>1 AS p2
     FROM call_analysis a JOIN calls c USING (call_sid)
     WHERE (c.started_at AT TIME ZONE '${TZ}')::date = $1::date AND a.transcript_quality IS DISTINCT FROM 'poor'
     ORDER BY (a.outcome = 'bad') DESC, (a.churn_risk = 'high') DESC, c.started_at
     LIMIT 150`,
    [day],
  );

  let brief: DayBrief | null = null;
  if (calls.length > 0) {
    const catLines = categories
      .map((c) => `${c.category}: ${c.n} calls, ${c.bad} bad, yesterday ${c.prev_n}, 7-day avg ${c.avg7}; top reasons: ${c.top_subs.map((s) => `${s.reason} (${s.n})`).join('; ')}`)
      .join('\n');
    const callLines = calls
      .map((c) => `${c.call_sid} | ${c.outcome} | ${c.category} | ${c.sub_reason ?? ''} | churn ${c.churn_risk} | ${c.bad_reason ?? ''} | ${c.p1 ?? ''} ${c.p2 ?? ''}`)
      .join('\n');

    try {
    brief = await callTool<DayBrief>({
      system: `You write the daily customer experience brief for a support team at this business: ${process.env.BUSINESS_CONTEXT || 'an online store selling building materials in India'}. Plain everyday language. Be specific: name products, amounts and reasons from the data. Don't pad.`,
      user: `Day: ${day}
Calls received ${counts.received}, answered ${counts.answered}, missed ${counts.missed}, analysed ${counts.analysed}.
Good ${outcomes.good}, neutral ${outcomes.neutral}, bad ${outcomes.bad}. CX score ${outcomes.cx}%. Resolution rate ${outcomes.resolution_rate}%.

Categories:
${catLines}

Calls (sid | outcome | category | sub-reason | churn | bad reason | pointers):
${callLines}

Write the brief. calls_to_listen must use call sids from the list above.`,
      tool: briefTool,
      maxTokens: 2000,
    });
    const sids = new Set(calls.map((c) => c.call_sid));
    brief.calls_to_listen = (brief.calls_to_listen ?? []).filter((c) => sids.has(c.call_sid));
    } catch (e) {
      // Save the numbers even if the brief can't be written. The next run retries the brief.
      console.error('Day brief failed', e);
      brief = null;
    }
  }

  await q(
    `INSERT INTO daily_summary (day, data, brief) VALUES ($1::date, $2, $3)
     ON CONFLICT (day) DO UPDATE SET data = EXCLUDED.data, brief = EXCLUDED.brief, created_at = now()`,
    [day, JSON.stringify(data), brief ? JSON.stringify(brief) : null],
  );
  return { day, analysed: calls.length, brief: !!brief };
}
