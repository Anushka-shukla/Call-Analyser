-- Customer Call Analyzer schema. Safe to run more than once.

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  grp         TEXT NOT NULL,
  name        TEXT NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  number  TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS calls (
  call_sid         TEXT PRIMARY KEY,
  direction        TEXT,
  from_number      TEXT,
  to_number        TEXT,
  customer_number  TEXT,
  agent_number     TEXT,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_s       INT,
  exotel_status    TEXT,
  recording_url    TEXT,
  recording_blob   TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','audio_saved','stt_pending','transcribed','analyzed','dropped','failed')),
  attempts         INT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  sarvam_job_id    TEXT,
  language         TEXT,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS audio_channels INT;

CREATE INDEX IF NOT EXISTS calls_status_idx   ON calls (status, started_at);
CREATE INDEX IF NOT EXISTS calls_started_idx  ON calls (started_at);
CREATE INDEX IF NOT EXISTS calls_customer_idx ON calls (customer_number, started_at);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id             BIGSERIAL PRIMARY KEY,
  call_sid       TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
  idx            INT NOT NULL,
  speaker        TEXT,
  start_ms       INT,
  end_ms         INT,
  text_original  TEXT,
  text_en        TEXT,
  language       TEXT,
  UNIQUE (call_sid, idx)
);

CREATE TABLE IF NOT EXISTS call_analysis (
  call_sid              TEXT PRIMARY KEY REFERENCES calls(call_sid) ON DELETE CASCADE,
  outcome               TEXT NOT NULL,
  bad_reason            TEXT,
  category              TEXT NOT NULL,
  category_group        TEXT,
  secondary_categories  TEXT[] NOT NULL DEFAULT '{}',
  suggested_category    TEXT,
  sub_reason            TEXT,
  root_cause            TEXT,
  resolved              TEXT,
  pending_items         TEXT,
  is_follow_up          BOOLEAN,
  sentiment_start       INT,
  sentiment_end         INT,
  score_greeting        INT,
  score_understood      INT,
  score_next_step       INT,
  score_empathy         INT,
  score_hold            INT,
  key_pointers          JSONB NOT NULL DEFAULT '[]',
  customer_quotes       JSONB NOT NULL DEFAULT '[]',
  action_items          JSONB NOT NULL DEFAULT '[]',
  churn_risk            TEXT,
  language              TEXT,
  after_sales           JSONB,
  third_party_on_call   BOOLEAN,
  agent_speaker         TEXT,
  transcript_quality    TEXT,
  model                 TEXT,
  prompt_version        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analysis_category_idx ON call_analysis (category);
CREATE INDEX IF NOT EXISTS analysis_outcome_idx  ON call_analysis (outcome);

CREATE TABLE IF NOT EXISTS after_sales_cases (
  case_id          BIGSERIAL PRIMARY KEY,
  order_id         TEXT,
  customer_number  TEXT,
  product          TEXT,
  request_type     TEXT,
  reason           TEXT,
  first_call_at    TIMESTAMPTZ NOT NULL,
  last_call_at     TIMESTAMPTZ NOT NULL,
  latest_stage     TEXT,
  timeline_given   TEXT,
  promise_missed   BOOLEAN NOT NULL DEFAULT false,
  call_count       INT NOT NULL DEFAULT 1,
  call_sids        TEXT[] NOT NULL DEFAULT '{}',
  is_open          BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS cases_order_idx    ON after_sales_cases (order_id);
CREATE INDEX IF NOT EXISTS cases_customer_idx ON after_sales_cases (customer_number, last_call_at);

CREATE TABLE IF NOT EXISTS daily_summary (
  day         DATE PRIMARY KEY,
  data        JSONB NOT NULL,
  brief       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categories (grp, name) VALUES
  ('Before purchase',    'Bulk pricing'),
  ('Before purchase',    'Product availability'),
  ('Before purchase',    'Product details or specs'),
  ('Before purchase',    'Placing a new order'),
  ('Order and delivery', 'Order status'),
  ('Order and delivery', 'Delivery delay'),
  ('Order and delivery', 'Delivery slot or address change'),
  ('Order and delivery', 'Payment issue'),
  ('Offers and wallet',  'Cashback or wallet credit'),
  ('Offers and wallet',  'Coupon or offer not applied'),
  ('After-sales',        'Return request'),
  ('After-sales',        'Replacement request'),
  ('After-sales',        'Exchange'),
  ('After-sales',        'Refund status'),
  ('After-sales',        'Pickup issue'),
  ('After-sales',        'Return or replacement rejected'),
  ('After-sales',        'Cancellation'),
  ('Service',            'Complaint about agent'),
  ('Service',            'App or website issue'),
  ('Other',              'Other')
ON CONFLICT (name) DO NOTHING;