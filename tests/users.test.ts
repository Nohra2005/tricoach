import { describe, expect, it } from "vitest";
import { configuredUsers, resolveUser, runAs, currentUser, demoUser } from "../api/lib/users";
import { ActivitySchema, WellnessSchema, getWellness, summarise } from "../api/lib/intervals";
import { demoActivities, demoSamplePlan, demoWellness } from "../api/lib/demo";
import { computeMetrics } from "../api/lib/metrics";
import { checkPlan } from "../api/lib/rules";
import type { CheckIn } from "../shared/schemas";

const env = {
  APP_PASSCODE: "first-pass",
  APP_USER_NAME: "Tatiana",
  INTERVALS_API_KEY: "k1",
  INTERVALS_ATHLETE_ID: "i1",
  USER2_NAME: "Sam",
  USER2_PASSCODE: "second-pass",
  USER2_INTERVALS_API_KEY: "k2",
  USER2_INTERVALS_ATHLETE_ID: "i2",
};
const req = (headers: Record<string, string>) => new Request("https://x/api", { headers });

describe("resolveUser", () => {
  it("picks the account by passcode, with its own storage prefix and keys", () => {
    const a = resolveUser(req({ "x-tricoach-passcode": "first-pass" }), env);
    expect(a).toMatchObject({ id: "u1", name: "Tatiana", storePrefix: "", intervals: { apiKey: "k1", athleteId: "i1" } });
    const b = resolveUser(req({ "x-tricoach-passcode": "second-pass" }), env);
    expect(b).toMatchObject({ id: "u2", name: "Sam", storePrefix: "users/u2/", intervals: { apiKey: "k2", athleteId: "i2" } });
  });

  it("rejects a wrong or missing passcode", () => {
    expect(() => resolveUser(req({ "x-tricoach-passcode": "nope" }), env)).toThrow("Wrong or missing passcode");
    expect(() => resolveUser(req({}), env)).toThrow("Wrong or missing passcode");
  });

  it("gives a demo visitor a sandbox with no intervals.icu access", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const d = resolveUser(req({ "x-tricoach-demo": id }), env);
    expect(d).toMatchObject({ kind: "demo", storePrefix: `demo/${id}/`, intervals: null });
  });

  it("refuses a demo id that is not a UUID (it becomes a storage path)", () => {
    expect(() => resolveUser(req({ "x-tricoach-demo": "../users/u1" }), env)).toThrow("Invalid demo id");
  });

  it("skips accounts without a passcode", () => {
    expect(configuredUsers({ APP_PASSCODE: "a", USER3_NAME: "No passcode" }).map((u) => u.user.id)).toEqual(["u1"]);
  });
});

describe("demo data", () => {
  it("parses with the real intervals.icu schemas and produces metrics", () => {
    const w = demoWellness("2026-09-08", "2026-10-19").map((r) => WellnessSchema.parse(r));
    const a = demoActivities("2026-10-06", "2026-10-19", "2026-10-19").map((r) => summarise(ActivitySchema.parse(r)));
    expect(w).toHaveLength(42);
    expect(a.every((x) => x.date < "2026-10-19")).toBe(true); // nothing "done" today yet
    const m = computeMetrics("2026-10-19", w, a, 0);
    expect(m.today.hrv).not.toBeNull();
    expect(m.baselines.hrv.n28).toBe(28);
    expect(m.last7.swim.sessions + m.last7.bike.sessions + m.last7.run.sessions).toBeGreaterThan(2);
  });

  it("is the same all day for the same date", () => {
    expect(demoWellness("2026-10-19", "2026-10-19")).toEqual(demoWellness("2026-10-19", "2026-10-19"));
  });

  it("serves demo data through the normal client without any API key", async () => {
    const rows = await runAs(demoUser("123e4567-e89b-42d3-a456-426614174000"), () => getWellness("2026-10-13", "2026-10-19"));
    expect(rows).toHaveLength(7);
    expect(() => runAs(demoUser("123e4567-e89b-42d3-a456-426614174000"), () => currentUser().intervals!.apiKey)).toThrow();
  });
});

describe("demo sample plan", () => {
  const base: CheckIn = { energy: 4, soreness: 2, minutes: 60, locations: ["pool"], pain: null };
  const ctx = (c: CheckIn) => ({ date: "2026-10-19", checkin: c, hardDates: [], maxHardPerWeek: 2 });
  const cases: CheckIn[] = [
    base,
    { ...base, locations: ["indoor_trainer"], minutes: 45 },
    { ...base, locations: ["run"], minutes: 25 },
    { ...base, locations: ["gym"], minutes: 40 },
    { ...base, locations: ["run"], pain: "sore calf" },
    { ...base, locations: ["none"] },
    { ...base, locations: ["pool"], minutes: 30, energy: 1 },
  ];
  it.each(cases)("passes the same rule checks as AI plans (%o)", (c) => {
    expect(checkPlan(demoSamplePlan(c), ctx(c))).toEqual([]);
  });
});
