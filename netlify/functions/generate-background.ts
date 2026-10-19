// Background function (name ends in -background): gathers the data, calls the model,
// validates, and stores the day record and job status. Started by /api/generate.
import { z } from "zod";
import { DateStr, type DayRecord } from "../../shared/schemas";
import { requireUser } from "./lib/auth";
import { addDays, weekday } from "./lib/dates";
import { hardDates, loadMetrics } from "./lib/data";
import { generatePlan, provider, type GenerateResult } from "./lib/generator";
import { isDemo } from "./lib/auth";
import { demoSamplePlan } from "./lib/demo";
import { addDemoUsage, demoUsageToday } from "./lib/store";
import { PROMPT_VERSION } from "./lib/coach-prompt";
import { HARD_RULE } from "./lib/intervals";
import { getDay, getSettings, listDays, now, putDay, putJob } from "./lib/store";

const Body = z.object({ jobId: z.string().uuid(), date: DateStr });

// Null fields carry no information for the model and cost tokens.
function dropNulls<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as Partial<T>;
}

function pastPlans(history: DayRecord[], date: string) {
  const from = addDays(date, -14);
  return history
    .filter((d) => d.date >= from && d.date < date && d.plan)
    .map((d) => ({
      date: d.date,
      weekday: d.weekday,
      planned: { sport: d.plan!.sport, title: d.plan!.title, intensity: d.plan!.intensity, minutes: d.plan!.total_minutes },
      feedback: d.feedback
        ? { followed: d.feedback.followed, reason: d.feedback.reason, rpe: d.feedback.rpe, feel: d.feedback.feel }
        : null,
    }));
}

// The demo shares the free Groq quota, so it is capped: per visitor per day and in total.
const DEMO_PER_VISITOR = 5;
async function demoMayUseAi(date: string, events: { type: string; at: string }[]): Promise<boolean> {
  const limit = Number(process.env.DEMO_DAILY_LIMIT ?? 40);
  const mine = events.filter((e) => e.type === "generate").length;
  return mine < DEMO_PER_VISITOR && (await demoUsageToday(date)) < limit;
}

export default async (req: Request): Promise<void> => {
  requireUser(req);
  const { jobId, date } = Body.parse(await req.json());
  await putJob({ id: jobId, date, status: "running", error: null });
  const started = Date.now();
  const startedAt = now();

  try {
    const [day, settings, metrics, history] = await Promise.all([getDay(date), getSettings(), loadMetrics(date), listDays()]);
    if (!day?.checkin) throw new Error("No check-in for this date");
    const { submitted_at: _, ...checkin } = day.checkin;
    const hard = hardDates(date, metrics, history);

    const input = {
      date,
      weekday: weekday(date),
      athlete_profile: settings.profile,
      plan_settings: settings.plan,
      readiness: {
        today: metrics.today,
        baselines_prior_days: metrics.baselines,
        flags: metrics.flags.map((f) => f.rule),
        flag_rule: metrics.flag_rule,
        latest_values_if_today_missing: metrics.latest ?? null,
        form_note: "tsb = ctl - atl (fitness minus fatigue); negative means fatigued",
      },
      athlete_thresholds_and_zones: metrics.thresholds ?? null,
      typical_last_6_weeks: metrics.typical ?? null,
      last_7_days_by_sport: metrics.last7,
      sessions_last_14_days: metrics.activities14.map(({ id: _id, start_local: _s, ...a }) => dropNulls(a)),
      hard_days_last_14: hard,
      hard_rule: HARD_RULE,
      previous_plans_last_14_days: pastPlans(history, date),
      checkin,
    };

    const ctx = { date, checkin, hardDates: hard, maxHardPerWeek: settings.plan.max_hard_per_week };
    let result: GenerateResult;
    let usedSample = false;
    if (isDemo() && !(await demoMayUseAi(date, day.events))) {
      // Public demo over its daily AI budget: a labelled fixed sample instead.
      usedSample = true;
      result = { plan: demoSamplePlan(checkin), error: null, attempts: [{ ok: true, error: null, raw: null }], answeredBy: "demo-sample", inputTokens: 0, outputTokens: 0 };
    } else {
      if (isDemo()) await addDemoUsage(date);
      result = await generatePlan(input, ctx);
    }

    const finishedAt = now();
    day.metrics = metrics;
    day.generation = {
      provider: usedSample ? "demo-sample" : provider().name,
      model: usedSample ? "demo-sample" : provider().model(),
      answered_by: result.answeredBy,
      prompt_version: PROMPT_VERSION,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: Date.now() - started,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      attempts: result.attempts,
      input,
    };
    if (result.plan) {
      if (day.plan) day.previous_plans.push({ plan: day.plan, replaced_at: finishedAt });
      day.plan = result.plan;
      day.events.push({ at: finishedAt, type: "generate", detail: `${result.attempts.length} attempt(s)` });
    } else {
      day.events.push({ at: finishedAt, type: "generate_failed", detail: result.error });
    }
    await putDay(day);
    await putJob({ id: jobId, date, status: result.plan ? "done" : "error", error: result.error });
  } catch (e) {
    console.error(e);
    await putJob({ id: jobId, date, status: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
