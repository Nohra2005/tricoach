// Local stand-ins for intervals.icu and Groq, so the whole app
// can be exercised without real keys or API spend.
//
//   node scripts/mock-apis.mjs            (listens on http://localhost:8787)
//
// Then in .env:
//   INTERVALS_BASE_URL=http://localhost:8787/intervals/api/v1
//   GROQ_BASE_URL=http://localhost:8787/groq/openai/v1
//   INTERVALS_API_KEY=x  INTERVALS_ATHLETE_ID=i1  GROQ_API_KEY=x  APP_PASSCODE=test
//
// MOCK_PLAN=bad makes the first model answer break a rule, to exercise the retry.
// MOCK_429=1 makes the first Groq call return 429 with retry-after: 2.
// MOCK_NO_TODAY=1 leaves today's HRV, resting HR and sleep out (not synced yet).
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8787);
let modelCalls = 0;
let rateLimited = false;
let lastEvent = null;

function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function wellness() {
  return Array.from({ length: 42 }, (_, i) => {
    const off = i - 41;
    const row = { id: day(off), ctl: 55 + i * 0.1, atl: 60 + (i % 5), restingHR: 48 + (i % 3), weight: 58, sportInfo: [{ type: "Ride", eftp: 196 }] };
    if (i % 7 !== 3) row.hrv = off === 0 ? 38 : 55 + ((i * 7) % 9) - 4; // today low, some days missing
    if (i % 6 !== 2) row.sleepSecs = (7 + (i % 3) * 0.4) * 3600;
    if (off === 0 && process.env.MOCK_NO_TODAY) {
      delete row.hrv;
      delete row.sleepSecs;
      delete row.restingHR;
    }
    return row;
  });
}

const athlete = {
  id: "i1",
  name: "Mock Athlete",
  sportSettings: [
    {
      types: ["Ride", "VirtualRide"],
      ftp: 200,
      indoor_ftp: 190,
      lthr: 165,
      max_hr: 185,
      hr_zones: [138, 151, 158, 165, 171, 176, 185],
      hr_zone_names: ["Recovery", "Aerobic", "Tempo", "SubThreshold", "SuperThreshold", "Aerobic Capacity", "Anaerobic"],
      power_zones: [55, 75, 90, 105, 120, 150, 999],
      power_zone_names: ["Active Recovery", "Endurance", "Tempo", "Threshold", "VO2 Max", "Anaerobic", "Neuromuscular"],
    },
    { types: ["Run", "TrailRun"], lthr: 170, max_hr: 190, threshold_pace: 3.508, pace_units: "MINS_KM", pace_zones: [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999], hr_zones: [140, 153, 160, 170, 175, 180, 190] },
    { types: ["Swim"], threshold_pace: 0.8, pace_units: "SECS_100M", pace_zones: [80, 90, 100, 999] },
  ],
};

function activities() {
  const a = (off, type, mins, dist, load, intensity, extra = {}) => ({
    id: `i${1000 - off}`,
    start_date_local: `${day(off)}T07:30:00`,
    type,
    name: `${type} session`,
    moving_time: mins * 60,
    distance: dist,
    icu_training_load: load,
    icu_intensity: intensity,
    average_heartrate: 140,
    ...extra,
  });
  return [
    a(-1, "Swim", 45, 2000, 35, 70, { pool_length: 25 }),
    a(-2, "VirtualRide", 60, 28000, 62, 78, { icu_average_watts: 160, trainer: true }),
    a(-4, "Run", 50, 8500, 58, 88),
    a(-5, "Swim", 40, 1800, 30, 68),
    a(-8, "Ride", 90, 40000, 85, 72),
    { id: "i1", start_date_local: `${day(-3)}T18:00:00`, source: "STRAVA", _note: "STRAVA activities are not available via the API" },
  ];
}

const goodPlan = {
  sport: "swim",
  title: "Aerobic swim with stroke-length drills",
  total_minutes: 45,
  intensity: "easy",
  steps: [
    { label: "Warm-up", minutes: null, distance_m: 300, target: "Easy, RPE 3", target_spec: { kind: "rpe", low: 3, high: 3 }, reps: null, rest_seconds: null, notes: null },
    { label: "Catch-up drill", minutes: null, distance_m: 50, target: "RPE 4, long strokes", target_spec: { kind: "rpe", low: 4, high: 4 }, reps: 6, rest_seconds: 20, notes: "20 s rest" },
    { label: "Main set", minutes: null, distance_m: 200, target: "2:15 to 2:20/100m", target_spec: { kind: "pace", low: 135, high: 140 }, reps: 4, rest_seconds: 30, notes: "30 s rest" },
    { label: "Cool-down", minutes: null, distance_m: 200, target: "Easy", target_spec: { kind: "none", low: null, high: null }, reps: null, rest_seconds: null, notes: null },
  ],
  why: "HRV is 38 ms, below your normal range of 50 to 60 ms, and form is -6. Sleep was 7.4 h, inside your range. An easy swim keeps the routine without adding load.",
  easier_option: "Swim 1000 m easy with no main set.",
  warnings: ["Stop if you feel unusually tired in the warm-up."],
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = "";
  for await (const chunk of req) body += chunk;
  console.log(req.method, url.pathname + url.search);

  if (url.pathname.startsWith("/intervals/")) {
    if (!req.headers.authorization?.startsWith("Basic ")) return send(res, 401, { error: "no auth" });
    if (url.pathname.endsWith("/wellness")) return send(res, 200, wellness());
    if (url.pathname.endsWith("/activities")) return send(res, 200, activities());
    if (url.pathname.endsWith("/pace-curves")) {
      // Run: critical speed 3.448 m/s (4:50/km). Swim: best 200 m 3:32, 400 m 7:32 (CSS 2:00/100m).
      return send(res, 200, url.searchParams.get("type") === "Swim"
        ? { list: [{ distance: [100, 200, 400], values: [98, 212, 452], paceModels: [] }] }
        : { list: [{ distance: [1000, 5000], values: [250, 1375], paceModels: [{ type: "CS", criticalSpeed: 3.448, r2: 0.97 }] }] });
    }
    if (/\/athlete\/[^/]+$/.test(url.pathname)) return send(res, 200, athlete);
    if (url.pathname.endsWith("/events") && req.method === "POST") {
      const ev = JSON.parse(body);
      console.log("  event:", url.search, JSON.stringify({ category: ev.category, type: ev.type, uid: ev.uid, date: ev.start_date_local, name: ev.name }));
      console.log(ev.description.split("\n").map((l) => "    | " + l).join("\n"));
      // Rough stand-in for intervals.icu parsing: one step per "- " line.
      // MOCK_NOPARSE=labels: descriptions with step labels are "not parsed" (no workout_doc),
      // to exercise the fallback. MOCK_NOPARSE=all: nothing parses.
      const lines = ev.description.split("\n").filter((l) => l.startsWith("- "));
      const hasLabels = lines.some((l) => /^- [A-Za-z]/.test(l));
      const mode = process.env.MOCK_NOPARSE;
      if (mode === "all" || (mode === "labels" && hasLabels)) {
        console.log("  (mock: not parsed)");
        lastEvent = { id: 4242, ...ev };
        return send(res, 200, lastEvent);
      }
      lastEvent = { id: 4242, ...ev, workout_doc: { duration: ev.moving_time, steps: lines.map((l) => ({ text: l })) } };
      return send(res, 200, lastEvent);
    }
    if (/\/events\/\d+$/.test(url.pathname) && req.method === "GET") return send(res, 200, lastEvent ?? {});
  }
  if (url.pathname.startsWith("/groq/openai/v1/models/")) {
    return send(res, 200, { id: url.pathname.split("/models/")[1], object: "model", owned_by: "mock" });
  }
  if (url.pathname === "/groq/openai/v1/chat/completions") {
    if (process.env.MOCK_429 && !rateLimited) {
      rateLimited = true;
      console.log("  groq: returning 429");
      res.writeHead(429, { "content-type": "application/json", "retry-after": "2" });
      return res.end(JSON.stringify({ error: { message: "Rate limit reached", type: "tokens" } }));
    }
    modelCalls++;
    const params = JSON.parse(body);
    const rf = params.response_format;
    console.log("  groq params:", JSON.stringify({ model: params.model, max_completion_tokens: params.max_completion_tokens, reasoning_effort: params.reasoning_effort, format: rf?.type, strict: rf?.json_schema?.strict }));
    const bad = process.env.MOCK_PLAN === "bad" && modelCalls % 2 === 1;
    const plan = bad ? { ...goodPlan, total_minutes: 500 } : goodPlan;
    return send(res, 200, {
      id: `chatcmpl-mock-${modelCalls}`,
      object: "chat.completion",
      model: params.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(plan) } }],
      usage: { prompt_tokens: 3100, completion_tokens: 900, total_tokens: 4000 },
    });
  }
  send(res, 404, { error: `mock has no route for ${url.pathname}` });
}).listen(PORT, () => console.log(`mock APIs on http://localhost:${PORT}`));
