// Original local motion estimates. Integer block matching is deliberately bounded;
// it cannot recover motion outside the search radius, rotation or occluded subjects.
export const MOTION_ANALYSIS_EDGE = 160;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const motionAbort = () => Object.assign(new Error('Picture processing cancelled.'), { name: 'AbortError' });
export function checkMotionSignal(signal) { if (signal?.aborted) throw motionAbort(); }
export function assertPicture(picture, channels = 1, maxEdge = 1280) {
    if (!picture || !Number.isInteger(picture.width) || !Number.isInteger(picture.height) || picture.width < 8 || picture.height < 8 || Math.max(picture.width, picture.height) > maxEdge || picture.data?.length !== picture.width * picture.height * channels) throw new Error('Choose a supported picture size.');
}
export function grayscale(picture) {
    assertPicture(picture, 4);
    const data = new Float32Array(picture.width * picture.height);
    for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = (picture.data[p] * .2126 + picture.data[p + 1] * .7152 + picture.data[p + 2] * .0722) / 255;
    return { width: picture.width, height: picture.height, data };
}
export function meanLuminance(frame) {
    assertPicture(frame);
    let sum = 0, count = 0;
    for (let i = 0; i < frame.data.length; i++) if (frame.data[i] > .025 && frame.data[i] < .975) { sum += frame.data[i]; count++; }
    return count ? sum / count : .5;
}
/** Coarse exposure-normalized structure survives fine texture lost to video compression. */
export function exposureStructureCorrelation(a, b) {
    assertPicture(a, 1, 256); assertPicture(b, 1, 256);
    if (a.width !== b.width || a.height !== b.height) throw new Error('Choose matching picture bounds.');
    const block = Math.max(2, Math.min(8, Math.floor(Math.min(a.width, a.height) / 4)));
    let sumA = 0, sumB = 0, squareA = 0, squareB = 0, product = 0, count = 0;
    for (let y = 0; y + block <= a.height; y += block) for (let x = 0; x + block <= a.width; x += block) {
        let av = 0, bv = 0;
        for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) { const at = (y + dy) * a.width + x + dx; av += a.data[at]; bv += b.data[at]; }
        av /= block * block; bv /= block * block;
        sumA += av; sumB += bv; squareA += av * av; squareB += bv * bv; product += av * bv; count++;
    }
    const varianceA = squareA / count - (sumA / count) ** 2, varianceB = squareB / count - (sumB / count) ** 2;
    return varianceA > 1e-10 && varianceB > 1e-10 ? clamp((product / count - sumA * sumB / count ** 2) / Math.sqrt(varianceA * varianceB), -1, 1) : 0;
}
/** A cut veto requires matching coarse structure and a substantial exposure change. */
export function retainsExposureStructure(a, b) {
    return Math.abs(Math.log(Math.max(.03, meanLuminance(a)) / Math.max(.03, meanLuminance(b)))) >= .15 && exposureStructureCorrelation(a, b) >= .6;
}
export function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function patchStats(frame, x, y, radius) {
    let mean = 0, variance = 0, n = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { const value = frame.data[(y + dy) * frame.width + x + dx]; mean += value; variance += value * value; n++; }
    return { mean: mean / n, variance: Math.max(0, variance / n - (mean / n) ** 2) };
}
function patchError(a, b, x, y, dx, dy, radius, statsA) {
    let product = 0, sumB = 0, squareB = 0, n = 0;
    for (let py = -radius; py <= radius; py++) for (let px = -radius; px <= radius; px++) { const av = a.data[(y + py) * a.width + x + px], bv = b.data[(y + dy + py) * b.width + x + dx + px]; product += av * bv; sumB += bv; squareB += bv * bv; n++; }
    const meanB = sumB / n, variance = Math.max(0, squareB / n - meanB ** 2), covariance = product / n - statsA.mean * meanB;
    // Zero-mean normalized correlation is invariant to uniform gain and offset.
    // Exposure flicker must not look like either camera motion or a scene cut.
    const correlation = variance > .0003 ? clamp(covariance / Math.sqrt(statsA.variance * variance), -1, 1) : 0;
    return { error: 1 - correlation, variance };
}
/** Motion of a textured patch from a to b. Coordinates and vectors use analysis pixels. */
export function matchMotionPatch(a, b, x, y, { radius = 4, search = 10, predictedX = 0, predictedY = 0, signal } = {}) {
    assertPicture(a, 1, 256); assertPicture(b, 1, 256);
    if (a.width !== b.width || a.height !== b.height || !Number.isInteger(radius) || radius < 2 || radius > 10 || !Number.isInteger(search) || search < 1 || search > 20) throw new Error('Choose bounded motion analysis settings.');
    checkMotionSignal(signal);
    x = clamp(Math.round(x), radius, a.width - radius - 1); y = clamp(Math.round(y), radius, a.height - radius - 1);
    const stats = patchStats(a, x, y, radius);
    if (stats.variance < .0003) return { x: 0, y: 0, confidence: 0, error: 1, textured: false };
    let best = Infinity, bestX = 0, bestY = 0, bestVariance = 0;
    const px = Math.round(predictedX), py = Math.round(predictedY);
    for (let dy = py - search; dy <= py + search; dy++) {
        checkMotionSignal(signal);
        if (y + dy < radius || y + dy >= b.height - radius) continue;
        for (let dx = px - search; dx <= px + search; dx++) {
            if (x + dx < radius || x + dx >= b.width - radius) continue;
            const result = patchError(a, b, x, y, dx, dy, radius, stats);
            // Prefer shorter vectors only when errors are effectively identical.
            const score = result.error + (dx * dx + dy * dy) * 1e-10;
            if (score < best) { best = score; bestX = dx; bestY = dy; bestVariance = result.variance; }
        }
    }
    const energy = Math.min(stats.variance, bestVariance), error = Number.isFinite(best) ? best : 1;
    return { x: bestX, y: bestY, confidence: energy < .0003 ? 0 : clamp(1 - error * 3, 0, 1), error, textured: true };
}
/** Grid flow estimates local image displacement, rather than crossfading unaligned frames. */
export function estimateBlockFlow(a, b, { step = 12, radius = 4, search = 10, signal } = {}) {
    assertPicture(a, 1, 256); assertPicture(b, 1, 256);
    if (!Number.isInteger(step) || step < 6 || step > 24) throw new Error('Choose a bounded optical-flow grid.');
    const columns = Math.max(2, Math.ceil(a.width / step)), rows = Math.max(2, Math.ceil(a.height / step));
    const vectors = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
        const x = clamp(i * step + step / 2, radius, a.width - radius - 1), y = clamp(j * step + step / 2, radius, a.height - radius - 1);
        vectors.push(matchMotionPatch(a, b, x, y, { radius, search, signal }));
    }
    return { width: a.width, height: a.height, step, columns, rows, vectors };
}
export function globalMotion(flow) {
    const textured = flow.vectors.filter(v => v.textured !== false), trusted = textured.filter(v => v.confidence >= .45);
    const cut = textured.length / flow.vectors.length > .12 && trusted.length / Math.max(1, textured.length) < .12;
    if (trusted.length < 3) return { x: 0, y: 0, confidence: 0, cut, unknown: true };
    const x = median(trusted.map(v => v.x)), y = median(trusted.map(v => v.y));
    const inliers = trusted.filter(v => Math.hypot(v.x - x, v.y - y) <= 2), confidence = inliers.length / flow.vectors.length;
    // A small moving subject alone cannot establish camera displacement.
    return { x: confidence >= .25 ? x : 0, y: confidence >= .25 ? y : 0, confidence, cut, unknown: confidence < .25 };
}
/** Piecewise linear flow, confidence included so flat or occluded regions can fall back honestly. */
export function flowAt(flow, x, y) {
    const gx = clamp(x / flow.step - .5, 0, flow.columns - 1), gy = clamp(y / flow.step - .5, 0, flow.rows - 1), ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const out = { x: 0, y: 0, confidence: 0 };
    for (const [cx, cy, weight] of [[ix, iy, (1 - fx) * (1 - fy)], [Math.min(ix + 1, flow.columns - 1), iy, fx * (1 - fy)], [ix, Math.min(iy + 1, flow.rows - 1), (1 - fx) * fy], [Math.min(ix + 1, flow.columns - 1), Math.min(iy + 1, flow.rows - 1), fx * fy]]) {
        const vector = flow.vectors[cy * flow.columns + cx]; out.x += vector.x * weight; out.y += vector.y * weight; out.confidence += vector.confidence * weight;
    }
    return out;
}
function segments(items) {
    const ranges = []; let start = 0;
    for (let i = 1; i < items.length; i++) if (items[i].cut) { ranges.push([start, i]); start = i; }
    ranges.push([start, items.length]); return ranges;
}
/** Smooth within a shot; cuts never smear exposure or camera trajectories into the next shot. */
export function smoothMotionPath(samples, radius = 10) {
    if (!Array.isArray(samples) || samples.length > 1800 || !Number.isInteger(radius) || radius < 0 || radius > 30) throw new Error('Choose a bounded picture-processing window.');
    const result = samples.map(s => ({ ...s }));
    for (const [start, end] of segments(samples)) for (let i = start; i < end; i++) {
        let x = 0, y = 0, exposure = 0, n = 0;
        for (let j = Math.max(start, i - radius); j <= Math.min(end - 1, i + radius); j++) { x += samples[j].x; y += samples[j].y; exposure += Math.log(Math.max(.03, samples[j].luminance)); n++; }
        result[i].smoothX = x / n; result[i].smoothY = y / n;
        result[i].correctionX = x / n - samples[i].x; result[i].correctionY = y / n - samples[i].y;
        result[i].gain = clamp(Math.exp(exposure / n) / Math.max(.03, samples[i].luminance), .5, 2);
    }
    return result;
}
/** Follow a user-selected textured region; no claim of semantic person detection. */
export function trackMotionRegion(a, b, region, { search = 12, signal } = {}) {
    if (!region || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(region[k]) && region[k] >= 0 && region[k] <= 1) || region.width < .05 || region.height < .05 || region.x + region.width > 1 || region.y + region.height > 1) throw new Error('Select a subject region inside the picture.');
    const radius = clamp(Math.floor(Math.min(region.width * a.width, region.height * a.height) / 2) - 1, 2, 10);
    const match = matchMotionPatch(a, b, (region.x + region.width / 2) * a.width, (region.y + region.height / 2) * a.height, { radius, search, signal });
    const tracked = match.confidence >= .5;
    return { ...region, x: clamp(region.x + (tracked ? match.x / a.width : 0), 0, 1 - region.width), y: clamp(region.y + (tracked ? match.y / a.height : 0), 0, 1 - region.height), confidence: match.confidence, tracked };
}
