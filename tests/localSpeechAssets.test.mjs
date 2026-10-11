import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventory, MAX_ASSET_BYTES, sha256, verifyBytes, verifyAssets, manifestText, workerText } from '../scripts/local-speech-assets.mjs';
test('pinned speech delivery fits static limits and retains original/conversion/runtime notices',()=>{
    assert.ok(inventory.files.every(file=>file.bytes<=MAX_ASSET_BYTES));
    assert.equal(inventory.modelRevision,'517244293732ee2d58139af5814231b7e6830a0d');
    assert.ok(inventory.files.some(file=>file.path==='notices/original-model-card.md'));
    assert.ok(inventory.files.some(file=>file.path==='models/whisper-tiny_timestamped/README.md'));
    assert.ok(inventory.files.some(file=>file.path==='notices/onnxruntime-ThirdPartyNotices.txt'));
    assert.equal(inventory.decoder.chunks.reduce((n,file)=>n+file.bytes,0),inventory.decoder.bytes);
    assert.equal(inventory.files.some(file=>file.path===inventory.decoder.path),false);
    const models=JSON.parse(manifestText()).models;
    assert.deepEqual(models[inventory.decoder.path].chunks,inventory.decoder.chunks);
    assert.ok(!Object.values(models).some(spec=>spec.source));
});
test('build verification catches corruption, unexpected assets and incorrect model reassembly',async()=>{
    const base=await mkdtemp(join(tmpdir(),'speech-assets-test-')),target=join(base,'editor-speech','fixture');
    const fragments=[Buffer.from('abc'),Buffer.from('def')],files=fragments.map((data,i)=>({path:`models/tiny/decoder.part${i}`,bytes:data.length,sha256:sha256(data),fragmentOf:'decoder'}));
    const spec={version:'fixture',model:'tiny',modelRevision:'fixture',files,decoder:{path:'models/tiny/decoder.onnx',bytes:6,sha256:sha256(Buffer.concat(fragments)),chunks:files.map(({path,bytes,sha256})=>({path,bytes,sha256}))}};
    try {
        await mkdir(join(target,'models','tiny'),{recursive:true});
        for(let i=0;i<files.length;i++)await writeFile(join(target,files[i].path),fragments[i]);
        await writeFile(join(target,'manifest.json'),manifestText(spec));await writeFile(join(target,'worker.mjs'),await workerText(spec));
        assert.equal((await verifyAssets(base,spec)).files,4);
        await writeFile(join(target,'models/tiny/decoder.part1'),'deg');await assert.rejects(verifyAssets(base,spec),/checksum/);
        await writeFile(join(target,'models/tiny/decoder.part1'),fragments[1]);await writeFile(join(target,'unexpected.js'),'executable');await assert.rejects(verifyAssets(base,spec),/file set/);
        await rm(join(target,'unexpected.js'));const reversed={...spec,decoder:{...spec.decoder,chunks:[...spec.decoder.chunks].reverse()}};
        await writeFile(join(target,'manifest.json'),manifestText(reversed));await writeFile(join(target,'worker.mjs'),await workerText(reversed));await assert.rejects(verifyAssets(base,reversed),/checksum/);
        assert.throws(()=>verifyBytes(Buffer.from('bad'),files[0]),/checksum/);
    } finally {await rm(base,{recursive:true,force:true});}
});
