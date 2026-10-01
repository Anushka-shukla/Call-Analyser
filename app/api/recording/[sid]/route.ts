import { get } from '@vercel/blob';
import { NextResponse, type NextRequest } from 'next/server';
import { one } from '@/lib/db';
import { fetchRecording } from '@/lib/exotel';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Streams a recording to logged-in dashboard users, from Blob if it was copied there,
// otherwise straight from Exotel. Passes Range through so seeking works.
export async function GET(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  const row = await one<{ recording_blob: string | null; recording_url: string | null }>(
    'SELECT recording_blob, recording_url FROM calls WHERE call_sid = $1', [sid]);
  if (!row?.recording_blob && !row?.recording_url) return NextResponse.json({ error: 'No recording for this call' }, { status: 404 });

  const range = req.headers.get('range');
  let stream: ReadableStream | null = null;
  let type = 'audio/mpeg';
  let src: { get(name: string): string | null };

  if (row.recording_blob) {
    const res = await get(row.recording_blob, { access: 'private', headers: range ? { Range: range } : undefined });
    if (!res || !res.stream) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    stream = res.stream;
    type = res.blob.contentType || type;
    src = res.headers;
  } else {
    let res: Response;
    try {
      res = await fetchRecording(row.recording_url as string, range);
    } catch {
      return NextResponse.json({ error: 'Could not reach Exotel for this recording.' }, { status: 502 });
    }
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Exotel returned ${res.status}. The recording link may have expired.` }, { status: 502 });
    }
    stream = res.body;
    type = res.headers.get('content-type') || type;
    src = res.headers;
  }

  const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
  const cr = src.get('content-range');
  const cl = src.get('content-length');
  if (cr) headers.set('Content-Range', cr);
  if (cl) headers.set('Content-Length', cl);
  return new Response(stream, { status: cr ? 206 : 200, headers });
}