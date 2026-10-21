import { describe, expect, it } from "vitest";
import { Plan, type CheckIn } from "../shared/schemas";
import { generatePlan } from "../api/lib/generator";
import { strictSchema } from "../api/lib/providers/groq";
import { ProviderError, type Provider, type ProviderAnswer } from "../api/lib/providers/types";

const checkin: CheckIn = { energy: 4, soreness: 2, motivation: 4, stress: 2, minutes: 60, locations: ["run"], pain: null };
const ctx = { date: "2026-10-19", checkin, hardDates: [] as string[], maxHardPerWeek: 2 };
const plan = {
  sport: "run",
  title: "Easy run",
  total_minutes: 40,
  intensity: "easy",
  steps: [
    { label: "Run", minutes: 40, distance_m: null, target: "Z2", target_spec: { kind: "hr_zone", low: 2, high: 2 }, reps: null, rest_seconds: null, notes: null },
  ],
  why: "HRV 52 ms is in range.",
  easier_option: "30 minutes.",
  warnings: [],
};

function answer(raw: string | null, extra: Partial<ProviderAnswer> = {}): ProviderAnswer {
  return { raw, stopProblem: null, answeredBy: "fake-model", inputTokens: 10, outputTokens: 5, ...extra };
}

function fake(answers: (ProviderAnswer | Error)[]) {
  const prompts: string[] = [];
  const p: Provider = {
    name: "fake",
    model: () => "fake-model",
    async ask(_system, user) {
      prompts.push(user);
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      if (next instanceof Error) throw next;
      return next;
    },
    check: async () => ({ provider: "fake", model: "fake-model" }),
  };
  return { p, prompts };
}

describe("strictSchema", () => {
  it("makes every property required, forbids extra keys and drops unsupported keywords", () => {
    const s = strictSchema(Plan) as {
      $schema?: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { minimum?: number; items?: { required: string[]; additionalProperties: boolean } }>;
    };
    expect(s.$schema).toBeUndefined();
    expect(s.additionalProperties).toBe(false);
    expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
    expect(s.properties.total_minutes.minimum).toBeUndefined();
    const step = s.properties.steps.items!;
    expect(step.additionalProperties).toBe(false);
    expect(step.required).toContain("distance_m");
  });
});

describe("generatePlan", () => {
  it("returns a valid plan on the first try", async () => {
    const { p } = fake([answer(JSON.stringify(plan))]);
    const r = await generatePlan({}, ctx, p);
    expect(r.plan?.title).toBe("Easy run");
    expect(r.attempts).toHaveLength(1);
    expect(r.answeredBy).toBe("fake-model");
  });

  it("retries once with the rule violation in the prompt", async () => {
    const { p, prompts } = fake([answer(JSON.stringify({ ...plan, sport: "swim" })), answer(JSON.stringify(plan))]);
    const r = await generatePlan({}, ctx, p);
    expect(r.plan?.sport).toBe("run");
    expect(r.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(prompts[1]).toContain("pool");
    expect(r.inputTokens).toBe(20);
  });

  it("gives up after two bad answers and reports both", async () => {
    const { p } = fake([answer("not json"), answer(JSON.stringify({ ...plan, intensity: "extreme" }))]);
    const r = await generatePlan({}, ctx, p);
    expect(r.plan).toBeNull();
    expect(r.error).toContain("Attempt 1: The answer was not valid JSON");
    expect(r.error).toContain("Attempt 2: The answer did not match the plan schema");
  });

  it("does not retry provider errors such as a rate limit", async () => {
    const { p, prompts } = fake([new ProviderError("Groq API error HTTP 429")]);
    const r = await generatePlan({}, ctx, p);
    expect(r.plan).toBeNull();
    expect(r.error).toContain("429");
    expect(prompts).toHaveLength(1);
  });

  it("treats a cut-off answer as a retryable problem", async () => {
    const { p } = fake([answer(null, { stopProblem: "The answer was cut off." }), answer(JSON.stringify(plan))]);
    const r = await generatePlan({}, ctx, p);
    expect(r.plan).not.toBeNull();
  });
});
