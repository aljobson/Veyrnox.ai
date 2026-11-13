import { hairFixture, HAIR_GOLDENS } from './photo-studio-hair-fixture.mjs';
import { createPhotoRenderer } from '../../app/veyrnox/_lib/liveEdit/renderer.js';
import { createPhotoEngine } from '../../app/veyrnox/_lib/liveEdit/engine.js';
import { DEFAULTS } from '../../packages/live-edit/effects.js';
import { MAKEUP_PRESETS } from '../../packages/live-edit/makeup.js';
import { luminance, toLinear, selectFaceHair } from '../../packages/live-edit/hair.js';
import { OVAL } from '../../packages/live-edit/regions.js';
const pixels = c => c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const difference = (a,b) => a.reduce((m,v,i) => Math.max(m,Math.abs(v-b[i])),0);
export async function proveHair() {
    const { source, points, mask } = hairFixture(), target = document.createElement('canvas');
    const original = pixels(source), misses = [], checks = [];
    let renderer = createPhotoRenderer(target,source), engine;
    const check = (ok, name, expected, actual) => { if (!ok) misses.push({ name, expected, actual }); };
    const draw = hair => { renderer.draw({ ...DEFAULTS, hair: { strength:1, ...hair } }); return pixels(target); };
    const sample = (data,x,y) => [...data.slice((y*128+x)*4,(y*128+x)*4+3)];
    try {
        renderer.setLandmarks(points); renderer.setHairMask(selectFaceHair(mask,points));
        for (const mode of ['solid','ombre','highlights']) check(difference(draw({ mode,strength:0 }), original)===0, `zero-${mode}`, 0, difference(pixels(target),original));
        checks.push('hair-zero-identical');
        for (const golden of HAIR_GOLDENS) {
            const data=draw(golden.hair), actual=[], expected=[]; let maxError=0;
            for(let y=0;y<3;y++) for(let x=0;x<3;x++) for(let c=0;c<3;c++) {
                const v=data[((golden.y+y)*128+golden.x+x)*4+c];
                actual.push(v); expected.push(golden.rgb[c]); maxError=Math.max(maxError,Math.abs(v-golden.rgb[c]));
            }
            check(maxError<=2, golden.name, expected, actual);
        }
        checks.push('hair-golden-crops');
        const full=draw({}), half=draw({strength:.5});
        let alphaMiss=0, backgroundMiss=0, monotonicMiss=0, lumaError=0;
        for(let y=0;y<128;y++) for(let x=0;x<128;x++) {
            const i=(y*128+x)*4;
            if(full[i+3]!==original[i+3]) alphaMiss++;
            for(let c=0;c<3;c++) {
                if((y<8 || y>=120 || x<8 || x>=120) && Math.abs(full[i+c]-original[i+c])>1) backgroundMiss++;
                const d=full[i+c]-original[i+c], h=half[i+c]-original[i+c];
                if(Math.abs(h)>Math.abs(d)+1 || h*d < -1) monotonicMiss++;
            }
            lumaError=Math.max(lumaError,Math.abs(luminance(sample(full,x,y).map(v=>toLinear(v/255)))-luminance(sample(original,x,y).map(v=>toLinear(v/255)))));
        }
        check(alphaMiss===0,'preserved alpha / no hair deletion',0,alphaMiss);
        check(backgroundMiss===0,'known background / orientation',0,backgroundMiss);
        check(monotonicMiss===0,'strength monotonic',0,monotonicMiss);
        check(lumaError<.009,'linear luminance preservation','<0.009',lumaError);
        // Relations across feathered edges, never a hand-derived steep-edge golden.
        const edge=[24,28,32,36,40,44].map(x=>Math.abs(full[(64*128+x)*4]-original[(64*128+x)*4]));
        check(edge[0]===0 && edge.at(-1)>20 && edge.every((v,i)=>i===0 || v>=edge[i-1]-1),'feather monotonic', 'zero to full monotonically',edge);
        const highlights=draw({mode:'highlights'}), dark=sample(highlights,40,64), bright=sample(highlights,100,64);
        check(dark.every(v=>v===64) && bright.some(v=>Math.abs(v-192)>2),'highlights preserve dark strands and colour bright ones', {dark:[64,64,64],bright:'changed'}, {dark,bright});
        checks.push('hair-feather-luminance-alpha-monotonic');
        // Small face, disconnected side locks and a second head: use flat source
        // plateaus / relations, never new goldens near the filtered mask edges.
        const smallFace=points.slice(), multi={width:64,height:64,hair:new Float32Array(4096)};
        OVAL.forEach((index,i)=>{const a=i/OVAL.length*2*Math.PI;smallFace[index*3]=.5+.1*Math.cos(a);smallFace[index*3+1]=.4+.1*Math.sin(a);});
        for(let y=10;y<48;y++) for(const start of [22,39,57]) for(let x=start;x<start+4;x++) multi.hair[y*64+x]=.9;
        renderer.setLandmarks(smallFace); renderer.setHairMask(selectFaceHair(multi,smallFace));
        const associated=draw({});
        for(const x of [46,80,118]) {
            const actual=sample(associated,x,40), expected=sample(original,x,40), delta=difference(actual,expected);
            check(x===118 ? delta<=1 : delta>2,`face-associated hair at x=${x}`,x===118?expected:'changed side lock',actual);
        }
        const speck={...mask,hair:new Float32Array(256)};speck.hair[8*16+8]=1;
        const speckReady=renderer.setHairMask(selectFaceHair(speck,smallFace));
        check(!speckReady,'single speck is not ready',false,speckReady);
        check(difference(draw({}),original)===0,'single speck leaves exact pixels',0,difference(pixels(target),original));
        checks.push('hair-subject-association-speck');
        renderer.setLandmarks(null);
        check(difference(draw({}),original)===0,'face lost exact off',0,difference(pixels(target),original));
        renderer.setLandmarks(points);
        renderer.setHairMask({ ...mask, hair:new Float32Array(256) });
        check(difference(draw({}),original)===0,'no hair exact off',0,difference(pixels(target),original));
        renderer.draw({ ...DEFAULTS, brightness:.2, hair:{strength:1} }); const cleared=pixels(target);
        renderer.draw({ ...DEFAULTS, brightness:.2 });
        check(difference(cleared,pixels(target))===0,'cleared hair on GPU path',0,difference(cleared,pixels(target)));
        renderer.close(); renderer=null;
        for(const count of [0,2]) {
            engine=createPhotoEngine(target,source,{
                processorFactory:async()=>({detect:async()=>({count,landmarks:points}),close(){}}),
                hairProcessorFactory:async()=>{throw new Error('Hair must not run without one face');},
            });
            await engine.ready; engine.setSettings({hair:{strength:1}}); await new Promise(requestAnimationFrame);
            check(difference(pixels(target),original)===0,`face-count-${count}`,0,difference(pixels(target),original));
            engine.close(); engine=null;
        }
        checks.push('hair-face-lost-multiple-no-hair');
        engine=createPhotoEngine(target,source,{
            processorFactory:async()=>({detect:async()=>({count:1,landmarks:points}),close(){}}),
            hairProcessorFactory:async()=>({segment:async()=>mask,close(){}}),
        });
        await engine.ready;
        engine.setSettings({...DEFAULTS,hair:{strength:.8,mode:'ombre'},makeup:MAKEUP_PRESETS.glam,warmth:.1,smoothing:.4});
        await new Promise(requestAnimationFrame); const preview=pixels(target);
        engine.compare(true); const blob=await engine.export('image/png'), bitmap=await createImageBitmap(blob), decoded=document.createElement('canvas');
        decoded.width=bitmap.width; decoded.height=bitmap.height; decoded.getContext('2d').drawImage(bitmap,0,0); bitmap.close();
        check(decoded.width===128 && decoded.height===128,'export source resolution',[128,128],[decoded.width,decoded.height]);
        check(difference(preview,pixels(decoded))===0,'export combined hair/makeup equality',0,difference(preview,pixels(decoded)));
        checks.push('hair-export-equality');
        if(misses.length) throw new Error(`Hair proof misses: ${JSON.stringify(misses)}`);
        return checks;
    } finally { renderer?.close(); engine?.close(); }
}
