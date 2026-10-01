import type Anthropic from '@anthropic-ai/sdk';
import { q } from './db';
import { AFTER_SALES_GROUP } from './config';
import { callTool, MODEL } from './claude';
import { mmss } from './time';

export const PROMPT_VERSION = 'v1';

export type Category = { grp: string; name: string };

export const ROOT_CAUSES = ['product', 'logistics', 'policy', 'app or website', 'agent', 'pricing', 'payment', 'none'] as const;
export const REQUEST_TYPES = ['return', 'replacement', 'exchange', 'refund', 'cancellation'] as const;
export const AS_REASONS = ['damaged in transit', 'wrong item', 'wrong size or grade', 'quality issue', 'short quantity', 'late delivery', 'excess from bulk order', 'changed mind', 'other'] as const;
export const AS_STAGES = ['new request', 'pickup pending', 'pickup missed', 'in inspection', 'approved', 'rejected', 'refund pending', 'refund credited', 'replacement dispatched'] as const;
export const AS_RESOLUTIONS = ['return accepted', 'replacement', 'partial refund', 'wallet credit', 'escalated', 'denied', 'none'] as const;

export type AfterSales = {
  request_type?: string;
  reason?: string;
  product_mentioned?: string;
  order_id_mentioned?: string;
  stage?: string;
  days_waiting?: number;
  is_follow_up?: boolean;
  resolution_offered?: string;
  refund_mode?: string;
  timeline_given?: string;
  rejection_reason?: string;
  customer_accepted?: string;
};

export type Analysis = {
  outcome: 'good' | 'neutral' | 'bad';
  bad_reason?: string;
  category: string;
  secondary_categories?: string[];
  suggested_category?: string;
  sub_reason: string;
  root_cause: string;
  resolved: 'yes' | 'no' | 'partly';
  pending_items?: string;
  is_follow_up: boolean;
  sentiment_start: number;
  sentiment_end: number;
  agent_scores: { greeting: number; understood_issue: number; clear_next_step: number; empathy: number; hold_handling: number };
  key_pointers: string[];
  customer_quotes: { timestamp: string; quote: string }[];
  action_items: string[];
  churn_risk: 'low' | 'medium' | 'high';
  language: string;
  after_sales?: AfterSales;
  third_party_on_call: boolean;
  agent_speaker: string;
  transcript_quality: 'good' | 'partly unclear' | 'poor';
};

export async function loadCategories(): Promise<Category[]> {
  return q<Category>('SELECT grp, name FROM categories WHERE active ORDER BY id');
}

const score = { type: 'integer', minimum: 1, maximum: 5 };

function buildTool(categories: Category[]): Anthropic.Tool {
  const names = categories.map((c) => c.name);
  return {
    name: 'record_call_analysis',
    description: 'Record the analysis of one customer support call.',
    input_schema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['good', 'neutral', 'bad'] },
        bad_reason: { type: 'string', description: 'Only when outcome is bad. One short line.' },
        category: { type: 'string', enum: names },
        secondary_categories: { type: 'array', items: { type: 'string', enum: names }, maxItems: 2 },
        suggested_category: { type: 'string', description: 'Only when category is Other: a short label for what this call was about.' },
        sub_reason: { type: 'string', description: 'Short specific reason, e.g. "cashback not credited after fulfilment".' },
        root_cause: { type: 'string', enum: [...ROOT_CAUSES] },
        resolved: { type: 'string', enum: ['yes', 'no', 'partly'] },
        pending_items: { type: 'string', description: 'What is still pending, if anything.' },
        is_follow_up: { type: 'boolean', description: 'True if the customer says they called before about this same issue.' },
        sentiment_start: score,
        sentiment_end: score,
        agent_scores: {
          type: 'object',
          properties: { greeting: score, understood_issue: score, clear_next_step: score, empathy: score, hold_handling: score },
          required: ['greeting', 'understood_issue', 'clear_next_step', 'empathy', 'hold_handling'],
        },
        key_pointers: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
        customer_quotes: {
          type: 'array', maxItems: 2,
          items: { type: 'object', properties: { timestamp: { type: 'string' }, quote: { type: 'string' } }, required: ['timestamp', 'quote'] },
        },
        action_items: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        churn_risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        language: { type: 'string', description: 'Main language spoken, e.g. Hindi, Kannada, English, Hinglish.' },
        after_sales: {
          type: 'object',
          description: `Fill only when the category or a secondary category is in the ${AFTER_SALES_GROUP} group. Leave out any field not said on the call.`,
          properties: {
            request_type: { type: 'string', enum: [...REQUEST_TYPES] },
            reason: { type: 'string', enum: [...AS_REASONS] },
            product_mentioned: { type: 'string', description: 'As said, e.g. "UltraTech cement, 50 bags".' },
            order_id_mentioned: { type: 'string' },
            stage: { type: 'string', enum: [...AS_STAGES] },
            days_waiting: { type: 'integer', minimum: 0 },
            is_follow_up: { type: 'boolean' },
            resolution_offered: { type: 'string', enum: [...AS_RESOLUTIONS] },
            refund_mode: { type: 'string', enum: ['wallet', 'original payment method'] },
            timeline_given: { type: 'string', description: 'The exact timeline the agent promised, e.g. "pickup within 48 hours".' },
            rejection_reason: { type: 'string' },
            customer_accepted: { type: 'string', enum: ['yes', 'no', 'unclear'] },
          },
        },
        third_party_on_call: { type: 'boolean' },
        agent_speaker: { type: 'string', description: 'The speaker label that is the support agent, e.g. SPEAKER_00.' },
        transcript_quality: { type: 'string', enum: ['good', 'partly unclear', 'poor'] },
      },
      required: [
        'outcome', 'category', 'sub_reason', 'root_cause', 'resolved', 'is_follow_up', 'sentiment_start', 'sentiment_end',
        'agent_scores', 'key_pointers', 'customer_quotes', 'action_items', 'churn_risk', 'language',
        'third_party_on_call', 'agent_speaker', 'transcript_quality',
      ],
    },
  };
}

function buildSystem(categories: Category[], dual: boolean): string {
  const groups = new Map<string, string[]>();
  for (const c of categories) groups.set(c.grp, [...(groups.get(c.grp) ?? []), c.name]);
  const list = [...groups.entries()].map(([g, n]) => `- ${g}: ${n.join(', ')}`).join('\n');
  const context = process.env.BUSINESS_CONTEXT || 'An online store selling building materials in India.';

  return `You analyse customer support calls for this business: ${context}

You get a transcript with timestamps and speaker labels. Each line has the English translation and the original words. Use the original when tone or exact words matter.

Outcome rules:
- good: issue resolved, or a clear next step with a timeline the customer accepted, and the customer ends calm or happy.
- neutral: a simple information call, or the issue is still pending but the customer accepted the plan without frustration.
- bad: any one of these is enough. Customer ends unhappy. Issue unresolved with no clear next step. A repeat follow-up on the same issue. Customer asks to escalate or threatens to stop buying. Agent gave wrong information. Put the reason in bad_reason.

Categories. Pick one primary and up to 2 secondary, only from this list:
${list}
Use Other only when nothing fits, and give suggested_category.

Root cause: product, logistics, policy, app or website, agent, pricing, payment, or none for calls with no problem.

Speakers:
${dual
  ? `- The recording is dual-channel. Lines labelled "agent" are the support agent and lines labelled "customer" are the customer's phone. These labels are reliable. Set agent_speaker to "agent".
- Anyone else speaking comes through the customer's phone. Set third_party_on_call to true if the customer line clearly has another person, for example the phone is passed to a site supervisor.`
  : `- The recording is mono, so speaker labels can be wrong or there may be more than two speakers.
- Work out which label is the agent from what they say: greeting, company name, looking up orders, offering help. Put it in agent_speaker.
- Set third_party_on_call to true if someone else speaks, for example the phone is passed to a site supervisor or family member.`}

Writing:
- key_pointers: 3 to 6 plain lines of what actually happened, in order. Name the product, amount, date or promise when it was said.
- customer_quotes: 1 or 2 short lines the customer said, in English, with the mm:ss timestamp. Pick lines that show the problem or the mood.
- action_items: concrete things the business should fix, not the agent's next step. Empty if there is nothing to fix.
- Never guess. If something was not said on the call, leave that field out.
- transcript_quality: poor if large parts are unreadable or the call is mostly noise.`;
}

export function buildTranscript(segments: { speaker: string | null; start_ms: number | null; text_en: string | null; text_original: string | null }[]): string {
  return segments
    .map((s) => {
      const en = (s.text_en ?? '').trim();
      const orig = (s.text_original ?? '').trim();
      const same = !en || en === orig;
      return `[${mmss(s.start_ms)}] ${s.speaker ?? 'unknown'}: ${same ? orig : `${en}  (original: ${orig})`}`;
    })
    .join('\n');
}

export async function analyseTranscript(transcript: string, meta: { direction: string | null; duration_s: number | null; audio_channels?: number | null }, categories: Category[]) {
  const dual = meta.audio_channels === 2;
  const user = `Call direction: ${meta.direction ?? 'unknown'}. Duration: ${meta.duration_s ?? '?'} seconds.

Transcript:
${transcript}`;
  const result = await callTool<Analysis>({ system: buildSystem(categories, dual), user, tool: buildTool(categories), maxTokens: 3000 });

  // Keep labels inside the fixed list even if the model drifts.
  const names = new Set(categories.map((c) => c.name));
  if (!names.has(result.category)) {
    result.suggested_category = result.suggested_category || result.category;
    result.category = 'Other';
  }
  result.secondary_categories = (result.secondary_categories ?? []).filter((c) => names.has(c) && c !== result.category);
  if (dual) result.agent_speaker = 'agent';
  return { result, model: MODEL(), promptVersion: PROMPT_VERSION };
}

export function isAfterSales(a: Analysis, categories: Category[]): boolean {
  const after = new Set(categories.filter((c) => c.grp === AFTER_SALES_GROUP).map((c) => c.name));
  return after.has(a.category) || (a.secondary_categories ?? []).some((c) => after.has(c));
}