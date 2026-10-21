// Key/value storage on Cloudflare D1 (SQLite): one table, keys like the old Netlify
// Blobs keys ("days/2026-10-21.json", "users/u2/settings.json"), values as JSON text.
// D1 is strongly consistent: a write is read back straight away.
// worker.ts hands over the D1 binding on every request with useDatabase().

// The part of the D1 API this file uses (from @cloudflare/workers-types).
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
  };
  exec(sql: string): Promise<unknown>;
}

let db: D1Like | null = null;
let ready: Promise<unknown> | null = null;

export function useDatabase(d: D1Like) {
  if (d !== db) {
    db = d;
    ready = null;
  }
}

// The table is created on first use, so a new database needs no setup step.
async function conn(): Promise<D1Like> {
  if (!db) throw new Error("No database: the DB binding is missing (see wrangler.jsonc)");
  ready ??= db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
  await ready;
  return db;
}

export const kv = {
  async get(key: string): Promise<unknown | null> {
    const row = await (await conn()).prepare("SELECT value FROM kv WHERE key = ?").bind(key).first<{ value: string }>();
    return row ? JSON.parse(row.value) : null;
  },
  async set(key: string, value: unknown): Promise<void> {
    await (await conn())
      .prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(key, JSON.stringify(value), new Date().toISOString())
      .run();
  },
  // Every key that starts with prefix, with its value, in one query.
  async list(prefix: string): Promise<{ key: string; value: unknown }[]> {
    const { results } = await (await conn())
      .prepare("SELECT key, value FROM kv WHERE key >= ? AND key < ? ORDER BY key")
      .bind(prefix, prefix + "￿")
      .all<{ key: string; value: string }>();
    return results.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  },
  async delete(key: string): Promise<void> {
    await (await conn()).prepare("DELETE FROM kv WHERE key = ?").bind(key).run();
  },
  // Deletes every key that starts with prefix; returns how many.
  async deletePrefix(prefix: string): Promise<number> {
    const c = await conn();
    const row = await c.prepare("SELECT COUNT(*) AS n FROM kv WHERE key >= ? AND key < ?").bind(prefix, prefix + "￿").first<{ n: number }>();
    await c.prepare("DELETE FROM kv WHERE key >= ? AND key < ?").bind(prefix, prefix + "￿").run();
    return row?.n ?? 0;
  },
};
