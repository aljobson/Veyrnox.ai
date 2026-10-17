const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,188}[a-z0-9])?$/i;

// Navigation can prefill a lookup, never authorize one or select an action.
export function adminUserHandoff(searchParams) {
  const values = searchParams?.getAll('user') || [];
  if (values.length !== 1 || values[0].length > 254 || /[\u0000-\u001f\u007f]/.test(values[0])) return '';
  const value = values[0].trim();
  return UUID_RE.test(value) || EMAIL_RE.test(value) ? value : '';
}
