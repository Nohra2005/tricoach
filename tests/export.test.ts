import { describe, expect, it } from "vitest";
import { toCsv } from "../netlify/functions/lib/export";
import { emptyDayForTest } from "./fixtures";

describe("toCsv", () => {
  it("writes a header and quotes commas, quotes and newlines", () => {
    const d = emptyDayForTest("2026-10-19");
    d.feedback = { followed: "modified", reason: 'cut short, "tired"\nlegs', rpe: 5, feel: 3, notes: null, submitted_at: "x" };
    const csv = toCsv([d]);
    const header = csv.slice(0, csv.indexOf("\r\n"));
    expect(header.startsWith("date,weekday,hrv")).toBe(true);
    expect(csv).toContain('"cut short, ""tired""\nlegs"');
    expect(csv).toContain("\r\n2026-10-19,Monday,,");
  });
});
