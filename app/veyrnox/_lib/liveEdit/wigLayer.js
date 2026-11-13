import { WIGS } from '../../../../packages/live-edit/wigs.js';
import { isWig3d } from '../../../../packages/live-edit/wig3d.js';
import { fitWig, wigPose, validWigLandmarks } from '../../../../packages/live-edit/wigFit.js';
import { carveFace, sampleCoverage } from './wigCommon.js';
import { createWig3dLayer } from './wig3dLayer.js';

/** Same-origin SVG images, like public/photo-studio/stickers; no page WASM or remote art. */
export function createWigLayer(width, height, onChange = () => {}) {
    const images = new Map(), layer = document.createElement('canvas'), sample = document.createElement('canvas');
    const ratio = Math.min(1, 1024 / Math.max(width, height));
    layer.width = Math.max(1, Math.round(width * ratio)); layer.height = Math.max(1, Math.round(height * ratio));
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    let closed = false, version = 0, cacheKey, cached, layer3d;
    const get3d = () => layer3d ??= createWig3dLayer(width, height, onChange);
    /** Leaving 3D mode frees its WebGL context; the downloaded module stays cached for the next 3D choice. */
    const drop3d = () => { layer3d?.close(); layer3d = null; };
    // Hold-to-compare draws the plain photo for a moment: that is not leaving 3D mode, so release only after a pause.
    let dropTimer;
    const cancelDrop = () => { clearTimeout(dropTimer); dropTimer = undefined; };
    const scheduleDrop = () => { if (layer3d && dropTimer === undefined) dropTimer = setTimeout(() => { dropTimer = undefined; drop3d(); }, 1500); };
    function load(style) {
        const wig = WIGS.find(w => w.id === style);
        if (!wig || closed) return Promise.resolve();
        if (images.has(style)) return images.get(style).promise;
        const image = new Image(), entry = { image, state: 'loading', promise: null, cancel: null };
        images.set(style, entry);
        entry.promise = new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return; settled = true;
                clearTimeout(timer); image.onload = image.onerror = null;
                entry.state = error ? 'unavailable' : 'ready'; version++;
                if (error) { image.src = ''; reject(error); } else resolve();
                if (!closed) onChange();
            };
            const timer = setTimeout(() => finish(new Error('wig-unavailable')), 15000);
            entry.cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
            image.onload = () => finish(image.naturalWidth === wig.dimensions[0] && image.naturalHeight === wig.dimensions[1] ? null : new Error('wig-unavailable'));
            image.onerror = () => finish(new Error('wig-unavailable'));
            image.src = wig.file;
        });
        return entry.promise;
    }
    return {
        prepare(style) {
            if (!isWig3d(style)) { scheduleDrop(); return load(style); }
            if (closed) return Promise.resolve();
            cancelDrop();
            const layer = get3d();
            // If the layer was replaced while its load was pending (closed by a release), wait on the current one instead.
            return layer.prepare(style).then(() => layer3d === layer || closed ? undefined : this.prepare(style));
        },
        invalidate() { version++; layer3d?.invalidate(); },
        render(settings, points, mask) {
            if (isWig3d(settings.style)) { cancelDrop(); return settings.strength === 0 ? { active: false, status: 'off' } : get3d().render(settings, points, mask); }
            scheduleDrop();
            const wig = WIGS.find(w => w.id === settings.style);
            if (!wig || settings.strength === 0) return { active: false, status: 'off' };
            if (!validWigLandmarks(points)) return { active: false, status: 'face-required' };
            const pose = wigPose(points, width, height), fit = fitWig(wig, points, width, height, settings);
            if (!fit) return { active: false, status: 'face-required' };
            if (pose.fade === 0) return { active: false, status: 'angle' };
            if (!images.has(wig.id)) load(wig.id).catch(() => {});
            const entry = images.get(wig.id);
            if (entry.state !== 'ready') return { active: false, status: entry.state };
            const key = JSON.stringify([version, settings, fit, pose.fade]);
            if (key === cacheKey) return cached;
            ctx.clearRect(0, 0, layer.width, layer.height);
            const rx = layer.width / width, ry = layer.height / height;
            ctx.save(); ctx.setTransform(fit.a * rx, fit.b * ry, -fit.b * rx, fit.a * ry, fit.tx * rx, fit.ty * ry);
            ctx.drawImage(entry.image, 0, 0); ctx.restore();
            carveFace(ctx, layer, points);
            const opacity = settings.strength * pose.fade;
            const coverage = sampleCoverage(layer, sample, mask, opacity);
            cacheKey = key;
            cached = { active: true, image: layer, key, opacity, coverage,
                status: pose.fade < 1 ? (coverage.hint ? 'angle-uncovered' : 'angle') : coverage.hint ? 'uncovered' : coverage.known ? 'ready' : 'coverage-unknown' };
            return cached;
        },
        close() {
            closed = true; cancelDrop(); drop3d(); for (const entry of images.values()) { entry.cancel(); entry.image.src = ''; }
            images.clear(); cached = null; cacheKey = null; layer.width = layer.height = sample.width = sample.height = 1;
        },
    };
}
