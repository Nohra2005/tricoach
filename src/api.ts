// API client. Every call sends the passcode header (or, in the demo, the visitor's random
// sandbox id) and validates the response with zod.
import { z } from "zod";
import {
  DayRecord,
  Job,
  Settings,
  TodayResponse,
  type CheckIn,
  type Feedback,
} from "../shared/schemas";
import { load, remove, save } from "./storage";

const PASSCODE_KEY = "passcode";
const DEMO_KEY = "demo";
const STORAGE_PREFIX = "tricoach."; // as in storage.ts

// Who this tab is signed in as. It is read from localStorage once, when the tab opens,
// and changes only through the functions below. Requests never re-read localStorage, so
// starting the demo or signing in in another tab can't switch this tab's account while
// it still shows the old one. When another tab does change it, this tab reloads.
type Credential = { kind: "passcode"; passcode: string } | { kind: "demo"; id: string } | null;

function readCredential(): Credential {
  const demo = load<string>(DEMO_KEY);
  if (demo) return { kind: "demo", id: demo };
  const passcode = load<string>(PASSCODE_KEY);
  return passcode ? { kind: "passcode", passcode } : null;
}

let credential: Credential = readCredential();

function sameCredential(a: Credential, b: Credential): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "demo" && b.kind === "demo") return a.id === b.id;
  if (a.kind === "passcode" && b.kind === "passcode") return a.passcode === b.passcode;
  return false;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== STORAGE_PREFIX + PASSCODE_KEY && e.key !== STORAGE_PREFIX + DEMO_KEY) return;
    if (!sameCredential(readCredential(), credential)) window.location.reload();
  });
}

// The offline copy of Today belongs to whoever saved it; drop it when the account changes.
function switchTo(next: Credential) {
  if (!sameCredential(next, credential)) remove("lastToday");
  credential = next;
}

export function getPasscode(): string | null {
  return credential?.kind === "passcode" ? credential.passcode : null;
}
export function setPasscode(p: string) {
  remove(DEMO_KEY);
  save(PASSCODE_KEY, p);
  switchTo({ kind: "passcode", passcode: p });
}
// Signs out of both a real account and the demo.
export function clearPasscode() {
  remove(PASSCODE_KEY);
  remove(DEMO_KEY);
  switchTo(null);
}

export function getDemoId(): string | null {
  return credential?.kind === "demo" ? credential.id : null;
}
export function isDemoMode(): boolean {
  return credential?.kind === "demo";
}
// Each demo visitor gets a private sandbox, kept on this device.
export function startDemo(): string {
  const existing = getDemoId() ?? load<string>(DEMO_KEY);
  const id =
    existing ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
          (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
        ));
  remove(PASSCODE_KEY);
  save(DEMO_KEY, id);
  switchTo({ kind: "demo", id });
  return id;
}

// An explicit passcode (checking one at sign-in) wins; otherwise this tab's credential.
function authHeaders(passcode?: string): Record<string, string> {
  if (passcode !== undefined) return { "x-tricoach-passcode": passcode };
  if (credential?.kind === "demo") return { "x-tricoach-demo": credential.id };
  return { "x-tricoach-passcode": credential?.passcode ?? "" };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}, passcode?: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...authHeaders(passcode), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "No connection");
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) window.dispatchEvent(new Event("tricoach:unauthorised"));
    throw new ApiError(res.status, message);
  }
  return res;
}

async function call<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError(500, "Unexpected response from server: " + parsed.error.issues[0]?.message);
  }
  return parsed.data;
}

const DayOnly = z.object({ day: DayRecord });

export const api = {
  async checkPasscode(passcode: string): Promise<boolean> {
    const res = await request("/api/health", {}, passcode);
    const body = (await res.json()) as { authenticated?: boolean };
    return body.authenticated === true;
  },
  me: () => call(z.object({ id: z.string(), name: z.string(), kind: z.enum(["athlete", "demo"]) }), "/api/me"),
  health: () => request(`/api/health?date=${localDate()}`).then((r) => r.json() as Promise<unknown>),
  today: (date: string) => call(TodayResponse, `/api/today?date=${date}`),
  checkin: (date: string, checkin: CheckIn) =>
    call(DayOnly, "/api/checkin", { method: "POST", body: JSON.stringify({ date, checkin }) }),
  generate: (date: string) =>
    call(z.object({ jobId: z.string() }), "/api/generate", { method: "POST", body: JSON.stringify({ date }) }),
  job: (id: string) => call(Job, `/api/job?id=${encodeURIComponent(id)}`),
  feedback: (date: string, feedback: Feedback) =>
    call(DayOnly.extend({ matchError: z.string().nullable() }), "/api/feedback", {
      method: "POST",
      body: JSON.stringify({ date, feedback }),
    }),
  sendWorkout: (date: string) => call(DayOnly, "/api/send-workout", { method: "POST", body: JSON.stringify({ date }) }),
  match: () => call(z.object({ checked: z.number(), matched: z.number() }), "/api/match", { method: "POST" }),
  history: () => call(z.object({ days: z.array(DayRecord) }), "/api/history"),
  settings: () => call(Settings, "/api/settings"),
  saveSettings: (s: Settings) => call(Settings, "/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  importData: (days: unknown[], settings?: unknown) =>
    call(z.object({ imported: z.number(), skipped: z.array(z.string()), settings: z.boolean() }), "/api/import", {
      method: "POST",
      body: JSON.stringify(settings === undefined ? { days } : { days, settings }),
    }),
  deleteData: () =>
    call(z.object({ deleted: z.number() }), "/api/delete-data", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) }),

  // Downloads go through fetch so the passcode stays in a header, never in a URL.
  async download(format: "csv" | "json") {
    const res = await request(`/api/history?format=${format}`);
    const blob = await res.blob();
    const name =
      /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `tricoach.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

// Polls a generation job until it finishes or the time limit passes.
export async function waitForJob(id: string, onTick?: (seconds: number) => void, limitSeconds = 240): Promise<Job> {
  const start = Date.now();
  for (;;) {
    const job = await api.job(id);
    if (job.status === "done" || job.status === "error") return job;
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (elapsed > limitSeconds) throw new ApiError(504, "Generation is taking too long. Check History in a minute.");
    onTick?.(elapsed);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
