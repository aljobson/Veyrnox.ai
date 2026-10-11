import { assertPicture } from './editorMotionAnalysis.mjs';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function assertVisionMasks(masks) {
    if (!masks || !Number.isInteger(masks.width) || !Number.isInteger(masks.height) || masks.width < 8 || masks.height < 8 || Math.max(masks.width, masks.height) > 512 || !['background', 'face', 'body'].every(k => masks[k] instanceof Float32Array && masks[k].length === masks.width * masks.height)) throw new Error('Choose bounded segmentation masks.');
}
function sample(masks, channel, x, y) {
    const fx = clamp(x * masks.width - .5, 0, masks.width - 1), fy = clamp(y * masks.height - .5, 0, masks.height - 1), ix = Math.floor(fx), iy = Math.floor(fy), nx = Math.min(ix + 1, masks.width - 1), ny = Math.min(iy + 1, masks.height - 1), dx = fx - ix, dy = fy - iy, values = masks[channel];
    return clamp(values[iy * masks.width + ix] * (1 - dx) * (1 - dy) + values[iy * masks.width + nx] * dx * (1 - dy) + values[ny * masks.width + ix] * (1 - dx) * dy + values[ny * masks.width + nx] * dx * dy, 0, 1);
}
/** Confidence matte: clear uncertain background haze while keeping soft subject edges. */
function foregroundCoverage(background) {
    const confidence = clamp(((1 - background) - .2) / .6, 0, 1);
    return confidence * confidence * (3 - 2 * confidence);
}
/** Largest connected person region; no biometric identity or arbitrary subject recognition. */
export function personFraming(masks) {
    assertVisionMasks(masks);
    const width = masks.width, height = masks.height, seen = new Uint8Array(width * height), queue = new Uint32Array(width * height), components = [];
    for (let seed = 0; seed < seen.length; seed++) {
        if (seen[seed] || masks.background[seed] >= .4) continue;
        let begin = 0, end = 1, sumX = 0, sumY = 0, confidence = 0, faceX = 0, faceWeight = 0, facePixels = 0, minX = width, minY = height, maxX = 0, maxY = 0; queue[0] = seed; seen[seed] = 1;
        while (begin < end) {
            const at = queue[begin++], x = at % width, y = Math.floor(at / width); sumX += x + .5; sumY += y + .5; confidence += 1 - masks.background[at]; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            if (masks.face[at] >= .6) { faceX += (x + .5) * masks.face[at]; faceWeight += masks.face[at]; facePixels++; }
            for (const next of [x ? at - 1 : -1, x + 1 < width ? at + 1 : -1, y ? at - width : -1, y + 1 < height ? at + width : -1]) if (next >= 0 && !seen[next] && masks.background[next] < .4) { seen[next] = 1; queue[end++] = next; }
        }
        if (end >= Math.max(12, width * height * .01)) {
            // Clothing can pull the body centroid sideways and cut off the face in
            // portrait output. Only a confident face inside this same connected
            // person region anchors x; weak/no face retains the whole-person centre.
            const faceAnchor = facePixels >= Math.max(8, width * height * .003);
            components.push({ x: faceAnchor ? faceX / faceWeight / width : sumX / end / width, y: sumY / end / height, anchor: faceAnchor ? 'face' : 'person', confidence: confidence / end, area: end / (width * height), bounds: { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height } });
        }
    }
    components.sort((a, b) => b.area - a.area);
    return components.length ? { found: true, ...components[0], regions: components.length } : { found: false, x: .5, y: .5, confidence: 0, area: 0, regions: 0 };
}
export function validateVisionSettings(settings) {
    if (!settings || !['remove-background', 'replace-background', 'skin-retouch', 'person-glow'].includes(settings.tool)) return 'Choose a person processing tool.';
    if (!Number.isFinite(settings.strength ?? 1) || (settings.strength ?? 1) < 0 || (settings.strength ?? 1) > 1) return 'Choose an intensity from 0 to 1.';
    if (settings.tool === 'skin-retouch' && !['face', 'body', 'both'].includes(settings.region ?? 'face')) return 'Choose face, body or both skin regions.';
    if (settings.light !== undefined && (!Number.isFinite(settings.light) || settings.light < -.5 || settings.light > .5)) return 'Choose a bounded skin light adjustment.';
    if (settings.colour !== undefined && (!Array.isArray(settings.colour) || settings.colour.length !== 3 || !settings.colour.every(v => Number.isInteger(v) && v >= 0 && v <= 255))) return 'Choose a valid processing colour.';
    return null;
}
/** Original compositing and edge-preserving skin smoothing driven by real semantic masks. */
export function processVisionPixels(frame, masks, settings) {
    assertPicture(frame, 4); assertVisionMasks(masks);
    const problem = validateVisionSettings(settings); if (problem) throw new Error(problem);
    const strength = settings.strength ?? 1, colour = settings.colour ?? (settings.tool === 'person-glow' ? [50, 214, 197] : [16, 24, 39]), data = new Uint8ClampedArray(frame.data);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const p = (y * frame.width + x) * 4, mx = (x + .5) / frame.width, my = (y + .5) / frame.height;
        if (settings.tool === 'remove-background') {
            data[p + 3] = frame.data[p + 3] * (1 - (1 - foregroundCoverage(sample(masks, 'background', mx, my))) * strength);
        } else if (settings.tool === 'replace-background') {
            const background = (1 - foregroundCoverage(sample(masks, 'background', mx, my))) * strength;
            for (let c = 0; c < 3; c++) data[p + c] = frame.data[p + c] * (1 - background) + colour[c] * background;
        } else if (settings.tool === 'skin-retouch') {
            const region = settings.region ?? 'face', skin = Math.min(1, (region === 'body' ? 0 : sample(masks, 'face', mx, my)) + (region === 'face' ? 0 : sample(masks, 'body', mx, my))), amount = skin * strength;
            if (amount < .02) continue;
            const sums = [0, 0, 0]; let sumWeight = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = clamp(x + dx, 0, frame.width - 1), ny = clamp(y + dy, 0, frame.height - 1), at = (ny * frame.width + nx) * 4; let distance = 0;
                for (let c = 0; c < 3; c++) distance += (frame.data[at + c] - frame.data[p + c]) ** 2;
                const weight = Math.exp(-distance / (2 * 28 ** 2)) * (dx === 0 && dy === 0 ? 1 : .6);
                sumWeight += weight; for (let c = 0; c < 3; c++) sums[c] += frame.data[at + c] * weight;
            }
            for (let c = 0; c < 3; c++) data[p + c] = (frame.data[p + c] * (1 - amount) + sums[c] / sumWeight * amount) * (1 + (settings.light ?? 0) * skin);
        } else {
            const foreground = 1 - sample(masks, 'background', mx, my), near = Math.max(...[[-3, 0], [3, 0], [0, -3], [0, 3]].map(([dx, dy]) => 1 - sample(masks, 'background', mx + dx / masks.width, my + dy / masks.height))), glow = Math.max(0, near - foreground) * strength * .8;
            for (let c = 0; c < 3; c++) data[p + c] = frame.data[p + c] * (1 - glow) + colour[c] * glow;
        }
    }
    return { width: frame.width, height: frame.height, data };
}
