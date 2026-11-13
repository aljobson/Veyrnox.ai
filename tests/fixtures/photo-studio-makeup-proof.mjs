import { createPhotoRenderer } from '../../app/veyrnox/_lib/liveEdit/renderer.js';
import { DEFAULTS } from '../../packages/live-edit/effects.js';
import { MAKEUP, MAKEUP_PRESETS, normalizeMakeup } from '../../packages/live-edit/makeup.js';
import { makeupFixture } from './photo-studio-makeup-fixture.mjs';
import { MAKEUP_GOLDENS } from './photo-studio-makeup-goldens.mjs';
const pixels = c => c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const diff = (a,b) => a.reduce((m,v,i) => Math.max(m,Math.abs(v-b[i])),0);
const assert = (ok,label) => { if (!ok) throw new Error(label); };
export function proveMakeup() {
    const { source, points } = makeupFixture(), target = document.createElement('canvas');
    const renderer = createPhotoRenderer(target,source), original = pixels(source), checks = [];
    const draw = makeup => { renderer.draw({ ...DEFAULTS, makeup: normalizeMakeup(makeup) }); return pixels(target); };
    try {
        renderer.setLandmarks(points);
        // Zero must remain exact even with every shade/finish/geometry parameter selected.
        for (const finish of ['matte','gloss','tint']) {
            const zero = Object.fromEntries(MAKEUP.map(d => [d.id,{ ...MAKEUP_PRESETS.glam[d.id], strength: 0, finish }]));
            assert(diff(original,draw(zero))===0,'All makeup strengths zero = exact pixels');
        }
        checks.push('makeup-zero-identical');
        // Stored 3x3 analytic RGB crops; absolute per-channel tolerance <=2/255.
        const goldenMisses = [];
        for (const golden of MAKEUP_GOLDENS) {
            const actual = draw(golden.makeup), crop = []; let error = 0;
            for (let y=0;y<3;y++) for(let x=0;x<3;x++) for(let c=0;c<3;c++) {
                const value=actual[((golden.y+y)*256+golden.x+x)*4+c];
                crop.push(value);
                error=Math.max(error,Math.abs(value-golden.rgb[(y*3+x)*3+c]));
            }
            if (error > 2) goldenMisses.push({ name: golden.name, maxError: error, expected: golden.rgb, actual: crop });
        }
        assert(goldenMisses.length === 0, `Golden crop misses: ${JSON.stringify(goldenMisses)}`);
        checks.push('makeup-golden-crops');
        for (const d of MAKEUP) {
            const full = draw({ [d.id]: { strength: 1 } }), half = draw({ [d.id]: { strength: .5 } });
            assert(diff(original,full)>2,`${d.id} changes its region`);
            for (let i=0;i<full.length;i+=4) for(let c=0;c<3;c++) {
                const delta=full[i+c]-original[i+c], partial=half[i+c]-original[i+c];
                assert(Math.abs(partial)<=Math.abs(delta)+1 && partial*delta>=-1,`${d.id} intensity monotonic`);
            }
            for (let i=3;i<full.length;i+=4) assert(full[i]===original[i], `${d.id} preserves alpha`);
            // Whole interior rectangles, including the teeth and both eyes, must be untouched.
            for(const [x0,y0,w,h] of [[75,94,18,6],[161,94,18,6],[111,181,34,6],[0,0,16,16],[240,240,16,16]]) {
                for(let y=y0;y<y0+h;y++) for(let x=x0;x<x0+w;x++) for(let c=0;c<3;c++) {
                    const i=(y*256+x)*4+c; assert(full[i]===original[i],`${d.id} excludes eyes/teeth and preserves orientation`);
                }
            }
        }
        checks.push('makeup-regions-holes-monotonic');
        const lipOutputs = ['matte','gloss','tint'].map(finish => draw({ lips: { strength: 1, finish } }));
        assert(diff(lipOutputs[0],lipOutputs[1])>2 && diff(lipOutputs[1],lipOutputs[2])>2,'Distinct lip finishes/specular');
        // Fully covered highlight on the side of the mouth: gloss must brighten every channel over matte.
        const highlightPixel = (190 * 256 + 104) * 4;
        for (let c = 0; c < 3; c++) assert(lipOutputs[1][highlightPixel+c] > lipOutputs[0][highlightPixel+c] + 2, 'Gloss highlight brighter than matte');
        for(const [id,parameter] of [['eyeliner','wing'],['lashes','volume']]) {
            assert(diff(draw({[id]:{strength:1,[parameter]:0}}),draw({[id]:{strength:1,[parameter]:1}}))>2,`${id} geometry parameter`);
        }
        assert(diff(draw({eyeshadow:{strength:1,shade:'plum',shade2:'champagne'}}),draw({eyeshadow:{strength:1,shade:'plum',shade2:'bronze'}}))>2,'Two-colour shadow');
        checks.push('makeup-finishes-gradient-wing-volume');
        renderer.setLandmarks(null);
        assert(diff(original,draw(MAKEUP_PRESETS.glam))===0,'Lost face disables makeup exactly');
        // Also exercise the non-neutral GPU path with cleared masks, then restore them.
        renderer.draw({ ...DEFAULTS, brightness: .2, makeup: MAKEUP_PRESETS.glam });
        const withoutFace = pixels(target);
        renderer.draw({ ...DEFAULTS, brightness: .2 });
        assert(diff(withoutFace,pixels(target))===0,'Cleared makeup masks on GPU path');
        renderer.setLandmarks(points);
        assert(diff(original,draw(MAKEUP_PRESETS.glam))>2,'Restored landmarks rebuild masks');
        checks.push('makeup-face-lost');
        return checks;
    } finally { renderer.close(); }
}
