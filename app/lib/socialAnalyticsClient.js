'use client';

/**
 * Client-side driver for the Publish analytics page. Thin wrapper over
 * GET /api/v1/social/analytics — see that route's header for the shape.
 */

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';
import { getStoredUserId } from './authClient.js';

const analyticsReads = new Map();

/** Analytics for one of the caller's connected accounts; from/to are YYYY-MM-DD. */
export async function getSocialAnalytics({ accountId, from, to }) {
    const params = new URLSearchParams({ accountId, from, to });
    const path = `/social/analytics?${params.toString()}`;
    const key = `${getStoredUserId() || 'anonymous'}:${path}`;
    const existing = analyticsReads.get(key);
    if (existing) return existing;
    const request = gatewayFetch(path);
    analyticsReads.set(key, request);
    const clear = () => setTimeout(() => {
        if (analyticsReads.get(key) === request) analyticsReads.delete(key);
    }, 250);
    request.then(clear, clear);
    return request;
}

/** Fixed twelve-week timing/frequency aggregates for an owned account. */
export async function getSocialPostingInsights(accountId) {
    return gatewayFetch(`/social/best-time?${new URLSearchParams({ accountId }).toString()}`);
}
