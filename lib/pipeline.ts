import { q, one } from './db';
import { MAX_ATTEMPTS, MIN_CALL_SECONDS } from './config';
import type { CallRow } from './exotel';

export type Status = 'new' | 'audio_saved' | 'stt_pending' | 'transcribed' | 'analyzed' | 'dropped' | 'failed';

export type DbCall = CallRow & {
  status: Status;
  attempts: number;
  sarvam_job_id: string | null;
  recording_blob: string | null;
  language: string | null;
  audio_channels: number | null;
  error: string | null;
};

function initialStatus(c: CallRow): Status {
  if ((c.exotel_status ?? '').toLowerCase() !== 'completed') return 'dropped';
  if (c.duration_s != null && c.duration_s < MIN_CALL_SECONDS) return 'dropped';
  return 'new';
}

// Insert a call or refresh its Exotel fields. Never moves a call backwards in the pipeline.
export async function upsertCall(c: CallRow) {
  await q(
    `INSERT INTO calls (call_sid, direction, from_number, to_number, customer_number, agent_number,
                        started_at, ended_at, duration_s, exotel_status, recording_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (call_sid) DO UPDATE SET
       direction       = COALESCE(EXCLUDED.direction, calls.direction),
       from_number     = COALESCE(EXCLUDED.from_number, calls.from_number),
       to_number       = COALESCE(EXCLUDED.to_number, calls.to_number),
       customer_number = COALESCE(EXCLUDED.customer_number, calls.customer_number),
       agent_number    = COALESCE(EXCLUDED.agent_number, calls.agent_number),
       started_at      = COALESCE(EXCLUDED.started_at, calls.started_at),
       ended_at        = COALESCE(EXCLUDED.ended_at, calls.ended_at),
       duration_s      = COALESCE(EXCLUDED.duration_s, calls.duration_s),
       exotel_status   = COALESCE(EXCLUDED.exotel_status, calls.exotel_status),
       recording_url   = COALESCE(EXCLUDED.recording_url, calls.recording_url),
       status = CASE WHEN calls.status = 'dropped' AND EXCLUDED.status = 'new' THEN 'new' ELSE calls.status END,
       updated_at      = now()`,
    [c.call_sid, c.direction, c.from_number, c.to_number, c.customer_number, c.agent_number,
     c.started_at, c.ended_at, c.duration_s, c.exotel_status, c.recording_url, initialStatus(c)],
  );
}

// Lock up to `limit` calls at a status for 10 minutes so parallel runs never take the same call.
export async function claim(status: Status, limit: number): Promise<DbCall[]> {
  return q<DbCall>(
    `UPDATE calls SET locked_until = now() + interval '10 minutes', updated_at = now()
     WHERE call_sid IN (
       SELECT call_sid FROM calls
       WHERE status = $1 AND attempts < $3 AND (locked_until IS NULL OR locked_until < now())
       ORDER BY started_at NULLS LAST
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [status, limit, MAX_ATTEMPTS],
  );
}

const ALLOWED = new Set(['recording_blob', 'sarvam_job_id', 'language', 'recording_url', 'audio_channels']);

export async function advance(callSid: string, next: Status, fields: Record<string, unknown> = {}) {
  const keys = Object.keys(fields).filter((k) => ALLOWED.has(k));
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  await q(
    `UPDATE calls SET status = $2, attempts = 0, locked_until = NULL, error = NULL, updated_at = now()
     ${sets.length ? ', ' + sets.join(', ') : ''}
     WHERE call_sid = $1`,
    [callSid, next, ...keys.map((k) => fields[k])],
  );
}

// Count a failed attempt. After MAX_ATTEMPTS the call is marked failed.
// `rewindTo` sends the call back to an earlier status for the next try.
export async function fail(callSid: string, err: unknown, rewindTo?: Status) {
  const message = err instanceof Error ? err.message : String(err);
  await q(
    `UPDATE calls SET
       attempts = attempts + 1,
       error = $2,
       locked_until = NULL,
       status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE COALESCE($4, status) END,
       updated_at = now()
     WHERE call_sid = $1`,
    [callSid, message.slice(0, 1000), MAX_ATTEMPTS, rewindTo ?? null],
  );
}

// Unlock without counting an attempt (e.g. Sarvam job still running).
export async function release(callSid: string) {
  await q(`UPDATE calls SET locked_until = NULL, updated_at = now() WHERE call_sid = $1`, [callSid]);
}

export async function getCallRow(callSid: string) {
  return one<DbCall>('SELECT * FROM calls WHERE call_sid = $1', [callSid]);
}

// Run `fn` over items with a small concurrency limit and collect a summary.
export async function runEach<T>(items: T[], limit: number, fn: (item: T) => Promise<string>) {
  const results: Record<string, number> = {};
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      let key: string;
      try {
        key = await fn(item);
      } catch {
        key = 'error';
      }
      results[key] = (results[key] ?? 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { picked: items.length, ...results };
}