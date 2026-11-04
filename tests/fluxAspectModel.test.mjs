import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilityFor, checkInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';

const record = capabilityFor('fal-ai/flux-2-pro');
const SIZES = { '1:1': [960, 960], '4:3': [1024, 768], '3:4': [768, 1024], '16:9': [1024, 576], '9:16': [576, 1024] };

test('FLUX 2 Pro offers five ratios and sends the size migration 0439 admits, never the ratio', () => {
    assert.deepEqual(record.inputs.aspect_ratio.values, Object.keys(SIZES));
    assert.deepEqual(publicCapabilities(record).inputs.aspect_ratio.values, Object.keys(SIZES));
    for (const [ratio, [width, height]] of Object.entries(SIZES)) {
        const inputs = { prompt: 'a lighthouse', seed: 7, aspect_ratio: ratio };
        assert.deepEqual(checkInputs(record, inputs), { ok: true }, ratio);
        const body = shapePayload(record, inputs);
        assert.deepEqual(body, { prompt: 'a lighthouse', seed: 7, image_size: { width, height } }, ratio);
        assert.ok(width * height < 1_000_000, `${ratio} stays under one megapixel ($0.03 price)`);
    }
});

test('FLUX 2 Pro without a ratio keeps the 1024x768 default; an unknown ratio is refused', () => {
    assert.deepEqual(shapePayload(record, { prompt: 'x' }), { prompt: 'x', image_size: { width: 1024, height: 768 } });
    assert.equal(checkInputs(record, { prompt: 'x', aspect_ratio: '21:9' }).ok, false);
    assert.equal(checkInputs(record, { prompt: 'x', image_size: { width: 2048, height: 2048 } }).ok, false);
});

test('the catalog sizes match the sizes migration 0439 admits', () => {
    const sql = readFileSync(new URL('../packages/db/schema/supabase/0439_flux_aspect_image_size.sql', import.meta.url), 'utf8');
    for (const [width, height] of Object.values(SIZES)) {
        assert.match(sql, new RegExp(`${width}[^0-9]+${height}`), `${width}x${height} appears in 0439`);
    }
});
