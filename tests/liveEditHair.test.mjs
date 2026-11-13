import test from 'node:test';
import assert from 'node:assert/strict';
import { HAIR_SHADES, normalizeHair, recolourHair, luminance, toLinear, hairCoverage, hairTexture, selectFaceHair } from '../packages/live-edit/hair.js';
import { createHistory } from '../packages/live-edit/effects.js';
import { OVAL } from '../packages/live-edit/regions.js';
test('hair confidence matte matches ADR-0092 endpoints, feathering and bounds', () => {
    assert.equal(hairCoverage(.2), 0); assert.equal(hairCoverage(.8), 1);
    assert.ok(Math.abs(hairCoverage(.5) - .5) < 1e-12);
    for (const value of [0, .01, .1, .2]) assert.ok(hairCoverage(value) < .05);
    const mask = { width: 8, height: 8, hair: new Float32Array(64) };
    assert.equal(hairTexture(mask), null);
    mask.hair[16] = .8; mask.hair[40] = .9;
    const packed = hairTexture(mask);
    assert.equal(packed.top, .25); assert.equal(packed.span, .5); assert.equal(packed.data[16 * 4], 204);
    for (const hair of [new Float32Array(63), new Float32Array(64).fill(NaN), new Float32Array(64).fill(1.1)]) assert.throws(() => hairTexture({ ...mask, hair }));
    assert.throws(() => hairTexture({ width: 513, height: 8, hair: new Float32Array(4104) }));
});
test('hair readiness rejects one-pixel specks and requires 0.5% above 0.5 confidence', () => {
    for (const edge of [8,32,256,512]) {
        const mask = { width: edge, height: edge, hair: new Float32Array(edge * edge) };
        mask.hair[0] = 1; assert.equal(hairTexture(mask), null, `single speck at ${edge}`);
        const required = Math.max(2, Math.ceil(edge * edge * .005));
        mask.hair.fill(.5); assert.equal(hairTexture(mask), null, 'weak haze is not confident area');
        mask.hair.fill(.8, 0, required - 1); assert.equal(hairTexture(mask), null, 'just below area cutoff');
        mask.hair[required - 1] = .8; assert.ok(hairTexture(mask), 'area cutoff is inclusive');
    }
});
test('ombre row percentiles retain a real blob and ignore isolated top/bottom specks', () => {
    const mask = { width:64, height:64, hair:new Float32Array(4096) };
    for(let y=10;y<20;y++) for(let x=12;x<52;x++) mask.hair[y*64+x]=1;
    // Soft edges remain in the texture but do not define the ombre extent.
    mask.hair[9*64+32]=.3;
    const before=hairTexture(mask);
    assert.equal(before.top,10/64); assert.equal(before.span,10/64);
    assert.equal(before.data[(9*64+32)*4],77);
    mask.hair[0]=1; mask.hair[4095]=1;
    const after=hairTexture(mask);
    assert.deepEqual([after.top,after.span],[before.top,before.span]);
});
test('face association keeps both side locks and connected lengths, excluding a remote second head', () => {
    const points=new Float32Array(1434);
    OVAL.forEach((index,i)=>{const angle=i/OVAL.length*2*Math.PI; points[index*3]=.5+.1*Math.cos(angle); points[index*3+1]=.4+.1*Math.sin(angle);});
    const mask={width:64,height:64,hair:new Float32Array(4096)};
    for(let y=10;y<48;y++) for(const start of [22,39,57]) for(let x=start;x<start+4;x++) mask.hair[y*64+x]=.9;
    // Haze below visible alpha must not join the distant head to the subject.
    for(let x=43;x<57;x++) mask.hair[20*64+x]=.2;
    const selected=selectFaceHair(mask,points);
    for(const x of [23,40]) for(const y of [12,45]) assert.equal(selected.hair[y*64+x],mask.hair[y*64+x], 'side locks / long hair retained beyond anchor box');
    for(let y=10;y<48;y++) for(let x=57;x<61;x++) assert.equal(selected.hair[y*64+x],0,'remote second head removed');
    assert.ok(hairTexture(selected));
    assert.equal(mask.hair[12*64+58]>.5,true,'input mask is not mutated');
    assert.equal(selectFaceHair(mask,null),null);
    assert.equal(selectFaceHair(mask,new Float32Array(1434).fill(.5)),null,'degenerate face oval is not an anchor');
});
test('recolour preserves linear luminance and gamut across shades, modes, strengths and source tones', () => {
    for (const shade of Object.keys(HAIR_SHADES)) for (const mode of ['solid', 'ombre', 'highlights']) {
        for (const rgb of [[0,0,0], [1,1,1], [.2,.1,.06], [.8,.7,.6], [.9,.3,.1]]) {
            for (const position of [0, .5, 1]) {
                assert.deepEqual(recolourHair(rgb, 1, { shade, mode, strength: 0 }, position), rgb);
                assert.deepEqual(recolourHair(rgb, .2, { shade, mode, strength: 1 }, position), rgb);
                let previous = 0;
                for (const strength of [.1,.5,1]) {
                    const out = recolourHair(rgb, 1, { shade, mode, strength }, position);
                    assert.ok(out.every(v => v >= -1e-12 && v <= 1 + 1e-12));
                    assert.ok(Math.abs(luminance(out.map(toLinear)) - luminance(rgb.map(toLinear))) < 1e-12);
                    const delta = out.reduce((sum,v,i) => sum + Math.abs(v-rgb[i]),0);
                    assert.ok(delta >= previous - 1e-12); previous = delta;
                }
            }
        }
    }
});
test('hair settings clamp, survive undo/redo and never mutate shared defaults', () => {
    assert.deepEqual(normalizeHair({ strength: Infinity, shade: 'unknown', mode: 'wig' }), normalizeHair());
    const history = createHistory(); history.set({ hair: { strength: .8, mode: 'ombre', shade: 'teal', shade2: 'plum' } });
    const chosen = history.value; history.undo(); assert.equal(history.value.hair.strength, 0);
    history.redo(); assert.deepEqual(history.value, chosen);
    chosen.hair.shade = 'blonde'; assert.equal(history.value.hair.shade, 'teal');
});
