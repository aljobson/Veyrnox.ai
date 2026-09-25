/**
 * Read only after signature and standard claims have been verified.
 * @param {{aal?: unknown, amr?: unknown} | null | undefined} claims
 * @param {number} now
 */
export function recentMfaTimestamp(claims, now = Math.floor(Date.now() / 1000)) {
  if (claims?.aal !== 'aal2' || !Array.isArray(claims.amr)) return null;
  const times = claims.amr.filter(item => item?.method === 'totp'
    && Number.isSafeInteger(item.timestamp) && item.timestamp > 0
    && item.timestamp <= now + 5 && item.timestamp >= now - 300).map(item => item.timestamp);
  return times.length ? Math.max(...times) : null;
}
