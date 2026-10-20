/**
 * Is Supabase answering? The one place that decides, for the status banner on
 * the site and in the mobile app (GET /api/status, ADR-0160).
 *
 * The probe is a one-row read of model_catalog through the same client the
 * routes use, so "degraded" means the path a request takes is failing, not
 * only that a health page is. A refusal that is ours to fix (a 4xx: bad key,
 * missing grant) is logged and reported as ok: it is not an outage, and a
 * banner would only hide it.
 *
 * Probes are shared: one per 15 s per Worker isolate, and the result is saved
 * in the Workers Cache API so isolates do not each probe. An unauthenticated
 * flood of /api/status is therefore never a flood of PostgREST calls.
 */

import { select, SupabaseError } from '../packages/db/supabase-client.js';

export const STATUS_TTL_MS = 15 * 1000;
export const PROBE_TIMEOUT_MS = 3000;
// A single failed probe is not an outage: one retry after this pause, so a
// dropped packet does not flash a banner at every visitor.
export const PROBE_RETRY_MS = 400;
const CACHE_KEY = 'https://veyrnox.ai/__internal/upstream-status/v1';

let memo = null; // { status, checkedAt }
let inFlight = null;

/** True for a failure that means "Supabase is not answering": no response, a timeout, or a 5xx. */
export function isOutageError(err) {
    if (!(err instanceof SupabaseError)) return true; // a thrown transport error
    return err.status === 0 || err.status >= 500;
}

async function probeOnce(cfg, selectRows) {
    try {
        await selectRows('model_catalog', { columns: 'id', limit: 1 }, { ...cfg, timeoutMs: PROBE_TIMEOUT_MS });
        return 'ok';
    } catch (err) {
        if (isOutageError(err)) return 'degraded';
        console.error('[status] probe refused (not an outage):', err && err.status);
        return 'ok';
    }
}

export async function probeDatabase(cfg, { selectRows = select, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    if ((await probeOnce(cfg, selectRows)) === 'ok') return 'ok';
    await sleep(PROBE_RETRY_MS);
    return probeOnce(cfg, selectRows);
}

async function cacheGet() {
    try {
        const hit = await caches.default.match(CACHE_KEY);
        if (!hit) return undefined;
        const value = await hit.json();
        return value && (value.status === 'ok' || value.status === 'degraded') && Number.isFinite(value.checkedAt) ? value : undefined;
    } catch { return undefined; }
}

async function cachePut(value) {
    try {
        await caches.default.put(CACHE_KEY, new Response(JSON.stringify(value), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${STATUS_TTL_MS / 1000}` },
        }));
    } catch { /* not on Workers */ }
}

/**
 * { status: 'ok' | 'degraded' | 'unknown', checkedAt }. 'unknown' only when
 * this deployment has no Supabase configured, so a local build never claims
 * an outage it cannot measure.
 */
export async function currentStatus({ cfg, probe = probeDatabase, now = Date.now } = {}) {
    if (!cfg || !cfg.supabaseUrl || !cfg.serviceRoleKey) return { status: 'unknown', checkedAt: now() };
    if (memo && now() - memo.checkedAt < STATUS_TTL_MS) return memo;
    const saved = await cacheGet();
    if (saved && now() - saved.checkedAt < STATUS_TTL_MS) { memo = saved; return saved; }
    if (!inFlight) {
        inFlight = (async () => {
            const status = await probe(cfg);
            const value = { status, checkedAt: now() };
            memo = value;
            await cachePut(value);
            return value;
        })().finally(() => { inFlight = null; });
    }
    return inFlight;
}

/** Tests only. */
export function _resetUpstreamStatus() { memo = null; inFlight = null; }
