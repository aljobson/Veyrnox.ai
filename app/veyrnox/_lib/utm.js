// First-touch campaign attribution.
//
// No analytics vendor is wired into this site and the CSP's connect-src is
// same-origin only, so "UTM tracking" here means: remember where a visitor
// first arrived from, in their own browser, so a later sign-up or support
// thread can be attributed. Nothing is sent anywhere by this module.
//
// First-touch, not last-touch: the first landing wins and is never
// overwritten, which is what you want when a visitor comes back through a
// bookmark and then converts.

export const ATTRIBUTION_KEY = 'veyrnox_attribution';

// The params worth keeping. gclid/fbclid are ad-click ids, not UTM, but they
// answer the same question and arrive on the same URL.
export const ATTRIBUTION_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ref',
];

const MAX_VALUE_LEN = 128;

/**
 * Pull attribution out of a query string. Returns null when the URL carries
 * nothing campaign-shaped, so a plain visit never overwrites a real one.
 *
 * @param {string} search - `window.location.search`, with or without the `?`.
 * @param {string} [referrer] - `document.referrer`.
 * @returns {{ params: Record<string,string>, referrer?: string, landedAt: string } | null}
 */
export function parseAttribution(search, referrer = '') {
  const params = {};
  const q = new URLSearchParams(String(search || ''));
  for (const key of ATTRIBUTION_PARAMS) {
    const raw = q.get(key);
    if (!raw) continue;
    // Values land in localStorage and may be echoed into a support form, so
    // cap the length and keep them as plain text.
    params[key] = raw.slice(0, MAX_VALUE_LEN);
  }
  if (Object.keys(params).length === 0) return null;

  const entry = { params, landedAt: new Date().toISOString() };
  // Own-origin referrers say nothing about acquisition.
  if (referrer && !isSameOrigin(referrer)) entry.referrer = referrer.slice(0, MAX_VALUE_LEN);
  return entry;
}

function isSameOrigin(referrer) {
  try {
    return new URL(referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Store the first campaign landing we ever see. Returns what is on record. */
export function captureAttribution() {
  try {
    const existing = localStorage.getItem(ATTRIBUTION_KEY);
    if (existing) return JSON.parse(existing);
    const entry = parseAttribution(window.location.search, document.referrer);
    if (!entry) return null;
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(entry));
    return entry;
  } catch {
    return null;
  }
}

/** Read it back — for a sign-up payload or a support thread. */
export function readAttribution() {
  try {
    const raw = localStorage.getItem(ATTRIBUTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
