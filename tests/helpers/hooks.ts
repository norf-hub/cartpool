// Per-file teardown: release the pg pool so vitest can exit cleanly.
import { afterAll } from "vitest";
import { pool } from "./db";

afterAll(async () => {
  await pool.end();
});
