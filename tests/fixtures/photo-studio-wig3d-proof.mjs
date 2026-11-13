import { wigFixture } from './photo-studio-wig-fixture.mjs';
import { WIGS_3D, headFrame, hairlineAt } from '../../packages/live-edit/wig3d.js';
import { createPhotoRenderer } from '../../app/veyrnox/_lib/liveEdit/renderer.js';
import { createPhotoEngine } from '../../app/veyrnox/_lib/liveEdit/engine.js';
import { DEFAULTS } from '../../app/veyrnox/_lib/liveEdit/settings.js';
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
const canvas = () => document.createElement('canvas');
const frames = () => new Promise(requestAnimationFrame);
const PROTECTED = [['eyes', 94, 117, 68, 9], ['brows', 92, 104, 72, 7], ['nose', 122, 139, 12, 14], ['mouth', 114, 168, 28, 10]];
/** Yaw the synthetic face about the vertical axis; landmark z has the SDK's x scale, toward-camera negative. */
const yawed = (points, degrees) => {
    const out = points.slice(), c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
    for (let i = 0; i < 478; i++) {
        if (!out[i * 3] && !out[i * 3 + 1]) continue;
        const dx = out[i * 3] * 256 - 128; out[i * 3] = (128 + dx * c) / 256; out[i * 3 + 2] = -dx * s / 256;
    }
    return out;
};
const spyGl = () => {
    const made = [], proto = HTMLCanvasElement.prototype, original = proto.getContext;
    proto.getContext = function (type, ...rest) { const c = original.call(this, type, ...rest); if (c && /webgl/.test(type)) made.push(c); return c; };
    return { made, stop() { proto.getContext = original; } };
};
// The 3D wig is loaded as a real same-origin module from the built Worker's static assets, under the page CSP.
export async function proveWigs3d() {
    const checks = [], misses = [], { source, points, mask } = wigFixture(), original = pixels(source), target = canvas();
    const check = (ok, name, expected, actual) => { if (!ok) misses.push({ name, expected, actual }); };
    const equal = (name, actual, expected, tolerance = 0, include = () => true) => {
        for (let i = 0; i < expected.length; i++) if (include(i) && Math.abs(actual[i] - expected[i]) > tolerance)
            misses.push({ name, pixel: [Math.floor(i / 4) % 256, Math.floor(i / 1024)], channel: i % 4, expected: expected[i], actual: actual[i], tolerance });
    };
    const changed = (a, b) => a.reduce((n, v, i) => n + (i % 4 !== 3 && Math.abs(v - b[i]) > 2 ? 1 : 0), 0);
    const scenario = async (name, run) => { try { await run(); checks.push(name); } catch (error) { misses.push({ name, expected: 'completed', actual: error.message }); } };
    const settings = (style, strength = 1) => ({ ...DEFAULTS, wig: { ...DEFAULTS.wig, style, strength } });
    let renderer, engine, status;
    try {
        renderer = createPhotoRenderer(target, source, { onWig: value => { status = value; } });
        renderer.setLandmarks(points); renderer.setHairMask(mask);
        await scenario('wig3d-loads-and-zero-identical', async () => {
            for (const wig of WIGS_3D) {
                renderer.draw(settings(wig.id, 0)); equal(`${wig.id}: zero pixels`, pixels(target), original);
                renderer.draw(settings(wig.id)); check(status === 'loading' || status === 'ready' || status === 'coverage-unknown' || status === 'uncovered', `${wig.id}: first draw is loading or active`, 'loading|ready', status);
                await renderer.prepareWig(settings(wig.id));
                renderer.draw(settings(wig.id, 0)); equal(`${wig.id}: zero after load`, pixels(target), original);
            }
        });
        // Regression: a draw that happens first starts the load; prepareWig must wait for that same load.
        await scenario('wig3d-prepare-waits-for-inflight-load', async () => {
            const fresh = canvas(), other = createPhotoRenderer(fresh, source, { onWig: value => { status = value; } });
            try {
                other.setLandmarks(points); other.draw(settings('3d-bob'));
                check(status === 'loading', 'a draw before the load reports loading', 'loading', status);
                await other.prepareWig(settings('3d-bob')); other.draw(settings('3d-bob'));
                check(changed(pixels(fresh), original) > 200, 'prepareWig waited, so the wig is drawn', '>200 channels changed', changed(pixels(fresh), original));
            } finally { other.close(); }
        });
        for (const wig of WIGS_3D) await scenario(`wig3d-${wig.id}`, async () => {
            await renderer.prepareWig(settings(wig.id)); renderer.draw(settings(wig.id)); const full = pixels(target);
            check(changed(full, original) > 200, `${wig.id}: visible overlay`, '>200 channels changed', changed(full, original));
            equal(`${wig.id}: no alpha change`, full, original, 0, i => i % 4 === 3);
            for (const [name, x, y, w, h] of PROTECTED) equal(`${wig.id}: ${name} untouched`, full, original, 2, i => { const px = Math.floor(i / 4) % 256, py = Math.floor(i / 1024); return px >= x && px < x + w && py >= y && py < y + h; });
            equal(`${wig.id}: face below hairline untouched`, full, original, 2, i => { const px = Math.floor(i / 4) % 256, py = Math.floor(i / 1024); return px >= 95 && px < 160 && py >= 118 && py < 182; });
            const above = Array.from({ length: 40 }, (_, k) => (20 + k) * 1024 + 128 * 4); // a column above the head
            check(above.some(i => Math.abs(full[i] - original[i]) > 2), `${wig.id}: dome is drawn above the head`, 'a changed pixel above y=60', 'none');
            renderer.draw(settings(wig.id, .5)); const half = pixels(target);
            for (let i = 0; i < full.length; i++) if (i % 4 !== 3) {
                const lo = Math.min(original[i], full[i]), hi = Math.max(original[i], full[i]);
                if (half[i] < lo - 2 || half[i] > hi + 2) misses.push({ name: `${wig.id}: opacity monotonic`, pixel: Math.floor(i / 4), channel: i % 4, expected: [lo, hi], actual: half[i], tolerance: 2 });
            }
        });
        // The face carve hides the shader's own cut, so check rows only the shader decides: under the hairline, above the
        // carved face, on BOTH sides of the centre line (a pow() of a negative base once broke the left half).
        await scenario('wig3d-hairline-window-both-sides', async () => {
            const frame = headFrame(points, 256, 256);
            for (const wig of WIGS_3D) {
                await renderer.prepareWig(settings(wig.id)); renderer.draw(settings(wig.id)); const full = pixels(target);
                for (const px of [100, 128, 156]) {
                    const local = (px - frame.origin[0]) / frame.s, row = frame.origin[1] - hairlineAt(wig, local) * frame.h;
                    for (let y = Math.ceil(row) + 3; y <= 66; y++) for (let c = 0; c < 3; c++) {
                        const i = (y * 256 + px) * 4 + c;
                        if (Math.abs(full[i] - original[i]) > 2) misses.push({ name: `${wig.id}: open below the hairline at x=${px}`, pixel: [px, y], channel: c, expected: original[i], actual: full[i], tolerance: 2 });
                    }
                }
            }
        });
        // Graphics lifecycle: context loss, a failed render, and leaving 3D mode.
        await scenario('wig3d-context-loss-render-failure-and-release', async () => {
            const spy = spyGl(), fresh = canvas(), proto = WebGL2RenderingContext.prototype, drawElements = proto.drawElements;
            let other, armed = false, gl3d;
            try {
                other = createPhotoRenderer(fresh, source, { onWig: value => { status = value; } });
                other.setLandmarks(points);
                await other.prepareWig(settings('3d-bob')); other.draw(settings('3d-bob'));
                check(changed(pixels(fresh), original) > 200, 'wig drawn before any failure', '>200 channels changed', changed(pixels(fresh), original));
                gl3d = spy.made.at(-1); const lose = gl3d.getExtension('WEBGL_lose_context');
                lose.loseContext(); await frames(); await frames();
                other.draw(settings('3d-bob'));
                check(status === 'unavailable', 'a lost context reports unavailable', 'unavailable', status);
                equal('a lost context never composites a stale or empty wig', pixels(fresh), original);
                lose.restoreContext(); await frames(); await frames();
                other.draw(settings('3d-bob'));
                check(changed(pixels(fresh), original) > 200, 'a restored context draws the wig again', '>200 channels changed', changed(pixels(fresh), original));
                // A render that throws releases everything; the next prepare rebuilds meshes under a fresh renderer.
                proto.drawElements = function (...args) { if (armed && this === gl3d) throw new Error('simulated GPU failure'); return drawElements.apply(this, args); };
                armed = true; other.draw({ ...settings('3d-bob'), wig: { ...settings('3d-bob').wig, size: 1.05 } });
                check(status === 'unavailable', 'a failed render reports unavailable', 'unavailable', status);
                armed = false; await other.prepareWig(settings('3d-bob')); other.draw(settings('3d-bob'));
                check(changed(pixels(fresh), original) > 200, 'recovery draws the wig from a rebuilt renderer', '>200 channels changed', changed(pixels(fresh), original));
                const rebuilt = spy.made.at(-1); check(rebuilt !== gl3d && !rebuilt.isContextLost(), 'recovery uses a new context', 'new live context', 'same or lost');
                check(gl3d.isContextLost(), 'the failed context was released', true, gl3d.isContextLost());
                // Leaving 3D mode frees the GPU context.
                other.draw(settings('none')); await new Promise(resolve => setTimeout(resolve, 1800)); // released after a pause, not on a one-frame compare
                check(rebuilt.isContextLost(), 'choosing None releases the 3D context', true, rebuilt.isContextLost());
                await other.prepareWig(settings('3d-long')); other.draw(settings('3d-long'));
                check(changed(pixels(fresh), original) > 200, 'choosing 3D again rebuilds it', '>200 channels changed', changed(pixels(fresh), original));
            } finally { proto.drawElements = drawElements; spy.stop(); other?.close(); }
        });
        // Hold-to-compare is not leaving 3D mode: the layer survives it, and an export while comparing keeps the wig.
        await scenario('wig3d-compare-keeps-layer-and-export', async () => {
            const spy = spyGl(), fresh = canvas();
            const compared = createPhotoEngine(fresh, source, { processorFactory: async () => ({ detect: async () => ({ count: 1, landmarks: points }), close() {} }), hairProcessorFactory: async () => ({ segment: async () => mask, close() {} }) });
            try {
                await compared.ready; compared.setSettings(settings('3d-bob')); await compared.export(); await frames();
                const contexts = spy.made.length;
                compared.compare(true); await frames(); await frames(); equal('compare shows the original', pixels(fresh), original);
                compared.compare(false); await frames(); await frames();
                check(changed(pixels(fresh), original) > 200, 'releasing compare shows the wig again', '>200 channels changed', changed(pixels(fresh), original));
                check(spy.made.length === contexts, 'compare does not rebuild the GL context', contexts, spy.made.length);
                compared.compare(true); const blob = await compared.export(), image = await createImageBitmap(blob), decoded = canvas();
                decoded.width = image.width; decoded.height = image.height; decoded.getContext('2d').drawImage(image, 0, 0);
                check(changed(pixels(decoded), original) > 200, 'an export taken while comparing keeps the 3D wig', '>200 channels changed', changed(pixels(decoded), original));
            } finally { compared.close(); spy.stop(); }
        });
        // three.js reports a shader link failure by logging, not throwing: prepare must reject and nothing may be cached.
        await scenario('wig3d-shader-failure-refuses-and-recovers', async () => {
            const spy = spyGl(), fresh = canvas(), proto = WebGL2RenderingContext.prototype, original3d = proto.getProgramParameter, logged = console.error;
            let other, armed = false;
            console.error = () => {};
            try {
                other = createPhotoRenderer(fresh, source, { onWig: value => { status = value; } }); other.setLandmarks(points);
                const main = spy.made[0];
                proto.getProgramParameter = function (program, pname) { if (armed && this !== main && pname === this.LINK_STATUS) return false; return original3d.call(this, program, pname); };
                armed = true; let rejected = '';
                try { await other.prepareWig(settings('3d-pixie')); } catch (error) { rejected = error.message; }
                check(rejected === 'wig-unavailable', 'a shader failure rejects prepare, so an export is refused', 'wig-unavailable', rejected);
                other.draw(settings('3d-pixie'));
                check(status === 'unavailable', 'a shader failure reports unavailable', 'unavailable', status);
                equal('a shader failure is never cached as a wig', pixels(fresh), original);
                armed = false; await other.prepareWig(settings('3d-pixie')); other.draw(settings('3d-pixie'));
                check(changed(pixels(fresh), original) > 200, 'retry after the shader recovers draws the wig', '>200 channels changed', changed(pixels(fresh), original));
            } finally { proto.getProgramParameter = original3d; console.error = logged; spy.stop(); other?.close(); }
        });
        await scenario('wig3d-turns-with-head-and-fades', async () => {
            renderer.setLandmarks(points); renderer.draw(settings('3d-bob')); const front = pixels(target);
            renderer.setLandmarks(yawed(points, 30)); renderer.draw(settings('3d-bob')); const turned = pixels(target);
            check(changed(turned, original) > 200, 'turned 30 degrees still draws', '>200', changed(turned, original));
            check(changed(turned, front) > 200, 'wig follows the head turn', 'differs from frontal', changed(turned, front));
            renderer.setLandmarks(yawed(points, 75)); renderer.draw(settings('3d-bob')); equal('turned 75 degrees draws nothing', pixels(target), original);
            renderer.setLandmarks(points);
        });
        await scenario('wig3d-face-lost-and-count', async () => {
            renderer.setLandmarks(null); renderer.draw(settings('3d-long')); equal('no face draws nothing', pixels(target), original); renderer.setLandmarks(points);
            for (const count of [0, 2]) {
                engine = createPhotoEngine(target, source, { processorFactory: async () => ({ detect: async () => ({ count, landmarks: points }), close() {} }) });
                await engine.ready; engine.setSettings(settings('3d-long')); await frames(); equal(`face count ${count} draws nothing`, pixels(target), original); engine.close(); engine = null;
            }
        });
        await scenario('wig3d-export-equality', async () => {
            engine = createPhotoEngine(target, source, { processorFactory: async () => ({ detect: async () => ({ count: 1, landmarks: points }), close() {} }), hairProcessorFactory: async () => ({ segment: async () => mask, close() {} }) });
            await engine.ready; engine.setSettings(settings('3d-fringe'));
            const blob = await engine.export(); await frames(); const preview = pixels(target);
            const image = await createImageBitmap(blob), decoded = canvas(); decoded.width = image.width; decoded.height = image.height; decoded.getContext('2d').drawImage(image, 0, 0);
            check(changed(preview, original) > 200, 'export preview has the wig', '>200', changed(preview, original));
            equal('3D wig export equals preview', pixels(decoded), preview);
        });
    } catch (error) { misses.push({ name: 'wig3d renderer setup', expected: 'WebGL2 available', actual: error.message }); }
    finally { renderer?.close(); engine?.close(); }
    return { checks, misses };
}
