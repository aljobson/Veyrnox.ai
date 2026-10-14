'use client';

import { gatewayFetch, makeIdempotencyKey } from '../veyrnox/_lib/gateway.js';

export function listSocialInbox({ accountId, state = 'unresolved', kind, search, assignee, priority, tag } = {}) {
    const params = new URLSearchParams({ state });
    if (accountId) params.set('accountId', accountId);
    if (kind) params.set('kind', kind);
    if (search) params.set('search', search);
    if (assignee) params.set('assignee', assignee);
    if (priority) params.set('priority', priority);
    if (tag) params.set('tag', tag);
    return gatewayFetch(`/social/inbox?${params}`);
}

export const getSocialInboxThread = (threadId) => gatewayFetch(`/social/inbox/${encodeURIComponent(threadId)}`);
export const updateSocialInboxThread = (threadId, action, value = {}) => gatewayFetch(`/social/inbox/${encodeURIComponent(threadId)}`, {
    method: 'PATCH', body: JSON.stringify({ action, ...value }),
});
export const addSocialInboxNote = (threadId, note) => gatewayFetch(`/social/inbox/${encodeURIComponent(threadId)}`, {
    method: 'POST', body: JSON.stringify({ note }),
});
export const replyToSocialInboxThread = (threadId, body, idempotencyKey = makeIdempotencyKey()) => gatewayFetch(`/social/inbox/${encodeURIComponent(threadId)}/reply`, {
    method: 'POST', body: JSON.stringify({ body, idempotencyKey }),
});
export function getSocialInboxAnalytics({ accountId, days = 30 } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    if (accountId) params.set('accountId', accountId);
    return gatewayFetch(`/social/inbox/analytics?${params}`);
}

export function listSocialInboxContacts({ accountId, network, subscriptionStatus, search, tag } = {}) {
    const params = new URLSearchParams();
    if (accountId) params.set('accountId', accountId);
    if (network) params.set('network', network);
    if (subscriptionStatus) params.set('subscriptionStatus', subscriptionStatus);
    if (search) params.set('search', search);
    if (tag) params.set('tag', tag);
    return gatewayFetch(`/social/contacts?${params}`);
}

export const updateSocialInboxContact = (contact) => gatewayFetch('/social/contacts', {
    method: 'PATCH', body: JSON.stringify(contact),
});
