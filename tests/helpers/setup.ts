// vitest globalSetup: build the schema once from supabase/migrations.
import { Pool } from "pg";
import { migrate, DATABASE_URL } from "./db";

/**
 * Create the target database if it doesn't exist (Postgres can't
 * CREATE DATABASE IF NOT EXISTS, hence the 42P04 catch). Needed for the
 * default cartpool_test database on the local Supabase stack; a no-op when
 * DATABASE_URL points at an existing database, as in CI.
 */
async function ensureDatabase() {
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (dbName === "postgres") return;
  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`refusing to create oddly-named database "${dbName}"`);
  }
  try {
    await admin.query(`create database ${dbName}`);
  } catch (e: any) {
    if (e.code !== "42P04") throw e; // 42P04 = already exists
  } finally {
    await admin.end();
  }
}

export default async function setup() {
  await ensureDatabase();
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
