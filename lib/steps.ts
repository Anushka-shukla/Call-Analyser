// Every pipeline step. Each one picks a small batch so it finishes inside the Hobby plan's time limit.
import { put } from '@vercel/blob';
import { BATCH } from './config';
import { pool, q } from './db';
import { downloadRecording, listCalls, normalize } from './exotel';
import { exotelRecordingUrl, keepRecordings, loadAudio } from './audio';
import { getJobSegments, getJobState, startSttJob, translateSegments } from './sarvam';
import { agentChannel, splitTracks } from './audio-split';
import { analyseTranscript, buildTranscript, isAfterSales, loadCategories } from './analysis';
import { linkCase } from './cases';
import { advance, claim, fail, release, runEach, upsertCall } from './pipeline';
import { istStamp } from './time';

// Calls created between two IST timestamps. Default: the last 2 hours.
export async function pullExotel(range?: { from: string; to: string }) {
  const now = new Date();
  const from = range?.from ?? istStamp(new Date(now.getTime() - 2 * 60 * 60 * 1000));
  const to = range?.to ?? istStamp(now);
  const calls = await listCalls(from, to);
  for (const c of calls) await upsertCall(normalize(c));
  return { from, to, calls: calls.length };
}

// new -> audio_saved. With KEEP_RECORDINGS=true the recording is copied to private Blob storage.
// Without it, the step only checks a recording exists and the audio stays in Exotel.
export async function saveAudio() {
  const calls = await claim('new', BATCH.saveAudio);
  return runEach(calls, 4, async (c) => {
    try {
      const url = await exotelRecordingUrl(c);
      if (!keepRecordings()) {
        await advance(c.call_sid, 'audio_saved', { recording_url: url });
        return 'checked';
      }
      const { data, contentType } = await downloadRecording(url);
      const ext = contentType.includes('wav') ? 'wav' : 'mp3';
      const blob = await put(`recordings/${c.call_sid}.${ext}`, Buffer.from(data), {
        access: 'private', contentType, addRandomSuffix: true,
      });
      await advance(c.call_sid, 'audio_saved', { recording_blob: blob.url, recording_url: url });
      return 'saved';
    } catch (e) {
      await fail(c.call_sid, e);
      return 'failed';
    }
  });
}

// audio_saved -> stt_pending: start a Sarvam batch job for each recording.
export async function submitStt() {
  const calls = await claim('audio_saved', BATCH.submitStt);
  return runEach(calls, 3, async (c) => {
    try {
      const { data, contentType } = await loadAudio(c);
      // Stereo recordings become two tracks (agent and customer). Mono stays as one.
      const tracks = await splitTracks(data, contentType);
      const jobId = await startSttJob(c.call_sid, tracks);
      await advance(c.call_sid, 'stt_pending', { sarvam_job_id: jobId, audio_channels: tracks.length });
      return 'submitted';
    } catch (e) {
      await fail(c.call_sid, e);
      return 'failed';
    }
  });
}

// stt_pending -> transcribed: collect finished Sarvam jobs, translate each segment, save.
export async function pollStt() {
  const calls = await claim('stt_pending', BATCH.pollStt);
  return runEach(calls, 3, async (c) => {
    try {
      if (!c.sarvam_job_id) throw new Error('No Sarvam job ID');
      const { state, error } = await getJobState(c.sarvam_job_id);
      if (state === 'running') {
        await release(c.call_sid);
        return 'running';
      }
      if (state === 'failed') {
        await fail(c.call_sid, `Sarvam job failed: ${error ?? ''}`, 'audio_saved');
        return 'job_failed';
      }
      const { segments, language } = await getJobSegments(c.sarvam_job_id, c.call_sid, c.audio_channels ?? 1, agentChannel());
      const translated = await translateSegments(segments, language);

      const db = await pool().connect();
      try {
        await db.query('BEGIN');
        await db.query('DELETE FROM transcript_segments WHERE call_sid = $1', [c.call_sid]);
        for (const s of translated) {
          await db.query(
            `INSERT INTO transcript_segments (call_sid, idx, speaker, start_ms, end_ms, text_original, text_en, language)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [c.call_sid, s.idx, s.speaker, s.start_ms, s.end_ms, s.text_original, s.text_en, s.language],
          );
        }
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      } finally {
        db.release();
      }
      await advance(c.call_sid, 'transcribed', { language });
      return 'transcribed';
    } catch (e) {
      await fail(c.call_sid, e);
      return 'failed';
    }
  });
}

// transcribed -> analyzed: Claude reads each transcript and returns the structured analysis.
export async function analyze() {
  const calls = await claim('transcribed', BATCH.analyze);
  if (calls.length === 0) return { picked: 0 };
  const categories = await loadCategories();
  const groupOf = new Map(categories.map((c) => [c.name, c.grp]));

  return runEach(calls, 3, async (c) => {
    try {
      const segments = await q<any>('SELECT * FROM transcript_segments WHERE call_sid = $1 ORDER BY idx', [c.call_sid]);
      if (segments.length === 0) throw new Error('No transcript segments');
      const { result: a, model, promptVersion } = await analyseTranscript(buildTranscript(segments), c, categories);
      const afterSales = isAfterSales(a, categories) ? a.after_sales ?? {} : null;

      await q(
        `INSERT INTO call_analysis (call_sid, outcome, bad_reason, category, category_group, secondary_categories,
           suggested_category, sub_reason, root_cause, resolved, pending_items, is_follow_up, sentiment_start, sentiment_end,
           score_greeting, score_understood, score_next_step, score_empathy, score_hold, key_pointers, customer_quotes,
           action_items, churn_risk, language, after_sales, third_party_on_call, agent_speaker, transcript_quality,
           model, prompt_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
         ON CONFLICT (call_sid) DO UPDATE SET
           outcome = EXCLUDED.outcome, bad_reason = EXCLUDED.bad_reason, category = EXCLUDED.category,
           category_group = EXCLUDED.category_group, secondary_categories = EXCLUDED.secondary_categories,
           suggested_category = EXCLUDED.suggested_category, sub_reason = EXCLUDED.sub_reason,
           root_cause = EXCLUDED.root_cause, resolved = EXCLUDED.resolved, pending_items = EXCLUDED.pending_items,
           is_follow_up = EXCLUDED.is_follow_up, sentiment_start = EXCLUDED.sentiment_start,
           sentiment_end = EXCLUDED.sentiment_end, score_greeting = EXCLUDED.score_greeting,
           score_understood = EXCLUDED.score_understood, score_next_step = EXCLUDED.score_next_step,
           score_empathy = EXCLUDED.score_empathy, score_hold = EXCLUDED.score_hold,
           key_pointers = EXCLUDED.key_pointers, customer_quotes = EXCLUDED.customer_quotes,
           action_items = EXCLUDED.action_items, churn_risk = EXCLUDED.churn_risk, language = EXCLUDED.language,
           after_sales = EXCLUDED.after_sales, third_party_on_call = EXCLUDED.third_party_on_call,
           agent_speaker = EXCLUDED.agent_speaker, transcript_quality = EXCLUDED.transcript_quality,
           model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version, created_at = now()`,
        [
          c.call_sid, a.outcome, a.bad_reason ?? null, a.category, groupOf.get(a.category) ?? null,
          a.secondary_categories ?? [], a.suggested_category ?? null, a.sub_reason, a.root_cause, a.resolved,
          a.pending_items ?? null, a.is_follow_up, a.sentiment_start, a.sentiment_end,
          a.agent_scores.greeting, a.agent_scores.understood_issue, a.agent_scores.clear_next_step,
          a.agent_scores.empathy, a.agent_scores.hold_handling,
          JSON.stringify(a.key_pointers ?? []), JSON.stringify(a.customer_quotes ?? []), JSON.stringify(a.action_items ?? []),
          a.churn_risk, a.language, afterSales ? JSON.stringify(afterSales) : null,
          a.third_party_on_call, a.agent_speaker, a.transcript_quality, model, promptVersion,
        ],
      );
      if (afterSales) await linkCase(c, a);
      await advance(c.call_sid, 'analyzed');
      return 'analyzed';
    } catch (e) {
      await fail(c.call_sid, e);
      return 'failed';
    }
  });
}

// Runs every step at once. They work on different statuses, so they never touch the same call.
export async function tick() {
  const steps = { pullExotel, saveAudio, submitStt, pollStt, analyze };
  const names = Object.keys(steps) as (keyof typeof steps)[];
  const results = await Promise.allSettled(names.map((n) => steps[n]()));
  return Object.fromEntries(
    names.map((n, i) => {
      const r = results[i];
      return [n, r.status === 'fulfilled' ? r.value : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) }];
    }),
  );
}