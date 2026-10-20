import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRY, checkInputs, shapePayload } from '../lib/modelCapabilities.js';
import { TOOL_TASKS, toolGroups } from '../app/veyrnox/_lib/tools.js';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0356_face_filters_staged.sql', import.meta.url), 'utf8');
const FLOOR_RATE = 0.0165; // ADR-0014: the 50% floor at $0.033 per Credit

// id, fal endpoint, credits, list price read from the fal page on 2026-10-20
const FILTERS = [
    ['face-retouch', 'fal-ai/image-editing/retouch', 3, 0.04],
    ['face-enhance', 'fal-ai/image-editing/face-enhancement', 3, 0.04],
    ['face-relight', 'fal-ai/iclight-v2', 7, 0.10],
    ['face-makeup', 'fal-ai/image-apps-v2/makeup-application', 3, 0.04],
    ['face-age', 'fal-ai/image-apps-v2/age-modify', 3, 0.04],
];
const IMAGE = 'https://example.test/source.jpg';

test('A1-A5 are staged inactive, never live (CLAUDE.md: verify against the live provider first)', () => {
    const rows = sql.split('\n').filter((l) => /^\s+\('face-/.test(l));
    assert.equal(rows.length, FILTERS.length);
    for (const r of rows) assert.match(r, /'image-to-image'.*false, false\)[,;]?$/);
    assert.doesNotMatch(sql, /\bUPDATE\b/);
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING;/);
});

test('each row carries its endpoint and a price at or above the 50% floor', () => {
    for (const [id, endpoint, credits, cost] of FILTERS) {
        assert.ok(credits >= Math.ceil(cost / FLOOR_RATE), `${id} clears the floor`);
        assert.ok(credits < Math.ceil(cost / FLOOR_RATE) + 1, `${id} is the minimum whole credits`);
        const row = sql.split('\n').find((l) => l.includes(`('${id}'`));
        assert.ok(row.includes(`'${endpoint}', 'image-to-image', ${credits}, ${cost.toFixed(4)},`), id);
    }
});

test('A6 video relight and A7/A8 are not staged', () => {
    for (const endpoint of ['fal-ai/id-v2v/relight', 'fal-ai/lightx/relight', 'fal-ai/ip-adapter-face-id', 'fal-ai/hy-wu-edit']) {
        assert.doesNotMatch(sql, new RegExp(`'${endpoint}'`));
        assert.equal(REGISTRY[endpoint], undefined, `${endpoint} has no capability record`);
    }
});

test('every filter needs an uploaded image and takes nothing a customer could use to change the price', () => {
    for (const [id, endpoint] of FILTERS) {
        const record = REGISTRY[endpoint];
        assert.ok(record, `${id} has a capability record`);
        assert.equal(record.provider, 'fal');
        assert.equal(record.kind, 'image');
        assert.equal(record.media.image.required, true);
        assert.equal(record.lengths, null);
        assert.equal(checkInputs(record, { ...(record.inputs.prompt ? { prompt: 'warm window light' } : {}) }).ok, false, `${id} refuses a request with no source`);
        assert.equal(checkInputs(record, { image_url: IMAGE, ...(record.inputs.prompt ? { prompt: 'warm window light' } : {}) }).ok, true, id);
        assert.equal(checkInputs(record, { image_url: IMAGE, ...(record.inputs.prompt ? { prompt: 'x' } : {}), num_images: 4 }).ok, false, `${id}: no extra outputs`);
        assert.equal(checkInputs(record, { image_url: IMAGE, ...(record.inputs.prompt ? { prompt: 'x' } : {}), enable_safety_checker: false }).ok, false, `${id}: safety checker is not offered`);
    }
});

test('the provider safety checker is pinned on wherever the endpoint has one', () => {
    assert.equal(REGISTRY['fal-ai/image-editing/retouch'].fixed.enable_safety_checker, true);
    assert.equal(REGISTRY['fal-ai/iclight-v2'].fixed.enable_safety_checker, true);
    assert.equal(REGISTRY['fal-ai/image-editing/face-enhancement'].fixed.safety_tolerance, '2');
});

test('relight is one image on a 1 MP canvas, so the megapixel price cannot grow', () => {
    const fixed = REGISTRY['fal-ai/iclight-v2'].fixed;
    assert.equal(fixed.num_images, 1);
    assert.ok(fixed.image_size.width * fixed.image_size.height <= 1_000_000);
    assert.equal(checkInputs(REGISTRY['fal-ai/iclight-v2'], { image_url: IMAGE }).ok, false, 'a lighting prompt is required');
    const payload = shapePayload(REGISTRY['fal-ai/iclight-v2'], { image_url: IMAGE, prompt: 'warm window light' });
    assert.equal(payload.image_url, IMAGE);
    assert.deepEqual(payload.image_size, { width: 1000, height: 1000 });
});

test('age modify cannot be pushed to a child\'s age and always preserves identity', () => {
    const record = REGISTRY['fal-ai/image-apps-v2/age-modify'];
    for (const age of [0, 6, 12, 17, 101, 30.5, '30']) assert.equal(checkInputs(record, { image_url: IMAGE, target_age: age }).ok, false, String(age));
    for (const age of [18, 30, 100]) assert.equal(checkInputs(record, { image_url: IMAGE, target_age: age }).ok, true, String(age));
    const withoutAge = shapePayload(record, { image_url: IMAGE });
    assert.equal(withoutAge.target_age, 30, 'the default sent is not the endpoint\'s own');
    assert.equal(withoutAge.preserve_identity, true);
    assert.equal(shapePayload(record, { image_url: IMAGE, target_age: 18 }).target_age, 18);
});

test('makeup takes only the listed styles and intensities', () => {
    const record = REGISTRY['fal-ai/image-apps-v2/makeup-application'];
    assert.equal(checkInputs(record, { image_url: IMAGE, makeup_style: 'bridal', intensity: 'light' }).ok, true);
    assert.equal(checkInputs(record, { image_url: IMAGE, makeup_style: 'clown' }).ok, false);
    assert.equal(checkInputs(record, { image_url: IMAGE, intensity: 'extreme' }).ok, false);
});

test('the Tools page groups the filters in one place, web and phone', () => {
    const task = TOOL_TASKS.find((t) => t.key === 'face-filters');
    assert.deepEqual(task.ids, FILTERS.map(([id]) => id));
    const models = FILTERS.map(([id, endpoint]) => ({ id, capabilities: { media: REGISTRY[endpoint].media } }));
    const group = toolGroups(models).find((g) => g.key === 'face-filters');
    assert.equal(group.tools.length, FILTERS.length);
    const en = readFileSync(new URL('../lib/i18n/messages/en.mjs', import.meta.url), 'utf8');
    assert.match(en, /'tools\.t\.face-filters\.label': 'Face filters'/);
});
