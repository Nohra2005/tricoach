// Groq (free tier) via its OpenAI-compatible Chat Completions endpoint, using strict
// JSON-schema structured output. Docs: https://console.groq.com/docs/structured-outputs
// Groq does not retain inference request data by default (https://console.groq.com/docs/your-data).
import { z } from "zod";
import { Plan } from "../../../../shared/schemas";
import { ProviderError, type Provider, type ProviderAnswer } from "./types";

export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
// GROQ_BASE_URL is only for local testing against scripts/mock-apis.mjs.
const BASE = () => process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const MAX_COMPLETION_TOKENS = 3000;

function key(): string {
  const k = process.env.GROQ_API_KEY;
  if (!k) throw new ProviderError("Missing environment variable GROQ_API_KEY");
  return k;
}



// zod's JSON Schema output, cleaned for Groq strict mode: every property required,
// additionalProperties false (zod already does both), no $schema or numeric bounds.
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "$schema" || k === "minimum" || k === "maximum") continue;
        out[k] = clean(v);
      }
      return out;
    }
    return node;
  };
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}

const PLAN_SCHEMA = strictSchema(Plan);

const CompletionSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).partial().optional(),
});

export function groqModel(): string {
  return process.env.GROQ_MODEL?.trim() || GROQ_DEFAULT_MODEL;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// On a free-tier rate limit (429), wait for retry-after (at most 90 s) and try again,
// up to twice. The background function has a 15 minute limit, so waiting is fine.
async function post(path: string, body: unknown, timeoutMs: number, waits = 2): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE()}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ProviderError(`Groq did not respond (${e instanceof Error ? e.message : e})`);
  }
  if (res.status === 429 && waits > 0) {
    const after = Number(res.headers.get("retry-after"));
    const seconds = Number.isFinite(after) && after > 0 ? Math.min(after, 90) : 30;
    await res.body?.cancel();
    await sleep(seconds * 1000);
    return post(path, body, timeoutMs, waits - 1);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    const hint = res.status === 429 ? " (free-tier rate limit reached; try again later)" : "";
    throw new ProviderError(`Groq API error HTTP ${res.status}${hint}: ${text}`);
  }
  return res.json();
}

export const groq: Provider = {
  name: "groq",
  model: groqModel,

  async ask(system: string, user: string): Promise<ProviderAnswer> {
    const data = CompletionSchema.parse(
      await post(
        "/chat/completions",
        {
          model: groqModel(),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          reasoning_effort: "medium",
          response_format: {
            type: "json_schema",
            json_schema: { name: "training_plan", strict: true, schema: PLAN_SCHEMA },
          },
        },
        120_000,
      ),
    );
    const choice = data.choices[0];
    return {
      raw: choice.message.content,
      parsed: null,
      stopProblem:
        choice.finish_reason === "length" ? `The answer was cut off at ${MAX_COMPLETION_TOKENS} tokens.` : null,
      answeredBy: data.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  },

  async check() {
    let res: Response;
    try {
      res = await fetch(`${BASE()}/models/${groqModel()}`, {
        headers: { authorization: `Bearer ${key()}` },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      throw new ProviderError(`Groq did not respond (${e instanceof Error ? e.message : e})`);
    }
    if (!res.ok) throw new ProviderError(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const m = (await res.json()) as { id?: string };
    return { provider: "groq", model: m.id ?? groqModel() };
  },
};
