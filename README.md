# TriCoach

A personal triathlon coaching PWA for one athlete. Each morning it reads Garmin data through intervals.icu, asks a short check-in, and uses a language model to write that day's session. It runs entirely on free tiers: Netlify Free, intervals.icu, and Groq's free API. Every recommendation is logged with the data it was based on, and with whether it was followed, so the history can be exported as research data.

See [PLAN.md](PLAN.md) for the architecture and data model.

## How it works

- **Frontend**: Vite + React + TypeScript, installable as a PWA. The last day is kept on the device so it opens offline.
- **Backend**: Netlify Functions under `/api/*`. All API keys stay on the server. Every function checks the `x-tricoach-passcode` header against `APP_PASSCODE`.
- **Storage**: Netlify Blobs (store `tricoach`): `settings.json`, `days/YYYY-MM-DD.json`, `jobs/<id>.json`.
- **Generation**: `/api/generate` starts the `generate-background` function (15 minute limit), which calls the model (Groq `openai/gpt-oss-120b` by default) with strict JSON-schema output validated by zod, checks the plan against hard rules (location, time, hard-day spacing, pain), retries once with the errors, and otherwise reports the error. A free-tier rate limit (HTTP 429) is waited out using `retry-after`. The app polls `/api/job`.
- **Coaching rules**: [netlify/functions/lib/coach-prompt.ts](netlify/functions/lib/coach-prompt.ts). Edit it and redeploy; each plan stores a hash of the prompt that produced it.
- **Athlete profile and plan settings**: edited in the app (Settings tab), stored in Blobs, no redeploy needed.

## Environment variables

Set these in Netlify (Site configuration > Environment variables). Names are in [.env.example](.env.example).

| Name | What |
|---|---|
| `INTERVALS_API_KEY` | intervals.icu > Settings > Developer Settings > API key |
| `INTERVALS_ATHLETE_ID` | Your athlete ID, shown on the same page (looks like `i123456`) |
| `APP_PASSCODE` | Any passcode you choose; the app asks for it once per device |
| `GROQ_API_KEY` | Free: console.groq.com > API Keys |
| `GROQ_MODEL` | Optional. Default `openai/gpt-oss-120b` (must support strict structured outputs) |

Groq does not keep inference request data by default ([their data page](https://console.groq.com/docs/your-data)). Your exact free-tier limits are in your Groq account under Settings > Limits; the app needs about 1 to 3 requests a day.

Garmin Connect must be linked to intervals.icu **directly**. Activities that reach intervals.icu through Strava come back from its API as empty stubs; the app counts them and tells you.

## Local development

```bash
npm install
```

Create a `.env` file (git-ignored) with the variables above, then:

```bash
npx netlify dev
```

This serves the app and the functions together at http://localhost:8888, with a local Blobs store. `npm run dev` alone serves only the frontend.

### Testing without real keys or API spend

[scripts/mock-apis.mjs](scripts/mock-apis.mjs) stands in for intervals.icu and Groq. Run it, and point the app at it in `.env` (the full list is at the top of the script):

```bash
node scripts/mock-apis.mjs
```

```
INTERVALS_BASE_URL=http://localhost:8787/intervals/api/v1
GROQ_BASE_URL=http://localhost:8787/groq/openai/v1
```

`MOCK_PLAN=bad` makes the first answer break a rule, to exercise the retry; `MOCK_429=1` makes the first Groq call rate-limited. Variables already set in your shell win over `.env`.

If `npm install` fails with "The token '||' is not a valid statement separator", npm is set to run scripts with Windows PowerShell 5.1. Add `--script-shell=cmd.exe` to the install command.

Tests and type checks:

```bash
npm test
```

```bash
npm run typecheck
```

## Deploy (free)

1. Push this repo to GitHub.
2. In Netlify: Add new project > Import an existing project > GitHub > pick the repo. The build settings come from `netlify.toml` (`npm run build`, publish `dist`, functions in `netlify/functions`).
3. Add the environment variables, then trigger a deploy. Every push to `main` that changes the site redeploys.

Netlify's Free plan has 300 credits a month and a production deploy costs 15, so about 20 deploys a month; the app's own compute and bandwidth are a few credits. To stay inside it:
- `netlify.toml` skips the build when a push only changes README, tests, CI or scripts.
- Push several commits at once rather than one push per commit.

Netlify's pricing page lists automatic credit top-ups only for paid plans, so the Free plan should not bill you; check that no card is on your Netlify account to be sure.

[CI](.github/workflows/ci.yml) runs the type check, tests and build on GitHub Actions for every push; it does not use Netlify credits.

## First checks after deploying

1. Open `https://<your-site>/api/health` in a browser. Without the passcode it lists which environment variables are set (true/false only).
2. Open the app, enter the passcode, go to Settings > Check connections. It shows your intervals.icu athlete, how many of the last 7 days have HRV, sleep and resting HR, the recent activity types, and whether the Groq key and model work.
3. Fill in your goal race and FTP in Settings, then do a check-in on Today.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Key and data-field check |
| GET | `/api/today?date=` | Metrics and the stored day |
| POST | `/api/checkin` | `{date, checkin}` |
| POST | `/api/generate` | `{date}`, returns `{jobId}` |
| GET | `/api/job?id=` | Generation status |
| POST | `/api/feedback` | `{date, feedback}`, also matches the recorded activity |
| POST | `/api/match` | Re-match recent days with no recorded activity |
| GET | `/api/history[?format=csv\|json]` | All days, or an export download |
| GET/PUT | `/api/settings` | Profile and plan settings |
