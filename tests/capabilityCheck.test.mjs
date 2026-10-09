import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkRecord, inputSchemaOf } from '../scripts/lib/capability-check.mjs';
import { REGISTRY } from '../lib/modelCapabilities.js';

// fal's live schema for Sana, captured 2026-10-09 and cut down to the input
// schema and the ImageSize it refers to.
const SANA_DOC = JSON.parse(readFileSync(new URL('./fixtures/fal-sana-openapi.json', import.meta.url), 'utf8'));

const SIZE_PRESETS = ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'];
const IMAGE_SIZE = { width: { type: 'integer', exclusiveMinimum: 0, maximum: 14142 }, height: { type: 'integer', exclusiveMinimum: 0, maximum: 14142 } };
const SCHEMAS = { ImageSize: { type: 'object', properties: IMAGE_SIZE } };
// The shape fal gives image_size on Sana, FLUX 2 Pro and Seedream 4.
const SIZE_FIELD = { anyOf: [{ $ref: '#/components/schemas/ImageSize' }, { type: 'string', enum: SIZE_PRESETS }] };

const record = (over = {}) => ({ provider: 'fal', inputs: {}, rename: {}, media: {}, lengths: null, fixed: {}, assumes: {}, ...over });
const schema = (properties, required = []) => ({ properties, required });
const pinned = (value, field = SIZE_FIELD, schemas = SCHEMAS) => checkRecord(record({ fixed: { image_size: value } }), schema({ image_size: field }), schemas);

test('Sana matches the schema fal serves for it', () => {
    const live = inputSchemaOf(SANA_DOC);
    assert.deepEqual(checkRecord(REGISTRY['fal-ai/sana/v1.5/4.8b'], live.schema, live.schemas), []);
});

test('a document with no input schema is reported as missing, not as a match', () => {
    assert.equal(inputSchemaOf(null), null);
    assert.equal(inputSchemaOf({ components: { schemas: { QueueStatus: { properties: {} } } } }), null);
});

test('a size object pinned on a field that takes an object or a preset passes', () => {
    assert.deepEqual(pinned({ width: 1024, height: 768 }), []);
    assert.deepEqual(pinned('landscape_4_3'), []);
});

test('a preset name fal does not list on that field still fails', () => {
    assert.deepEqual(pinned('landscape_21_9'), [`pinned image_size="landscape_21_9" not in ${JSON.stringify(SIZE_PRESETS)}`]);
});

test('a value outside a plain enum still fails, whatever its type', () => {
    const live = schema({ output_format: { type: 'string', enum: ['jpeg', 'png'] } });
    assert.deepEqual(checkRecord(record({ fixed: { output_format: 'bmp' } }), live),
        ['pinned output_format="bmp" not in ["jpeg","png"]']);
    assert.deepEqual(checkRecord(record({ fixed: { output_format: { type: 'bmp' } } }), live),
        ['pinned output_format={"type":"bmp"} not in ["jpeg","png"]']);
    assert.deepEqual(checkRecord(record({ fixed: { output_format: 'png' } }), live), []);
});

test('a size object is held to the enum when no variant of the field is an object', () => {
    const size = { width: 1024, height: 768 };
    const message = [`pinned image_size=${JSON.stringify(size)} not in ${JSON.stringify(SIZE_PRESETS)}`];
    // A preset or nothing.
    assert.deepEqual(pinned(size, { anyOf: [{ type: 'string', enum: SIZE_PRESETS }, { type: 'null' }] }), message);
    // The object schema the field points at is gone from the document.
    assert.deepEqual(pinned(size, SIZE_FIELD, {}), message);
    // The variant it points at is not an object.
    assert.deepEqual(pinned(size, SIZE_FIELD, { ImageSize: { type: 'string' } }), message);
});

test('a pinned size outside the bounds fal sets on width and height fails', () => {
    assert.deepEqual(pinned({ width: 0, height: 768 }), ['pinned image_size.width=0 is not above 0']);
    assert.deepEqual(pinned({ width: 1024, height: 14143 }), ['pinned image_size.height=14143 is above the maximum 14142']);
    assert.deepEqual(pinned({ width: 1024.5, height: 768 }), ['pinned image_size.width=1024.5 is not an integer']);
    assert.deepEqual(pinned({ width: '1024', height: 768 }), ['pinned image_size.width="1024" is not an integer']);
    assert.deepEqual(pinned({ width: 14142, height: 1 }), []);
});

test('a key the size object does not have fails: fal would fall back to its own default for it', () => {
    assert.deepEqual(pinned({ widht: 1024, height: 768 }), ['pinned image_size.widht does not exist']);
    // Not when the object schema takes other keys, or lists none.
    const open = { ImageSize: { type: 'object', properties: IMAGE_SIZE, additionalProperties: true } };
    assert.deepEqual(pinned({ width: 1024, height: 768, dpi: 72 }, SIZE_FIELD, open), []);
    assert.deepEqual(pinned({ dpi: 72 }, SIZE_FIELD, { ImageSize: { type: 'object' } }), []);
});

test('a minimum is enforced the same way as an exclusive one', () => {
    const schemas = { Box: { type: 'object', properties: { scale: { type: 'number', minimum: 1, exclusiveMaximum: 4 } } } };
    const field = { anyOf: [{ $ref: '#/components/schemas/Box' }, { type: 'string', enum: ['auto'] }] };
    assert.deepEqual(pinned({ scale: 0.5 }, field, schemas), ['pinned image_size.scale=0.5 is below the minimum 1']);
    assert.deepEqual(pinned({ scale: 4 }, field, schemas), ['pinned image_size.scale=4 is not below 4']);
    assert.deepEqual(pinned({ scale: 1 }, field, schemas), []);
});

test('an enum input and a length value are checked the same way as a pin', () => {
    const live = schema({ aspect_ratio: { type: 'string', enum: ['16:9', '9:16'] }, duration: { type: 'string', enum: ['5', '10'] } });
    const rec = record({
        inputs: { aspect_ratio: { type: 'enum', values: ['16:9', '1:1'] } },
        lengths: { field: 'duration', map: { short: 5, long: 8 } },
    });
    // 5 against "5": a number is compared with fal's strings by its text.
    assert.deepEqual(checkRecord(rec, live), [
        'input aspect_ratio="1:1" not in ["16:9","9:16"]',
        'length duration=8 not in ["5","10"]',
    ]);
});

test('an assumed default is compared by value, not by the order fal lists its keys in', () => {
    const rec = record({ assumes: { image_size: { height: 2048, width: 2048 } } });
    const live = (def) => schema({ image_size: { ...SIZE_FIELD, default: def } });
    // fal served both orders for Seedream 4: this one on 2026-10-05 ...
    assert.deepEqual(checkRecord(rec, live({ width: 2048, height: 2048 }), SCHEMAS), []);
    // ... and this one on 2026-10-09.
    assert.deepEqual(checkRecord(rec, live({ height: 2048, width: 2048 }), SCHEMAS), []);
    assert.deepEqual(checkRecord(rec, live({ width: 4096, height: 2048 }), SCHEMAS),
        ['assumed default image_size={"height":2048,"width":2048} but fal now defaults to {"width":4096,"height":2048}']);
    assert.deepEqual(checkRecord(rec, live('square_hd'), SCHEMAS),
        ['assumed default image_size={"height":2048,"width":2048} but fal now defaults to "square_hd"']);
});

test('the other findings are reported as before', () => {
    const live = schema({
        prompt: { type: 'string' },
        voice: { type: 'string' },
        num_images: { type: 'integer', default: 1 },
        resolution: { type: 'string', default: '1080p' },
        generate_audio: { type: 'boolean', default: true },
    }, ['prompt', 'voice']);
    const rec = record({
        inputs: { prompt: { type: 'string' }, text: { type: 'string' } },
        fixed: { sync_mode: false },
        assumes: { num_images: 2, quality: 'high' },
        media: { image: { field: 'image_url' } },
        derives: ['inputs'],
    });
    assert.deepEqual(checkRecord(rec, live), [
        'input field "text" does not exist',
        'media field "image_url" does not exist',
        'derived field "inputs" does not exist',
        'pinned field "sync_mode" does not exist',
        'assumed default num_images=2 but fal now defaults to 1',
        'assumed field "quality" does not exist',
        'fal requires "voice", which we never send',
        'billing-sensitive "resolution" (default "1080p") is neither pinned nor assumed',
        'billing-sensitive "generate_audio" (default true) is neither pinned nor assumed',
    ]);
});

test('an input consumed by derive is not looked for on the endpoint', () => {
    const rec = record({ inputs: { prompt: { type: 'string' } }, rename: { prompt: null }, derives: ['inputs'] });
    assert.deepEqual(checkRecord(rec, schema({ inputs: { type: 'array' } })), []);
});
