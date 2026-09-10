#!/usr/bin/env node
/**
 * Apply every SQL file in packages/db/schema/ in filename order.
 * Idempotent by convention — every migration should be safe to re-run,
 * or should check for its own effect (CREATE TABLE IF NOT EXISTS, etc.).
 *
 * Reads DATABASE_URL from env. Fails loudly if it isn't set.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs
 *
 * In Phase 1 slice 4 (Neon provisioning) this same script runs against
 * a Neon Preview branch to seed a per-PR environment.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, "..", "packages", "db", "schema");

async function main() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error("DATABASE_URL is required");
        process.exit(1);
    }
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
        const files = (await readdir(SCHEMA_DIR))
            .filter((f) => f.endsWith(".sql"))
            .sort();
        for (const file of files) {
            const sql = await readFile(path.join(SCHEMA_DIR, file), "utf8");
            const t0 = Date.now();
            try {
                await client.query(sql);
                console.log(`  ok  ${file} (${Date.now() - t0}ms)`);
            } catch (err) {
                console.error(`  FAIL ${file}: ${err.message}`);
                throw err;
            }
        }
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
