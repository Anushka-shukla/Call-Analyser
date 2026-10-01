# Call analyzer

Pulls every support call from Exotel, transcribes and translates it with Sarvam, analyses it with Claude, and shows the day's customer experience on a dashboard. Runs entirely on Vercel.

## How it works

Each call moves through statuses in Postgres. One route, `/api/cron/tick`, runs every step at once, and a free scheduler calls it every 5 minutes. This works on Vercel's free Hobby plan.

| Step | Status change |
| --- | --- |
| Webhook `/api/exotel/webhook` (on every call end) | creates the call as `new`, or `dropped` if missed or under 20s |
| Pull from Exotel | same, for calls the webhook missed (last 2 hours) |
| Check audio | `new` to `audio_saved` (copies to Blob only if `KEEP_RECORDINGS=true`) |
| Start transcription | `audio_saved` to `stt_pending` (Sarvam batch job) |
| Collect transcript | `stt_pending` to `transcribed` (plus English translation) |
| Analyse | `transcribed` to `analyzed` (Claude) |
| Day summary `/api/cron/daily-rollup` | writes `daily_summary` and the day brief |

Each step picks a small batch so a run finishes inside 60 seconds. A failed step is retried on the next run. After 3 failed attempts the call is marked `failed` and shows on the Alerts page. Each step also has its own route (`/api/cron/save-audio` and so on) for testing.

## Files

| Path | What it does |
| --- | --- |
| `lib/exotel.ts` | Exotel API: list calls, get one call, download recording |
| `lib/sarvam.ts` | Sarvam batch STT and translation |
| `lib/claude.ts` | Claude client, forces a tool call so output always matches the schema |
| `lib/analysis.ts` | Prompt, JSON schema, category handling (`PROMPT_VERSION` lives here) |
| `lib/steps.ts` | Every pipeline step, plus `tick()` which runs them all |
| `lib/pipeline.ts` | Claiming calls, moving statuses, retries |
| `lib/audio.ts` | Reads a recording from Blob or straight from Exotel |
| `lib/audio-split.ts` | Splits stereo recordings into agent and customer tracks with ffmpeg |
| `lib/cases.ts` | Links after-sales calls into cases across days |
| `lib/metrics.ts` | Every dashboard query |
| `lib/rollup.ts` | Nightly summary and Claude day brief |
| `lib/config.ts` | Thresholds you can tune (dropped call cut-off, batch sizes, alert levels, stuck days) |
| `db/schema.sql` | Tables and the starting category list |
| `app/` | Dashboard pages and API routes |
| `scripts/migrate.mjs` | Applies the schema |
| `scripts/seed-demo.mjs` | Adds made-up calls to preview the dashboard |
| `scripts/check-audio.sh` | Checks if recordings are mono or stereo |

## Setup

You need Node 20 or later, a GitHub account, a Vercel account (the free Hobby plan works), and a free cron-job.org account.

### 1. Put the code on GitHub

```
cd call-analyzer
npm install
git init && git add . && git commit -m "Call analyzer"
```

Create an empty repo on GitHub and push to it.

### 2. Create the Vercel project

1. In Vercel, click Add New, then Project, and import the repo. Framework: Next.js. Leave build settings as they are.
2. Open the project, go to Storage, and add **Postgres** (Neon from the Marketplace, free plan). Connect it to the project. This adds `DATABASE_URL`. If the variable it adds has a different name, add `DATABASE_URL` yourself with the same value.
3. Skip Blob for now. Recordings stay in Exotel and play from there (`KEEP_RECORDINGS=false`). Add a Blob store later only if Exotel's recording links turn out to expire.

### 3. Add the environment variables

In Project Settings, Environment Variables, add everything from `.env.example`:

| Variable | Where to get it |
| --- | --- |
| `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_SID` | Exotel dashboard, Settings, API settings |
| `EXOTEL_SUBDOMAIN` | `api.exotel.com` for Singapore accounts, `api.in.exotel.com` for Mumbai |
| `EXOTEL_WEBHOOK_TOKEN` | Make up a long random string |
| `SARVAM_API_KEY` | dashboard.sarvam.ai |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` |
| `CRON_SECRET` | Make up a long random string. The scheduler sends it on every call. |
| `KEEP_RECORDINGS` | `false` |
| `AUDIO_MODE` | `dual` |
| `AGENT_CHANNEL` | `left` until you've confirmed which side the agent is on |
| `NEXTAUTH_URL` | Your app URL, e.g. `https://call-analyzer.vercel.app` |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Step 4 |
| `ALLOWED_EMAIL_DOMAIN` | Your company email domain, e.g. `yourcompany.com` |
| `BUSINESS_CONTEXT` | Short description of the business, given to Claude. A default is in `.env.example`. |

### 4. Set up Google sign-in

1. Go to Google Cloud Console, APIs and Services, Credentials.
2. Create an OAuth client ID, type Web application.
3. Add these redirect URIs:
   - `https://<your-app>.vercel.app/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
4. Copy the client ID and secret into Vercel.

Only emails ending in `ALLOWED_EMAIL_DOMAIN` can sign in.

### 5. Create the tables

```
npm i -g vercel
vercel link
vercel env pull .env.local
npm run db:migrate
```

Safe to run again. It only adds what's missing.

### 6. Deploy

Push to GitHub, or run `vercel --prod`. `vercel.json` registers one daily Vercel cron at 2:30 AM IST that rebuilds yesterday's summary, as a backup.

### 7. Set up the free scheduler

The Hobby plan only runs Vercel crons once a day, so cron-job.org calls the pipeline instead.

1. Sign up at cron-job.org (free).
2. Create a cron job:
   - URL: `https://<your-app>.vercel.app/api/cron/tick`
   - Schedule: every 5 minutes
   - Advanced, Headers: add `Authorization` with value `Bearer <CRON_SECRET>`
   - Request timeout: 60 seconds
3. Create a second cron job for the day brief:
   - URL: `https://<your-app>.vercel.app/api/cron/daily-rollup`
   - Schedule: every day at 23:30, time zone Asia/Kolkata
   - Same `Authorization` header
4. Click Test run on each. A good response starts with `{"ok":true`.

Check the job history on cron-job.org if calls stop moving. If calls pile up at `transcribed`, raise `BATCH.analyze` in `lib/config.ts` or run the tick every 2 to 3 minutes.

### 8. Point Exotel at the webhook

Set the StatusCallback URL in Exotel to:

```
https://<your-app>.vercel.app/api/exotel/webhook?token=<EXOTEL_WEBHOOK_TOKEN>
```

Where this is set depends on how your calls are routed (flow settings, the Connect applet, or the `StatusCallback` parameter on API calls). Confirm with Exotel for your account. The 15-minute backfill catches calls either way.

### 9. Load today's calls

Open this in a terminal to backfill a full day:

```
curl -H "Authorization: Bearer <CRON_SECRET>" "https://<your-app>.vercel.app/api/cron/pull-exotel?date=2026-09-30"
```

Then wait for the 5-minute tick, or call `/api/cron/tick` yourself with the same header.

## Day-one checks during integration

1. **Stereo recordings.** The code expects dual-channel recordings (`AUDIO_MODE=dual`). It splits each stereo file into an agent track and a customer track and transcribes them separately, so speaker labels come from the channel and are always right. Mono recordings are detected and sent as they are, with Sarvam diarization labelling speakers. See "Stereo setup" below.
2. **Sarvam output.** Open a call in the dashboard and check the transcript and speaker labels against the audio. Sarvam's batch endpoint paths, model names and output fields are all in `lib/sarvam.ts`. Check them against docs.sarvam.ai if a step fails.
3. **Agent numbers.** Check that calls show an agent. The webhook uses `DialWhomNumber`; outbound calls use `From`. If agents show as unknown, find which Exotel field carries the agent for your flows and set it in `normalize()` in `lib/exotel.ts`.
4. **Claude labels.** Hand-check outcome and category on 20 calls. Tune the rules in `buildSystem()` in `lib/analysis.ts`, then bump `PROMPT_VERSION`.

## Stereo setup

1. **Turn on dual-channel recording in Exotel.** For calls placed through Exotel's API, send `Record=true` and `RecordingChannels=dual`. For incoming calls and calls routed through flows, ask your Exotel account manager or support to enable dual-channel recording for your account and flows. I'm not sure whether there's a dashboard toggle for this, so confirm with them.
2. **Check a new recording.** After a few calls, fetch one recording through the API and run `./scripts/check-audio.sh rec.mp3`. It should say `2 channel(s)` and save `rec-left.wav` and `rec-right.wav`.
3. **Find the agent's side.** Listen to both files. If the agent is in `rec-left.wav`, keep `AGENT_CHANNEL=left`. If the agent is in `rec-right.wav`, set `AGENT_CHANNEL=right` in Vercel and redeploy. Check this once for an inbound call and once for an outbound call, because some setups swap sides by direction.
4. **Check the dashboard.** Open a call. Transcript lines should say Agent and Customer, and the words should match who you hear.

To go back to the mono path at any time, set `AUDIO_MODE=mono`.

## Run it on your laptop

```
cp .env.example .env.local      # or: vercel env pull .env.local
# set DATABASE_URL, and AUTH_DISABLED=true to skip login locally
npm run db:migrate
node --env-file=.env.local scripts/seed-demo.mjs   # optional demo data
npm run dev
```

Open http://localhost:3000. Remove the demo data with `node --env-file=.env.local scripts/seed-demo.mjs --clear`.

Trigger a cron locally:

```
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/tick
```

## Day-to-day

**Add agent names** so they show instead of numbers:

```sql
INSERT INTO agents (number, name) VALUES ('+919800000001', 'Priya'), ('+919800000002', 'Rahul')
ON CONFLICT (number) DO UPDATE SET name = EXCLUDED.name;
```

**Promote an Other label to a category** (Alerts shows repeating ones):

```sql
INSERT INTO categories (grp, name) VALUES ('Order and delivery', 'Wrong delivery address');
```

New calls use it straight away. Use `UPDATE categories SET active = false WHERE name = '...'` to retire one.

**Re-run analysis** after a prompt change:

```sql
UPDATE calls SET status = 'transcribed', attempts = 0 WHERE call_sid IN (SELECT call_sid FROM call_analysis WHERE prompt_version = 'v1');
```

**Rebuild a day's summary:** `/api/cron/daily-rollup?date=YYYY-MM-DD` with the cron header.

**Retry failed calls:** `UPDATE calls SET status = 'new', attempts = 0 WHERE status = 'failed';`

## Hobby plan limits to watch

- Vercel's Hobby plan is meant for personal, non-commercial use. Check Vercel's fair use terms before relying on it for company work.
- Functions stop at 60 seconds, which is why batches are small.
- Free Postgres storage is limited. Transcripts are text, so this lasts a while, but check usage in the Neon dashboard monthly.
- With `KEEP_RECORDINGS=false`, playback depends on Exotel keeping the recording. If links expire, old calls lose audio but keep their transcript and analysis.

## Still to confirm

- Dual-channel recording turned on in Exotel for every flow, and which side the agent is on
- Exotel subdomain, recording on for all flows, how long recording links stay valid
- Where Exotel reports the agent's number for your flows
- Sarvam model names, batch limits and pricing
- Claude pricing and rate limits (docs.claude.com), to size batches in `lib/config.ts`
- Expected calls per day
- Brand colour codes (current ones are read from the site banner, in `app/globals.css`)
- Starting thresholds in `lib/config.ts`