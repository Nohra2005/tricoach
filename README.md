# TriCoach

A personal triathlon coaching PWA for one athlete. Each morning it reads Garmin data through intervals.icu, asks a short check-in, and uses a language model to write that day's session. It runs entirely on free tiers: Cloudflare Workers Free, intervals.icu, and Groq's free API. Every recommendation is logged with the data it was based on, and with whether it was followed, so the history can be exported as research data.

See [PLAN.md](PLAN.md) for the architecture and data model.

**Try it:** [triathloncoach.netlify.app/?demo](https://triathloncoach.netlify.app/?demo) opens a demo with a made-up athlete. No passcode needed.

## How it works

- **Frontend**: Vite + React + TypeScript, installable as a PWA. The last day is kept on the device so it opens offline.
- **Backend**: one Cloudflare Worker ([api/worker.ts](api/worker.ts)) serves the app's files and the routes under `/api/*` (one file per route in [api/](api)). All API keys stay on the server. Every request carries either a passcode (`x-tricoach-passcode`), which picks the account, or a demo sandbox id (`x-tricoach-demo`).
- **Accounts**: up to 5 athletes, each with their own passcode, intervals.icu key, settings and history ([users.ts](api/lib/users.ts)). Each account's data is stored under its own prefix; account 1 uses the original keys.
- **Storage**: a Cloudflare D1 database with one key/value table ([db.ts](api/lib/db.ts)): `settings.json`, `days/YYYY-MM-DD.json`, `jobs/<id>.json` under each account's prefix. The table is created on first use.
- **Generation**: `/api/generate` puts a job on a Cloudflare Queue; the Worker's queue handler ([generation.ts](api/lib/generation.ts), up to 15 minutes) calls the model (Groq `openai/gpt-oss-120b` by default) with strict JSON-schema output validated by zod, checks the plan against hard rules (location, time, hard-day spacing, pain), retries once with the errors, and otherwise reports the error. A free-tier rate limit (HTTP 429) is waited out using `retry-after`. The app polls `/api/job`.
- **Coaching rules**: [api/lib/coach-prompt.ts](api/lib/coach-prompt.ts). Edit it and redeploy; each plan stores a hash of the prompt that produced it.
- **Your data (read-only)**: FTP, run threshold pace, swim CSS and heart rate zones are measured from the athlete's own sessions ([thresholds.ts](api/lib/thresholds.ts)). Nothing typed in is used; values typed in intervals.icu are shown as "not used". Where there is not enough data the app says what is missing and coaches by heart rate or effort.
- **Preferences**: races, weekly schedule (minutes and usual place per day), fixed sessions, a one-week change, races finished, equipment, long ride/run day, max sessions per sport, strength, hard sessions per week, phase, one-sided breathing, returning from injury and a short note. Edited in Settings > Preferences, stored in the database, no redeploy needed. Older free-text profiles are migrated on read ([settings-migrate.ts](api/lib/settings-migrate.ts)).

## Environment variables

Set these in Cloudflare (Workers & Pages > tricoach > Settings > Variables and Secrets), as **Secret** for keys and passcodes. Names are in [.env.example](.env.example).

| Name | What |
|---|---|
| `APP_USER_NAME` | Optional. Name shown for account 1 |
| `INTERVALS_API_KEY` | intervals.icu > Settings > Developer Settings > API key |
| `INTERVALS_ATHLETE_ID` | Your athlete ID, shown on the same page (looks like `i123456`) |
| `APP_PASSCODE` | Any passcode you choose; the app asks for it once per device |
| `GROQ_API_KEY` | Free: console.groq.com > API Keys |
| `GROQ_MODEL` | Optional. Default `openai/gpt-oss-120b` (must support strict structured outputs) |

**More accounts:** for account 2, add `USER2_NAME`, `USER2_PASSCODE`, `USER2_INTERVALS_API_KEY` and `USER2_INTERVALS_ATHLETE_ID` (up to `USER5_...`). Each person needs their own free intervals.icu account linked to their own Garmin. Passcodes must all differ; `/api/health` warns if two match. Cloudflare applies new variables straight away, without a deploy.

Groq does not keep inference request data by default ([their data page](https://console.groq.com/docs/your-data)). Your exact free-tier limits are in your Groq account under Settings > Limits; the app needs about 1 to 3 requests a day.

Garmin Connect must be linked to intervals.icu **directly**. Activities that reach intervals.icu through Strava come back from its API as empty stubs; the app counts them and tells you.

## Local development

```bash
npm install
```

Create a `.dev.vars` file (git-ignored) with the variables above, build the app, then start the Worker locally (local database and queue, nothing in your Cloudflare account is touched):

```bash
npm run build
```

```bash
npx wrangler dev --local --port 8790
```

This serves the app and the API at http://localhost:8790. On Windows, if the database gives "internal error", the project folder path is too long for SQLite; add `--persist-to C:	mp	ricoach` to keep the local data in a short path. `npm run dev` alone serves only the frontend.

### Testing without real keys or API spend

[scripts/mock-apis.mjs](scripts/mock-apis.mjs) stands in for intervals.icu and Groq. Run it, and point the app at it in `.dev.vars` (the full list is at the top of the script):

```bash
node scripts/mock-apis.mjs
```

```
INTERVALS_BASE_URL=http://localhost:8787/intervals/api/v1
GROQ_BASE_URL=http://localhost:8787/groq/openai/v1
```

`MOCK_PLAN=bad` makes the first answer break a rule, to exercise the retry; `MOCK_429=1` makes the first Groq call rate-limited. 

If `npm install` fails with "The token '||' is not a valid statement separator", npm is set to run scripts with Windows PowerShell 5.1. Add `--script-shell=cmd.exe` to the install command.

Tests and type checks:

```bash
npm test
```

```bash
npm run typecheck
```

## Deploy (free)

1. Create a free Cloudflare account (no card needed).
2. Create the database and the queue (once): `npx wrangler login`, then `npx wrangler d1 create tricoach` and `npx wrangler queues create tricoach-jobs`. Put the database id it prints into [wrangler.jsonc](wrangler.jsonc).
3. Deploy: `npm run build`, then `npx wrangler deploy`. The app is at `https://tricoach.<your-subdomain>.workers.dev`.
4. Add the variables above as secrets in the Cloudflare dashboard.
5. To deploy on every push: Workers & Pages > tricoach > Settings > Build > connect the GitHub repo, build command `npm run build`, deploy command `npx wrangler deploy`.

The free plan has 100,000 requests a day, 10 ms of CPU per request (the app needs about 2 to 4 ms), 10,000 queue operations a day, and no charge per deploy. Nothing is billed without a paid plan.

**Moving data from the old Netlify site:** on the old site, Settings > Export > Export JSON; on the new one, Settings > Export > Import, and pick that file. `netlify.toml` now skips every Netlify build, so the old site stays as it is and uses no credits.

[CI](.github/workflows/ci.yml) runs the type check, tests and build on GitHub Actions for every push.

## The public demo (for reviewers)

Send people [triathloncoach.netlify.app/?demo](https://triathloncoach.netlify.app/?demo), or they can tap **Try the demo** on the sign-in screen.

- **Made-up data only.** The demo athlete's six weeks of HRV, sleep, resting HR, fitness and sessions are generated ([demo.ts](api/lib/demo.ts)) in the same shape as the intervals.icu API, so the real metrics, AI and rule code run on them. The demo never calls intervals.icu and cannot read any real account.
- **Private sandbox per visitor.** The browser keeps a random id; each visitor's check-ins, sessions and feedback are stored under `demo/<id>/`. Exit demo (top banner or Settings) forgets it.
- **Real AI, capped.** Sessions are written live by the same model, up to 5 per visitor per day and `DEMO_DAILY_LIMIT` (default 40) across all visitors, so the free Groq quota is protected. Past the cap the demo shows a fixed sample session that is clearly labelled and still passes the same rule checks.
- **Send to watch is simulated.** It shows the exact workout text that would go to intervals.icu and Garmin.

**Sharing the code:** the repository is private. Either add reviewers on GitHub (Settings > Collaborators), or make it public after checking you are happy for the default athlete profile in [defaults.ts](api/lib/defaults.ts) and [PLAN.md](PLAN.md) to be public. No keys or passcodes are in the repository.

## First checks after deploying

1. Open `https://<your-site>/api/health` in a browser. Without the passcode it lists which environment variables are set (true/false only).
2. Open the app, enter the passcode, go to Settings > Connections. It shows your intervals.icu athlete, how many of the last 7 days have HRV, sleep and resting HR, the recent activity types, and whether the Groq key and model work.
3. Fill in your races and weekly schedule in Settings > Preferences, check Settings > Your data, then do a check-in on Today.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Key and data-field check |
| GET | `/api/me` | Which account the passcode (or demo id) belongs to |
| GET | `/api/today?date=` | Metrics and the stored day |
| POST | `/api/checkin` | `{date, checkin}` |
| POST | `/api/generate` | `{date}`, returns `{jobId}` |
| GET | `/api/job?id=` | Generation status |
| POST | `/api/feedback` | `{date, feedback}`, also matches the recorded activity |
| POST | `/api/match` | Re-match recent days with no recorded activity |
| GET | `/api/history[?format=csv\|json]` | All days, or an export download |
| GET/PUT | `/api/settings` | Preferences |
| POST | `/api/delete-data` | `{confirm: "DELETE"}`, deletes this account's TriCoach data (not intervals.icu or Garmin) |
| POST | `/api/send-workout` | `{date}`, puts the session on the intervals.icu calendar (simulated in the demo) |
