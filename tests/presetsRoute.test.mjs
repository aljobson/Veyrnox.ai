import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { MODELS, modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { toPublicPresets } from '../lib/publicPresets.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
const route = await import('../app/api/presets/route.js');

// A catalog that prices every web model one credit above the template's own figure, so a price copied from the template is caught.
const catalog = MODELS.map((m) => ({ id: m.id, name: m.name, modality: m.kind, credits: m.credits + 1, gated: !!m.gated }));

test('every listed preset names an active catalog model and is priced from that row', () => {
    const list = toPublicPresets(catalog);
    assert.ok(list.length > 0);
    for (const p of list) {
        const row = catalog.find((m) => m.id === p.modelId);
        assert.ok(row, `${p.id}: model ${p.modelId} is not in the catalog`);
        const unit = row.credits * (p.durationSeconds === 10 ? 2 : 1);
        assert.equal(p.credits, unit, `${p.id} must be priced from the catalog row`);
        assert.equal(p.modality, row.modality);
        assert.match(p.id, /^[a-z0-9-]+$/);
        assert.ok(p.prompt.length > 10 && p.title && p.category);
    }
});

test('a preset whose model is not active in the catalog is not listed', () => {
    const some = PRESETS.find((p) => modelIdForName(p.model));
    const without = catalog.filter((m) => m.id !== modelIdForName(some.model));
    assert.ok(!toPublicPresets(without).some((p) => p.id === some.id));
    assert.deepEqual(toPublicPresets([]), []);
    assert.deepEqual(toPublicPresets(undefined), []);
});

test('preview and poster addresses are absolute https on our own host', () => {
    for (const p of toPublicPresets(catalog)) {
        for (const u of [p.previewUrl, p.posterUrl]) assert.ok(u === null || /^https:\/\/veyrnox\.ai\/showcase\/[\w.-]+$/.test(u), `${p.id}: ${u}`);
    }
    assert.ok(toPublicPresets(catalog).some((p) => p.posterUrl));
});

test('the payload carries no per-user or internal field', () => {
    const allowed = new Set(['id', 'title', 'category', 'modelId', 'modelName', 'modality', 'prompt', 'needs', 'durationSeconds', 'credits', 'gated', 'isNew', 'previewUrl', 'posterUrl', 'previewAspect']);
    for (const p of toPublicPresets(catalog)) for (const k of Object.keys(p)) assert.ok(allowed.has(k), `unexpected field ${k}`);
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
        assert.deepEqual(Object.keys(await res.json()), ['presets']);
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
