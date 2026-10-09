import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/verify-filter-endpoints.mjs', import.meta.url));

function run({ submit = false, video, image, required = ['video_url'], output = true, schemaStatus = 200 } = {}) {
    const cwd = mkdtempSync(join(tmpdir(), 'veyrnox-filter-probe-'));
    try {
        mkdirSync(join(cwd, 'scripts'));
        const preload = join(cwd, 'mock.mjs');
        writeFileSync(preload, `
            import { writeFileSync } from 'node:fs';
            globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
            const required = ${JSON.stringify(required)};
            const json = (value, status = 200) => new Response(JSON.stringify(value), {status});
            globalThis.fetch = async (url, options = {}) => {
                if (url.startsWith('https://fal.ai/api/openapi/')) {
                    if (options.headers.Authorization) throw Error('public probe sent credentials');
                    return json({paths: {'/fal-ai/id-v2v/relight': {post: {requestBody: {
                        content: {'application/json': {schema: {$ref: '#/components/schemas/ActualInput'}}}
                    }}}}, components: {schemas: {
                        WrongInput: {properties: {image_url: {type: 'string'}}},
                        ActualInput: {required, properties: Object.fromEntries(required.map(k => [k, {type: 'string'}]))}
                    }}}, ${schemaStatus});
                }
                if (options.method === 'POST') {
                    writeFileSync('submitted.json', options.body);
                    return json({request_id: 'fixture', status_url: 'https://queue.fal.run/status', response_url: 'https://queue.fal.run/result'});
                }
                if (url === 'https://queue.fal.run/status') return json({status: 'COMPLETED'});
                if (url === 'https://queue.fal.run/result') return json(${output ? "{video: {url: 'https://example.test/output.mp4'}}" : '{}'});
                throw Error('unexpected fetch');
            };
        `);
        const env = { ...process.env };
        delete env.FAL_KEY;
        delete env.TEST_VIDEO_URL;
        delete env.TEST_IMAGE_URL;
        if (submit) env.FAL_KEY = 'test-key-not-a-secret';
        if (video) env.TEST_VIDEO_URL = video;
        if (image) env.TEST_IMAGE_URL = image;
        const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script,
            '--only=relight-video', ...(submit ? ['--submit'] : [])], { cwd, env, encoding: 'utf8', timeout: 10000 });
        assert.ifError(result.error);
        const read = (name) => { try { return JSON.parse(readFileSync(join(cwd, name), 'utf8')); } catch { return null; } };
        return { status: result.status, stderr: result.stderr, payload: read('submitted.json'),
            probe: read('scripts/.slice0-probe.json'), results: read('scripts/.slice0-results.json') };
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}

test('public probe needs no key, submits nothing, and resolves the exact request schema', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.payload, null);
    assert.deepEqual(r.probe[0].inputs, ['video_url']);
    assert.equal(r.probe[0].takesImage, false);
});

test('failed public schema request exits nonzero', () => {
    assert.equal(run({ schemaStatus: 404 }).status, 1);
});

test('video submission refuses the old still-image fallback before any POST', () => {
    const r = run({ submit: true });
    assert.equal(r.status, 1);
    assert.equal(r.payload, null);
    assert.match(r.results[0].note, /TEST_VIDEO_URL/);
});

test('mixed-media video requires an explicit corresponding reference frame', () => {
    const r = run({ submit: true, video: 'https://example.test/source.mp4', required: ['video_url', 'image_url', 'prompt'] });
    assert.equal(r.payload, null);
    assert.equal(r.status, 1);
    assert.match(r.results[0].note, /TEST_IMAGE_URL/);
});

test('mixed-media submission sends both supplied sources and the required prompt', () => {
    const video = 'https://example.test/source.mp4', image = 'https://example.test/frame.png';
    const r = run({ submit: true, video, image, required: ['video_url', 'image_url', 'prompt'] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.payload, { video_url: video, image_url: image, prompt: 'subtle, natural result' });
    assert.equal(r.results[0].ok, true);
});

test('unknown required fields prevent a paid request', () => {
    const r = run({ submit: true, video: 'https://example.test/source.mp4', required: ['video_url', 'new_required_field'] });
    assert.equal(r.payload, null);
    assert.equal(r.status, 1);
});

test('COMPLETED without an output cannot be recorded as verification success', () => {
    const r = run({ submit: true, video: 'https://example.test/source.mp4', output: false });
    assert.equal(r.status, 1);
    assert.equal(r.results[0].ok, false);
});
