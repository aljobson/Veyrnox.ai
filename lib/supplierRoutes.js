/**
 * Supplier routes, phase 0 (ADR-0256): the pure ordering and floor rules.
 *
 * Nothing in the request path imports this yet. It is the unit-tested
 * decision function that shadow mode will log next to the real dispatch, and
 * the generalised margin check that phase 4 turns into the catalog trigger.
 */

// ADR-0037 amendment 2 / migration 0366: a credit may carry this much
// provider cost and still leave half of gross at the $129 pack.
export const COST_CAP_PER_CREDIT = 0.01796;
export const MAX_ROUTES_PER_OFFER = 3;

const PROVENANCE_RANK = { official: 0, licensed_reseller: 1, unverified: 2 };

/** Integer test of cost <= credits * cap, so no float drift at the boundary. */
function withinCap(cost, credits) {
  return Math.round(cost * 100000) <= credits * Math.round(COST_CAP_PER_CREDIT * 100000);
}

function perGenerationCost(route) {
  const unitCount = route.cost_unit === 'per_second' ? Number(route.billing_seconds) || 1 : 1;
  return Number(route.cost_per_unit) * unitCount;
}

/**
 * The 50% floor for an offer: the dearest route that may serve it must stay
 * within credits * cap, unless that route carries a margin waiver.
 * Returns { ok, worst, breaches[] }.
 */
export function routeFloor(credits, routes) {
  const serving = routes.filter((r) => r.state === 'active');
  const breaches = serving
    .filter((r) => !r.margin_waiver_note && !withinCap(perGenerationCost(r), credits))
    .map((r) => r.supplier);
  const worst = serving.reduce((max, r) => Math.max(max, perGenerationCost(r)), 0);
  return { ok: breaches.length === 0, worst, breaches };
}

/**
 * Order the routes that may serve a job now.
 *
 * - only `active` routes with a parity record, at most three;
 * - a route whose breaker is open (health.open) is skipped;
 * - an `unverified` route is last, and only if the offer allows it;
 * - otherwise by priority, which the owner sets from cost.
 * Returns the ordered list; the first element is the route to try.
 */
export function chooseRoute(routes, { health = {}, allowUnverified = false } = {}) {
  return routes
    .filter((r) => r.state === 'active' && r.parity_record)
    .filter((r) => !(health[r.id] && health[r.id].open))
    .filter((r) => allowUnverified || r.provenance !== 'unverified')
    .slice()
    .sort((a, b) => (PROVENANCE_RANK[a.provenance] === 2) - (PROVENANCE_RANK[b.provenance] === 2) || a.priority - b.priority)
    .slice(0, MAX_ROUTES_PER_OFFER);
}

/** True when the route chosen for shadow logging is the one dispatch used. */
export function shadowMatches(offer, routes, opts) {
  const [first] = chooseRoute(routes, opts);
  return Boolean(first) && first.supplier === offer.provider && first.endpoint === offer.provider_endpoint;
}
