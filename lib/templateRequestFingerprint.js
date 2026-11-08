// JSONB equality ignores object order; photo arrays must retain their order.
export async function templateRequestFingerprint(body) {
  const canonical = JSON.stringify(body, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
