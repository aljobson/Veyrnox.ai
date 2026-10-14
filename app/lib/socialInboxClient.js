'use client';

import { gatewayFetch, makeIdempotencyKey } from '../veyrnox/_lib/gateway.js';

export function listSocialInbox({ accountId, state = 'unresolved', kind, search } = {}) {
    const params = new URLSearchParams({ state });
    if (accountId) params.set('accountId', accountId);
    if (kind) params.set('kind', kind);
    if (search) params.set('search', search);
    return gatewayFetch(`/social/inbox?${params}`);
}

export const getSocialInboxThread = (threadId) => gatewayFetch(`/social/inbox/${encodeURIComponent(threadId)}`);
export const updateSocialInboxThread = (threadId, action) => gatewayFetch(`/social/inbox/${encodeURIComponent(threadId)}`, {
    method: 'PATCH', body: JSON.stringify({ action }),
});
export const replyToSocialInboxThread = (threadId, body, idempotencyKey = makeIdempotencyKey()) => gatewayFetch(`/social/inbox/${encodeURIComponent(threadId)}/reply`, {
    method: 'POST', body: JSON.stringify({ body, idempotencyKey }),
});
