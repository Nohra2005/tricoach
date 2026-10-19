# TriCoach: Phase 1 plan

A single-user PWA. Each morning it reads intervals.icu, takes a check-in of under 30 seconds, asks Claude for today's session, and logs the recommendation next to what was actually done.

## 1. Architecture

```
Phone (PWA: Vite + React + TS)
   |  every request sends header  x-tricoach-passcode
   v
Netlify Functions (TS, v2 API, routed under /api/*)
   |-- lib/auth.ts         passcode check (constant-time compare against APP_PASSCODE)
   |-- lib/intervals.ts    typed intervals.icu client (zod-validated)
   |-- lib/metrics.ts      averages, SD, flags, per-sport weekly totals (pure functions, unit tested)
   |-- lib/claude.ts       Anthropic SDK call, zod-validated output, one retry
   |-- lib/rules.ts        hard checks on Claude's output (location, time, hard-day spacing)
   |-- lib/store.ts        Netlify Blobs read/write
   v
intervals.icu API          Anthropic Messages API          Netlify Blobs
```

No key ever reaches the browser. The frontend only knows the passcode, kept in `localStorage` (wrapped in try/catch).

## 2. What I verified in the intervals.icu docs

I read the OpenAPI spec behind https://intervals.icu/api-docs.html (it is served from `https://intervals.icu/api/v1/docs`).

| Your expectation | Verified |
|---|---|
| Base URL `https://intervals.icu/api/v1` | Yes |
| Basic auth, username `API_KEY`, password = key | Yes ("Username is API_KEY, Password is your API key found in /settings") |
| `GET /athlete/{id}/wellness?oldest&newest` | Yes. Path is `/wellness{ext}`, so `/wellness` returns JSON and `/wellness.csv` returns CSV. |
| `GET /athlete/{id}/activities?oldest&newest` | Yes. `oldest` is required. Results come newest first. |
| `GET/POST /athlete/{id}/events` | Yes. POST requires the query param `upsertOnUid`. There is also `POST /events/bulk`. |

Field names I will use:

- **Wellness** (one record per day, `id` is the date): `hrv` (rMSSD), `hrvSDNN`, `restingHR`, `sleepSecs`, `sleepScore`, `sleepQuality`, `avgSleepingHR`, `ctl`, `atl`, `rampRate`, `weight`, `readiness`. Form (TSB) is computed as `ctl - atl`. Every field is optional; a missing field becomes `null` and shows as "no data", never 0.
- **Activities**: `id`, `start_date_local`, `type` (for example `Swim`, `Ride`, `VirtualRide`, `Run`), `name`, `moving_time`, `elapsed_time`, `distance`, `icu_training_load`, `icu_intensity`, `average_heartrate`, `icu_average_watts`, `icu_weighted_avg_watts`, `pace`, `trainer`, `pool_length`, `icu_rpe`.
- **Athlete** (`GET /athlete/{id}`): used by `/api/health` to confirm the ID and key match.

One thing to know: the spec includes a "Hidden" activity shape (`id`, `start_date_local`, `source`, `_note`). That is what intervals.icu returns for activities it received from Strava, which it is not allowed to pass on through the API. **Garmin Connect must be linked to intervals.icu directly, not through Strava**, or your sessions will come back without data. The client will detect these stubs and `/api/health` will report how many it saw.

Sport mapping: `Swim`/`OpenWaterSwim` -> swim; `Ride`/`VirtualRide`/`GravelRide`/`MountainBikeRide` -> bike; `Run`/`TrailRun`/`VirtualRun` -> run; everything else -> other (shown, but not counted in the swim/bike/run balance).

## 3. Generation and the Netlify timeout

I could not confirm the current timeout for synchronous Netlify functions: the docs and support pages say 10 s in some places and 30 s in others. Background functions are documented at 15 minutes and are available on the Free plan. So generation does not depend on the sync limit:

1. `POST /api/generate` (sync): checks the passcode, writes a job `{status: "queued"}` to Blobs, calls the background function internally, and returns `{jobId}` at once.
2. `generate-background` (up to 15 min): gathers data, calls Claude, validates, runs the rule checks, retries once if needed, and writes the day record and `{status: "done" | "error", error?}`.
3. The frontend polls `GET /api/job?id=` every 2 s and shows "Writing today's session...".

**Update (2026-10-19):** to keep the app free, generation now uses Groq's free API (`openai/gpt-oss-120b`, strict JSON schema) by default, behind a small provider interface (`lib/generator.ts`, `lib/providers/`). Claude stays available with `LLM_PROVIDER=anthropic`. The validation, rule checks and retry below are unchanged.

Claude call details (when `LLM_PROVIDER=anthropic`):

- Model: `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5"`.
- Structured outputs (`client.messages.parse` with `zodOutputFormat(PlanSchema)`): the API constrains the reply to the schema and the SDK parses it with zod. Steps use exactly one of `minutes` or `distance_m`, which zod checks with a refine.
- `max_tokens: 4000` (thinking counts against it; the plan itself is about 600 tokens) and `effort: "medium"` to keep latency and cost down.
- **Retry once.** If zod parsing fails, or `rules.ts` finds a violation (pool session when the pool is unavailable, `total_minutes` over the time available, a hard session the day after a hard one, more than 2 hard sessions in the trailing 7 days, a step-minutes sum that does not match `total_minutes`), I send the error text back and ask for a corrected plan. If the second attempt also fails, the user sees the error, and the failed attempts are logged. No plan is invented.
- **Medical override, in code as well as in the prompt.** If the check-in says "pain or illness: something", the prompt requires a rest or see-a-doctor answer for chest pain, fever, illness or injury pain, and `rules.ts` rejects anything above "recovery" intensity in that case.
- **Refusal fallback.** For Sonnet 5.5 the SDK guide recommends enabling Anthropic's server-side `fallbacks: "default"` (a beta) so a rare false-positive safety refusal is retried on another model rather than failing. I plan to turn it on and log which model actually answered. Say if you would rather leave it off.

## 4. Data model (Netlify Blobs, one store `tricoach`)

```
settings/profile.json      athlete profile (your defaults, editable)
settings/plan.json         goal race + date, FTP, swim days, set sessions, hard-session cap
days/2026-10-19.json       one record per day (below)
jobs/<uuid>.json           generation job status (deleted after 1 day)
```

A day record is the research unit:

```jsonc
{
  "date": "2026-10-19", "weekday": "Monday",
  "metrics":  { /* snapshot: hrv, rhr, sleep, ctl/atl/tsb, 7/28-day means and SDs, per-sport 7-day totals */ },
  "flags":    [ { "metric": "hrv", "value": 41, "mean28": 55, "sd28": 8, "rule": "below mean - 1 SD (47)" } ],
  "checkin":  { "energy": 3, "soreness": 2, "motivation": 4, "stress": 3, "minutes": 60,
                "locations": ["pool","run"], "pain": null, "submitted_at": "..." },
  "generation": { "model": "...", "answered_by": "...", "prompt_version": "<hash of coach-prompt.ts>",
                  "attempts": [ { "ok": false, "error": "..." } ], "latency_ms": 0,
                  "input_tokens": 0, "output_tokens": 0, "input": { /* exact payload sent */ } },
  "plan":     { /* the validated Claude JSON */ },
  "feedback": { "followed": "as_planned|modified|skipped", "reason": "...", "rpe": 6, "feel": 4,
                "notes": "...", "submitted_at": "..." },
  "matched_activity": { "id": "...", "type": "Swim", "moving_time": 2700, "load": 38, "match_rule": "same date + sport, longest" },
  "events":   [ { "at": "...", "type": "checkin|generate|regenerate|feedback|match" } ]
}
```

Storing the exact input and the prompt version means every recommendation can be traced to what Claude saw, and that matters for the Media Lab write-up.

## 5. Metric rules (shown in the UI, not hidden)

- Baselines use the 28 days **before** today (today excluded) and the 7 days before today.
- Flag when `|today - mean28| > 1 SD28`. The UI prints the rule and the numbers, for example "HRV 41 ms. Normal range 47 to 63 (28-day mean 55 +/- 1 SD). Below range."
- At least 10 valid days are needed in the window; otherwise it shows "not enough data for a range".
- Applied to HRV, resting HR and sleep duration. CTL/ATL/TSB are shown, not flagged.
- Last 7 days per sport: count, total time, total load.

## 6. File tree

```
tricoach/
  PLAN.md  README.md  .env.example  .gitignore
  netlify.toml                 build, functions dir, /api redirects, node 20
  package.json  tsconfig.json  vite.config.ts  index.html
  public/                      icons (192, 512, maskable)
  src/
    main.tsx  App.tsx  styles.css
    api.ts                     fetch wrapper, adds passcode header, typed with shared zod schemas
    storage.ts                 safe localStorage (passcode, last day record for offline)
    screens/ Today.tsx  CheckIn.tsx  Session.tsx  Feedback.tsx  History.tsx  Settings.tsx  Passcode.tsx
    components/ MetricCard.tsx  TapScale.tsx  StepList.tsx  NoData.tsx
  shared/
    schemas.ts                 zod: Plan, CheckIn, Feedback, DayRecord, Settings (used by both sides)
  netlify/functions/
    health.ts                  GET  /api/health
    today.ts                   GET  /api/today?date=      metrics + flags + day record
    checkin.ts                 POST /api/checkin
    generate.ts                POST /api/generate          -> starts job
    generate-background.ts     background worker
    job.ts                     GET  /api/job?id=
    feedback.ts                POST /api/feedback          (also runs activity matching)
    match.ts                   POST /api/match             re-match days still missing an activity
    history.ts                 GET  /api/history  (+ ?format=csv|json for export)
    settings.ts                GET/PUT /api/settings
    lib/ auth.ts intervals.ts metrics.ts claude.ts rules.ts store.ts http.ts
    coach-prompt.ts            system prompt, editable, versioned by hash
  tests/
    metrics.test.ts  rules.test.ts  intervals.test.ts (fixtures, including null-heavy days)
```

Tests run with Vitest. Metrics and rules are pure functions, so they get real tests; the Claude call is tested with a recorded fixture, not live.

## 7. Screens

- **Today**: readiness cards (HRV, RHR, sleep, CTL/ATL/TSB) with range bars and the rule text, 7-day sport totals, then a "Check in" button, or the plan if one exists.
- **Check-in**: one screen of tap rows (1 to 5 for each scale), minute chips (0/30/45/60/75/90/120 plus custom), location toggles, a pain toggle that opens a text field. Submitting it starts generation.
- **Session**: title, intensity badge, steps, why, easier option, warnings. "Regenerate" (logged), "Log feedback".
- **History**: newest first, one card per day, expandable. Export CSV / JSON.
- **Settings**: profile and plan fields, passcode reset.
- Offline: the service worker caches the app shell; the last day record is kept in localStorage, so the most recent plan opens with no signal.

## 8. Build order (one or more small commits each)

1. Scaffold: Vite/React/TS, Netlify config, `.env.example`, auth helper, `/api/health` (checks both keys, lists which wellness and activity fields came back and how often they are null).
2. intervals client + fixtures + tests; a test call through `/api/health`.
3. Metrics and flags + Today screen.
4. Check-in + Blobs storage.
5. coach-prompt.ts, Claude client, rules, background generation, Session screen.
6. Feedback + activity matching.
7. History + CSV/JSON export.
8. Settings.
9. PWA (manifest, icons, service worker, offline last plan).
10. README, deploy, smoke test on the live URL.

## 9. Things you need to do or decide

- **Repo**: this session has no git repository yet. I will `git init` a new `tricoach` repo unless you point me at an existing one. For Netlify, either connect a GitHub repo in the Netlify UI (auto-deploy on push) or I deploy with the Netlify CLI after you run `netlify login` yourself.
- **Keys**: you set the five environment variables in the Netlify UI (Site configuration > Environment variables) or with `netlify env:set`. I will not handle the key values.
- **Garmin -> intervals.icu**: confirm Garmin Connect is linked directly (see section 2).
- **Phase 2 groundwork**: the plan schema already stores steps in a structured form, so "send to watch" can later be converted to intervals.icu's workout text format without changing stored data.
