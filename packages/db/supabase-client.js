import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js';

/**
 * Minimal Supabase / PostgREST client for the Cloudflare Worker runtime.
 *
 * Every ledger operation on the Worker side goes through here. Cloudflare
 * Workers can't cleanly hold long-lived Postgres TCP connections, so we
 * call Postgres functions via PostgREST's /rest/v1/rpc/* endpoint —
 * one round trip per atomic operation, no client-side transaction
 * management.
 *
 * We deliberately do NOT ship @supabase/supabase-js: it's a big library
 * whose auth/realtime features we don't use in the Worker, and (per the
 * Slice 1 tsx + Slice 3b jose lessons) big JS libraries have a habit of
 * tripping the OpenNext / Cloudflare Workers Builds bundler. Native
 * fetch is enough.
 *
 * Reads:  supabaseUrl, serviceRoleKey from environment (server-side only).
 * Never send the service_role key to the browser — it bypasses RLS.
 */

/**
 * @typedef {Object} SupabaseClientOptions
 * @property {string} supabaseUrl   e.g. https://<ref>.supabase.co
 * @property {string} serviceRoleKey  Backend key — bypasses RLS
 * @property {number} [timeoutMs=8000]  Per-request timeout
 */

/** Custom error carrying the PostgREST status + body for debugging. */
export class SupabaseError extends Error {
    constructor(message, { status, body }) {
        super(message);
        this.name = 'SupabaseError';
        this.status = status;
        this.body = body;
    }
}

/**
 * Call a Postgres function via PostgREST /rpc/<name>. Returns the parsed
 * JSON payload the function returned. Throws SupabaseError on non-2xx.
 */
export async function rpc(name, args, options) {
    const { supabaseUrl, serviceRoleKey, timeoutMs = 8000 } = options;
    if (!supabaseUrl || !serviceRoleKey) {
        throw new SupabaseError('supabase client not configured', { status: 0, body: null });
    }

    let res;
    try {
        res = await fetchWithTimeout(new URL(`/rest/v1/rpc/${encodeURIComponent(name)}`, supabaseUrl), {
            method: 'POST',
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(args ?? {}),
        }, timeoutMs);
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new SupabaseError(`rpc(${name}) timed out after ${timeoutMs}ms`, { status: 0, body: null });
        }
        throw new SupabaseError(`rpc(${name}) transport error: ${err && err.message}`, { status: 0, body: null });
    }

    // Read once — either JSON or text.
    let payload;
    const ct = res.headers.get('content-type') || '';
    try {
        payload = ct.includes('application/json') ? await res.json() : await res.text();
    } catch {
        payload = null;
    }

    if (!res.ok) {
        throw new SupabaseError(`rpc(${name}) failed: ${res.status}`, { status: res.status, body: payload });
    }
    return payload;
}

/**
 * SELECT-shaped read via PostgREST. For ad-hoc queries only — prefer
 * a stored function for anything transactional or repeated.
 */
export async function select(table, { columns = '*', filter = '', limit } = {}, options) {
    const { supabaseUrl, serviceRoleKey, timeoutMs = 8000 } = options;
    const url = new URL(`/rest/v1/${encodeURIComponent(table)}`, supabaseUrl);
    url.searchParams.set('select', columns);
    if (filter) {
        for (const [k, v] of new URLSearchParams(filter)) url.searchParams.set(k, v);
    }
    if (limit) url.searchParams.set('limit', String(limit));

    let res;
    try {
        res = await fetchWithTimeout(url, {
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                Accept: 'application/json',
            },
        }, timeoutMs);
    } catch (err) {
        throw new SupabaseError(`select(${table}) transport error: ${err && err.message}`, { status: 0, body: null });
    }
    if (!res.ok) {
        throw new SupabaseError(`select(${table}) failed: ${res.status}`, {
            status: res.status,
            body: await res.text().catch(() => null),
        });
    }
    return res.json();
}

/**
 * Exact row count without pulling the rows: PostgREST answers
 * `Prefer: count=exact` in the Content-Range header, so one capped GET
 * costs a single row of body whatever the table holds.
 *
 * `query` is a PostgREST query string — `select` plus any filters,
 * including filters on an `!inner` embed. Interpolate only values you
 * have already validated (a UUID from a verified JWT, not raw input).
 */
export async function count(table, { query = '' } = {}, options) {
    const { supabaseUrl, serviceRoleKey, timeoutMs = 8000 } = options;
    if (!supabaseUrl || !serviceRoleKey) {
        throw new SupabaseError('supabase client not configured', { status: 0, body: null });
    }
    const url = new URL(`/rest/v1/${encodeURIComponent(table)}`, supabaseUrl);
    for (const [k, v] of new URLSearchParams(query)) url.searchParams.set(k, v);
    url.searchParams.set('limit', '1');

    let res;
    try {
        res = await fetchWithTimeout(url, {
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                Accept: 'application/json',
                Prefer: 'count=exact',
            },
        }, timeoutMs);
    } catch (err) {
        throw new SupabaseError(`count(${table}) transport error: ${err && err.message}`, { status: 0, body: null });
    }
    if (!res.ok) {
        throw new SupabaseError(`count(${table}) failed: ${res.status}`, {
            status: res.status,
            body: await res.text().catch(() => null),
        });
    }
    // `0-0/42`, or `*/42` when the capped range came back empty.
    const total = Number((res.headers.get('content-range') || '').split('/')[1]);
    if (!Number.isInteger(total)) {
        throw new SupabaseError(`count(${table}) had no exact count`, { status: res.status, body: null });
    }
    return total;
}

/** Read the Supabase config out of process.env once. */
export function envConfig() {
    return {
        supabaseUrl: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
}
