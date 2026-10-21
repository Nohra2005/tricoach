// Writes today's session with Groq (free tier): zod validation and rule checks on
// every answer, one retry with the problems appended, then give up (never invent a
// plan). The provider is a parameter so tests can pass a fake one.
import { Plan } from "../../shared/schemas";
import { COACH_PROMPT } from "./coach-prompt";
import { checkPlan, tidyText, type RuleContext } from "./rules";
import { groq } from "./providers/groq";
import { ProviderError, type Provider } from "./providers/types";

export function provider(): Provider {
  return groq;
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

function parsePlan(raw: string | null): { plan: Plan | null; problem: string | null } {
  if (!raw) return { plan: null, problem: "The answer was empty." };
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { plan: null, problem: "The answer was not valid JSON." };
  }
  const r = Plan.safeParse(candidate);
  if (r.success) return { plan: r.data, problem: null };
  const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { plan: null, problem: `The answer did not match the plan schema: ${issues.join("; ")}` };
}

export async function generatePlan(input: unknown, ctx: RuleContext, p: Provider = provider()): Promise<GenerateResult> {
  const attempts: AttemptLog[] = [];
  let answeredBy: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  // Compact JSON keeps the prompt inside free-tier per-minute token limits.
  const base = "Here is today's data as JSON. Write today's session.\n\n" + JSON.stringify(input);
  let userText = base;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: string | null = null;
    let problem: string;
    try {
      const a = await p.ask(COACH_PROMPT, userText);
      raw = a.raw;
      answeredBy = a.answeredBy ?? answeredBy;
      inputTokens += a.inputTokens;
      outputTokens += a.outputTokens;
      if (a.stopProblem) {
        problem = a.stopProblem;
      } else {
        const { plan, problem: parseProblem } = parsePlan(a.raw);
        if (plan) {
          const tidy = tidyText(plan);
          const violations = checkPlan(tidy, ctx);
          if (violations.length === 0) {
            attempts.push({ ok: true, error: null, raw });
            return { plan: tidy, error: null, attempts, answeredBy, inputTokens, outputTokens };
          }
          problem = "The plan broke these rules: " + violations.join(" ");
        } else {
          problem = parseProblem!;
        }
      }
    } catch (e) {
      // Auth, rate-limit and network errors are not fixed by re-asking.
      const msg = e instanceof ProviderError || e instanceof Error ? e.message : String(e);
      attempts.push({ ok: false, error: msg, raw });
      return { plan: null, error: msg, attempts, answeredBy, inputTokens, outputTokens };
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
