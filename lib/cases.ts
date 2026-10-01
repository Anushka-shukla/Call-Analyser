import { q, one } from './db';
import { CASE_MATCH_DAYS } from './config';
import type { Analysis } from './analysis';

const CLOSED_STAGES = new Set(['refund credited', 'replacement dispatched', 'rejected']);

// Link an after-sales call to an open case (by order ID, else same customer + product within
// CASE_MATCH_DAYS), or open a new case.
export async function linkCase(call: { call_sid: string; customer_number: string | null; started_at: string | null }, a: Analysis) {
  const as = a.after_sales ?? {};
  const orderId = as.order_id_mentioned?.trim() || null;
  const product = as.product_mentioned?.trim() || null;
  const at = call.started_at ?? new Date().toISOString();

  const already = await one('SELECT case_id FROM after_sales_cases WHERE $1 = ANY(call_sids)', [call.call_sid]);
  if (already) return;

  let existing: any = null;
  if (orderId) {
    existing = await one('SELECT * FROM after_sales_cases WHERE is_open AND order_id = $1 ORDER BY last_call_at DESC LIMIT 1', [orderId]);
  }
  if (!existing && call.customer_number) {
    existing = await one(
      `SELECT * FROM after_sales_cases
       WHERE is_open AND customer_number = $1
         AND last_call_at > $2::timestamptz - make_interval(days => $3)
         AND ($4::text IS NULL OR product IS NULL OR lower(product) = lower($4))
       ORDER BY last_call_at DESC LIMIT 1`,
      [call.customer_number, at, CASE_MATCH_DAYS, product],
    );
  }

  const stage = as.stage ?? null;
  const isOpen = !(stage && CLOSED_STAGES.has(stage));

  if (existing) {
    // A follow-up call on a case that already had a promised timeline means the promise wasn't kept.
    const promiseMissed = existing.promise_missed || (!!existing.timeline_given && (a.is_follow_up || !!as.is_follow_up));
    await q(
      `UPDATE after_sales_cases SET
         order_id = COALESCE(order_id, $2), product = COALESCE(product, $3),
         request_type = COALESCE($4, request_type), reason = COALESCE($5, reason),
         last_call_at = GREATEST(last_call_at, $6::timestamptz),
         latest_stage = COALESCE($7, latest_stage),
         timeline_given = COALESCE($8, timeline_given),
         promise_missed = $9,
         call_count = call_count + 1,
         call_sids = array_append(call_sids, $10),
         is_open = $11
       WHERE case_id = $1`,
      [existing.case_id, orderId, product, as.request_type ?? null, as.reason ?? null, at, stage,
       as.timeline_given ?? null, promiseMissed, call.call_sid, isOpen],
    );
  } else {
    await q(
      `INSERT INTO after_sales_cases (order_id, customer_number, product, request_type, reason,
         first_call_at, last_call_at, latest_stage, timeline_given, call_count, call_sids, is_open)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,1,ARRAY[$9],$10)`,
      [orderId, call.customer_number, product, as.request_type ?? null, as.reason ?? null, at, stage,
       as.timeline_given ?? null, call.call_sid, isOpen],
    );
  }
}
