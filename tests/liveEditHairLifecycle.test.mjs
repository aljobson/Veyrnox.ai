import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoEngine } from '../app/veyrnox/_lib/liveEdit/engine.js';
import { hairTexture } from '../packages/live-edit/hair.js';
import { OVAL } from '../packages/live-edit/regions.js';
const points = new Float32Array(1434).fill(.5);
OVAL.forEach((index,i)=>{const angle=i/OVAL.length*2*Math.PI; points[index*3]=.5+.1*Math.cos(angle); points[index*3+1]=.4+.1*Math.sin(angle);});
const mask = value => ({ width: 8, height: 8, hair: new Float32Array(64).fill(value) });
async function withFrames(run) {
    const previous = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
    globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
    try { await run(); } finally { [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = previous; }
}
test('hair runs only after one face, announces no-hair/errors and closes both inference owners', () => withFrames(async () => {
    for (const scenario of ['no-face', 'multiple', 'hair', 'bald', 'failure']) {
        const statuses = [], applied = [], order = []; let calls = 0, closes = 0;
        const engine = createPhotoEngine({}, {}, {
            rendererFactory: () => ({ setLandmarks() {}, setHairMask(m) { applied.push(m); return Boolean(hairTexture(m)); }, close() {} }),
            processorFactory: async () => ({ detect: async () => ({ count: scenario === 'no-face' ? 0 : scenario === 'multiple' ? 2 : 1, landmarks: points }), close() { order.push('face-closed'); } }),
            hairProcessorFactory: async options => { assert.equal(options.hair, true); assert.deepEqual(order, ['face-closed']); calls++; return {
                segment: async () => { if (scenario === 'failure') throw new Error('inference'); return mask(scenario === 'bald' ? .1 : .9); }, close() { closes++; },
            }; }, onHair: s => statuses.push(s),
        });
        await engine.ready;
        const expected = { 'no-face': 'face-required', multiple: 'face-required', hair: 'ready', bald: 'no-hair', failure: 'unavailable' }[scenario];
        assert.equal(statuses.at(-1), expected);
        assert.equal(calls, ['no-face','multiple'].includes(scenario) ? 0 : 1); assert.equal(closes, calls);
        if (scenario === 'failure' || !calls) assert.equal(applied.at(-1), null);
        engine.close();
    }
}));
test('engine filters the whole-image mask before uploading to the renderer', () => withFrames(async () => {
    const sourceMask={width:64,height:64,hair:new Float32Array(4096)}; let uploaded;
    for(let y=10;y<40;y++) for(const start of [22,39,57]) for(let x=start;x<start+4;x++) sourceMask.hair[y*64+x]=.9;
    const engine=createPhotoEngine({}, {}, {
        rendererFactory:()=>({setLandmarks(){},setHairMask(m){uploaded=m;return Boolean(hairTexture(m));},close(){}}),
        processorFactory:async()=>({detect:async()=>({count:1,landmarks:points}),close(){}}),
        hairProcessorFactory:async()=>({segment:async()=>sourceMask,close(){}}),
    });
    await engine.ready;
    assert.ok(uploaded.hair[12*64+23]>.5); assert.ok(uploaded.hair[12*64+40]>.5);
    assert.equal(uploaded.hair[12*64+58],0); engine.close();
}));
test('face initialization or detection failure makes hair unavailable, without blaming the photo', () => withFrames(async () => {
    for (const stage of ['init', 'detect']) {
        const faces = [], hair = [], uploaded = []; let hairCalls = 0, faceCloses = 0;
        const engine = createPhotoEngine({}, {}, {
            rendererFactory: () => ({ setLandmarks() {}, setHairMask(m) { uploaded.push(m); }, close() {} }),
            processorFactory: async () => {
                if (stage === 'init') throw new Error('face model failed to load');
                return { detect: async () => { throw new Error('face inference failed'); }, close() { faceCloses++; } };
            },
            hairProcessorFactory: async () => { hairCalls++; throw new Error('hair must not start'); },
            onFace: status => faces.push(status), onHair: status => hair.push(status),
        });
        await engine.ready;
        assert.equal(faces.at(-1), 'face-unavailable');
        assert.equal(hair.at(-1), 'unavailable'); assert.ok(!hair.includes('face-required'));
        assert.deepEqual(uploaded, [null]); assert.equal(hairCalls, 0);
        assert.equal(faceCloses, stage === 'detect' ? 1 : 0); engine.close();
    }
}));
test('renderer loss is a graphics error; invalid internal masks disable hair without inference Retry', () => withFrames(async () => {
    for(const failure of ['graphics-lost','invalid-hair-mask','malformed-mask','clear-context-lost']) {
        const statuses=[], errors=[]; let processorCloses=0, clears=0;
        const engine=createPhotoEngine({}, {}, {
            rendererFactory:()=>({setLandmarks(){},setHairMask(m){
                if(!m){clears++;if(failure==='clear-context-lost') throw new Error('graphics-lost');return false;}
                throw new Error(failure);
            },close(){}}),
            processorFactory:async()=>({detect:async()=>({count:1,landmarks:points}),close(){}}),
            hairProcessorFactory:async()=>({segment:async()=>{
                if(failure==='clear-context-lost') throw new Error('model download failed');
                return failure==='malformed-mask' ? {...mask(.9),hair:new Float32Array(1)} : mask(.9);
            },close(){processorCloses++;}}),
            onHair:s=>statuses.push(s),onError:e=>errors.push(e),
        });
        await engine.ready;
        assert.equal(statuses.at(-1),'invalid'); assert.ok(!statuses.includes('unavailable'));
        const invalid=['invalid-hair-mask','malformed-mask'].includes(failure);
        assert.deepEqual(errors,invalid?[]:['graphics-lost']);
        if(invalid) assert.equal(clears,1,'clear stale hair after an internal mask failure');
        assert.equal(processorCloses,1); engine.close();
    }
}));
test('source replacement/unmount rejects late hair initialization and masks without stale rendering', () => withFrames(async () => {
    for (const stage of ['init', 'segment']) {
        let finish, entered, closes = 0, applied = 0, signal;
        const started = new Promise(resolve => { entered = resolve; });
        const deferred = new Promise(resolve => { finish = resolve; });
        const processor = { segment: async () => { entered(); return deferred; }, close() { closes++; } };
        const engine = createPhotoEngine({}, {}, {
            rendererFactory: () => ({ setLandmarks() {}, setHairMask() { applied++; }, close() {} }),
            processorFactory: async () => ({ detect: async () => ({ count: 1, landmarks: points }), close() {} }),
            hairProcessorFactory: async opts => { signal = opts.signal; if (stage === 'init') { entered(); return deferred; } return processor; },
        });
        await started; engine.close(); assert.equal(signal.aborted, true);
        finish(stage === 'init' ? processor : mask(.9)); await engine.ready;
        assert.equal(applied, 0); assert.ok(closes >= 1);
    }
}));
test('export while comparing uses the complete saved hair stack', () => withFrames(async () => {
    let drawn;
    const engine = createPhotoEngine({ toBlob: callback => callback(new Blob(['pixels'])) }, {}, {
        rendererFactory: () => ({ setLandmarks() {}, setHairMask: () => true, draw: s => { drawn = s; }, close() {} }),
        processorFactory: async () => ({ detect: async () => ({ count: 1, landmarks: points }), close() {} }),
        hairProcessorFactory: async () => ({ segment: async () => mask(.9), close() {} }),
    });
    await engine.ready; engine.setSettings({ hair: { strength: .6, mode: 'ombre', shade: 'plum' } }); engine.compare(true);
    await engine.export(); assert.equal(drawn.hair.strength, .6); assert.equal(drawn.hair.mode, 'ombre'); engine.close();
}));
