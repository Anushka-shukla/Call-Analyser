import { cronRoute } from '@/lib/cron';
import { buildDailySummary } from '@/lib/rollup';
import { addDays, isDay, istDate } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Today by default. ?date=yesterday or ?date=YYYY-MM-DD for any other day.
export const GET = cronRoute(async (req) => {
  const date = req.nextUrl.searchParams.get('date');
  const day = date === 'yesterday' ? addDays(istDate(), -1) : isDay(date) ? date : istDate();
  return buildDailySummary(day);
});