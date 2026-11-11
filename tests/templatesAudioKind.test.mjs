import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { AUDIO_CATEGORIES } from '../app/veyrnox/_lib/audioTemplates.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET } = await import('../app/api/templates/route.js');

test('GET /api/templates?kind=audio lists every audio template, cached, with no price', async () => {
    const res = GET(new Request('https://x.test/api/templates?kind=audio'));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /public/);
    const body = await res.json();
    assert.deepEqual(body.categories, [...AUDIO_CATEGORIES]);
    assert.ok(body.templates.length >= 40);
    for (const t of body.templates) {
        assert.match(t.id, /^audio-[a-z0-9-]+$/);
        assert.equal('credits' in t, false);
    }
});
