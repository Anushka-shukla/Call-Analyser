// Adds ~14 days of made-up calls so you can see the dashboard before Exotel is connected.
// Remove them with: node --env-file=.env.local scripts/seed-demo.mjs --clear
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is missing'); process.exit(1); }
const db = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await db.connect();

await db.query(`DELETE FROM after_sales_cases WHERE call_sids[1] LIKE 'demo-%'`);
await db.query(`DELETE FROM calls WHERE call_sid LIKE 'demo-%'`);
await db.query(`DELETE FROM agents WHERE number LIKE '+9100000%'`);
if (process.argv.includes('--clear')) { console.log('Demo data removed.'); await db.end(); process.exit(0); }

const agents = [['+910000000001', 'Priya'], ['+910000000002', 'Rahul'], ['+910000000003', 'Farhan'], ['+910000000004', 'Meena']];
for (const [n, name] of agents) await db.query('INSERT INTO agents (number, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [n, name]);

const cats = (await db.query('SELECT grp, name FROM categories')).rows;
const groupOf = Object.fromEntries(cats.map((c) => [c.name, c.grp]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const weighted = [
  ['Order status', 'Where is my order, placed 3 days ago', 'logistics'],
  ['Delivery delay', 'Delivery slot missed for cement bags', 'logistics'],
  ['Cashback or wallet credit', 'Cashback not credited after fulfilment', 'policy'],
  ['Bulk pricing', 'Asked for price on 200 bags of cement', 'pricing'],
  ['Product availability', 'Tile model out of stock in their pincode', 'product'],
  ['Return request', 'Wants to return extra putty bags', 'policy'],
  ['Replacement request', 'Tiles arrived broken', 'logistics'],
  ['Refund status', 'Refund for cancelled order not received', 'payment'],
  ['Pickup issue', 'Pickup agent did not come', 'logistics'],
  ['Placing a new order', 'Placing order for plumbing fittings', 'none'],
  ['Payment issue', 'UPI payment debited but order not placed', 'payment'],
  ['App or website issue', 'Could not apply coupon on app', 'app or website'],
];
const products = ['UltraTech cement, 50 bags', 'Kajaria floor tiles, 40 boxes', 'Birla White putty, 20 bags', 'Fevicol SH, 10 kg', 'Roff tile adhesive, 15 bags'];
const reasons = { 'Replacement request': 'damaged in transit', 'Return request': 'excess from bulk order', 'Refund status': 'other', 'Pickup issue': 'damaged in transit' };
const stages = ['pickup pending', 'pickup missed', 'refund pending', 'approved', 'refund credited'];

let n = 0;
const now = Date.now();
for (let d = 13; d >= 0; d--) {
  const perDay = 30 + Math.floor(Math.random() * 25) + (d === 0 ? 10 : 0);
  for (let i = 0; i < perDay; i++) {
    n++;
    const sid = `demo-${d}-${i}`;
    const start = new Date(now - d * 86400000 - Math.floor(Math.random() * 11 * 3600000));
    const missed = Math.random() < 0.12;
    const dur = missed ? 0 : 40 + Math.floor(Math.random() * 400);
    const [agentNum] = pick(agents);
    const customer = `+9198${String(10000000 + Math.floor(Math.random() * 400)).padStart(8, '0')}`;
    const status = missed ? 'dropped' : 'analyzed';
    await db.query(
      `INSERT INTO calls (call_sid, direction, from_number, to_number, customer_number, agent_number, started_at, duration_s, exotel_status, status)
       VALUES ($1,'inbound',$2,'+918000000000',$2,$3,$4,$5,$6,$7)`,
      [sid, customer, agentNum, start.toISOString(), dur, missed ? 'no-answer' : 'completed', status],
    );
    if (missed) continue;

    let [category, sub, cause] = pick(weighted);
    if (d === 0 && Math.random() < 0.25) [category, sub, cause] = weighted[2];
    const bad = Math.random() < (cause === 'none' ? 0.05 : 0.35);
    const outcome = bad ? 'bad' : Math.random() < 0.6 ? 'good' : 'neutral';
    const isAS = groupOf[category] === 'After-sales';
    const after = isAS ? { request_type: category.startsWith('Replacement') ? 'replacement' : category.startsWith('Refund') ? 'refund' : 'return',
      reason: reasons[category] ?? 'other', product_mentioned: pick(products), stage: pick(stages), timeline_given: 'within 48 hours',
      is_follow_up: bad, customer_accepted: bad ? 'no' : 'yes' } : null;
    const s = () => 2 + Math.floor(Math.random() * 4);
    await db.query(
      `INSERT INTO call_analysis (call_sid, outcome, bad_reason, category, category_group, sub_reason, root_cause, resolved,
         is_follow_up, sentiment_start, sentiment_end, score_greeting, score_understood, score_next_step, score_empathy, score_hold,
         key_pointers, customer_quotes, action_items, churn_risk, language, after_sales, third_party_on_call, agent_speaker,
         transcript_quality, model, prompt_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,false,'SPEAKER_00',$23,'demo','demo')`,
      [sid, outcome, bad ? 'Customer ended unhappy with no clear next step' : null, category, groupOf[category], sub, cause,
       bad ? 'no' : 'yes', bad && Math.random() < 0.5, 2, bad ? 1 : 4, s(), s(), s(), s(), s(),
       JSON.stringify([`Customer called about: ${sub.toLowerCase()}`, 'Agent checked the order details', bad ? 'No timeline given' : 'Agent gave a clear next step']),
       JSON.stringify([{ timestamp: '0:42', quote: bad ? 'I have called three times already' : 'Okay, thank you' }]),
       JSON.stringify(bad ? [`Fix: ${sub.toLowerCase()}`] : []),
       bad ? pick(['medium', 'high']) : 'low', pick(['Hindi', 'Hinglish', 'Kannada', 'English', 'Tamil']),
       after ? JSON.stringify(after) : null, Math.random() < 0.05 ? 'poor' : 'good'],
    );
    if (after) {
      await db.query(
        `INSERT INTO after_sales_cases (customer_number, product, request_type, reason, first_call_at, last_call_at, latest_stage,
           timeline_given, promise_missed, call_count, call_sids, is_open)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,ARRAY[$10],$11)`,
        [customer, after.product_mentioned, after.request_type, after.reason, start.toISOString(), after.stage,
         after.timeline_given, bad, bad ? 2 : 1, sid, after.stage !== 'refund credited'],
      );
    }
  }
}
await db.end();
console.log(`Added ${n} demo calls.`);
