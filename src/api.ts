// API client. Every call sends the passcode header and validates the response with zod.
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

export function getPasscode(): string | null {
  return load<string>(PASSCODE_KEY);
}
export function setPasscode(p: string) {
  save(PASSCODE_KEY, p);
}
export function clearPasscode() {
  remove(PASSCODE_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}, passcode = getPasscode()): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", "x-tricoach-passcode": passcode ?? "", ...init.headers },
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
  match: () => call(z.object({ checked: z.number(), matched: z.number() }), "/api/match", { method: "POST" }),
  history: () => call(z.object({ days: z.array(DayRecord) }), "/api/history"),
  settings: () => call(Settings, "/api/settings"),
  saveSettings: (s: Settings) => call(Settings, "/api/settings", { method: "PUT", body: JSON.stringify(s) }),

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
