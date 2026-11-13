import { MAKEUP } from '../../../../packages/live-edit/makeup.js';
import { OVAL, LIPS, INNER_LIPS, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LEFT_UPPER_EYE, RIGHT_UPPER_EYE, polygonFromLandmarks } from '../../../../packages/live-edit/regions.js';
const mean = vertices => vertices.reduce((a, p) => [a[0] + p[0] / vertices.length, a[1] + p[1] / vertices.length], [0, 0]);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
/** Bounded masks: R coverage, G local gradient/specular coordinate. Holes cut last. */
export function createMakeupMasks(width, height, points, settings) {
    const scale = Math.min(1, 512 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = new Uint8Array(w * h * 4 * MAKEUP.length);
    const valid = points instanceof Float32Array && points.length === 1434 && points.every(Number.isFinite);
    const polygon = (indices, expansion = 1) => polygonFromLandmarks(points, indices, expansion).map(([x, y]) => [x * w, y * h]);
    function path(vertices) {
        ctx.beginPath(); vertices.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    }
    function fill(vertices, paint = '#ffff00') { path(vertices); ctx.fillStyle = paint; ctx.fill(); }
    function gradient(a, b) { const g = ctx.createLinearGradient(...a, ...b); g.addColorStop(0, '#ff0000'); g.addColorStop(1, '#ffff00'); return g; }
    if (valid) {
        const oval = polygon(OVAL), faceCenter = mean(oval);
        const sides = [[LEFT_EYE, LEFT_BROW, LEFT_UPPER_EYE], [RIGHT_EYE, RIGHT_BROW, RIGHT_UPPER_EYE]].map(([eye, brow, upper]) => {
            const e = polygon(eye), b = polygon(brow), u = polygon(upper);
            const center = mean(e), browCenter = mean(b), up = browCenter.map((v, i) => v - center[i]);
            return { e, b, u, center, browCenter, up, span: Math.hypot(u[0][0] - u.at(-1)[0], u[0][1] - u.at(-1)[1]) };
        });
        MAKEUP.forEach(({ id }, layer) => {
            ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
            if (id === 'foundation') fill(polygon(OVAL, .94));
            if (id === 'lips') {
                const lips = polygon(LIPS), inner = mean(polygon(INNER_LIPS));
                // Face-local vertical axis follows roll, using eye centre toward mouth.
                const eyes = mean(sides.map(s => s.center)), axis = inner.map((v, i) => v - eyes[i]);
                const length = Math.hypot(...axis) || 1, direction = axis.map(v => v / length);
                const projections = lips.map(p => (p[0] - inner[0]) * direction[0] + (p[1] - inner[1]) * direction[1]);
                const a = inner.map((v, i) => v + direction[i] * Math.min(...projections));
                const b = inner.map((v, i) => v + direction[i] * Math.max(...projections));
                fill(lips, gradient(a, b));
            }
            for (const s of sides) {
                if (id === 'brows') fill(s.b);
                if (id === 'blush') {
                    const center = s.center.map((v, i) => v - s.up[i] * 1.25 + (v - faceCenter[i]) * .12);
                    const radius = s.span * .8;
                    const g = ctx.createRadialGradient(...center, 0, ...center, radius);
                    g.addColorStop(0, '#ffff00'); g.addColorStop(1, '#000000');
                    ctx.save(); path(polygon(OVAL, .92)); ctx.clip(); ctx.fillStyle = g;
                    ctx.fillRect(center[0] - radius, center[1] - radius, radius * 2, radius * 2); ctx.restore();
                }
                if (id === 'eyeshadow') {
                    const raised = s.u.map((p, i) => p.map((v, j) => v + s.up[j] * .65 * Math.sin(Math.PI * i / (s.u.length - 1))));
                    fill([...s.u, ...raised.reverse()], gradient(s.center, mix(s.center, s.browCenter, .65)));
                }
                if (id === 'eyeliner') {
                    const outer = s.u.map(p => p.map((v, j) => v + s.up[j] * .18));
                    fill([...s.u, ...outer.reverse()]);
                    const corner = s.u[0], inner = s.u.at(-1), wing = settings.eyeliner.wing;
                    const tip = corner.map((v, j) => v + (v - inner[j]) * wing * .5 + s.up[j] * wing * .4);
                    fill([corner, tip, corner.map((v, j) => v + s.up[j] * .25)]);
                }
                if (id === 'lashes') {
                    const volume = settings.lashes.volume;
                    // Tapered individual lashes grow outwards from the upper contour.
                    s.u.slice(1, -1).forEach((p, i) => {
                        const base = p.map((v, j) => v + s.up[j] * .08);
                        const tip = base.map((v, j) => v + s.up[j] * (.18 + volume * .45) + (p[j] - s.center[j]) * .12);
                        const tangent = s.u[i + 2].map((v, j) => (v - s.u[i][j]) * (.05 + volume * .16));
                        fill([base.map((v, j) => v - tangent[j]), tip, base.map((v, j) => v + tangent[j])]);
                    });
                }
            }
            // Remove coverage, not alpha alone: array upload ignores alpha when sampling R/G.
            // Expanded eye/mouth holes include an extra mask texel to prevent linear-filter bleed.
            ctx.fillStyle = '#000000'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
            const holes = id === 'lips' ? [INNER_LIPS, LEFT_EYE, RIGHT_EYE] : [LIPS, LEFT_EYE, RIGHT_EYE];
            if (id === 'foundation' || id === 'blush') holes.push(LEFT_BROW, RIGHT_BROW);
            for (const indices of holes) { path(polygon(indices)); ctx.fill(); ctx.stroke(); }
            const rgba = ctx.getImageData(0, 0, w, h).data;
            // Canvas returns straight RGB: fold antialias alpha into coverage, retaining G's coordinate.
            for (let i = 0; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * rgba[i + 3] / 255);
            data.set(rgba, layer * w * h * 4);
        });
    }
    canvas.width = canvas.height = 1;
    return { width: w, height: h, data };
}
