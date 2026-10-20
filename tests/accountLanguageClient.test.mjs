import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isAppLocalePath, localeFromCookie, LOCALE_COOKIE, localeCookie } from '../lib/i18n/localeCookie.mjs';

function browser({ cookie = '', accountLocale = 'de', signedIn = true, blockedCookies = false, status = 200, path = '/app' } = {}) {
    const calls = [], store = new Map();
    let session = signedIn ? { access_token: 'test-token', user: { id: 'alice' } } : null;
    let listener, reloads = 0, responder;
    const document = { get cookie() { return cookie; }, set cookie(value) { if (!blockedCookies) cookie = /Max-Age=0(?:;|$)/.test(value) ? '' : value.split(';')[0]; } };
    const source = readFileSync(new URL('../app/lib/accountLanguageClient.js', import.meta.url), 'utf8')
        .replace(/^import .*;$/gm, '').replace(/export /g, '');
    const api = runInNewContext(`${source}\n({ saveAccountLanguage, syncAccountLanguage, watchAccountLanguage });`, {
        getSession: () => session, onSessionChange: fn => { listener = fn; return () => { listener = null; }; },
        isAppLocalePath, localeFromCookie, LOCALE_COOKIE, rememberLocale: code => { document.cookie = localeCookie(code); }, document,
        sessionStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
        window: { location: { pathname: path, reload: () => { reloads += 1; } } },
        fetch: async (url, init) => {
            calls.push({ url, ...init });
            if (responder) return responder(url, init);
            return Response.json({ locale: accountLocale }, { status });
        },
    });
    return { ...api, calls, store, document, get reloads() { return reloads; },
        get session() { return session; }, changeSession(s) { session = s; listener?.(s); },
        respond(fn) { responder = fn; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('no request on signed-out public visits or anonymous choices', async () => {
    const b = browser({ signedIn: false, path: '/' });
    b.watchAccountLanguage(); b.saveAccountLanguage('de'); await tick();
    assert.equal(b.calls.length, 0);
});
test('cookie wins, no-cookie adopts account once, blocked cookies never reload', async () => {
    const b = browser({ cookie: 'veyrnox_locale=fr' });
    await b.syncAccountLanguage(b.session);
    assert.deepEqual(JSON.parse(b.calls[1].body), { locale: 'fr' }); assert.equal(b.reloads, 0);
    const empty = browser();
    await empty.syncAccountLanguage(empty.session); await empty.syncAccountLanguage(empty.session);
    assert.equal(empty.document.cookie, 'veyrnox_locale=de'); assert.equal(empty.reloads, 1);
    const blocked = browser({ blockedCookies: true });
    await blocked.syncAccountLanguage(blocked.session); assert.equal(blocked.reloads, 0);
});
test('sign-in syncs once per identity; sign-out keeps cookie; refresh does not repeat requests', async () => {
    const b = browser({ signedIn: false, path: '/', cookie: 'veyrnox_locale=de' });
    b.watchAccountLanguage();
    const s = { access_token: 'one', user: { id: 'alice' } };
    b.changeSession(s); await tick(); b.changeSession({ ...s, access_token: 'two' }); await tick();
    assert.equal(b.calls.length, 1);
    b.changeSession(null); assert.equal(b.document.cookie, 'veyrnox_locale=de');
});
test('keepalive writes do not wait; English survives old account state and reload', async () => {
    const b = browser();
    b.document.cookie = localeCookie('en');
    assert.equal(b.saveAccountLanguage('en'), undefined);
    assert.equal(b.calls[0].keepalive, true); assert.deepEqual(JSON.parse(b.calls[0].body), { locale: null });
    await b.syncAccountLanguage(b.session);
    assert.equal(b.reloads, 0); assert.equal(b.document.cookie, '');
    assert.deepEqual(JSON.parse(b.calls.at(-1).body), { locale: null });
});
test('503 and network failures are silent; late GET cannot undo a click or change another session', async () => {
    for (const status of [503, 401]) {
        const b = browser({ status }); await b.syncAccountLanguage(b.session); assert.equal(b.reloads, 0); assert.equal(b.calls.length, 1);
    }
    const failed = browser(); failed.respond(() => { throw Error('offline'); });
    await failed.syncAccountLanguage(failed.session); failed.saveAccountLanguage('fr'); await tick(); assert.equal(failed.reloads, 0);
    for (const change of ['choice','account','logout']) {
        const b = browser(); let finish;
        b.respond((_url, init) => init.method === 'PUT' ? Response.json({ locale: 'fr' }) : new Promise(resolve => { finish = resolve; }));
        const reading = b.syncAccountLanguage(b.session);
        if (change === 'choice') { b.document.cookie = localeCookie('fr'); b.saveAccountLanguage('fr'); }
        else b.changeSession(change === 'logout' ? null : { access_token: 'other', user: { id: 'bob' } });
        finish(Response.json({ locale: 'de' })); await reading; assert.equal(b.reloads, 0);
    }
});
