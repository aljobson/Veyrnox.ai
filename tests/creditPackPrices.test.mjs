import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The catalog is the only source of a price (CLAUDE.md, "Money & billing").
// This page used to carry three hardcoded "indicative" packs that quoted
// 300 cr for $9 against a real 100 cr for $10 (audit 2026-09-23).
const creditsRaw = readFileSync(new URL('../app/veyrnox/app/credits/page.js', import.meta.url), 'utf8');
// Comments may name the old wrong prices; code may not.
const credits = creditsRaw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const packs = readFileSync(new URL('../app/veyrnox/_components/TopUpPacks.js', import.meta.url), 'utf8');
const pricing = readFileSync(new URL('../app/veyrnox/pricing/page.js', import.meta.url), 'utf8');

test('the credits page prices nothing itself', () => {
    assert.doesNotMatch(credits, /const TOPUPS/);
    assert.doesNotMatch(credits, /\$9|\$19|\$49/, 'no hardcoded dollar amounts');
    assert.match(credits, /<TopUpPacks signedIn=/);
    assert.match(packs, /gatewayFetch\('\/credit-packs'\)/);
    assert.match(packs, /usd\.format\(p\.price_usd_cents \/ 100\)/);
    assert.doesNotMatch(credits, /topupsEnabled|veyrnox_topups/);
    // And it no longer calls its own numbers indicative, because they are the
    // catalog's.
    assert.doesNotMatch(credits, /INDICATIVE/);
});

test('a pack list that cannot be read shows no prices at all', () => {
    // Empty array on failure, and the block only renders with packs in hand:
    // an unreachable catalog must not fall back to invented numbers.
    assert.match(packs, /if \(!cancelled\) setError\('Credit packs are unavailable right now\.'\)/);
    assert.match(packs, /\{packs && packs\.length > 0 && \(/);
});

test('the pricing page still defers to the catalog for pack prices', () => {
    assert.doesNotMatch(pricing, /\$9\b|\$19\b|\$49\b/);
    assert.doesNotMatch(pricing, /veyrnox_topups/);
});
