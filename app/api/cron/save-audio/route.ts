import { cronRoute } from '@/lib/cron';
import { saveAudio } from '@/lib/steps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// One step on its own. /api/cron/tick runs all steps together.
export const GET = cronRoute(async () => saveAudio());