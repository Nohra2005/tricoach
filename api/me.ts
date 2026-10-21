// GET /api/me : which account this passcode (or demo id) belongs to.
import type { RouteConfig as Config } from "./lib/http";
import { requireUser } from "./lib/auth";
import { handle, json } from "./lib/http";

export default handle(async (req) => {
  const user = requireUser(req);
  return json({ id: user.id, name: user.name, kind: user.kind });
});

export const config: Config = { path: "/api/me" };
