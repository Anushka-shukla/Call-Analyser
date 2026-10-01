import { q, one } from './db';
import { ALERT_MIN_CALLS, ALERT_SPIKE_RATIO, MIN_CALL_SECONDS, STUCK_DAYS, STUCK_STAGES, TZ } from './config';

// Day of a call in IST.
const DAY = `(c.started_at AT TIME ZONE '${TZ}')::date`;
// Calls whose transcripts are good enough to count in scores.
const SCORED = `a.transcript_quality IS DISTINCT FROM 'poor'`;

export type DayCounts = {
  received: number; answered: number; missed: number; dropped: number; analysed: number;
  failed: number; in_progress: number; inbound: number; outbound: number; avg_duration: number | null;
  repeat_callers: number;
};

export async function dayCounts(day: string): Promise<DayCounts> {
  const row = await one<DayCounts>(
    `SELECT
       count(*)::int AS received,
       count(*) FILTER (WHERE lower(exotel_status) = 'completed')::int AS answered,
       count(*) FILTER (WHERE lower(coalesce(exotel_status, '')) <> 'completed')::int AS missed,
       count(*) FILTER (WHERE lower(exotel_status) = 'completed' AND duration_s < $2)::int AS dropped,
       count(*) FILTER (WHERE status = 'analyzed')::int AS analysed,
       count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status IN ('new','audio_saved','stt_pending','transcribed'))::int AS in_progress,
       count(*) FILTER (WHERE direction LIKE 'inbound%')::int AS inbound,
       count(*) FILTER (WHERE direction IS NOT NULL AND direction NOT LIKE 'inbound%')::int AS outbound,
       round(avg(duration_s) FILTER (WHERE lower(exotel_status) = 'completed'))::int AS avg_duration
     FROM calls c WHERE ${DAY} = $1::date`,
    [day, MIN_CALL_SECONDS],
  );
  const rep = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM (
       SELECT customer_number FROM calls c
       WHERE customer_number IS NOT NULL AND ${DAY} BETWEEN $1::date - 6 AND $1::date
       GROUP BY customer_number
       HAVING count(*) >= 2 AND bool_or(${DAY} = $1::date)
     ) t`,
    [day],
  );
  return { ...(row as DayCounts), repeat_callers: rep?.n ?? 0 };
}

export type OutcomeStats = {
  n: number; good: number; neutral: number; bad: number; resolved: number; fcr: number;
  avg_agent: number | null; poor: number; cx: number | null;
  resolution_rate: number | null; fcr_rate: number | null; bad_rate: number | null;
};

export async function outcomeStats(from: string, to: string): Promise<OutcomeStats> {
  const r = await one<any>(
    `SELECT
       count(*) FILTER (WHERE ${SCORED})::int AS n,
       count(*) FILTER (WHERE ${SCORED} AND a.outcome = 'good')::int AS good,
       count(*) FILTER (WHERE ${SCORED} AND a.outcome = 'neutral')::int AS neutral,
       count(*) FILTER (WHERE ${SCORED} AND a.outcome = 'bad')::int AS bad,
       count(*) FILTER (WHERE ${SCORED} AND a.resolved = 'yes')::int AS resolved,
       count(*) FILTER (WHERE ${SCORED} AND a.resolved = 'yes' AND a.is_follow_up IS NOT TRUE)::int AS fcr,
       round(avg((a.score_greeting + a.score_understood + a.score_next_step + a.score_empathy + a.score_hold) / 5.0)
             FILTER (WHERE ${SCORED}), 1)::float AS avg_agent,
       count(*) FILTER (WHERE a.transcript_quality = 'poor')::int AS poor
     FROM call_analysis a JOIN calls c USING (call_sid)
     WHERE ${DAY} BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  const pct = (x: number) => (r.n ? Math.round((100 * x) / r.n) : null);
  return {
    ...r,
    cx: r.n ? Math.round((100 * (r.good - r.bad)) / r.n) : null,
    resolution_rate: pct(r.resolved),
    fcr_rate: pct(r.fcr),
    bad_rate: pct(r.bad),
  };
}

export async function trend(to: string, days: number) {
  return q<{ day: string; received: number; n: number; good: number; bad: number }>(
    `WITH d AS (SELECT generate_series($1::date - ($2::int - 1), $1::date, interval '1 day')::date AS day)
     SELECT d.day::text AS day,
       count(c.call_sid)::int AS received,
       count(a.call_sid) FILTER (WHERE ${SCORED})::int AS n,
       count(a.call_sid) FILTER (WHERE ${SCORED} AND a.outcome = 'good')::int AS good,
       count(a.call_sid) FILTER (WHERE ${SCORED} AND a.outcome = 'bad')::int AS bad
     FROM d
     LEFT JOIN calls c ON ${DAY} = d.day
     LEFT JOIN call_analysis a ON a.call_sid = c.call_sid
     GROUP BY d.day ORDER BY d.day`,
    [to, days],
  );
}

export async function byHour(day: string) {
  return q<{ h: number; answered: number; missed: number }>(
    `SELECT extract(hour FROM c.started_at AT TIME ZONE '${TZ}')::int AS h,
       count(*) FILTER (WHERE lower(exotel_status) = 'completed')::int AS answered,
       count(*) FILTER (WHERE lower(coalesce(exotel_status, '')) <> 'completed')::int AS missed
     FROM calls c WHERE ${DAY} = $1::date GROUP BY 1 ORDER BY 1`,
    [day],
  );
}

export async function countBy(field: 'category_group' | 'language' | 'root_cause' | 'outcome', from: string, to: string) {
  return q<{ label: string; n: number; bad: number }>(
    `SELECT coalesce(a.${field}, 'Unknown') AS label, count(*)::int AS n,
            count(*) FILTER (WHERE a.outcome = 'bad')::int AS bad
     FROM call_analysis a JOIN calls c USING (call_sid)
     WHERE ${DAY} BETWEEN $1::date AND $2::date
     GROUP BY 1 ORDER BY n DESC`,
    [from, to],
  );
}

export async function directionSplit(day: string) {
  return q<{ label: string; n: number }>(
    `SELECT CASE WHEN direction LIKE 'inbound%' THEN 'Inbound' ELSE 'Outbound' END AS label, count(*)::int AS n
     FROM calls c WHERE ${DAY} = $1::date AND direction IS NOT NULL GROUP BY 1 ORDER BY 1`,
    [day],
  );
}

export type CategoryCard = {
  category: string; category_group: string | null; n: number; bad: number; prev_n: number; avg7: number;
  top_subs: { reason: string; n: number }[];
};

export async function categoryCards(day: string): Promise<CategoryCard[]> {
  return q<CategoryCard>(
    `WITH base AS (
       SELECT a.*, ${DAY} AS d FROM call_analysis a JOIN calls c USING (call_sid)
       WHERE ${DAY} BETWEEN $1::date - 7 AND $1::date
     ),
     cur AS (SELECT category, max(category_group) AS category_group, count(*)::int AS n,
                    count(*) FILTER (WHERE outcome = 'bad')::int AS bad
             FROM base WHERE d = $1::date GROUP BY category),
     prev AS (SELECT category, count(*)::int AS n FROM base WHERE d = $1::date - 1 GROUP BY category),
     wk AS (SELECT category, count(*)::float / 7 AS avg7 FROM base WHERE d < $1::date GROUP BY category),
     subs AS (SELECT category, sub_reason, count(*)::int AS n,
                     row_number() OVER (PARTITION BY category ORDER BY count(*) DESC) AS rn
              FROM base WHERE d = $1::date AND sub_reason IS NOT NULL GROUP BY category, sub_reason)
     SELECT cur.category, cur.category_group, cur.n, cur.bad,
            coalesce(prev.n, 0)::int AS prev_n, round(coalesce(wk.avg7, 0)::numeric, 1)::float AS avg7,
            coalesce((SELECT json_agg(json_build_object('reason', s.sub_reason, 'n', s.n) ORDER BY s.n DESC)
                      FROM subs s WHERE s.category = cur.category AND s.rn <= 3), '[]'::json) AS top_subs
     FROM cur LEFT JOIN prev USING (category) LEFT JOIN wk USING (category)
     ORDER BY cur.n DESC`,
    [day],
  );
}

export type CallFilters = {
  from: string; to: string; outcome?: string; category?: string; agent?: string; language?: string;
  churn?: string; stage?: string; show?: string;
};

export async function callsList(f: CallFilters) {
  const where: string[] = [`${DAY} BETWEEN $1::date AND $2::date`];
  const params: unknown[] = [f.from, f.to];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.outcome) add('a.outcome = ?', f.outcome);
  if (f.category) add('a.category = ?', f.category);
  if (f.agent) add('c.agent_number = ?', f.agent);
  if (f.language) add('a.language = ?', f.language);
  if (f.churn) add('a.churn_risk = ?', f.churn);
  if (f.stage) add(`a.after_sales->>'stage' = ?`, f.stage);
  if (f.show === 'failed') where.push(`c.status = 'failed'`);
  else if (f.show === 'poor') where.push(`a.transcript_quality = 'poor'`);
  else if (f.show === 'processing') where.push(`c.status IN ('new','audio_saved','stt_pending','transcribed')`);
  else if (f.show !== 'all') where.push(`c.status = 'analyzed'`);

  return q<any>(
    `SELECT c.call_sid, c.started_at, c.duration_s, c.direction, c.customer_number, c.agent_number,
            ag.name AS agent_name, c.status, c.error, a.outcome, a.category, a.sub_reason, a.churn_risk,
            a.language, a.after_sales->>'stage' AS stage, a.transcript_quality, a.is_follow_up
     FROM calls c
     LEFT JOIN call_analysis a USING (call_sid)
     LEFT JOIN agents ag ON ag.number = c.agent_number
     WHERE ${where.join(' AND ')}
     ORDER BY c.started_at DESC NULLS LAST
     LIMIT 300`,
    params,
  );
}

export async function filterOptions() {
  const [categories, agents, languages] = await Promise.all([
    q<{ name: string }>('SELECT name FROM categories WHERE active ORDER BY id'),
    q<{ number: string; name: string | null }>(
      `SELECT DISTINCT c.agent_number AS number, ag.name FROM calls c LEFT JOIN agents ag ON ag.number = c.agent_number
       WHERE c.agent_number IS NOT NULL ORDER BY 2 NULLS LAST, 1 LIMIT 200`),
    q<{ language: string }>(`SELECT DISTINCT language FROM call_analysis WHERE language IS NOT NULL ORDER BY 1 LIMIT 50`),
  ]);
  return { categories: categories.map((c) => c.name), agents, languages: languages.map((l) => l.language) };
}

export async function callDetail(sid: string) {
  const call = await one<any>(
    `SELECT c.*, ag.name AS agent_name FROM calls c LEFT JOIN agents ag ON ag.number = c.agent_number WHERE c.call_sid = $1`,
    [sid],
  );
  if (!call) return null;
  const [analysis, segments, caseRow] = await Promise.all([
    one<any>('SELECT * FROM call_analysis WHERE call_sid = $1', [sid]),
    q<any>('SELECT * FROM transcript_segments WHERE call_sid = $1 ORDER BY idx', [sid]),
    one<any>('SELECT * FROM after_sales_cases WHERE $1 = ANY(call_sids) LIMIT 1', [sid]),
  ]);
  return { call, analysis, segments, caseRow };
}

export async function rootCauses(from: string, to: string) {
  const range = `${DAY} BETWEEN $1::date AND $2::date`;
  const [byCause, products, actions] = await Promise.all([
    q<{ root_cause: string; n: number; bad: number }>(
      `SELECT coalesce(a.root_cause, 'none') AS root_cause, count(*)::int AS n,
              count(*) FILTER (WHERE a.outcome = 'bad')::int AS bad
       FROM call_analysis a JOIN calls c USING (call_sid)
       WHERE ${range} AND a.root_cause IS DISTINCT FROM 'none'
       GROUP BY 1 ORDER BY bad DESC, n DESC`, [from, to]),
    q<{ product: string; root_cause: string; n: number }>(
      `SELECT lower(trim(a.after_sales->>'product_mentioned')) AS product, a.root_cause, count(*)::int AS n
       FROM call_analysis a JOIN calls c USING (call_sid)
       WHERE ${range} AND a.outcome = 'bad' AND coalesce(a.after_sales->>'product_mentioned', '') <> ''
       GROUP BY 1, 2 ORDER BY n DESC LIMIT 15`, [from, to]),
    q<{ root_cause: string; item: string; n: number }>(
      `SELECT a.root_cause, item, count(*)::int AS n
       FROM call_analysis a JOIN calls c USING (call_sid), jsonb_array_elements_text(a.action_items) AS item
       WHERE ${range} AND a.outcome <> 'good'
       GROUP BY 1, 2 ORDER BY n DESC LIMIT 40`, [from, to]),
  ]);
  return { byCause, products, actions };
}

export async function returnsData(from: string, to: string) {
  const range = `${DAY} BETWEEN $1::date AND $2::date AND a.after_sales IS NOT NULL`;
  const field = (f: string) =>
    q<{ label: string; n: number }>(
      `SELECT a.after_sales->>'${f}' AS label, count(*)::int AS n
       FROM call_analysis a JOIN calls c USING (call_sid)
       WHERE ${range} AND coalesce(a.after_sales->>'${f}', '') <> ''
       GROUP BY 1 ORDER BY n DESC LIMIT 12`, [from, to]);

  const [byType, byReason, rejections, reasonByProduct, stuck, repeat, promises] = await Promise.all([
    field('request_type'),
    field('reason'),
    field('rejection_reason'),
    q<{ product: string; reason: string; n: number }>(
      `SELECT lower(trim(a.after_sales->>'product_mentioned')) AS product, a.after_sales->>'reason' AS reason, count(*)::int AS n
       FROM call_analysis a JOIN calls c USING (call_sid)
       WHERE ${range} AND coalesce(a.after_sales->>'product_mentioned', '') <> ''
       GROUP BY 1, 2 ORDER BY n DESC LIMIT 15`, [from, to]),
    q<any>(
      `SELECT *, extract(day FROM now() - first_call_at)::int AS days_open FROM after_sales_cases
       WHERE is_open AND latest_stage = ANY($1) AND first_call_at < now() - make_interval(days => $2)
       ORDER BY first_call_at LIMIT 30`, [STUCK_STAGES, STUCK_DAYS]),
    q<any>(
      `SELECT *, extract(day FROM now() - first_call_at)::int AS days_open FROM after_sales_cases
       WHERE is_open AND call_count >= 2 ORDER BY first_call_at LIMIT 30`),
    one<{ given: number; missed: number }>(
      `SELECT count(*) FILTER (WHERE timeline_given IS NOT NULL)::int AS given,
              count(*) FILTER (WHERE promise_missed)::int AS missed
       FROM after_sales_cases WHERE last_call_at::date BETWEEN $1::date AND $2::date`, [from, to]),
  ]);
  return { byType, byReason, rejections, reasonByProduct, stuck, repeat, promises };
}

export async function agentsData(from: string, to: string) {
  const range = `${DAY} BETWEEN $1::date AND $2::date`;
  const [rows, review] = await Promise.all([
    q<any>(
      `SELECT c.agent_number, max(ag.name) AS agent_name, count(*)::int AS calls,
         count(*) FILTER (WHERE a.outcome = 'bad')::int AS bad,
         count(*) FILTER (WHERE a.resolved = 'yes')::int AS resolved,
         round(avg(a.score_greeting), 1)::float AS greeting,
         round(avg(a.score_understood), 1)::float AS understood,
         round(avg(a.score_next_step), 1)::float AS next_step,
         round(avg(a.score_empathy), 1)::float AS empathy,
         round(avg(a.score_hold), 1)::float AS hold
       FROM call_analysis a JOIN calls c USING (call_sid) LEFT JOIN agents ag ON ag.number = c.agent_number
       WHERE ${range} AND ${SCORED}
       GROUP BY c.agent_number ORDER BY calls DESC`, [from, to]),
    q<any>(
      `SELECT * FROM (
         SELECT c.agent_number, c.call_sid, c.started_at, a.category, a.bad_reason,
                row_number() OVER (PARTITION BY c.agent_number ORDER BY a.sentiment_end ASC, c.started_at DESC) AS rn
         FROM call_analysis a JOIN calls c USING (call_sid)
         WHERE ${range} AND a.outcome = 'bad' AND ${SCORED}
       ) t WHERE rn <= 3`, [from, to]),
  ]);
  return { rows, review };
}

export async function alerts(day: string) {
  const cards = await categoryCards(day);
  const spikes = cards.filter((c) => c.n >= ALERT_MIN_CALLS && (c.avg7 === 0 || c.n >= ALERT_SPIKE_RATIO * c.avg7));
  const [otherLabels, highChurn, stuck, failed] = await Promise.all([
    q<{ label: string; n: number }>(
      `SELECT lower(trim(a.suggested_category)) AS label, count(*)::int AS n
       FROM call_analysis a JOIN calls c USING (call_sid)
       WHERE a.category = 'Other' AND coalesce(a.suggested_category, '') <> ''
         AND ${DAY} BETWEEN $1::date - 6 AND $1::date
       GROUP BY 1 HAVING count(*) >= 3 ORDER BY n DESC`, [day]),
    q<any>(
      `SELECT c.call_sid, c.started_at, a.category, a.sub_reason, a.bad_reason
       FROM call_analysis a JOIN calls c USING (call_sid)
       WHERE a.churn_risk = 'high' AND ${DAY} = $1::date ORDER BY c.started_at DESC LIMIT 20`, [day]),
    q<any>(
      `SELECT *, extract(day FROM now() - first_call_at)::int AS days_open FROM after_sales_cases
       WHERE is_open AND latest_stage = ANY($1) AND first_call_at < now() - make_interval(days => $2)
       ORDER BY first_call_at LIMIT 10`, [STUCK_STAGES, STUCK_DAYS]),
    q<any>(
      `SELECT c.call_sid, c.started_at, c.error FROM calls c
       WHERE c.status = 'failed' AND ${DAY} BETWEEN $1::date - 6 AND $1::date ORDER BY c.started_at DESC LIMIT 20`, [day]),
  ]);
  return { spikes, otherLabels, highChurn, stuck, failed };
}

export async function getSummary(day: string) {
  return one<{ day: string; data: any; brief: any; created_at: string }>('SELECT * FROM daily_summary WHERE day = $1::date', [day]);
}
