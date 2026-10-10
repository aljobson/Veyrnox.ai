import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANNOUNCEMENT, isDismissed, dismiss } from '../app/veyrnox/_lib/announcement.js';
import { SITE_PAGES } from '../app/veyrnox/_lib/tokens.js';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('a dismissal is remembered for that announcement only', () => {
    const s = store();
    assert.equal(isDismissed(s, 'a'), false);
    dismiss(s, 'a');
    assert.equal(isDismissed(s, 'a'), true);
    assert.equal(isDismissed(s, 'b'), false, 'a new announcement shows again');
});

test('blocked storage never throws and never hides the bar', () => {
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(isDismissed(blocked, 'a'), false);
    assert.doesNotThrow(() => dismiss(blocked, 'a'));
});

test('the announcement, when set, has an id and links to a page that exists', () => {
    if (!ANNOUNCEMENT) return;
    assert.match(ANNOUNCEMENT.id, /^[a-z0-9-]{3,40}$/);
    assert.ok(ANNOUNCEMENT.message.length > 10 && ANNOUNCEMENT.cta.length > 2);
    assert.ok(SITE_PAGES.some((p) => p.href === ANNOUNCEMENT.href), `${ANNOUNCEMENT.href} is not a site page`);
});

test('the bar sits above the marketing nav and can be dismissed', () => {
    const nav = readFileSync(new URL('../app/veyrnox/_components/NavBar.js', import.meta.url), 'utf8');
    assert.match(nav, /<AnnouncementBar \/>\s*<header data-print="hide" className="sticky/);
    // The landing page takes the same nav as every other public page, so the
    // nav places the bar there too. A bar of the page's own would show twice.
    const home = readFileSync(new URL('../app/veyrnox/page.js', import.meta.url), 'utf8');
    assert.match(home, /<div className="min-h-dvh">\s*<MarketingNav \/>/);
    assert.doesNotMatch(home, /AnnouncementBar/);
    const bar = readFileSync(new URL('../app/veyrnox/_components/AnnouncementBar.js', import.meta.url), 'utf8');
    assert.match(bar, /aria-label="Dismiss announcement"/);
    assert.match(bar, /dismiss\(window\.localStorage, ANNOUNCEMENT\.id\)/);
});
