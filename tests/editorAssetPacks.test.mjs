import test from 'node:test';
import assert from 'node:assert/strict';
import { assetPackProblem, parseAssetPack, verifyPackFile, createAssetPack, matchingPackAssets } from '../app/veyrnox/_lib/editorAssetPacks.mjs';
const original = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'picture.png', { type: 'image/png' });
const terms = { name: 'Original stickers', credit: 'Test creator', usage: 'Original artwork; commercial use allowed', url: 'https://example.com/licence' };
test('local catalog creation and digest-verified insertion retain licence/source metadata without file bytes in JSON', async () => {
    const pack = await createAssetPack([original], terms);
    assert.equal(assetPackProblem(pack), null); assert.equal(pack.capabilities[0], 'local-catalog'); assert.equal(pack.assets[0].sha256.length, 64);
    const parsed = parseAssetPack(JSON.stringify(pack)); assert.equal(parsed.error, undefined);
    const loaded = await verifyPackFile(parsed.pack, 'asset-1', [original]);
    assert.equal(loaded.file, original); assert.deepEqual(loaded.details.attribution, { credit: terms.credit, usage: terms.usage, url: terms.url }); assert.equal(loaded.details.sourceName, 'picture.png'); assert.match(loaded.details.folder, /^Asset packs\//);
    assert.deepEqual(Object.keys(pack.assets[0]).sort(), ['attribution', 'category', 'file', 'id', 'kind', 'name', 'sha256', 'tags']);
    assert.equal(matchingPackAssets(pack, { query: 'commercial' }).length, 1); assert.equal(matchingPackAssets(pack, { category: 'Music' }).length, 0);
});
test('matching a filename is insufficient: incorrect digest, duplicate name and claimed media type are rejected', async () => {
    const pack = await createAssetPack([original], terms);
    await assert.rejects(verifyPackFile(pack, 'asset-1', [new File(['Different bytes'], original.name, { type: original.type })]), /recorded hash/);
    await assert.rejects(verifyPackFile(pack, 'asset-1', [original, original]), /exactly one/);
    await assert.rejects(verifyPackFile(pack, 'asset-1', [new File([original], original.name, { type: 'audio/wav' })]), /file type/);
});
test('catalog contract refuses scripts, remote asset URLs, path traversal and unrecorded rights', async () => {
    const pack = await createAssetPack([original], terms);
    assert.match(assetPackProblem({ ...pack, script: 'alert(1)' }), /local-catalog/);
    assert.match(assetPackProblem({ ...pack, capabilities: ['network'] }), /local-catalog/);
    for (const file of ['../picture.png', 'https://example.com/image.png', 'folder/picture.png']) assert.match(assetPackProblem({ ...pack, assets: [{ ...pack.assets[0], file }] }), /invalid identity/);
    assert.match(assetPackProblem({ ...pack, assets: [{ ...pack.assets[0], attribution: { credit: 'X', usage: '', url: '' } }] }), /licence metadata/);
    assert.match(assetPackProblem({ ...pack, assets: [{ ...pack.assets[0], attribution: { credit: 'X', usage: 'Original', url: 'javascript:alert(1)' } }] }), /licence metadata/);
});
test('cancelled verification never ingests and pack bounds reject oversized or duplicate catalog entries', async () => {
    const pack = await createAssetPack([original], terms), controller = new AbortController(); controller.abort();
    await assert.rejects(verifyPackFile(pack, 'asset-1', [original], { signal: controller.signal }), { name: 'AbortError' });
    assert.match(assetPackProblem({ ...pack, assets: [...pack.assets, ...pack.assets] }), /invalid identity/);
    assert.match(parseAssetPack('x'.repeat(131073)).error, /128 KiB/);
    await assert.rejects(createAssetPack(Array(41).fill(original), terms), /1 and 40/);
});
