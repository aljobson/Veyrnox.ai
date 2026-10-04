'use client';

/**
 * Client-side driver for the Publish analytics page. Thin wrapper over
 * GET /api/v1/social/analytics — see that route's header for the shape.
 */

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

/** Analytics for one of the caller's connected accounts; from/to are YYYY-MM-DD. */
export async function getSocialAnalytics({ accountId, from, to }) {
    const params = new URLSearchParams({ accountId, from, to });
    return gatewayFetch(`/social/analytics?${params.toString()}`);
}

/** Fixed twelve-week timing/frequency aggregates for an owned account. */
export async function getSocialPostingInsights(accountId) {
    return gatewayFetch(`/social/best-time?${new URLSearchParams({ accountId }).toString()}`);
}
