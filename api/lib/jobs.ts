// Starting a generation job. The model can take minutes (with retries and free-tier rate
// limits), longer than a request should wait, so the job runs on a Cloudflare Queue
// (worker.ts registers it). The message carries the account id, never the passcode.
export interface JobMessage {
  jobId: string;
  date: string;
  userId: string;
}

let send: ((m: JobMessage) => Promise<void>) | null = null;

export function useJobQueue(fn: (m: JobMessage) => Promise<void>) {
  send = fn;
}

export async function startJob(m: JobMessage): Promise<void> {
  if (!send) throw new Error("No job queue: the JOBS binding is missing (see wrangler.jsonc)");
  await send(m);
}
