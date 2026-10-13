'use client';

import { gatewayFetch, makeIdempotencyKey } from '../veyrnox/_lib/gateway.js';

export const getPublishPlan = () => gatewayFetch('/social/plan');

export function startPublishPlan(planId, consentVersion) {
  return gatewayFetch('/social/plan', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: planId, idempotency_key: makeIdempotencyKey(),
      consent: true, consent_version: consentVersion,
    }),
  });
}

export function recoverPublishPlan(subscriptionId, sessionId) {
  return gatewayFetch('/social/plan/return', {
    method: 'POST', body: JSON.stringify({ subscription_id: subscriptionId, session_id: sessionId }),
  });
}

export const cancelPublishPlan = () => gatewayFetch('/social/plan/cancel', { method: 'POST', body: '{}' });
export const openPublishBilling = () => gatewayFetch('/social/plan/portal', { method: 'POST', body: '{}' });
