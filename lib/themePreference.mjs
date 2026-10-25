// The remembered appearance: 'light', 'dark' or 'system' (follow the device).
// It lives in a plain cookie so the server can put it on <html> in the first
// response: no inline script (CSP) and no flash of the wrong theme. The cookie
// holds no identity and is only ever read to pick a colour set.
export const THEME_COOKIE = 'veyrnox_theme';
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;
export const THEME_CHOICES = ['system', 'light', 'dark'];

/** A cookie or storage value as a choice, or null when it is not one. */
export function parseTheme(value) {
  return THEME_CHOICES.includes(value) ? value : null;
}

/** The scheme actually painted: system resolves through the device setting. */
export function resolveTheme(choice, systemPrefersLight) {
  if (choice === 'light' || choice === 'dark') return choice;
  return choice === 'system' && systemPrefersLight ? 'light' : 'dark';
}

/** The Set-Cookie text for a choice (document.cookie form). */
export function themeCookie(choice, secure = true) {
  return `${THEME_COOKIE}=${choice}; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
