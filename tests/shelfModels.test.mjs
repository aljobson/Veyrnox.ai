import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isShelfModel, MODELS } from '../app/veyrnox/_lib/tokens.js';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';

// Audit 2026-09-23, finding 12: the landing page advertised "Auto Short" at
// 110 credits while app/create kept it behind localStorage.veyrnox_auto_short.
// A visitor read about a product and could not find it anywhere in the app.
// The public surfaces now list only what the picker will sell to everyone.

test('a gated topic row is not on the shelf', () => {
    assert.equal(isShelfModel(capabilityFor('auto-short:v1')), false);
});

test('an edit tool is not on the shelf', () => {
    assert.equal(isShelfModel(capabilityFor('clip-edit:v1')), false);
});

test('ordinary models are', () => {
    for (const endpoint of ['fal-ai/wan-25-preview/text-to-video', 'market:google/nano-banana']) {
        const cap = capabilityFor(endpoint);
        assert.ok(cap, `${endpoint} is in the registry`);
        assert.equal(isShelfModel(cap), true, endpoint);
    }
});

test('the client shape works too, though it has no `edit` flag', () => {
    // publicCapabilities() (what GET /api/catalog serves) drops `edit`, so the
    // browser-side surfaces can only recognise the Clip Editor by inputs.clips.
    // Both clauses in isShelfModel are load-bearing; neither is redundant.
    const clipEdit = publicCapabilities(capabilityFor('clip-edit:v1'));
    assert.equal(clipEdit.edit, undefined, 'edit is stripped for the browser');
    assert.equal(isShelfModel(clipEdit), false);
    assert.equal(isShelfModel(publicCapabilities(capabilityFor('auto-short:v1'))), false);
});

test('the bundled fallback list carries no capabilities and still renders', () => {
    // SiteSearch indexes MODELS when /api/catalog is unreachable; those rows
    // have no `capabilities`, and a missing record must not hide every model.
    assert.ok(MODELS.length > 0);
    assert.equal(MODELS.every((m) => isShelfModel(m.capabilities)), true);
});

const landing = readFileSync(new URL('../app/veyrnox/page.js', import.meta.url), 'utf8');
const search = readFileSync(new URL('../app/veyrnox/_components/SiteSearch.js', import.meta.url), 'utf8');
const create = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
const pricing = readFileSync(new URL('../app/veyrnox/pricing/page.js', import.meta.url), 'utf8');

test('every public surface uses the one predicate', () => {
    assert.match(landing, /rows\.filter\(\(m\) => isShelfModel\(capabilityFor\(m\.provider_endpoint\)\)\)/);
    assert.match(search, /models\.filter\(\(m\) => isShelfModel\(m\.capabilities\)\)/);
    // The pricing page filtered nothing at all and quoted both held-back rows.
    assert.match(pricing, /data\.models\.filter\(\(m\) => isShelfModel\(m\.capabilities\)\)/);
});

test('the picker still gates Auto Short, so the shelf must keep hiding it', () => {
    // If this gate is ever removed without the `topic` clause in isShelfModel,
    // the two sides disagree again — in the other direction.
    assert.match(create, /AUTO_SHORT_FLAG = 'veyrnox_auto_short'/);
    assert.match(create, /autoShortOn \|\| !m\.takesTopic/);
});
