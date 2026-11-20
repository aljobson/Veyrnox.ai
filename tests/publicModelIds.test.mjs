import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicModelId, internalModelId, withPublicModelIds, withPublicJobModelIds } from '../lib/publicModelIds.js';
import { toPublicPresets } from '../lib/publicPresets.js';
import { templateCards, templateDetail, kindTemplates } from '../lib/clientTemplates.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';
import { developerOpenApi } from '../lib/developerOpenApi.js';

const SUPPLIER = /(?:^|[^a-z0-9])(?:kie|grsai|crun|byteplus|higgsfield|openrouter|fal)(?:[^a-z0-9]|$)/i;

test('a supplier suffix becomes a neutral tag and maps back', () => {
    assert.equal(publicModelId('nano-banana-pro-grsai'), 'nano-banana-pro-a2');
    assert.equal(publicModelId('nano-banana-pro-edit-grsai'), 'nano-banana-pro-edit-a2');
    assert.equal(internalModelId('nano-banana-pro-a2'), 'nano-banana-pro-grsai');
});

test('ids with no supplier suffix, and display names, are unchanged', () => {
    for (const id of ['kling-3.0-i2v', 'veo-3.1-fast', 'Kling 3.0 · I2V', '', undefined, null]) assert.equal(publicModelId(id), id);
    assert.equal(internalModelId('kling-3.0-i2v'), 'kling-3.0-i2v');
});

test('old supplier-suffixed ids still resolve (input is never refused)', () => {
    assert.equal(internalModelId('nano-banana-kie'), 'nano-banana-kie');
});

test('the same offer from two suppliers keeps two distinct public ids', () => {
    assert.notEqual(publicModelId('nano-banana-pro-kie'), publicModelId('nano-banana-pro-grsai'));
    assert.notEqual(publicModelId('kling-3.0-i2v-kie'), publicModelId('kling-3.0-i2v'));
});

test('round trip is exact for every bundled model id and no public id names a supplier', () => {
    for (const { id } of MODELS) {
        assert.equal(internalModelId(publicModelId(id)), id, id);
        assert.doesNotMatch(publicModelId(id), SUPPLIER, id);
    }
    const publicIds = MODELS.map((m) => publicModelId(m.id));
    assert.equal(new Set(publicIds).size, publicIds.length, 'public ids are unique');
});

test('no catalog id already looks like a neutral tag', () => {
    const all = readFileSync(new URL('../app/veyrnox/_lib/tokens.js', import.meta.url), 'utf8');
    assert.doesNotMatch(all, /id: '[a-z0-9.-]+-a[1-7]'/);
});

test('withPublicModelIds returns copies', () => {
    const rows = [{ id: 'wan-2.5-kie', credits: 1 }];
    const out = withPublicModelIds(rows);
    assert.equal(out[0].id, 'wan-2.5-a1');
    assert.equal(rows[0].id, 'wan-2.5-kie');
});

test('anonymous template and preset answers carry no supplier id', () => {
    const blob = JSON.stringify([templateCards(), kindTemplates('image'), kindTemplates('audio'), toPublicPresets([])]);
    assert.doesNotMatch(blob, /-(?:kie|grsai|crun|byteplus|higgsfield|openrouter)\b/);
    const image = kindTemplates('image').templates[0];
    assert.ok(MODELS.some((m) => m.id === internalModelId(image.modelId)), 'the image template model maps back to a catalog key');
});

test('the Developer API contract names no flag, supplier or provider shape', () => {
    const blob = JSON.stringify(developerOpenApi);
    assert.doesNotMatch(blob, /MULTI_REFERENCE|_ENABLED|Provider list|scalar shape/);
    assert.doesNotMatch(blob.replace(/https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/oauth\/(?:authorize|token)/g, ''), /supabase/i);
});

test('a job read, or a list of them, shows public model ids and nothing else changes', () => {
    const one = { state: 'running', credits: 18, model_id: 'kling-2.6-pro-kie', refunded: false };
    assert.deepEqual(withPublicJobModelIds(one), { ...one, model_id: 'kling-2.6-pro-a1' });
    assert.equal(one.model_id, 'kling-2.6-pro-kie');
    const list = { jobs: [{ job_id: 'a', model_id: 'kling-3.0-i2v-kie' }, { job_id: 'b', model_id: 'kling-3.0-i2v' }, null], next: null };
    assert.deepEqual(withPublicJobModelIds(list).jobs.map((job) => job && job.model_id), ['kling-3.0-i2v-a1', 'kling-3.0-i2v', null]);
    assert.equal(withPublicJobModelIds(list).next, null);
    for (const body of [null, undefined, 'x', 5, ['kling-3.0-i2v-kie']]) assert.equal(withPublicJobModelIds(body), body);
    assert.deepEqual(withPublicJobModelIds({ error: 'not_found' }), { error: 'not_found' });
});

test('the MCP and the Developer API pass job reads through withPublicJobModelIds', () => {
    const mcp = readFileSync(new URL('../lib/veyrnoxMcp.js', import.meta.url), 'utf8');
    assert.match(mcp, /\.\.\.withPublicJobModelIds\(data\)/);
    assert.match(mcp, /generationListText\(publicData, models\)/);
    const dev = readFileSync(new URL('../lib/developerApi.js', import.meta.url), 'utf8');
    assert.match(dev, /publicJobRead\(await internal\(listGenerations/);
    assert.match(dev, /publicJobRead\(await internal\(readGeneration/);
});
