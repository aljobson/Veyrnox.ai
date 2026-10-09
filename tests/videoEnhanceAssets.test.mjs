import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, manifestText, verifyAssets } from '../scripts/video-enhance-assets.mjs';

async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'enhance-assets-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const bytes = Buffer.from('test runtime');
    const spec = { version: 'test-v1', files: [{ path: 'runtime.wasm', bytes: bytes.length, sha256: sha256(bytes) }] };
    const target = join(base, 'video-enhance', spec.version);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'runtime.wasm'), bytes);
    await writeFile(join(target, 'manifest.json'), manifestText(spec));
    return { base, spec, target };
}
test('verifies complete packaged assets', async t => {
    const { base, spec } = await fixture(t);
    assert.equal(await verifyAssets(base, spec), 1);
});
for (const failure of ['missing', 'corrupt', 'manifest', 'extra']) {
    test(`rejects ${failure} packaged assets`, async t => {
        const { base, spec, target } = await fixture(t);
        if (failure === 'missing') await rm(join(target, 'runtime.wasm'));
        if (failure === 'corrupt') await writeFile(join(target, 'runtime.wasm'), 'bad runtime!');
        if (failure === 'manifest') await writeFile(join(target, 'manifest.json'), '{}');
        if (failure === 'extra') await writeFile(join(target, 'unexpected.js'), 'extra');
        await assert.rejects(verifyAssets(base, spec), /mismatch/);
    });
}
