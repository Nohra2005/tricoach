// Single-user access control: every request must carry the passcode header.
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError, env } from "./http";

export const PASSCODE_HEADER = "x-tricoach-passcode";

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

export function requirePasscode(req: Request): void {
  const expected = env("APP_PASSCODE");
  const given = req.headers.get(PASSCODE_HEADER) ?? "";
  if (!timingSafeEqual(digest(given), digest(expected))) {
    throw new HttpError(401, "Wrong or missing passcode");
  }
}
