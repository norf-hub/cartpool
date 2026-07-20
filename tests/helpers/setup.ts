// vitest globalSetup: build the schema once from supabase/migrations.
import { Pool } from "pg";
import { migrate, DATABASE_URL } from "./db";

export default async function setup() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
