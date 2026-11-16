import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

for (const name of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), name);
  if (existsSync(path)) process.loadEnvFile(path);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
const migration = readFileSync(new URL("./migrate-sms-inbox.sql", import.meta.url), "utf8");
await sql.transaction(migration.split(";").map(s => s.trim()).filter(Boolean).map(s => sql.query(s)));
console.log("Shared SMS inbox schema is ready.");
