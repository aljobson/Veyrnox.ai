// Vey answers from hand-written articles, so a page added to the app is invisible to it until someone writes one
// (the CLI and developer API were missing this way). This test makes that a decision, not an accident: every page
// route has a reviewed article, or is named below with the reason it has none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_KNOWLEDGE } from '../lib/productKnowledge.js';
import { AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';

const NO_ARTICLE = Object.freeze({
    // Reached only by a link or redirect, with no question to ask about them.
    transient: [
        '/auth/callback',
        '/oauth/consent',
        '/s/[slug]',
        '/social/connect/callback/[network]',
        '/social/review/[token]',
        '/social/team/invite/[token]',
    ],
    // Not a product page.
    internal: ['/design-system'],
    // The phone layout of pages that already have an article under /app.
    mobile: ['/m', '/m/create', '/m/credits', '/m/explore', '/m/job', '/m/library'],
    // Real pages Vey can only describe from the automatic scan of their labels. Each is a candidate for a reviewed
    // article; remove it from here when one is written (the test fails if a listed route gains an article).
    autoScanOnly: [
        '/',
        '/about',
        '/guides',
        '/guides/[id]',
        '/oddlings',
        '/oddlings/[id]',
        '/pricing',
        '/publish',
        '/legal/aup',
        '/legal/cinema-content',
        '/legal/gdpr',
        '/legal/privacy',
        '/legal/refund',
        '/legal/terms',
    ],
});

const excluded = new Map(Object.entries(NO_ARTICLE).flatMap(([reason, routes]) => routes.map((route) => [route, reason])));
const reviewedRoutes = new Set(PRODUCT_KNOWLEDGE.flatMap((entry) => entry.routes));
// A section article covers its sub-pages (/app/publish covers /app/publish/calendar), but the app root and the site
// root are the overview and cover only themselves, or every new page would count as covered.
const EXACT_ONLY = new Set(['/', '/app']);
const hasArticle = (route) => [...reviewedRoutes].some((covered) => route === covered || (!EXACT_ONLY.has(covered) && route.startsWith(`${covered}/`)));
const inventoryRoutes = AUTO_PRODUCT_INVENTORY.map((item) => item.route);

test('every page route has a reviewed Vey article or a named reason it has none', () => {
    const missing = inventoryRoutes.filter((route) => !hasArticle(route) && !excluded.has(route));
    assert.deepEqual(missing, [], `Add a reviewed article in lib/productKnowledge.js, or list the route in NO_ARTICLE with a reason:\n${missing.join('\n')}`);
});

test('the list of routes without an article stays honest', () => {
    const known = new Set(inventoryRoutes);
    const gone = [...excluded.keys()].filter((route) => !known.has(route));
    assert.deepEqual(gone, [], `These routes no longer exist; remove them from NO_ARTICLE:\n${gone.join('\n')}`);
    const written = [...excluded.keys()].filter((route) => hasArticle(route));
    assert.deepEqual(written, [], `These routes now have an article; remove them from NO_ARTICLE:\n${written.join('\n')}`);
});

test('a new page under the app root is not covered by the overview article', () => {
    assert.equal(hasArticle('/app/brand-new-page'), false);
    assert.equal(hasArticle('/app/publish/calendar'), true);
});

test('the surfaces a user can reach from outside the app each have an article', () => {
    for (const route of ['/mcp', '/developers', '/models', '/presets', '/tools', '/social-cinema']) {
        assert.ok(hasArticle(route), `${route} has no reviewed article`);
    }
});
