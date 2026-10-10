// Only redirect to the same provider origins accepted by the server adapter.
export function subscriptionCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function subscriptionReturnFrom(url) {
  const q = url.searchParams;
  if (
    q.getAll('subscription').length !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      q.get('subscription') || '',
    )
  )
    return null;
  if (
    q.getAll('checkout').length !== 1 ||
    !['done', 'cancelled'].includes(q.get('checkout'))
  )
    return null;
  if (q.get('checkout') === 'cancelled')
    return { subscription_id: q.get('subscription'), cancelled: true };
  return q.getAll('session_id').length === 1 &&
    /^cs_[A-Za-z0-9_]{1,251}$/.test(q.get('session_id') || '')
    ? {
        subscription_id: q.get('subscription'),
        session_id: q.get('session_id'),
      }
    : null;
}
