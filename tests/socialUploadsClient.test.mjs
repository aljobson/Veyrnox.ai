import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadSocialFile } from '../app/lib/socialUploadsClient.js';
const id = '11111111-1111-4111-8111-111111111111';
let sent, headers, outcome;
class FakeXHR {
    upload = {};
    status = 204;
    open(method,url) { assert.equal(method,'PUT'); assert.equal(url,'https://storage.test/signed'); headers = {}; }
    setRequestHeader(key,value) { headers[key] = headers[key] ? `${headers[key]}, ${value}` : value; }
    send(file) { sent = file; if (outcome === 'error') this.onerror(); else { this.upload.onprogress?.({ lengthComputable:true, loaded:file.size,total:file.size }); this.onload(); } }
    abort() { this.onabort?.(); }
}
globalThis.XMLHttpRequest = FakeXHR;
const file = new File([new Uint8Array(16)],'video.mp4',{ type:'video/mp4' });
function requests() {
    const calls = [];
    const call = async (path,init) => {
        assert.equal(path,'/social/uploads');
        const body = JSON.parse(init.body); calls.push({ method:init.method,body });
        if (body.action === 'reserve') return { id,upload_url:'https://storage.test/signed',content_type:file.type,headers:{ 'Content-Type':file.type,'If-None-Match':'*','Content-Length':'16' } };
        if (body.action === 'complete') return { upload:{ id } };
        return { ok:true };
    };
    return { calls,call };
}
test('device upload sends File bytes with immutable headers and completes only after PUT success', async () => {
    const { calls,call } = requests(); outcome = 'ok'; const progress = [];
    assert.equal((await uploadSocialFile(file,{ call,onProgress:(n) => progress.push(n) })).id,id);
    assert.equal(sent,file); assert.equal(headers['If-None-Match'],'*'); assert.equal(headers['Content-Length'],undefined);
    assert.equal(headers['Content-Type'],'video/mp4'); assert.equal(calls[0].body.rights_confirmed,true);
    assert.deepEqual(progress,[100]); assert.equal(calls[1].body.action,'complete');
});
test('failed or canceled transfers never finalize; their reservation is queued for cleanup', async () => {
    for (const canceled of [false,true]) {
        const { calls,call } = requests(); outcome = 'error';
        const controller = new AbortController(); if (canceled) controller.abort();
        await assert.rejects(uploadSocialFile(file,{ call,signal:controller.signal }));
        assert.equal(calls.some((c) => c.body.action === 'complete'),false);
        assert.deepEqual(calls.at(-1),{ method:'DELETE',body:{ id } });
    }
});
test('unsupported device files never reserve storage', async () => {
    const { calls,call } = requests();
    await assert.rejects(uploadSocialFile(new File(['bad'],'bad.mov',{ type:'video/quicktime' }),{ call }));
    assert.equal(calls.length,0);
});
