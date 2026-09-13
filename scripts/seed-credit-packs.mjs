#!/usr/bin/env node
/**
 * Set each web Credit Pack's LemonSqueezy variant id from
 * config/credit-packs.json and activate it. Test and live mode have
 * different variant ids, so the mode is an argument, never a default.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed-credit-packs.mjs test
 *
 * Only variant_id and active change. Credits and prices come from
 * migration 0041 and its floor CHECKs; this script never sets them.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const PACK_ID_RE = /^[a-z0-9-]{1,32}$/;
const VARIANT_RE = /^[0-9]{1,20}$/;

async function main() {
    const mode = process.argv[2];
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL is required");

    const config = JSON.parse(await readFile(new URL("../config/credit-packs.json", import.meta.url), "utf8"));
    const variants = mode && !mode.startsWith("_") ? config[mode] : undefined;
    const entries = Object.entries(variants || {});
    if (entries.length === 0) throw new Error(`no variant ids for mode "${mode}" in config/credit-packs.json`);
    for (const [packId, variantId] of entries) {
        if (!PACK_ID_RE.test(packId) || !VARIANT_RE.test(String(variantId))) {
            throw new Error(`invalid entry ${packId}: ${variantId}`);
        }
    }

    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
        await client.query("BEGIN");
        // Clear first so swapping modes never trips UNIQUE (sales_channel, variant_id).
        await client.query(
            "UPDATE public.credit_packs SET active = false, variant_id = NULL, updated_at = now() WHERE sales_channel = 'web' AND id = ANY($1)",
            [entries.map(([packId]) => packId)],
        );
        for (const [packId, variantId] of entries) {
            const r = await client.query(
                "UPDATE public.credit_packs SET variant_id = $2, active = true, updated_at = now() WHERE id = $1 AND sales_channel = 'web'",
                [packId, String(variantId)],
            );
            if (r.rowCount !== 1) throw new Error(`pack ${packId} not found; apply migration 0041 first`);
            console.log(`  ok  ${packId} -> variant ${variantId}`);
        }
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
