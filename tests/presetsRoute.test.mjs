import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { GENJUTSU_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/genjutsuSourcePromptRecords.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { MODELS, modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { toPublicPresets } from '../lib/publicPresets.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
const route = await import('../app/api/presets/route.js');

// A catalog that prices every web model one credit above the template's own figure, so a price copied from the template is caught.
const catalog = MODELS.map((m) => ({ id: m.id, name: m.name, modality: m.kind, credits: m.credits + 1, gated: !!m.gated }));

test('every web preset is listed, available, and priced from its active catalog row', () => {
    const list = toPublicPresets(catalog);
    assert.equal(list.length, PRESETS.length);
    for (const p of list) {
        const row = catalog.find((m) => m.id === p.modelId);
        assert.ok(row, `${p.id}: model ${p.modelId} is not in the catalog`);
        assert.equal(p.available, true);
        const unit = row.credits * (p.durationSeconds === 10 ? 2 : 1);
        assert.equal(p.credits, unit, `${p.id} must be priced from the catalog row`);
        assert.equal(p.modality, row.modality);
        assert.match(p.id, /^[a-z0-9-]+$/);
        assert.ok(p.prompt.length > 10 && p.title && p.category && p.theme);
    }
});

test('a preset whose model is not active stays listed with the web fallback price and is unavailable', () => {
    const some = PRESETS.find((p) => p.durationSeconds === 10 && modelIdForName(p.model));
    const without = catalog.filter((m) => m.id !== modelIdForName(some.model));
    const fallback = toPublicPresets(without).find((p) => p.id === some.id);
    assert.equal(toPublicPresets(without).length, PRESETS.length);
    assert.equal(fallback.available, false);
    assert.equal(fallback.credits, some.credits * (some.durationSeconds === 10 ? 2 : 1));

    for (const list of [toPublicPresets([]), toPublicPresets(undefined)]) {
        assert.equal(list.length, PRESETS.length);
        assert.ok(list.every((p) => p.available === false));
        assert.ok(list.every((p) => p.modality));
    }
});

test('preview and poster addresses are absolute https on our own host', () => {
    for (const p of toPublicPresets(catalog)) {
        for (const u of [p.previewUrl, p.posterUrl]) assert.ok(u === null || /^https:\/\/veyrnox\.ai\/showcase\/[\w.-]+$/.test(u), `${p.id}: ${u}`);
    }
    assert.ok(toPublicPresets(catalog).some((p) => p.posterUrl));
});

test('the payload carries source framing and exact public source prompts but no per-user or internal field', () => {
    const allowed = new Set(['id', 'title', 'category', 'theme', 'modelId', 'modelName', 'modality', 'prompt', 'promptOrigin', 'sourcePrompt', 'sourcePromptOrigin', 'sourcePromptStatus', 'sourcePromptRunnable', 'sourcePromptIssues', 'sourcePromptCharacterCount', 'sourcePromptReferenceImageCount', 'sourcePromptReferenceVideoCount', 'sourcePromptDuplicateOf', 'needs', 'sourceAspect', 'durationSeconds', 'credits', 'gated', 'available', 'isNew', 'previewUrl', 'posterUrl', 'previewAspect']);
    for (const p of toPublicPresets(catalog)) for (const k of Object.keys(p)) assert.ok(allowed.has(k), `unexpected field ${k}`);
    const framed = toPublicPresets(catalog).filter((p) => p.sourceAspect);
    assert.equal(framed.length, 100);
    assert.ok(framed.every((p) => /^(?:1:1|9:16|16:9)$/.test(p.sourceAspect)));
    const exact = toPublicPresets(catalog).filter((p) => p.sourcePromptOrigin === 'community-source-exact');
    assert.equal(exact.length, 114);
    assert.ok(exact.every((p) => typeof p.sourcePrompt === 'string' && p.sourcePrompt.length > 0));
    assert.ok(exact.every((p) => p.prompt.length <= 2000));
    assert.ok(exact.every((p) => p.sourcePrompt === SOURCE_PROMPT_RECORDS[p.id]?.prompt));
    assert.equal(exact.filter((p) => GENJUTSU_SOURCE_PROMPT_RECORDS[p.id]).length, 57);
    assert.equal(exact.filter((p) => SOURCE_PROMPT_RECORDS[p.id] && !GENJUTSU_SOURCE_PROMPT_RECORDS[p.id]).length, 57);
    const statuses = Object.groupBy(toPublicPresets(catalog), (p) => p.sourcePromptStatus);
    assert.equal(statuses.exact.length, 113);
    assert.equal(statuses['exact-truncated'].length, 1);
    assert.equal(statuses.unavailable.length, 44);
    assert.equal(statuses['adaptation-only'].length, 117);
    assert.ok(exact.every((p) => p.sourcePromptRunnable === false));
    assert.ok(exact.every((p) => p.sourcePromptIssues.includes('source-input-contract-not-wired')));
    assert.equal(exact.filter((p) => p.sourcePromptIssues.includes('prompt-over-2000')).length, 67);
    assert.equal(exact.filter((p) => p.sourcePromptIssues.includes('more-than-two-reference-images')).length, 12);
    assert.equal(exact.filter((p) => p.sourcePromptIssues.includes('audio-preservation-not-supported')).length, 60);
    assert.equal(exact.filter((p) => p.sourcePromptDuplicateOf).length, 2);
});

function stubCatalog(rows) {
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
        assert.equal(new URL(String(url)).pathname, '/rest/v1/model_catalog');
        if (rows instanceof Error) throw rows;
        return Response.json(rows);
    };
    return () => { globalThis.fetch = real; };
}

test('the route answers 200 with cached public headers and ignores identity headers', async () => {
    const restore = stubCatalog([]);
    try {
        const res = await route.GET(new Request('https://veyrnox.test/api/presets', { headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111' } }));
        assert.equal(res.status, 200);
        assert.match(res.headers.get('cache-control'), /^public,/);
        const body = await res.json();
        assert.deepEqual(Object.keys(body), ['presets']);
        assert.equal(body.presets.length, PRESETS.length);
        assert.ok(body.presets.every((p) => p.available === false));
    } finally { restore(); }
});

test('an unreachable catalog is a typed 502 and not cached', async () => {
    const restore = stubCatalog(new Error('db down'));
    try {
        const res = await route.GET();
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: 'presets_unavailable' });
        assert.equal(res.headers.get('cache-control'), 'no-store');
    } finally { restore(); }
});

test('the route takes no input and reads no identity header', () => {
    const src = readFileSync(new URL('../app/api/presets/route.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /x-veyrnox|req\.|request\.|searchParams/);
});
