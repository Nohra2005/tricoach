// Who is making the request. Accounts are configured with environment variables:
//   user 1 (the original):  APP_PASSCODE, INTERVALS_API_KEY, INTERVALS_ATHLETE_ID, APP_USER_NAME
//   users 2 to 5:           USER2_PASSCODE, USER2_INTERVALS_API_KEY, USER2_INTERVALS_ATHLETE_ID, USER2_NAME
// The passcode picks the account. The demo needs no passcode: the browser sends a random
// sandbox id and gets made-up data, its own storage, and no access to any real account.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http";

export const PASSCODE_HEADER = "x-tricoach-passcode";
export const DEMO_HEADER = "x-tricoach-demo";
export const MAX_USERS = 5;

export interface User {
  id: string; // stable: "u1".."u5" or "demo-<sandbox id>"
  name: string;
  kind: "athlete" | "demo";
  storePrefix: string; // Blobs key prefix; "" for user 1 so existing data stays where it is
  intervals: { apiKey: string; athleteId: string } | null; // null for the demo
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}
function same(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

// All configured athlete accounts (without secrets checked yet).
export function configuredUsers(env: NodeJS.ProcessEnv = process.env) {
  const out: { n: number; passcode: string; user: User }[] = [];
  for (let n = 1; n <= MAX_USERS; n++) {
    const p = n === 1 ? "" : `USER${n}_`;
    const passcode = env[n === 1 ? "APP_PASSCODE" : `${p}PASSCODE`];
    if (!passcode) continue;
    const apiKey = env[`${p}INTERVALS_API_KEY`];
    const athleteId = env[`${p}INTERVALS_ATHLETE_ID`];
    out.push({
      n,
      passcode,
      user: {
        id: `u${n}`,
        name: env[n === 1 ? "APP_USER_NAME" : `${p}NAME`] || `Athlete ${n}`,
        kind: "athlete",
        storePrefix: n === 1 ? "" : `users/u${n}/`,
        intervals: apiKey && athleteId ? { apiKey, athleteId } : null,
      },
    });
  }
  return out;
}

export function demoUser(sandbox: string): User {
  return {
    id: `demo-${sandbox.toLowerCase()}`,
    name: "Demo athlete",
    kind: "demo",
    storePrefix: `demo/${sandbox.toLowerCase()}/`,
    intervals: null,
  };
}

export function resolveUser(req: Request, env: NodeJS.ProcessEnv = process.env): User {
  const sandbox = req.headers.get(DEMO_HEADER);
  if (sandbox) {
    if (!UUID.test(sandbox)) throw new HttpError(400, "Invalid demo id");
    return demoUser(sandbox);
  }
  const given = req.headers.get(PASSCODE_HEADER) ?? "";
  const users = configuredUsers(env);
  if (users.length === 0) throw new HttpError(500, "Missing environment variable APP_PASSCODE");
  // Check every account (no early exit) so timing does not reveal which passcode matched.
  let match: User | null = null;
  for (const u of users) if (same(given, u.passcode) && !match) match = u.user;
  if (!match || !given) throw new HttpError(401, "Wrong or missing passcode");
  return match;
}

// The account for a stored id ("u2", "demo-<sandbox id>"). Used by queued jobs, which
// carry the id rather than the passcode. Null when that account no longer exists.
export function userById(id: string, env: NodeJS.ProcessEnv = process.env): User | null {
  if (id.startsWith("demo-")) {
    const sandbox = id.slice("demo-".length);
    return UUID.test(sandbox) ? demoUser(sandbox) : null;
  }
  return configuredUsers(env).find((u) => u.user.id === id)?.user ?? null;
}

// ---------- request context ----------

// Each request (and each queued job) runs inside its own context, started by worker.ts
// with withRequest() or runAs(). requireUser() fills in who it is, so code anywhere in
// that request can ask currentUser() without passing the user around, and two requests
// can never see each other's account.
const current = new AsyncLocalStorage<{ user: User | null }>();

export function withRequest<T>(fn: () => T): T {
  return current.run({ user: null }, fn);
}

// Resolves the user and makes it the current user for the rest of this request.
export function requireUser(req: Request): User {
  const ctx = current.getStore();
  if (!ctx) throw new HttpError(500, "Request context missing");
  const user = resolveUser(req);
  ctx.user = user;
  return user;
}

export function currentUser(): User {
  const u = current.getStore()?.user;
  if (!u) throw new HttpError(500, "No user for this request");
  return u;
}

export function runAs<T>(user: User, fn: () => T): T {
  return current.run({ user }, fn);
}

export function isDemo(): boolean {
  return current.getStore()?.user?.kind === "demo";
}
