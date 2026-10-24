/**
 * Supplier routes, phase 2b (ADR-0256 decision 5): submit-phase failover.
 *
 * A job has been debited and its first supplier refused it in a way that proves
 * nothing was accepted. This module decides whether that refusal may be routed
 * around and, if so, walks the offer's other routes. It never retries, never
 * fails over on an ambiguous answer, and never touches the debit or the refund:
 * when no route takes the job, the caller refunds exactly as it does today.
 *
 * What may be routed around, and nothing else:
 *   - the supplier refused on payment or auth (kie 402, 401, 403; fal 401, 403) or on capacity (429);
 *   - the adapter reported outcome "rejected" (an answer, not a timeout).
 * Never: outcome "unknown" (transport error, 5xx, 408: the supplier may hold the task,
 * 0329), a refusal of the prompt or inputs, a moderation refusal, or a 4xx we cannot read.
 * A job that carries media references does not hop: signed sources are per supplier.
 *
 * The database does the safe part: job_route_failover (0373) locks the job, checks it is
 * still DEBITED, closes the failed attempt, checks the next route's eligibility, margin
 * floor and spend budget, and opens the next attempt. Everything here is best effort
 * around it: any error means "stop hopping", which is the behaviour without this module.
 */

import { rpc } from '../packages/db/supabase-client.js';
import { chooseRoute, MAX_ROUTES_PER_OFFER } from './supplierRoutes.js';

const KIE_LIKE_REFUSAL = /^(kie|crun) (401|403|429)\//;
const FAL_REFUSAL = /^fal (401|403|429):/;
// The database says this job can no longer hop at all, whatever route is offered.
const TERMINAL_REFUSALS = new Set(['job_not_found', 'job_not_failable_over', 'attempt_was_accepted', 'no_more_routes', 'failed_route_mismatch']);

/**
 * @param {{ok:boolean, outcome?:string, error?:string, errorCode?:string}} result a failed submit result
 * @returns {'failover'|'stop'}
 */
export function classifySubmitFailure(result) {
    if (!result || result.ok || result.outcome !== 'rejected') return 'stop';
    if (result.errorCode === 'provider_payment_required') return 'failover';
    const error = String(result.error || '');
    return KIE_LIKE_REFUSAL.test(error) || FAL_REFUSAL.test(error) ? 'failover' : 'stop';
}

/** The next route to try: eligible, not yet tried, in chooseRoute's order. */
export function nextRoute(routes, tried, opts) {
    return chooseRoute(routes, opts).find((r) => !tried.has(r.id)) || null;
}

/**
 * Submit through the offer's routes.
 *
 * @param {object} p
 * @param {string} p.jobId
 * @param {object} p.modelRow          the catalog row (its provider is route 1)
 * @param {object|null} p.ownRoute     route 1, or null: no failover, submit once
 * @param {object[]} p.routes          every route of the offer
 * @param {boolean} p.canHop           false when the job carries media references
 * @param {object} p.inputs            inputs for the provider's own check and submit
 * @param {string} p.publicHost
 * @param {object} p.first             {provider, record, key} for route 1
 * @param {object} p.deps              {providerFor, capabilityFor, rpc, log}
 * @returns {Promise<{result:object, supplier:string, route:object|null, attemptNo:number}>}
 */
export async function submitWithFailover({ jobId, modelRow, ownRoute, routes, canHop, inputs, jobInputs, publicHost, sources, first, deps }, cfg) {
    const call = deps.rpc || rpc;
    const log = deps.log || console.warn;
    let supplier = modelRow.provider;
    let route = ownRoute;
    let attemptNo = 1;
    let result = await first.provider.submit(
        { job_id: jobId, provider_endpoint: modelRow.provider_endpoint, inputs: jobInputs }, first.record, first.key, publicHost, sources);

    const tried = new Set(ownRoute ? [ownRoute.id] : []);
    while (ownRoute && !result.ok && canHop && attemptNo < MAX_ROUTES_PER_OFFER && classifySubmitFailure(result) === 'failover') {
        const next = nextRoute(routes, tried);
        if (!next) break;
        const target = { ...modelRow, provider: next.supplier, provider_endpoint: next.endpoint };
        const provider = deps.providerFor(next.supplier);
        const record = deps.capabilityFor(next.endpoint);
        const key = provider && provider.key();
        // Everything the next supplier needs must be in place before the database opens an attempt.
        if (!provider || !key || !record || record.provider !== next.supplier || !provider.check(record, target, inputs).ok) {
            log('[supplier-routes] next route not usable; no failover', JSON.stringify({ model: modelRow.id, supplier: next.supplier }));
            tried.add(next.id);
            continue;
        }
        let hop;
        try { hop = await call('job_route_failover', { p_job_id: jobId, p_failed_route_id: route.id, p_next_route_id: next.id }, cfg); }
        catch (err) { log('[supplier-routes] failover call failed', JSON.stringify({ error: String((err && err.message) || err).slice(0, 120) })); break; }
        if (!hop || hop.ok !== true) {
            log('[supplier-routes] failover refused', JSON.stringify({ model: modelRow.id, code: hop && hop.code }));
            tried.add(next.id);
            // The refusing call already closed the failed attempt, so another candidate is still safe to try.
            if (hop && TERMINAL_REFUSALS.has(hop.code)) break;
            continue;
        }
        tried.add(next.id);
        log('[supplier-routes] failover', JSON.stringify({ model: modelRow.id, from: supplier, to: next.supplier, attempt: hop.attempt_no }));
        supplier = next.supplier;
        route = next;
        attemptNo = hop.attempt_no;
        result = await provider.submit({ job_id: jobId, provider_endpoint: next.endpoint, inputs: jobInputs }, record, key, publicHost, sources);
    }

    // An ambiguous answer (outcome unknown) is not closed: the supplier may hold the task and the debit stays held (0329).
    if (!result.ok && ownRoute && result.outcome === 'rejected') {
        // Close the last attempt as failed so the log shows it; the caller refunds as today.
        try { await call('job_route_failover', { p_job_id: jobId, p_failed_route_id: route.id, p_next_route_id: null }, cfg); }
        catch (err) { log('[supplier-routes] could not close the failed attempt', JSON.stringify({ error: String((err && err.message) || err).slice(0, 120) })); }
    }
    return { result, supplier, route, attemptNo };
}
