import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseProbe, requireEmptyFolder, summariseStreams, isMp4, probeFacts, readProbeTask, main } from '../scripts/probe-higgsfield.mjs';
import { parseEndpoint } from '../packages/adapters/higgsfield.js';

const realFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = async () => assert.fail('no live provider calls'); });
test.afterEach(() => { globalThis.fetch = realFetch; });

test('only the two paid probes are offered, with an https start frame required for 3.0', () => {
    const text = chooseProbe(['kling-2-6']);
    assert.equal(text.ok, true);
    assert.ok(parseEndpoint(text.probe.endpoint));
    assert.equal(text.probe.usd, 0.175);
    const image = chooseProbe(['--keep', '/tmp/example', 'kling-3', '--image', 'https://image.test/a.png']);
    assert.equal(image.ok, true);
    assert.equal(image.keep, '/tmp/example');
    assert.equal(image.probe.inputs.image_url, 'https://image.test/a.png');
    assert.equal(image.probe.usd, 0.28);
    assert.ok(parseEndpoint(image.probe.endpoint));
    for (const argv of [[], ['unknown'], ['kling-3'], ['kling-3', '--image', 'http://x.test/a'], ['kling-3', '--image', 'https://'],
        ['kling-2-6', '--image', 'https://image.test/a'], ['kling-2-6', '--keep'], ['kling-2-6', '--key', 'anything'], ['kling-2-6', 'anything']]) {
        assert.equal(chooseProbe(argv).ok, false, JSON.stringify(argv));
    }
});

test('missing key and nonempty keep folder refuse before any submit; no environment secret is logged', async () => {
    const saved = process.env.HIGGSFIELD_API_KEY;
    const dir = await mkdtemp(join(tmpdir(), 'higgsfield-probe-test-'));
    try {
        delete process.env.HIGGSFIELD_API_KEY;
        await assert.rejects(main(['kling-2-6']), /HIGGSFIELD_API_KEY is not set/);
        await requireEmptyFolder(dir);
        await requireEmptyFolder(join(dir, 'new-folder'));
        await writeFile(join(dir, 'personal-file.txt'), 'preserve');
        process.env.HIGGSFIELD_API_KEY = 'test-fixture';
        await assert.rejects(main(['kling-2-6', '--keep', dir]), /folder must be empty/);
    } finally {
        if (saved === undefined) delete process.env.HIGGSFIELD_API_KEY; else process.env.HIGGSFIELD_API_KEY = saved;
        await rm(dir, { recursive: true });
    }
});

test('probe reports raw status words and only numeric billed fields without payloads', async () => {
    assert.deepEqual(probeFacts({ status: 'in_progress', billed_amount: 0.175, cost: 'private', message: 'secret', credits: 3 }),
        { status: 'in_progress', billed: { billed_amount: 0.175, credits: 3 } });
    globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://api.higgsfield.ai/requests/id-1/status');
        assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.Authorization, 'Key fixture');
        return Response.json({ status: 'completed', billed_amount: 0.28, video: { url: 'https://unknown.test/a.mp4' }, status_url: 'https://evil.test' });
    };
    const task = await readProbeTask('id-1', 'fixture');
    assert.equal(task.status, 'completed');
    assert.equal(task.billed.billed_amount, 0.28);
    assert.equal(task.outcome.state, 'success');
    await assert.rejects(readProbeTask('../x', 'fixture'), /invalid request_id/);
});

test('kept clips require MP4 bytes and report stream parity facts', () => {
    assert.equal(isMp4(Buffer.from('00000020667479706d703432000000006d70343269736f6d', 'hex')), true);
    assert.equal(isMp4(Buffer.from('<html>not a clip</html>')), false);
    assert.deepEqual(summariseStreams({ format: { duration: '5.1' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, codec_name: 'h264' }] }),
        { durationSeconds: 5.1, width: 1920, height: 1080, videoCodec: 'h264', hasAudio: false });
});
