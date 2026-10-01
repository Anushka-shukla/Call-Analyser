import { NextResponse, type NextRequest } from 'next/server';

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Reject anything else.
export function cronRoute(fn: (req: NextRequest) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    try {
      const result = await fn(req);
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      console.error(e);
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  };
}
