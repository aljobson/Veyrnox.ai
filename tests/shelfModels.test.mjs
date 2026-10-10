import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isShelfModel, MODELS, distinctShelfNames } from '../app/veyrnox/_lib/tokens.js';
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
const modelPages = readFileSync(new URL('../app/veyrnox/_lib/modelPages.js', import.meta.url), 'utf8');

test('every public surface uses the one predicate', () => {
    // The landing page reads lib/publicCatalog.js, whose rows carry the
    // publicCapabilities() shape; the test above shows it is enough.
    assert.match(landing, /rows\.filter\(\(m\) => isShelfModel\(m\.capabilities\)\)/);
    assert.match(modelPages, /\.filter\(\(m\) => isShelfModel\(m\.capabilities\)\)/);
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

test('the video agent stays off every shelf: it is bought from a plan on its own page, not from the picker', () => {
    // Server shape and the client shape GET /api/catalog serves.
    assert.equal(isShelfModel(capabilityFor('video-agent:v1')), false);
    assert.equal(isShelfModel(publicCapabilities(capabilityFor('video-agent:v1'))), false);
    // The mark the browser reads survives publicCapabilities().
    assert.ok(publicCapabilities(capabilityFor('video-agent:v1')).inputs.plan_id);
});

// Design pass 2026-10-09: the price list printed "Nano Banana Pro Edit" twice,
// at 10 cr and at 2 cr, and the footer linked "MMAudio v2" twice to different
// models. shelfName() drops the parenthetical that told them apart.
test('names that collide once shortened keep their full name; the rest stay short', () => {
    const rows = [
        { id: 'a', name: 'Nano Banana Pro Edit' },
        { id: 'b', name: 'Nano Banana Pro Edit (GrsAI, no seed)' },
        { id: 'c', name: 'Kling 3.0 (image-to-video)' },
    ];
    const nameOf = distinctShelfNames(rows);
    assert.deepEqual(rows.map(nameOf), ['Nano Banana Pro Edit', 'Nano Banana Pro Edit (GrsAI, no seed)', 'Kling 3.0']);
    assert.equal(new Set(rows.map(nameOf)).size, rows.length, 'every row can be told apart');
});

test('the landing price list, the footer and the hero picker all print distinct names', () => {
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
    assert.match(read('../app/veyrnox/_sections/showcase.js'), /distinctShelfNames\(g\.rows\)/);
    assert.match(read('../app/veyrnox/_sections/footer.js'), /distinctShelfNames\(catalog\)/);
    assert.match(read('../app/veyrnox/_components/PriceSlip.js'), /distinctShelfNames\(models\)/);
});
