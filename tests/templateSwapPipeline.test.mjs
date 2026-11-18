import test from 'node:test';
import assert from 'node:assert/strict';
import { processSwapPhoto } from '../app/veyrnox/_lib/templateSwapPhoto.mjs';
const file = new Blob(['original'], { type: 'image/jpeg' });
function deps(over = {}) {
  let closed = 0;
  const bitmap = { width: 1000, height: 1000, close() { closed++; } };
  const landmarks = Float32Array.from({ length: 478 * 3 }, (_, i) => i % 3 === 2 ? 0 : i % 2 ? .5 : .35);
  const background = Float32Array.from({ length: 32 * 32 }, (_, i) => i % 32 >= 8 && i % 32 < 24 && i >= 256 && i < 896 ? 0 : 1);
  return { header: async () => ({ width: 1000, height: 1000, rotation: 0 }), bitmap: async () => bitmap,
    vision: async () => ({ segment: async picture => { assert.equal(picture, bitmap); return { width: 32, height: 32, background }; }, close() { closed++; } }),
    face: async () => ({ detect: async picture => { assert.equal(picture, bitmap); return { count: 1, landmarks }; }, close() { closed++; } }),
    encode: async () => [new Blob(['front'], { type: 'image/png' }), new Blob(['crop'], { type: 'image/png' })],
    closed: () => closed, ...over };
}
test('processed PNG pair, same bounded bitmap for both processors, all resources close', async () => {
  const d = deps(); const result = await processSwapPhoto(file, { deps: d });
  assert.equal(result.files.length, 2); assert.equal(await result.files[0].text(), 'front'); assert.equal(d.closed(), 3);
});
test('init failure, timeout, no person and abort block with no upload boundary', async () => {
  for (const replacement of [
    { vision: async () => { throw Error('init'); } },
    { vision: async () => ({ segment: async () => { throw Error('timeout'); }, close() {} }) },
    { face: async () => ({ detect: async () => ({ count: 0, landmarks: new Float32Array() }), close() {} }) },
  ]) { let encoded = false; await assert.rejects(processSwapPhoto(file, { deps: deps({ ...replacement, encode() { encoded = true; } }) })); assert.equal(encoded, false); }
  const c = new AbortController(); c.abort(); await assert.rejects(processSwapPhoto(file, { signal: c.signal, deps: deps() }), { name: 'AbortError' });
});
test('oversize headers refused before decoding; orientation and 6000x4000 bounded before segment', async () => {
  let decoded = false;
  await assert.rejects(processSwapPhoto(file, { deps: deps({ header: async () => ({ width: 12001, height: 4000 }), bitmap() { decoded = true; } }) }), /photo_too_large/);
  assert.equal(decoded, false);
  for (const rotation of [0, 90]) {
    const result = await processSwapPhoto(file, { deps: deps({ header: async () => ({ width: 6000, height: 4000, rotation }),
      bitmap: async (_, options) => { assert.equal(options.imageOrientation, 'from-image'); assert.ok(Math.max(options.resizeWidth, options.resizeHeight) <= 1536); return { width: options.resizeWidth, height: options.resizeHeight, close() {} }; },
      vision: async () => ({ segment: async p => { assert.ok(Math.max(p.width, p.height) <= 1536); return { width: 32, height: 32, background: Float32Array.from({length:1024}, (_,i)=>i%32>8&&i%32<23&&i>256&&i<896?0:1) }; }, close() {} }),
      face: async () => ({ detect: async () => ({ count: 1, landmarks: Float32Array.from({length:1434},(_,i)=>i%3===2?0:i%2?.5:.35) }), close() {} }) }) });
    assert.equal(result.transform.rotation, rotation);
  }
});

test('6000x4000 and rotated inputs satisfy the REAL vision and face client protocols', async t => {
  const { createVisionProcessor } = await import('../app/veyrnox/_lib/editorVisionWorkerClient.mjs');
  const { createFaceProcessor } = await import('../app/veyrnox/_lib/liveEdit/faceClient.mjs');
  const paths = [], seen = [];
  class ProtocolWorker {
    constructor(path) { paths.push(path); this.face = path.includes('face'); }
    terminate() {}
    postMessage(message) {
      let response;
      if (message.op === 'init') response = { ready: true, labels: ['background','hair','body','face','clothes','others'] };
      else if (message.op === 'detect') response = { count: 1, landmarks: Float32Array.from({length:1434}, (_,i)=>i%3===2?0:i%2?.5:.35) };
      else {
        seen.push([message.bitmap.width,message.bitmap.height]);
        const background=Float32Array.from({length:1024},(_,i)=>i%32>8&&i%32<23&&i>256&&i<896?0:1);
        response={width:32,height:32,background,body:new Float32Array(1024),face:new Float32Array(1024),categories:new Uint8Array(1024)};
      }
      queueMicrotask(()=>this.onmessage({data:{...response,id:message.id}}));
    }
  }
  const oldWorker = globalThis.Worker, oldBitmap = globalThis.createImageBitmap;
  t.after(() => { if (oldWorker) globalThis.Worker = oldWorker; else delete globalThis.Worker; if (oldBitmap) globalThis.createImageBitmap = oldBitmap; else delete globalThis.createImageBitmap; });
  globalThis.Worker = ProtocolWorker;
  globalThis.createImageBitmap ||= () => {};
  t.mock.method(globalThis,'createImageBitmap',async (_,o)=>({width:o.resizeWidth,height:o.resizeHeight,close(){}}));
  for(const rotation of [0,90]) await processSwapPhoto(file,{deps:deps({header:async()=>({width:6000,height:4000,rotation}),
    bitmap:globalThis.createImageBitmap,vision:createVisionProcessor,face:createFaceProcessor})});
  assert.deepEqual(seen,[[384,256],[256,384]]);
  assert.ok(paths.every(path=>path.startsWith('/editor-vision/')));
});
test('actual compositor writes opaque grey background and exports frontal/crop PNG in order', async t => {
  const { encodeSwapPair } = await import('../app/veyrnox/_lib/templateSwapPhoto.mjs');
  const originalCanvas = globalThis.OffscreenCanvas, canvases=[];
  t.after(()=>{if(originalCanvas)globalThis.OffscreenCanvas=originalCanvas;else delete globalThis.OffscreenCanvas;});
  class Canvas {
    constructor(width,height){this.width=width;this.height=height;this.context={drawImage:(...args)=>{this.draw=args;},
      getImageData:()=>({data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===0||i%4===3?255:0)}),
      putImageData:pixels=>{this.pixels=pixels.data;}};canvases.push(this);}
    getContext(){return this.context;}
    async convertToBlob({type}){assert.equal(type,'image/png');return new Blob([String(canvases.indexOf(this))],{type});}
  }
  globalThis.OffscreenCanvas=Canvas;
  const alpha={width:32,height:32,data:Float32Array.from({length:1024},(_,i)=>i%32>8&&i%32<23&&i>256&&i<896?1:0)};
  const files=await encodeSwapPair({width:600,height:600},alpha,{box:{x:150,y:150,width:300,height:300},output:{width:512,height:512}});
  assert.deepEqual(await Promise.all(files.map(f=>f.text())),['0','1']);
  assert.deepEqual(Array.from(canvases[0].pixels.slice(0,4)),[128,128,128,255]);
  assert.deepEqual(Array.from(canvases[0].pixels.slice((300*600+300)*4,(300*600+300)*4+4)),[255,0,0,255]);
  assert.ok(canvases[0].pixels.every((n,i)=>i%4!==3||n===255));
  assert.deepEqual(canvases[1].draw.slice(1),[150,150,300,300,0,0,512,512]);
});
