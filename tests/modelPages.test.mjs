import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY } from '../lib/modelCapabilities.js';
import { readPublicCatalog, toPublicModels } from '../lib/publicCatalog.js';
import { MODEL_ID_RE, findModel, modelFacts, shelfModels } from '../app/veyrnox/_lib/modelPages.js';

const endpoints = Object.keys(REGISTRY);
const shelfEndpoint = endpoints.find((e) => !REGISTRY[e].edit && !REGISTRY[e].inputs.clips && !REGISTRY[e].inputs.topic);
const hiddenEndpoint = endpoints.find((e) => REGISTRY[e].edit || REGISTRY[e].inputs.clips || REGISTRY[e].inputs.topic);
const cfg = { supabaseUrl: 'https://example.test', serviceRoleKey: 'test' };
const row = (id, endpoint, extra = {}) => ({ id, name: `Model ${id}`, modality: 'text-to-video', credits_5s: 19, gated_flag: false, provider_endpoint: endpoint, ...extra });

test('public rows never carry provider routing or cost, and unknown endpoints are dropped', () => {
    const errors = console.error; console.error = () => {};
    try {
        const out = toPublicModels([row('a', shelfEndpoint, { provider_cost_per_unit: 0.4 }), row('b', 'no/such-endpoint')]);
        assert.deepEqual(out.map((m) => m.id), ['a']);
        assert.equal('provider_endpoint' in out[0], false);
        assert.equal('provider_cost_per_unit' in out[0], false);
        assert.equal(out[0].credits, 19);
    } finally { console.error = errors; }
});

test('the catalog read refuses to run without the service-role config', async () => {
    await assert.rejects(readPublicCatalog({ cfg: {}, selectRows: () => assert.fail('unexpected read') }), /not_configured/);
});

test('the catalog read selects only the safe columns of active rows', async () => {
    let query;
    await readPublicCatalog({ cfg, selectRows: async (table, q) => { query = { table, ...q }; return []; } });
    assert.equal(query.table, 'model_catalog');
    assert.equal(query.columns, 'id,name,modality,credits_5s,gated_flag,provider_endpoint');
    assert.match(query.filter, /^active=eq\.true&/);
});

test('model pages list only shelf models, as the landing shelf does', () => {
    const rows = toPublicModels([row('shelf', shelfEndpoint), row('hidden', hiddenEndpoint)]);
    assert.deepEqual(shelfModels(rows).map((m) => m.id), ['shelf']);
});

test('ids outside the catalog slug shape never reach the catalog', async () => {
    for (const bad of ['', 'UPPER', '../etc', 'a b', 'x'.repeat(65), '-lead', undefined]) {
        assert.equal(MODEL_ID_RE.test(bad ?? ''), false);
        assert.equal(await findModel(bad), null);
    }
    assert.equal(MODEL_ID_RE.test('wan-2.5-kie'), true);
});

test('facts come from capabilities: lengths for video, media slots and enum values', () => {
    const facts = modelFacts({
        modality: 'image-to-video', kind: 'video', durations: [5, 10],
        capabilities: {
            inputs: { prompt: { type: 'string' }, aspect_ratio: { type: 'enum', values: ['16:9', '9:16'] }, seed: { type: 'int' } },
            media: { image: { required: true }, audio: { required: false, maxSeconds: 40 } },
        },
    });
    assert.deepEqual(facts, [
        { label: 'Mode', value: 'image to video' },
        { label: 'Clip lengths', value: '5 s, 10 s' },
        { label: 'Prompt', value: 'Text prompt' },
        { label: 'Image input', value: 'Required' },
        { label: 'Audio input', value: 'Optional, up to 40 s' },
        { label: 'Aspect ratio', value: '16:9, 9:16' },
    ]);
});

test('image models do not list clip lengths', () => {
    const facts = modelFacts({ modality: 'text-to-image', kind: 'image', durations: [5], capabilities: { inputs: {}, media: {} } });
    assert.equal(facts.some((f) => f.label === 'Clip lengths'), false);
});
