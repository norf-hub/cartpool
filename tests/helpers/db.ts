import { Pool, QueryResult } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54322/postgres";

export const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

export const MIGRATIONS_DIR = join(here, "..", "..", "supabase", "migrations");

/** Drop and rebuild the schema from supabase/migrations (used by globalSetup). */
export async function migrate(p: Pool = pool): Promise<void> {
  await p.query(
    "drop schema if exists api cascade; drop schema public cascade; create schema public;"
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await p.query(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
}

/** Call a Postgres function: rpc('mark_purchased', [itemId, userId]) */
export async function rpc<T = Record<string, unknown>>(
  fn: string,
  args: unknown[] = []
): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await pool.query(`select ${fn}(${placeholders}) as r`, args);
  return rows[0].r as T;
}

export function q(text: string, params?: unknown[]): Promise<QueryResult> {
  return pool.query(text, params);
}
