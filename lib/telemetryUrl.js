// Capabilities authorize their holder, so removing only ?query/#fragment is
// insufficient. Keep route structure, never the bearer segment or its suffix.
const CAPABILITY = /(\/(?:social\/review|social\/team\/invite|media\/social|api\/social\/(?:approvals|team)))\/[^?#]*/gi;
const CAPABILITY_ROUTE = /\/(?:social\/review|social\/team\/invite|media\/social|api\/social\/(?:approvals|team))(?:\/|$)/i;
const LOCALE = /^\/(?:en|de|es|fr|pt|ru|ar|zh|ja|ko|hi)(?=\/|$)/i;

function decoded(value) {
  let result = value;
  for (let n = 0; n < 4; n += 1) {
    try {
      const next = decodeURIComponent(result);
      if (next === result) break;
      result = next;
    } catch {
      // A malformed escape in the bearer must not prevent decoding its route.
      result = result.replace(/%([0-7][\da-f])/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
      break;
    }
  }
  return result;
}

export function telemetryPath(value) {
  const raw = decoded(typeof value === 'string' ? value : '/').replaceAll('\\', '/').split(/[?#]/, 1)[0];
  try { return new URL(raw, 'https://telemetry.invalid').pathname.replace(/\/{2,}/g, '/'); }
  catch { return '/:invalid-url'; }
}

export function capabilityPath(value) {
  return CAPABILITY_ROUTE.test(telemetryPath(value));
}

export function unlocalizedTelemetryPath(value) {
  return telemetryPath(value).replace(LOCALE, '') || '/';
}

export function scrubTelemetryUrl(value) {
  if (typeof value !== 'string') return value;
  const raw = decoded(value).replaceAll('\\', '/').split(/[?#]/, 1)[0];
  const method = raw.match(/^[A-Z]+ (?=\/)/)?.[0] || '';
  const target = raw.slice(method.length);
  const path = telemetryPath(target).replace(CAPABILITY, '$1/:token');
  try {
    const url = new URL(target, 'https://telemetry.invalid');
    url.pathname = path;
    url.username = ''; url.password = '';
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) return `${method}${url.href}`;
    if (target.startsWith('//')) return `${method}//${url.host}${path}`;
    return `${method}${target.startsWith('/') ? path : path.slice(1)}`;
  } catch { return '/:invalid-url'; }
}

// SDK payload shapes change independently of the app. Apply the same boundary
// recursively, including nested frame locations, tags and navigation metadata.
export function scrubTelemetryTree(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return /^(?:[a-z][a-z\d+.-]*:|\/|%2f)/i.test(value) || capabilityPath(value)
      ? scrubTelemetryUrl(value) : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => scrubTelemetryTree(item, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubTelemetryTree(item, seen)]));
  seen.delete(value);
  return result;
}
