import { wigFixture } from './photo-studio-wig-fixture.mjs';
import { WIGS } from '../../packages/live-edit/wigs.js';
import { createPhotoRenderer } from '../../app/veyrnox/_lib/liveEdit/renderer.js';
import { createPhotoEngine } from '../../app/veyrnox/_lib/liveEdit/engine.js';
import { DEFAULTS, createHistory } from '../../app/veyrnox/_lib/liveEdit/settings.js';
import { luminance, toLinear } from '../../packages/live-edit/hair.js';
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
const canvas = () => document.createElement('canvas');
// All mismatching pixels/channels are retained with expected/actual, not just the first miss.
export async function proveWigs() {
    const checks = [], misses = [], { source, points, mask } = wigFixture(), original = pixels(source), target = canvas();
    const check = (ok, name, expected, actual) => { if (!ok) misses.push({ name, expected, actual }); };
    const equal = (name, actual, expected, tolerance = 0, include = () => true) => {
        for (let i = 0; i < expected.length; i++) if (include(i) && Math.abs(actual[i] - expected[i]) > tolerance)
            misses.push({ name, pixel: [Math.floor(i / 4) % 256, Math.floor(i / 1024)], channel: i % 4, expected: expected[i], actual: actual[i], tolerance });
    };
    const scenario = async (name, run) => {
        try { await run(); checks.push(name); }
        catch (error) { misses.push({ name, expected: 'completed', actual: error.message }); }
    };
    let renderer, engine, status;
    const settings = (style, strength = 1) => ({ ...DEFAULTS, wig: { ...DEFAULTS.wig, style, strength } });
    try {
        renderer = createPhotoRenderer(target, source, { onWig: value => { status = value; } });
        renderer.setLandmarks(points); renderer.setHairMask(mask);
        await scenario('wig-zero-identical', async () => {
            for (const wig of WIGS) {
                await renderer.prepareWig(settings(wig.id)); renderer.draw(settings(wig.id, 0));
                equal(`${wig.id}: zero decoded pixels`, pixels(target), original);
                renderer.draw({ ...DEFAULTS, brightness: .2 }); const baseline = pixels(target);
                renderer.draw({ ...settings(wig.id, 0), brightness: .2 });
                equal(`${wig.id}: zero on GPU path`, pixels(target), baseline);
            }
        });
        for (const wig of WIGS) await scenario(`wig-svg-${wig.id}`, async () => {
            // Asset request is NOT intercepted: served by built Worker/Assets under the page CSP.
            const image = new Image(); image.src = wig.file; await image.decode();
            const art = canvas(); art.width = 512; art.height = 640; art.getContext('2d').drawImage(image, 0, 0);
            const raw = pixels(art); check(raw[(300 * 512 + 256) * 4 + 3] === 0, `${wig.id}: transparent face opening`, 0, raw[(300 * 512 + 256) * 4 + 3]);
            const oracle = canvas(); oracle.width = oracle.height = 256;
            // Known synthetic fixture transform, independent of the fitting implementation.
            const oc = oracle.getContext('2d'); oc.setTransform(.4, 0, 0, .4, 25.6, 0); oc.drawImage(image, 0, 0);
            const silhouette = pixels(oracle);
            const allowed = new Uint8Array(256 * 256);
            for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (silhouette[(y * 256 + x) * 4 + 3]) {
                // Two-pixel rasterization boundary margin; never a hand-derived edge golden.
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x+dx>=0 && x+dx<256 && y+dy>=0 && y+dy<256) allowed[(y+dy)*256+x+dx]=1;
            }
            await renderer.prepareWig(settings(wig.id)); renderer.draw(settings(wig.id)); const full = pixels(target);
            const changedChannels = full.reduce((count, v, i) => count + (Math.abs(v - original[i]) > 2 ? 1 : 0), 0);
            check(changedChannels > 0, `${wig.id}: visible overlay`, '>0 channels changed by more than 2/255', changedChannels);
            equal(`${wig.id}: outside expected silhouette`, full, original, 2, i => !allowed[Math.floor(i / 4)]);
            equal(`${wig.id}: no holes / alpha`, full, original, 0, i => i % 4 === 3);
            for (const [name,x,y,w,h] of [['eyes',94,117,68,9],['brows',92,104,72,7],['nose',122,139,12,14],['mouth',114,168,28,10]])
                equal(`${wig.id}: ${name} untouched`, full, original, 2, i => { const px = Math.floor(i/4)%256, py = Math.floor(i/1024); return px>=x && px<x+w && py>=y && py<y+h; });
            renderer.draw(settings(wig.id, .5)); const half = pixels(target);
            for (let i = 0; i < full.length; i++) if (i%4!==3) {
                const lo = Math.min(original[i], full[i]), hi = Math.max(original[i], full[i]);
                if (half[i] < lo-2 || half[i] > hi+2) misses.push({ name: `${wig.id}: opacity monotonic`, pixel: Math.floor(i/4), channel: i%4, expected: [lo, hi], actual: half[i], tolerance: 2 });
            }
        });
        await scenario('wig-r4-long-hair-short-wig', async () => {
            renderer.draw(settings('pixie')); const data = pixels(target);
            check(status === 'uncovered', 'long-hair hint', 'uncovered', status);
            equal('long natural hair remains visible', data, original, 0, i => { const x = Math.floor(i/4)%256, y = Math.floor(i/1024); return y>180 && y<238 && (x>=48 && x<72 || x>=184 && x<208); });
            equal('long-hair no transparent holes', data, original, 0, i => i%4===3);
        });
        await scenario('wig-tint-luminance', async () => {
            renderer.setHairMask(null); renderer.draw(settings('bob')); const plain = pixels(target);
            renderer.draw({ ...settings('bob'), hair: { strength: 1, shade: 'teal' } }); const tinted = pixels(target);
            // Constant interior plateau, far from the source-over and hairline boundaries.
            let changed = 0;
            for (let y=45; y<50; y++) for (let x=115; x<120; x++) {
                const i=(y*256+x)*4, a=[...plain.slice(i,i+3)], b=[...tinted.slice(i,i+3)];
                const delta=Math.abs(luminance(a.map(v=>toLinear(v/255)))-luminance(b.map(v=>toLinear(v/255))));
                check(delta<.009, `wig tint luminance ${x},${y}`, '<0.009', delta);
                if (a.some((v,c)=>Math.abs(v-b[c])>2)) changed++;
            }
            check(changed>0, 'wig tint without natural hair mask', '>0 changed plateau pixels', changed);
            renderer.setHairMask(mask);
        });
        await scenario('wig-face-lost-pose-off', async () => {
            renderer.setLandmarks(null); renderer.draw(settings('bob')); equal('face lost off', pixels(target), original);
            renderer.setLandmarks(points); renderer.setHairMask(mask); renderer.draw(settings('bob', .5)); const half=pixels(target);
            for (const [a,b,label] of [[234,454,'yaw'],[10,152,'pitch']]) {
                const tilted=points.slice(), span=Math.hypot(points[a*3]-points[b*3],points[a*3+1]-points[b*3+1]);
                tilted[a*3+2]=span*Math.tan(27.5*Math.PI/180);
                renderer.setLandmarks(tilted); renderer.draw(settings('bob'));
                equal(`${label} midpoint fade`,pixels(target),half,2);
                check(status==='angle-uncovered'||status==='angle',`${label} fade announced`,'angle message',status);
            }
            const angled=points.slice(); angled[234*3+2]=.8;
            renderer.setLandmarks(angled); renderer.draw(settings('bob')); equal('yaw beyond threshold off', pixels(target), original); check(status==='angle','angle announcement','angle',status);
            renderer.setLandmarks(points); renderer.setHairMask(mask);
            // Clamp extremes must still protect features when the overlay is shifted down/enlarged.
            renderer.draw({ ...settings('long'), wig:{style:'long',size:999,offset:999,strength:1} });
            equal('extreme fit protects face',pixels(target),original,2,i=>{const x=Math.floor(i/4)%256,y=Math.floor(i/1024);return x>=95&&x<160&&y>=105&&y<180;});
        });
        renderer.close(); renderer=null;
        await scenario('wig-transparent-source',async()=>{
            const translucent=canvas(); translucent.width=translucent.height=256;
            const tc=translucent.getContext('2d'); tc.globalAlpha=.5; tc.drawImage(source,0,0);
            const base=pixels(translucent);
            renderer=createPhotoRenderer(target,translucent); renderer.setLandmarks(points);
            await renderer.prepareWig(settings('bob')); renderer.draw(settings('bob',0)); equal('transparent zero identical',pixels(target),base);
            renderer.draw(settings('bob')); const over=pixels(target);
            for(let i=3;i<over.length;i+=4) if(over[i]<base[i]) misses.push({name:'source-over never reduces source alpha',pixel:Math.floor(i/4),expected:`>=${base[i]}`,actual:over[i]});
            equal('transparent background outside wig preserved',over,base,2,i=>Math.floor(i/1024)>220);
            renderer.close(); renderer=null;
        });
        for (const count of [0,2]) await scenario(`wig-face-count-${count}`,async()=>{
            engine=createPhotoEngine(target,source,{processorFactory:async()=>({detect:async()=>({count,landmarks:points}),close(){}})});
            await engine.ready; engine.setSettings(settings('bob')); await new Promise(requestAnimationFrame);
            equal(`face count ${count} off`,pixels(target),original); engine.close(); engine=null;
        });
        await scenario('wig-export-history-compare',async()=>{
            engine=createPhotoEngine(target,source,{
                processorFactory:async()=>({detect:async()=>({count:1,landmarks:points}),close(){}}),
                hairProcessorFactory:async()=>({segment:async()=>mask,close(){}}),
            });
            await engine.ready;
            const history=createHistory(), edited={...settings('bob'),hair:{strength:.65,shade:'plum'},makeup:{lips:{strength:.5,shade:'rose'}},brightness:.1};
            history.set(edited); engine.setSettings(history.value);
            // Export waits for the selected asset even when it has never finished a preview draw.
            await engine.export(); await new Promise(requestAnimationFrame); const preview=pixels(target);
            history.undo(); engine.setSettings(history.value); await new Promise(requestAnimationFrame); equal('undo',pixels(target),original);
            history.redo(); engine.setSettings(history.value); await new Promise(requestAnimationFrame); equal('redo',pixels(target),preview);
            engine.compare(true); await new Promise(requestAnimationFrame); equal('compare original',pixels(target),original);
            const blob=await engine.export(), image=await createImageBitmap(blob), decoded=canvas(); decoded.width=image.width; decoded.height=image.height; decoded.getContext('2d').drawImage(image,0,0); image.close();
            check(decoded.width===256&&decoded.height===256,'source resolution',[256,256],[decoded.width,decoded.height]);
            equal('combined wig/tint/makeup export equality while comparing',pixels(decoded),preview);
        });
    } catch (error) { misses.push({ name: 'wig renderer setup', expected: 'WebGL2 available', actual: error.message }); }
    finally { renderer?.close(); engine?.close(); }
    return { checks, misses };
}
