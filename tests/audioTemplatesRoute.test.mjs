import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { AUDIO_CATEGORIES } from '../app/veyrnox/_lib/audioTemplates.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET } = await import('../app/api/audio-templates/route.js');

test('GET /api/audio-templates lists every audio template, cached, with no price or identity', async () => {
    const res = GET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /public/);
    const body = await res.json();
    assert.deepEqual(body.categories, [...AUDIO_CATEGORIES]);
    assert.ok(body.templates.length >= 40);
    for (const t of body.templates) {
        assert.match(t.id, /^audio-[a-z0-9-]+$/);
        assert.ok(t.name && t.modelId && t.prompt && AUDIO_CATEGORIES.includes(t.category));
        assert.equal('credits' in t, false);
    }
});
