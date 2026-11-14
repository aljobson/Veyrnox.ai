import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { kindTemplates } from '../lib/kindTemplates.js';
import { createTemplatesFor } from '../app/veyrnox/_lib/createTemplates.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const route = await import('../app/api/templates/route.js');
const get = async (qs) => (await route.GET(new Request(`https://veyrnox.ai/api/templates${qs}`))).json();
const modelIds = new Set(MODELS.map((m) => m.id));

test('audio answers the Create audio templates in the shape older mobile builds parse', async () => {
    const body = await get('?kind=audio');
    assert.equal(body.templates.length, createTemplatesFor('audio').length);
    assert.ok(body.templates.length > 0);
    for (const t of body.templates) {
        for (const key of ['id', 'name', 'category', 'modelId', 'prompt']) assert.equal(typeof t[key], 'string', `${t.id} ${key}`);
        assert.ok(modelIds.has(t.modelId), `${t.id} opens a known model (${t.modelId})`);
    }
    assert.deepEqual(body.categories, ['MUSIC']);
});

test('image answers only image templates, each runnable with a full prompt and a picture', async () => {
    const body = await get('?kind=image');
    assert.ok(body.templates.length >= createTemplatesFor('image').length);
    for (const t of body.templates) {
        assert.ok(t.prompt.length > 0 && t.previewImage, t.id);
        assert.ok(modelIds.has(t.modelId), `${t.id} opens a known model (${t.modelId})`);
        assert.equal('durationSeconds' in t, false);
    }
    assert.deepEqual(body.categories, [...new Set(body.templates.map((t) => t.category))]);
});

test('an unknown kind is not a kind list', () => {
    assert.equal(kindTemplates('video'), null);
    assert.equal(kindTemplates(null), null);
});
