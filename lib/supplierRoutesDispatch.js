/**
 * Supplier routes, phase 1 (ADR-0256): resolve the route a job runs on and
 * record it as attempt 1.
 *
 * With SUPPLIER_ROUTES_ENABLED="true" the generation route asks which route
 * `chooseRoute` picks for the offer. In phase 1 every offer has exactly one
 * eligible route, the offer's own. If the choice is anything else (a second
 * route, an empty table, a read error) dispatch ignores it and uses the
 * offer's provider exactly as today, and the difference is logged. So the flag
 * can only add a row to job_attempts; it can never change where a job goes.
 *
 * Both functions resolve, never throw, and are no-ops with the flag off.
 */

import { select, rpc } from '../packages/db/supabase-client.js';
import { chooseRoute } from './supplierRoutes.js';

const COLUMNS = 'id,supplier,endpoint,priority,state,provenance,parity_record,cost_per_unit,cost_unit,billing_seconds,margin_waiver_note,breaker_opened_at';

export function routesEnabled(env = process.env) {
    return String(env.SUPPLIER_ROUTES_ENABLED || '').toLowerCase() === 'true';
}

/**
 * The routes of an offer and which of them is the offer's own. `own` is null
 * whenever dispatch must run as today (flag off, a read error, an empty table,
 * or chooseRoute naming a different first route); `routes` then is empty too.
 * @returns {Promise<{own: object|null, routes: object[]}>}
 */
export async function resolveRouteSet(offer, cfg, { read = select, log = console.warn, env = process.env } = {}) {
    const none = { own: null, routes: [] };
    if (!routesEnabled(env)) return none;
    try {
        const rows = await read('model_routes', { columns: COLUMNS, filter: `model_id=eq.${encodeURIComponent(offer.id)}` }, cfg);
        const routes = Array.isArray(rows) ? rows : [];
        const [first] = chooseRoute(routes);
        if (first && first.supplier === offer.provider && first.endpoint === offer.provider_endpoint) return { own: first, routes };
        log('[supplier-routes] not the offer\'s own route; dispatching as today', JSON.stringify({ model: offer.id, chosen: first ? first.supplier : null }));
        return none;
    } catch (err) {
        log('[supplier-routes] route read failed; dispatching as today', JSON.stringify({ model: offer.id, error: String((err && err.message) || err).slice(0, 120) }));
        return none;
    }
}

/**
 * The offer's own route, or null. `null` always means "dispatch as today".
 * @returns {Promise<object|null>}
 */
export async function resolveOwnRoute(offer, cfg, deps) {
    return (await resolveRouteSet(offer, cfg, deps)).own;
}

/**
 * Record attempt 1 once job_submitted has stored the supplier job id.
 * @returns {Promise<boolean>} true when the row exists afterwards
 */
export async function recordFirstAttempt({ jobId, route, attemptNo = 1, providerJobId }, cfg, { call = rpc, log = console.warn } = {}) {
    if (!route) return false;
    try {
        // Attempt 1 is created here; a failover attempt (2 or 3) was opened by job_route_failover and only needs its supplier id.
        const r = attemptNo > 1
            ? await call('record_attempt_supplier', { p_job_id: jobId, p_attempt_no: attemptNo, p_supplier_job_id: providerJobId }, cfg)
            : await call('record_job_attempt', { p_job_id: jobId, p_route_id: route.id, p_supplier_job_id: providerJobId }, cfg);
        if (r && r.ok === true) return true;
        log('[supplier-routes] attempt not recorded', JSON.stringify({ job_id: jobId, code: r && r.code }));
    } catch (err) {
        log('[supplier-routes] attempt record failed', JSON.stringify({ job_id: jobId, error: String((err && err.message) || err).slice(0, 120) }));
    }
    return false;
}

/**
 * Close attempt 1 once the supplier has settled the job (migration 0372). Best
 * effort: it never throws, never changes the job or the ledger, and does nothing
 * unless SUPPLIER_ROUTES_ENABLED is "true". Call it after the job's own state
 * RPC has run, with the supplier and its job id.
 * @param {{provider:string, providerJobId:string, outcome:'completed'|'failed'}} attempt
 * @returns {Promise<boolean>} true when the call returned ok
 */
export async function markAttemptOutcome({ provider, providerJobId, outcome }, cfg, { call = rpc, log = console.warn, env = process.env } = {}) {
    if (!routesEnabled(env)) return false;
    try {
        const r = await call('mark_job_attempt_outcome', { p_provider: provider, p_supplier_job_id: providerJobId, p_outcome: outcome }, cfg);
        if (r && r.ok === true) return true;
        log('[supplier-routes] attempt outcome not recorded', JSON.stringify({ provider, code: r && r.code }));
    } catch (err) {
        log('[supplier-routes] attempt outcome failed', JSON.stringify({ provider, error: String((err && err.message) || err).slice(0, 120) }));
    }
    return false;
}
