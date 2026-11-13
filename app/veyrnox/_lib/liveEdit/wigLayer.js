import { WIGS } from '../../../../packages/live-edit/wigs.js';
import { fitWig, protectedFace, wigPose, wigCoverage, wigEdgeAlpha, validWigLandmarks } from '../../../../packages/live-edit/wigFit.js';
import { polygonFromLandmarks, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS } from '../../../../packages/live-edit/regions.js';

/** Same-origin SVG images, like public/photo-studio/stickers; no page WASM or remote art. */
export function createWigLayer(width, height, onChange = () => {}) {
    const images = new Map(), layer = document.createElement('canvas'), sample = document.createElement('canvas');
    const ratio = Math.min(1, 1024 / Math.max(width, height));
    layer.width = Math.max(1, Math.round(width * ratio)); layer.height = Math.max(1, Math.round(height * ratio));
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    let closed = false, version = 0, cacheKey, cached;
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
    function polygon(vertices) {
        if (!vertices.length) return;
        ctx.beginPath(); vertices.forEach(([x, y], i) => i ? ctx.lineTo(x * layer.width, y * layer.height) : ctx.moveTo(x * layer.width, y * layer.height));
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    return {
        prepare: load,
        invalidate() { version++; },
        render(settings, points, mask) {
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
            // Subtraction is ONLY from the overlay. The source photograph is never masked out.
            ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
            polygon(protectedFace(points));
            for (const indices of [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS]) polygon(polygonFromLandmarks(points, indices, 1.15));
            ctx.restore();
            let coverage = { known: false, hint: false, fraction: 0 };
            const opacity = settings.strength * pose.fade;
            if (mask) {
                sample.width = mask.width; sample.height = mask.height;
                const sc = sample.getContext('2d', { willReadFrequently: true }); sc.drawImage(layer, 0, 0, sample.width, sample.height);
                const data = sc.getImageData(0, 0, sample.width, sample.height).data;
                coverage = wigCoverage(mask, Float32Array.from(mask.hair, (_, i) => wigEdgeAlpha(data[i * 4 + 3] / 255, Math.round(mask.hair[i] * 255) / 255)), opacity);
            }
            cacheKey = key;
            cached = { active: true, image: layer, key, opacity, coverage,
                status: pose.fade < 1 ? (coverage.hint ? 'angle-uncovered' : 'angle') : coverage.hint ? 'uncovered' : coverage.known ? 'ready' : 'coverage-unknown' };
            return cached;
        },
        close() {
            closed = true; for (const entry of images.values()) { entry.cancel(); entry.image.src = ''; }
            images.clear(); cached = null; cacheKey = null; layer.width = layer.height = sample.width = sample.height = 1;
        },
    };
}
