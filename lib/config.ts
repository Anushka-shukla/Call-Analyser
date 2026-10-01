export const TZ = 'Asia/Kolkata';

// Calls answered but shorter than this are saved as dropped and not transcribed.
export const MIN_CALL_SECONDS = 20;

// A step is retried this many times before the call is marked failed.
export const MAX_ATTEMPTS = 3;

// How many calls each run picks up. Sized to finish inside the Hobby plan's 60-second limit.
// With a run every 5 minutes, analyze handles about 36 calls an hour. Raise these, or run the
// scheduler more often, if calls pile up at the transcribed status.
export const BATCH = {
  saveAudio: 6,
  submitStt: 4,
  pollStt: 8,
  analyze: 3,
};

// After-sales calls without an order ID are linked to an open case from the same
// customer about the same product within this many days.
export const CASE_MATCH_DAYS = 30;

// An open after-sales case at one of these stages for more than STUCK_DAYS shows as stuck.
export const STUCK_STAGES = ['pickup pending', 'pickup missed', 'refund pending', 'in inspection', 'approved'];
export const STUCK_DAYS = 7;

// Alerts: a category is flagged when today's count is at least this many times its
// 7-day average and has at least ALERT_MIN_CALLS calls.
export const ALERT_SPIKE_RATIO = 1.5;
export const ALERT_MIN_CALLS = 10;

// Team that owns each root cause, shown on the Root causes page.
export const ROOT_CAUSE_OWNER: Record<string, string> = {
  product: 'Catalogue',
  logistics: 'Logistics',
  policy: 'Support lead',
  'app or website': 'Tech',
  agent: 'Support',
  pricing: 'Category',
  payment: 'Tech and finance',
  none: '-',
};

export const AFTER_SALES_GROUP = 'After-sales';