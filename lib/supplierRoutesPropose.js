/**
 * Supplier routes, phase 4b (ADR-0256 decisions 1, 3 and 4): propose the cheapest order.
 *
 * Pure. Given an offer and its routes, say which order the owner could approve. The owner
 * approves every change (decision 4), so this proposes and never applies: the script
 * scripts/propose-route-order.mjs applies one only with --apply.
 *
 * The proposed order lists every `active` route (model_route_reorder requires that):
 *   1. routes the Worker can dispatch now (an adapter and a capability record exist), the
 *      cheapest first, ties keeping today's order;
 *   2. then routes it cannot dispatch, in today's order, so none can become the first route;
 *   3. an `unverified` route is always last (decision 1).
 * A route is only ever a candidate if it is active, has a parity record and a closed breaker.
 */

const RANK = { official: 0, licensed_reseller: 0, unverified: 1 };

/** Cost of one generation of the offer on a route, the same arithmetic the spend guard uses. */
export function generationCost(route, offer) {
    const units = Math.max(1, Math.ceil(Math.max(1, offer.credits) / offer.credits_5s));
    return Number(route.cost_per_unit) * units;
}

/**
 * @param {{id:string, credits:number, credits_5s:number}} offer  `credits` is what one generation is priced at
 * @param {object[]} routes every route of the offer
 * @param {{canDispatch:(route:object)=>boolean}} deps
 * @returns {{changed:boolean, current:string[], proposed:string[], savingPerGeneration:number, reason:string}}
 */
export function proposeOrder(offer, routes, { canDispatch }) {
    const active = routes.filter((r) => r.state === 'active').sort((a, b) => a.priority - b.priority);
    const current = active.map((r) => r.id);
    const none = (reason) => ({ changed: false, current, proposed: current, savingPerGeneration: 0, reason });
    if (active.length < 2) return none('fewer than two active routes');

    const candidates = active.filter((r) => r.parity_record && !r.breaker_opened_at);
    if (candidates.length !== active.length) return none('an active route has no parity record or an open breaker');

    const rank = (r) => RANK[r.provenance] ?? 1;
    const dispatchable = candidates.filter(canDispatch);
    const rest = candidates.filter((r) => !canDispatch(r));
    const byCost = (a, b) => generationCost(a, offer) - generationCost(b, offer) || a.priority - b.priority;
    const ordered = [
        ...dispatchable.filter((r) => rank(r) === 0).sort(byCost),
        ...rest.filter((r) => rank(r) === 0),
        ...dispatchable.filter((r) => rank(r) === 1).sort(byCost),
        ...rest.filter((r) => rank(r) === 1),
    ];
    // A first route the Worker cannot dispatch would answer 501: propose nothing.
    if (!canDispatch(ordered[0])) return none('no dispatchable route to put first');
    const proposed = ordered.map((r) => r.id);
    if (proposed.every((id, i) => id === current[i])) return none('already the cheapest order');
    const saving = generationCost(active[0], offer) - generationCost(ordered[0], offer);
    return { changed: true, current, proposed, savingPerGeneration: Math.round(saving * 1e6) / 1e6, reason: 'a cheaper dispatchable route exists' };
}
