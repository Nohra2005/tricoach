// What every model provider returns for one request. The generator does the zod
// validation, rule checks and retry, so providers stay small.
export interface ProviderAnswer {
  raw: string | null; // the text the model returned
  stopProblem: string | null; // refusal, cut off, etc.
  answeredBy: string | null; // model that actually answered
  inputTokens: number;
  outputTokens: number;
}

export interface Provider {
  name: string;
  model: () => string;
  ask: (system: string, user: string) => Promise<ProviderAnswer>;
  check: () => Promise<{ provider: string; model: string; display_name?: string }>;
}

// A failure that re-asking the model will not fix (auth, rate limit, network).
export class ProviderError extends Error {}
