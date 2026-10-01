// Exotel API. Docs: https://developer.exotel.com/api/
// Everything Exotel-specific lives in this file.
import { fromExotelTime } from './time';

export type ExotelCall = {
  Sid: string;
  Direction?: string;       // inbound | outbound-api | outbound-dial
  From?: string;
  To?: string;
  Status?: string;          // completed | busy | no-answer | failed | canceled
  StartTime?: string;
  EndTime?: string;
  Duration?: string | number;
  RecordingUrl?: string | null;
  DateCreated?: string;
};

export type CallRow = {
  call_sid: string;
  direction: string | null;
  from_number: string | null;
  to_number: string | null;
  customer_number: string | null;
  agent_number: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  exotel_status: string | null;
  recording_url: string | null;
};

function cfg() {
  const key = process.env.EXOTEL_API_KEY;
  const token = process.env.EXOTEL_API_TOKEN;
  const sid = process.env.EXOTEL_SID;
  const sub = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
  if (!key || !token || !sid) throw new Error('Exotel env vars are missing');
  return { key, token, sid, sub, auth: 'Basic ' + Buffer.from(`${key}:${token}`).toString('base64') };
}

async function exotelGet(pathOrUrl: string): Promise<any> {
  const c = cfg();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://${c.sub}${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: c.auth, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Exotel ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// All calls created between two IST timestamps ("YYYY-MM-DD HH:mm:ss"), following pagination.
export async function listCalls(fromIst: string, toIst: string): Promise<ExotelCall[]> {
  const c = cfg();
  const filter = encodeURIComponent(`gte:${fromIst};lte:${toIst}`);
  let next: string | null = `/v1/Accounts/${c.sid}/Calls.json?DateCreated=${filter}&PageSize=100`;
  const all: ExotelCall[] = [];
  for (let page = 0; next && page < 100; page++) {
    const data: any = await exotelGet(next);
    const calls: ExotelCall[] = data?.Calls ?? [];
    all.push(...calls);
    next = data?.Metadata?.NextPageUri || null;
  }
  return all;
}

export async function getCall(callSid: string): Promise<ExotelCall | null> {
  const c = cfg();
  const data = await exotelGet(`/v1/Accounts/${c.sid}/Calls/${encodeURIComponent(callSid)}.json`);
  return data?.Call ?? null;
}

export function normalize(c: ExotelCall, extra: { agentNumber?: string | null } = {}): CallRow {
  const direction = c.Direction ?? null;
  const inbound = (direction ?? '').startsWith('inbound');
  const dur = c.Duration != null && c.Duration !== '' ? Number(c.Duration) : null;
  return {
    call_sid: c.Sid,
    direction,
    from_number: c.From ?? null,
    to_number: c.To ?? null,
    // Inbound: the customer is the caller. Outbound: the customer is the number dialled.
    customer_number: (inbound ? c.From : c.To) ?? null,
    // To confirm during integration: where Exotel reports the agent's number for your flows.
    // Webhook DialWhomNumber is used when present; outbound calls use From.
    agent_number: extra.agentNumber ?? (inbound ? null : c.From ?? null),
    started_at: fromExotelTime(c.StartTime ?? c.DateCreated),
    ended_at: fromExotelTime(c.EndTime),
    duration_s: Number.isFinite(dur as number) ? (dur as number) : null,
    exotel_status: c.Status ?? null,
    recording_url: c.RecordingUrl || null,
  };
}

// Recording links are sometimes pre-signed (no auth allowed) and sometimes need API auth.
// Try without auth first, then with it.
export async function fetchRecording(url: string, range?: string | null): Promise<Response> {
  const base: Record<string, string> = range ? { Range: range } : {};
  let res = await fetch(url, { headers: base, cache: 'no-store', signal: AbortSignal.timeout(25_000) });
  if (res.status === 401 || res.status === 403) {
    res = await fetch(url, { headers: { ...base, Authorization: cfg().auth }, cache: 'no-store', signal: AbortSignal.timeout(25_000) });
  }
  return res;
}

export async function downloadRecording(url: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await fetchRecording(url);
  if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
  return { data: await res.arrayBuffer(), contentType: res.headers.get('content-type') || 'audio/mpeg' };
}