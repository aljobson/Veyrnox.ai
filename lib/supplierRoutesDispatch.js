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
 * The offer's own route, or null. `null` always means "dispatch as today".
 * @returns {Promise<object|null>}
 */
export async function resolveOwnRoute(offer, cfg, { read = select, log = console.warn, env = process.env } = {}) {
    if (!routesEnabled(env)) return null;
    try {
        const rows = await read('model_routes', { columns: COLUMNS, filter: `model_id=eq.${encodeURIComponent(offer.id)}` }, cfg);
        const [first] = chooseRoute(Array.isArray(rows) ? rows : []);
        if (first && first.supplier === offer.provider && first.endpoint === offer.provider_endpoint) return first;
        log('[supplier-routes] not the offer\'s own route; dispatching as today', JSON.stringify({ model: offer.id, chosen: first ? first.supplier : null }));
        return null;
    } catch (err) {
        log('[supplier-routes] route read failed; dispatching as today', JSON.stringify({ model: offer.id, error: String((err && err.message) || err).slice(0, 120) }));
        return null;
    }
}

/**
 * Record attempt 1 once job_submitted has stored the supplier job id.
 * @returns {Promise<boolean>} true when the row exists afterwards
 */
export async function recordFirstAttempt({ jobId, route, providerJobId }, cfg, { call = rpc, log = console.warn } = {}) {
    if (!route) return false;
    try {
        const r = await call('record_job_attempt', { p_job_id: jobId, p_route_id: route.id, p_supplier_job_id: providerJobId }, cfg);
        if (r && r.ok === true) return true;
        log('[supplier-routes] attempt not recorded', JSON.stringify({ job_id: jobId, code: r && r.code }));
    } catch (err) {
        log('[supplier-routes] attempt record failed', JSON.stringify({ job_id: jobId, error: String((err && err.message) || err).slice(0, 120) }));
    }
    return false;
}
