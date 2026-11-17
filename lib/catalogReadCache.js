/**
 * The sweeps read the model catalog / routes before every jobs query. The minute cron does that once a minute,
 * which is fine. Check-on-read (lib/refreshPolledJob.js) runs the same code once per in-flight job per poll, so
 * there the same small, rarely changing read is cached per isolate for a short time.
 * The cron path (`only` empty) is never cached.
 */
import { select } from '../packages/db/supabase-client.js';

export const CATALOG_CACHE_MS = 60_000;
const MAX_ENTRIES = 16;
const cache = new Map();

/** @param {string} only the sweep's one-job filter; empty on the cron path */
export async function catalogSelect(only, table, query, cfg, now = Date.now()) {
    if (!only) return select(table, query, cfg);
    const key = `${cfg?.supabaseUrl}|${table}|${query.filter}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < CATALOG_CACHE_MS) return hit.rows;
    const rows = await select(table, query, cfg);
    if (Array.isArray(rows)) {
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(key, { at: now, rows });
    }
    return rows;
}

export function resetCatalogCache() { cache.clear(); }
