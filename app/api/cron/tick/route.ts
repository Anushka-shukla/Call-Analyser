import { cronRoute } from '@/lib/cron';
import { tick } from '@/lib/steps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// One call runs every pipeline step. Point a free scheduler (cron-job.org) at this every 5 minutes.
export const GET = cronRoute(async () => tick());
