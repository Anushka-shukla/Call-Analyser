import { NextResponse, type NextRequest } from 'next/server';
import { getCall, normalize, type ExotelCall } from '@/lib/exotel';
import { upsertCall } from '@/lib/pipeline';

// Set this as the StatusCallback URL in Exotel:
// https://<your-app>.vercel.app/api/exotel/webhook?token=<EXOTEL_WEBHOOK_TOKEN>
export const dynamic = 'force-dynamic';

async function readBody(req: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (out[k] = v));
  if (req.method === 'POST') {
    const type = req.headers.get('content-type') ?? '';
    try {
      if (type.includes('application/json')) Object.assign(out, await req.json());
      else (await req.formData()).forEach((v, k) => (out[k] = String(v)));
    } catch {
      // Body is optional; Exotel sometimes sends everything as query params.
    }
  }
  return out;
}

async function handle(req: NextRequest) {
  const token = process.env.EXOTEL_WEBHOOK_TOKEN;
  if (!token || req.nextUrl.searchParams.get('token') !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await readBody(req);
  const sid = body.CallSid || body.Sid;
  if (!sid) return NextResponse.json({ error: 'CallSid missing' }, { status: 400 });

  // Fetch the full call so webhook and cron store calls the same way.
  let call: ExotelCall | null = null;
  try {
    call = await getCall(sid);
  } catch (e) {
    console.error('Exotel getCall failed, using webhook fields', e);
  }
  if (!call) {
    call = {
      Sid: sid, Direction: body.Direction, From: body.From || body.CallFrom, To: body.To || body.CallTo,
      Status: body.Status || body.CallStatus, StartTime: body.StartTime, EndTime: body.EndTime,
      Duration: body.ConversationDuration || body.DialCallDuration || body.Duration, RecordingUrl: body.RecordingUrl,
    };
  }
  await upsertCall(normalize(call, { agentNumber: body.DialWhomNumber || null }));
  return NextResponse.json({ ok: true });
}

export const POST = handle;
export const GET = handle;
