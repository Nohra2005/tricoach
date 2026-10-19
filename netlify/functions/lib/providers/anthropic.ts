// Claude (paid API), used only when LLM_PROVIDER=anthropic.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Plan } from "../../../../shared/schemas";
import { ProviderError, type Provider } from "./types";

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 4000;

const model = () => process.env.ANTHROPIC_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL;
// Reads ANTHROPIC_API_KEY. One SDK retry for 429/5xx.
const client = () => new Anthropic({ maxRetries: 1, timeout: 120_000 });

export const anthropic: Provider = {
  name: "anthropic",
  model,

  async ask(system, user) {
    try {
      const res = await client().beta.messages.parse({
        model: model(),
        max_tokens: MAX_TOKENS,
        // Server-side fallback: a policy decline is retried on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "medium", format: betaZodOutputFormat(Plan) },
      });
      const raw = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("") || null;
      return {
        raw,
        parsed: res.parsed_output ?? null,
        stopProblem:
          res.stop_reason === "refusal"
            ? `The model declined to answer (${res.stop_details?.category ?? "no category"}).`
            : res.stop_reason === "max_tokens"
              ? `The answer was cut off at ${MAX_TOKENS} tokens.`
              : null,
        answeredBy: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    } catch (e) {
      // API errors are not fixable by re-asking; a zod failure inside the SDK is.
      if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error: ${e.message}`);
      return {
        raw: null,
        parsed: null,
        stopProblem: `The answer failed validation: ${e instanceof Error ? e.message : String(e)}`,
        answeredBy: null,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  },

  async check() {
    try {
      const m = await new Anthropic({ maxRetries: 0, timeout: 8000 }).models.retrieve(model());
      return { provider: "anthropic", model: m.id, display_name: m.display_name };
    } catch (e) {
      throw new ProviderError(e instanceof Error ? e.message : String(e));
    }
  },
};
