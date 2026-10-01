// Sarvam batch speech-to-text and translate. Docs: https://docs.sarvam.ai
// Everything Sarvam-specific lives in this file. The batch endpoints and output fields below
// follow Sarvam's batch STT API; check them against the current docs during integration.

const BASE = 'https://api.sarvam.ai';

function key() {
  const k = process.env.SARVAM_API_KEY;
  if (!k) throw new Error('SARVAM_API_KEY is missing');
  return k;
}

async function sarvam(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'api-subscription-key': key(), 'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sarvam ${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export type Segment = {
  idx: number;
  speaker: string;
  start_ms: number;
  end_ms: number;
  text_original: string;
  text_en: string | null;
  language: string | null;
};

import type { Track } from './audio-split';

function fileName(callSid: string, channel: Track['channel']) {
  return channel === 'mono' ? `${callSid}.mp3` : `${callSid}-${channel}.mp3`;
}

// Creates one batch job for a call's tracks (1 for mono, 2 for stereo), uploads them and starts it.
// Diarization stays on so the output format is the same either way. For stereo tracks the
// speaker comes from the channel, not from diarization.
export async function startSttJob(callSid: string, tracks: Track[]): Promise<string> {
  const job = await sarvam('/speech-to-text/job/v1', {
    method: 'POST',
    body: JSON.stringify({
      job_parameters: {
        model: process.env.SARVAM_STT_MODEL || 'saarika:v2.5',
        language_code: 'unknown',
        with_timestamps: true,
        with_diarization: true,
      },
    }),
  });
  const jobId: string = job.job_id;
  if (!jobId) throw new Error('Sarvam did not return a job_id');

  const names = tracks.map((t) => fileName(callSid, t.channel));
  const up = await sarvam('/speech-to-text/job/v1/upload-files', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId, files: names }),
  });

  for (let i = 0; i < tracks.length; i++) {
    const uploadUrl: string | undefined = up?.upload_urls?.[names[i]]?.file_url;
    if (!uploadUrl) throw new Error(`Sarvam did not return an upload URL for ${names[i]}`);
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': tracks[i].contentType },
      body: new Uint8Array(tracks[i].data),
      signal: AbortSignal.timeout(30_000),
    });
    if (!put.ok) throw new Error(`Sarvam upload failed for ${names[i]}: ${put.status}`);
  }

  await sarvam(`/speech-to-text/job/v1/${jobId}/start`, { method: 'POST', body: '{}' });
  return jobId;
}

export type JobState = 'running' | 'completed' | 'failed';

export async function getJobState(jobId: string): Promise<{ state: JobState; error?: string }> {
  const s = await sarvam(`/speech-to-text/job/v1/${jobId}/status`, { method: 'GET' });
  const raw = String(s?.job_state ?? '').toLowerCase();
  if (raw === 'completed') {
    const failedFile = (s?.job_details ?? []).find((d: any) => String(d?.state ?? '').toLowerCase() === 'failed');
    if (failedFile) return { state: 'failed', error: failedFile?.error_message || 'file failed' };
    return { state: 'completed' };
  }
  if (raw === 'failed') return { state: 'failed', error: s?.error_message || 'job failed' };
  return { state: 'running' };
}

type RawSeg = { speaker: string; start_ms: number; end_ms: number; text: string };

// Reads one output file. Handles the diarized format, the plain timestamps format, and a bare transcript.
export function parseOutput(out: any): { segs: RawSeg[]; language: string | null } {
  const language: string | null = out?.language_code ?? null;
  const entries: any[] = out?.diarized_transcript?.entries ?? [];
  let segs: RawSeg[] = entries
    .filter((e) => String(e?.transcript ?? '').trim())
    .map((e) => ({
      speaker: String(e?.speaker_id ?? 'unknown'),
      start_ms: Math.round(Number(e?.start_time_seconds ?? 0) * 1000),
      end_ms: Math.round(Number(e?.end_time_seconds ?? 0) * 1000),
      text: String(e.transcript).trim(),
    }));
  const ts = out?.timestamps;
  if (segs.length === 0 && Array.isArray(ts?.words)) {
    segs = ts.words
      .map((w: string, i: number) => ({
        speaker: 'unknown',
        start_ms: Math.round(Number(ts.start_time_seconds?.[i] ?? 0) * 1000),
        end_ms: Math.round(Number(ts.end_time_seconds?.[i] ?? 0) * 1000),
        text: String(w ?? '').trim(),
      }))
      .filter((x: RawSeg) => x.text);
  }
  if (segs.length === 0 && String(out?.transcript ?? '').trim()) {
    segs = [{ speaker: 'unknown', start_ms: 0, end_ms: 0, text: String(out.transcript).trim() }];
  }
  return { segs, language };
}

async function downloadOutput(jobId: string, name: string): Promise<any> {
  const dl = await sarvam('/speech-to-text/job/v1/download-files', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId, files: [name] }),
  });
  const url: string | undefined = dl?.download_urls?.[name]?.file_url;
  if (!url) throw new Error(`Sarvam did not return a download URL for ${name}`);
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Sarvam output download failed: ${res.status}`);
  return res.json();
}

// Merges stereo tracks into one timeline. The agent's track is labelled "agent", the other "customer".
export function mergeTracks(
  tracks: { channel: Track['channel']; segs: RawSeg[]; language: string | null }[],
  agentSide: 'left' | 'right',
): { segments: Segment[]; language: string | null } {
  const dual = tracks.length > 1;
  const all = tracks.flatMap((t) =>
    t.segs.map((s) => ({
      ...s,
      speaker: dual ? (t.channel === agentSide ? 'agent' : 'customer') : s.speaker,
      language: t.language,
    })),
  );
  all.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  const customer = tracks.find((t) => t.channel !== agentSide && t.language);
  const language = customer?.language ?? tracks.find((t) => t.language)?.language ?? null;
  return {
    language,
    segments: all.map((s, i) => ({
      idx: i, speaker: s.speaker, start_ms: s.start_ms, end_ms: s.end_ms,
      text_original: s.text, text_en: null, language: s.language,
    })),
  };
}

export async function getJobSegments(
  jobId: string, callSid: string, channels: number, agentSide: 'left' | 'right',
): Promise<{ segments: Segment[]; language: string | null }> {
  const list: Track['channel'][] = channels === 2 ? ['left', 'right'] : ['mono'];
  const tracks = [];
  for (const ch of list) {
    const out = await downloadOutput(jobId, fileName(callSid, ch).replace(/\.mp3$/, '.json'));
    tracks.push({ channel: ch, ...parseOutput(out) });
  }
  return mergeTracks(tracks, agentSide);
}

// Translate one piece of text to English. Long text is split to stay under the input limit.
export async function translateToEnglish(text: string, sourceLang: string | null): Promise<string> {
  if (!text.trim()) return '';
  if (sourceLang && sourceLang.startsWith('en')) return text;
  const chunks = splitText(text, 900);
  const out: string[] = [];
  for (const chunk of chunks) {
    const r = await sarvam('/translate', {
      method: 'POST',
      body: JSON.stringify({
        input: chunk,
        source_language_code: 'auto',
        target_language_code: 'en-IN',
        model: process.env.SARVAM_TRANSLATE_MODEL || 'mayura:v1',
        mode: 'formal',
      }),
    });
    out.push(r?.translated_text ?? '');
  }
  return out.join(' ').trim();
}

export async function translateSegments(segments: Segment[], language: string | null): Promise<Segment[]> {
  const result = [...segments];
  const limit = 5;
  let i = 0;
  async function worker() {
    while (i < result.length) {
      const n = i++;
      const s = result[n];
      result[n] = { ...s, text_en: await translateToEnglish(s.text_original, s.language ?? language) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, result.length) }, worker));
  return result;
}

function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let buf = '';
  for (const sentence of text.split(/(?<=[.!?।])\s+/)) {
    if ((buf + ' ' + sentence).length > max && buf) {
      parts.push(buf.trim());
      buf = '';
    }
    if (sentence.length > max) {
      for (let j = 0; j < sentence.length; j += max) parts.push(sentence.slice(j, j + max));
    } else {
      buf += ' ' + sentence;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}