# TriCoach

A personal triathlon coaching PWA for one athlete. Each morning it reads Garmin data through intervals.icu, asks a short check-in, and uses Claude to write that day's session. Every recommendation is logged with the data it was based on, and with whether it was followed, so the history can be exported as research data.

See [PLAN.md](PLAN.md) for the architecture and data model.

## How it works

- **Frontend**: Vite + React + TypeScript, installable as a PWA. The last day is kept on the device so it opens offline.
- **Backend**: Netlify Functions under `/api/*`. All API keys stay on the server. Every function checks the `x-tricoach-passcode` header against `APP_PASSCODE`.
- **Storage**: Netlify Blobs (store `tricoach`): `settings.json`, `days/YYYY-MM-DD.json`, `jobs/<id>.json`.
- **Generation**: `/api/generate` starts the `generate-background` function (15 minute limit), which calls Claude with structured output validated by zod, checks the plan against hard rules (location, time, hard-day spacing, pain), retries once with the errors, and otherwise reports the error. The app polls `/api/job`.
- **Coaching rules**: [netlify/functions/lib/coach-prompt.ts](netlify/functions/lib/coach-prompt.ts). Edit it and redeploy; each plan stores a hash of the prompt that produced it.
- **Athlete profile and plan settings**: edited in the app (Settings tab), stored in Blobs, no redeploy needed.

## Environment variables

Set these in Netlify (Site configuration > Environment variables). Names are in [.env.example](.env.example).

| Name | What |
|---|---|
| `INTERVALS_API_KEY` | intervals.icu > Settings > Developer Settings > API key |
| `INTERVALS_ATHLETE_ID` | Your athlete ID, shown on the same page (looks like `i123456`) |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `ANTHROPIC_MODEL` | Optional. Default `claude-sonnet-5-5`. `claude-haiku-5-5` is much cheaper |
| `APP_PASSCODE` | Any passcode you choose; the app asks for it once per device |

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

[scripts/mock-apis.mjs](scripts/mock-apis.mjs) stands in for intervals.icu and the Anthropic API. Run it, and point the app at it in `.env` (the full list is at the top of the script):

```bash
node scripts/mock-apis.mjs
```

```
INTERVALS_BASE_URL=http://localhost:8787/intervals/api/v1
ANTHROPIC_BASE_URL=http://localhost:8787/anthropic
```

If `ANTHROPIC_BASE_URL` is already set in your shell, Netlify ignores the `.env` value; set it on the command line instead. `MOCK_PLAN=bad` makes the first answer break a rule, to exercise the retry.

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
3. Add the environment variables, then trigger a deploy. Every push to `main` redeploys.

Netlify's Free plan covers functions, background functions and Blobs for one user. The only running cost is the Anthropic API, billed per use.

## First checks after deploying

1. Open `https://<your-site>/api/health` in a browser. Without the passcode it lists which environment variables are set (true/false only).
2. Open the app, enter the passcode, go to Settings > Check connections. It shows your intervals.icu athlete, how many of the last 7 days have HRV, sleep and resting HR, the recent activity types, and whether the Anthropic key and model work.
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
