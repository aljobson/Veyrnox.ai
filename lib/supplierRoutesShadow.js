/**
 * Shadow mode for supplier routes (ADR-0256 decision 11, phase 0).
 *
 * With SUPPLIER_ROUTES_SHADOW="true" the generation route asks which route
 * `chooseRoute` would pick for the offer and logs it next to the route dispatch
 * actually uses. Nothing here changes dispatch, the debit or the response, and
 * nothing here can throw into the request: every failure is swallowed into one
 * log line. Off (the default) it does no work and reads no table.
 *
 * "Done when" for phase 0: the log shows `match: true` for every dispatch.
 */

import { select } from '../packages/db/supabase-client.js';
import { chooseRoute } from './supplierRoutes.js';

const COLUMNS = 'id,supplier,endpoint,priority,state,provenance,parity_record,cost_per_unit,cost_unit,billing_seconds,margin_waiver_note,breaker_opened_at';

export function shadowEnabled(env = process.env) {
    return String(env.SUPPLIER_ROUTES_SHADOW || '').toLowerCase() === 'true';
}

/**
 * Compare the route chooseRoute picks with the offer's own provider and
 * endpoint. Pure; the async wrapper below adds the read and the log.
 * @returns {{match:boolean, chosen:string|null, reason:string}}
 */
export function compareShadow(offer, routes) {
    const [first] = chooseRoute(routes);
    if (!first) return { match: false, chosen: null, reason: routes.length ? 'no_eligible_route' : 'no_routes' };
    const match = first.supplier === offer.provider && first.endpoint === offer.provider_endpoint;
    return { match, chosen: first.supplier, reason: match ? 'same_route' : 'different_route' };
}

/**
 * Fire and forget: returns a promise that always resolves, so a caller may
 * ignore it. A table that does not exist yet (migration 0367 unapplied) logs
 * once per call and does nothing else.
 */
export async function logShadowRoute(offer, cfg, { read = select, log = console.info, env = process.env } = {}) {
    if (!shadowEnabled(env)) return null;
    try {
        const rows = await read('model_routes', { columns: COLUMNS, filter: `model_id=eq.${encodeURIComponent(offer.id)}` }, cfg);
        const result = compareShadow(offer, Array.isArray(rows) ? rows : []);
        log('[supplier-routes] shadow', JSON.stringify({ model: offer.id, dispatch: offer.provider, ...result }));
        return result;
    } catch (err) {
        log('[supplier-routes] shadow failed', JSON.stringify({ model: offer.id, error: String((err && err.message) || err).slice(0, 120) }));
        return null;
    }
}
