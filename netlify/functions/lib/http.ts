// Small helpers shared by every function.
import { ZodError } from "zod";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function error(status: number, message: string, detail?: unknown): Response {
  return json({ error: message, detail: detail ?? null }, status);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new HttpError(500, `Missing environment variable ${name}`);
  return value;
}

export function zodMessage(e: ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

// Wraps a handler: converts thrown errors into JSON responses.
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message);
      if (e instanceof ZodError) return error(400, zodMessage(e));
      console.error(e);
      return error(500, e instanceof Error ? e.message : "Unexpected error");
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}
