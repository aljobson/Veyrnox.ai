'use client';
import { getSession, onSessionChange } from './authClient.js';
import { isAppLocalePath, localeFromCookie, LOCALE_COOKIE, rememberLocale } from '../../lib/i18n/localeCookie.mjs';

const ENDPOINT = '/api/v1/account/language';
let choiceVersion = 0;
const pendingKey = id => `veyrnox_language_pending:${id}`;
function pending(id, value) {
    try {
        if (value !== undefined) sessionStorage.setItem(pendingKey(id), value);
        return sessionStorage.getItem(pendingKey(id));
    } catch { return null; }
}
function hasCookie() {
    return document.cookie.split(';').some(part => part.trim().startsWith(`${LOCALE_COOKIE}=`));
}
async function writeChoice(session, locale) {
    try {
        await fetch(ENDPOINT, { method: 'PUT', keepalive: true, credentials: 'same-origin',
            headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale: locale === 'en' ? null : locale }) });
    } catch { /* The display choice never waits for the account. */ }
}

/** Called after the cookie is written, only for an ordinary language-link click. */
export function saveAccountLanguage(locale) {
    choiceVersion += 1;
    const session = getSession();
    if (!session?.access_token || !session.user?.id) return;
    // Survives immediate navigation, including English, which removes the cookie.
    pending(session.user.id, locale);
    void writeChoice(session, locale);
}

export async function syncAccountLanguage(session) {
    if (!session?.access_token || !session.user?.id) return;
    const id = session.user.id;
    const version = choiceVersion;
    try {
        const response = await fetch(ENDPOINT, { cache: 'no-store', credentials: 'same-origin',
            headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!response.ok) return;
        const { locale } = await response.json();
        if (getSession()?.user?.id !== id || version !== choiceVersion) return;
        const explicit = pending(id);
        const cookie = hasCookie();
        const browser = cookie ? localeFromCookie(document.cookie) : explicit;
        if (browser) {
            if ((locale || 'en') !== browser) await writeChoice(getSession(), browser);
            else {
                try { sessionStorage.removeItem(pendingKey(id)); } catch { /* optional storage */ }
            }
        } else if (locale && localeFromCookie(`${LOCALE_COOKIE}=${locale}`) === locale) {
            rememberLocale(locale);
            // If cookies are blocked, do not reload into the same state.
            if (localeFromCookie(document.cookie) === locale) window.location.reload();
        }
    } catch { /* Missing migration, offline or expired session: keep the current display. */ }
}

/** Root auth boundary: no request for anonymous public visitors, once per session identity. */
export function watchAccountLanguage() {
    let lastId = getSession()?.user?.id || null;
    if (lastId && isAppLocalePath(window.location.pathname)) void syncAccountLanguage(getSession());
    return onSessionChange(session => {
        const id = session?.user?.id || null;
        if (id && id !== lastId) void syncAccountLanguage(session);
        lastId = id;
    });
}
