// GET /api/history[?format=csv|json] : all day records, newest first. format=csv or
// format=json returns a download (the research export).
import type { RouteConfig as Config } from "./lib/http";
import { requireUser } from "./lib/auth";
import { handle, json } from "./lib/http";
import { toCsv } from "./lib/export";
import { getSettings, listDays } from "./lib/store";
import { PROMPT_VERSION } from "./lib/coach-prompt";

export default handle(async (req) => {
  requireUser(req);
  const format = new URL(req.url).searchParams.get("format");
  const days = await listDays();
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return new Response(toCsv(days), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tricoach-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  if (format === "json") {
    return new Response(JSON.stringify({ exported_at: new Date().toISOString(), current_prompt_version: PROMPT_VERSION, settings: await getSettings(), days }, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="tricoach-${stamp}.json"`,
        "cache-control": "no-store",
      },
    });
  }
  return json({ days });
});

export const config: Config = { path: "/api/history" };
