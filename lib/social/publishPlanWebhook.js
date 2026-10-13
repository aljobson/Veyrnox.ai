import { verifyPublishPlanMetadata } from '../../packages/adapters/stripePublishPlan.js';

const FINAL_NOT_OURS = new Set(['SUBSCRIPTION_NOT_FOUND']);
const REFUSED = new Set(['SUBSCRIPTION_NOT_FOUND', 'SUBSCRIPTION_MISMATCH', 'INVALID_EVENT', 'INVALID_SUBSCRIPTION']);

/** Apply a Stripe subscription snapshot when it belongs to Publish.
 * Returns null when this subscription belongs to another billing product. */
export async function handlePublishPlanEvent({ rpcCall, cancelSubscriptionNow, cfg, stripeConfig, subscription, eventId, type, signingSecret, eventCreated, isYoung }) {
  const signed = await verifyPublishPlanMetadata(subscription.metadata, signingSecret);
  const publishId = signed ? subscription.metadata.social_publish_subscription_id : null;
  const result = await rpcCall('apply_social_publish_subscription_event', {
    p_event_id: eventId, p_type: type, p_publish_subscription_id: publishId,
    p_stripe_subscription_id: subscription.id, p_customer_id: subscription.customerId,
    p_status: subscription.status, p_period_end: subscription.periodEnd,
    p_cancel_at_period_end: subscription.cancelAtPeriodEnd,
    p_occurred_at: new Date(Number.isSafeInteger(eventCreated) && eventCreated > 0 ? eventCreated * 1000 : Date.now()).toISOString(),
  }, cfg);
  if (result?.ok === false && FINAL_NOT_OURS.has(result.code) && !signed) return null;
  if (!result || typeof result.ok !== 'boolean' || (result.ok === false && !REFUSED.has(result.code))) {
    return Response.json({ error: 'internal' }, { status: 500 });
  }
  if (result.ok === false && result.code === 'SUBSCRIPTION_NOT_FOUND' && publishId && isYoung(eventCreated)) {
    return Response.json({ error: 'publish_subscription_not_bound_yet' }, { status: 503 });
  }
  if (result.flagged) {
    const stopped = await cancelSubscriptionNow(subscription.id, stripeConfig);
    if (!stopped.ok) return Response.json({ error: 'flagged_cancel_failed' }, { status: 503 });
    console.error('[stripe-webhook] second Publish Plan subscription cancelled and flagged for refund:', subscription.id);
  }
  return Response.json({ ok: true });
}

/** End Publish access for a refund or dispute. Null means another product. */
export async function handlePublishPlanCharge({ rpcCall, cfg, stripeSubscriptionId, eventId, type, reference, eventCreated }) {
  const result = await rpcCall('end_social_publish_subscription', {
    p_stripe_subscription_id: stripeSubscriptionId, p_event_id: eventId,
    p_reason: type === 'charge.refunded' ? 'refunded' : 'disputed',
    p_reference: reference,
    p_occurred_at: new Date(Number.isSafeInteger(eventCreated) && eventCreated > 0 ? eventCreated * 1000 : Date.now()).toISOString(),
  }, cfg);
  if (result?.ok === false && result.code === 'SUBSCRIPTION_NOT_FOUND') return null;
  if (!result || typeof result.ok !== 'boolean' || (result.ok === false && !REFUSED.has(result.code))) {
    return Response.json({ error: 'internal' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
