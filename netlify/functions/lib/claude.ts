// Claude call for today's session: structured output validated with zod, one retry
// with the validation errors appended, then give up (never invent a plan).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Plan } from "../../../shared/schemas";
import { COACH_PROMPT } from "./coach-prompt";
import { checkPlan, tidyText, type RuleContext } from "./rules";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
// The plan JSON is roughly 600 to 1000 tokens; the rest is room for thinking.
const MAX_TOKENS = 4000;

export function modelName(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export interface AttemptLog {
  ok: boolean;
  error: string | null;
  raw: string | null;
}

export interface GenerateResult {
  plan: Plan | null;
  error: string | null;
  attempts: AttemptLog[];
  answeredBy: string | null;
  inputTokens: number;
  outputTokens: number;
}

function client() {
  // Reads ANTHROPIC_API_KEY. One SDK retry for 429/5xx; 2 minutes per request is far
  // inside the 15 minute background-function limit.
  return new Anthropic({ maxRetries: 1, timeout: 120_000 });
}

async function callOnce(userText: string) {
  const res = await client().beta.messages.parse({
    model: modelName(),
    max_tokens: MAX_TOKENS,
    // Server-side fallback: if the model declines for policy reasons (a false positive
    // is possible on health-related text), the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: COACH_PROMPT,
    messages: [{ role: "user", content: userText }],
    output_config: { effort: "medium", format: betaZodOutputFormat(Plan) },
  });
  const raw = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("") || null;
  return { res, raw };
}

export async function generatePlan(input: unknown, ctx: RuleContext): Promise<GenerateResult> {
  const attempts: AttemptLog[] = [];
  let answeredBy: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  const base = "Here is today's data as JSON. Write today's session.\n\n" + JSON.stringify(input, null, 1);
  let userText = base;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: string | null = null;
    let problem: string;
    try {
      const { res, raw: text } = await callOnce(userText);
      raw = text;
      answeredBy = res.model;
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;

      if (res.stop_reason === "refusal") {
        problem = `The model declined to answer (${res.stop_details?.category ?? "no category"}).`;
      } else if (res.stop_reason === "max_tokens") {
        problem = `The answer was cut off at ${MAX_TOKENS} tokens.`;
      } else if (!res.parsed_output) {
        problem = "The answer was not valid JSON for the plan schema.";
      } else {
        const plan = tidyText(res.parsed_output);
        const violations = checkPlan(plan, ctx);
        if (violations.length === 0) {
          attempts.push({ ok: true, error: null, raw });
          return { plan, error: null, attempts, answeredBy, inputTokens, outputTokens };
        }
        problem = "The plan broke these rules: " + violations.join(" ");
      }
    } catch (e) {
      // API errors (auth, bad request, overload after SDK retries) are not fixable by re-asking.
      if (e instanceof Anthropic.APIError) {
        const msg = `Anthropic API error: ${e.message}`;
        attempts.push({ ok: false, error: msg, raw });
        return { plan: null, error: msg, attempts, answeredBy, inputTokens, outputTokens };
      }
      // The SDK throws when the returned JSON fails zod validation.
      problem = `The answer failed validation: ${e instanceof Error ? e.message : String(e)}`;
    }

    attempts.push({ ok: false, error: problem, raw });
    userText =
      base +
      `\n\nYour previous answer was:\n${raw ?? "(no text)"}\n\n` +
      `It was rejected. ${problem}\nReturn a corrected plan that fixes every point.`;
  }

  return {
    plan: null,
    error: "No valid plan after 2 attempts. " + attempts.map((a, i) => `Attempt ${i + 1}: ${a.error}`).join(" "),
    attempts,
    answeredBy,
    inputTokens,
    outputTokens,
  };
}
