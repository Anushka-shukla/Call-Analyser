import { cronRoute } from '@/lib/cron';
import { pullExotel } from '@/lib/steps';
import { isDay } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Default: the last 2 hours. Backfill a whole day: /api/cron/pull-exotel?date=2026-09-30
export const GET = cronRoute(async (req) => {
  const date = req.nextUrl.searchParams.get('date');
  return pullExotel(isDay(date) ? { from: `${date} 00:00:00`, to: `${date} 23:59:59` } : undefined);
});