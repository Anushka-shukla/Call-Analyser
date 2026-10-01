import { readBlob } from './blob';
import { downloadRecording, getCall } from './exotel';

// Recordings are copied to Vercel Blob only when KEEP_RECORDINGS=true.
// Otherwise audio is read straight from Exotel each time it's needed.
export const keepRecordings = () => process.env.KEEP_RECORDINGS === 'true';

export async function exotelRecordingUrl(c: { call_sid: string; recording_url: string | null }): Promise<string> {
  const url = c.recording_url || (await getCall(c.call_sid))?.RecordingUrl || null;
  if (!url) throw new Error('No recording URL yet');
  return url;
}

export async function loadAudio(c: { call_sid: string; recording_url: string | null; recording_blob: string | null }) {
  if (c.recording_blob) return readBlob(c.recording_blob);
  return downloadRecording(await exotelRecordingUrl(c));
}
