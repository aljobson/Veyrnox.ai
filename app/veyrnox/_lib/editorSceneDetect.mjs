// Scene detection (ADR-0105 slice A). Pure: no DOM, no media API. The caller decodes frames, shrinks them and passes the RGBA pixels
// to frameSignature(); detectScenes() turns a list of { time, signature } into cut times. Nothing here is shipped to users yet.

export const HIST_BINS = 32;
export const EDGE_BLOCK = 8; // edges are counted per 8 x 8 pixel block, so a shifted edge (camera motion) barely changes the count

export const SCENE_DEFAULTS = Object.freeze({
    histWeight: 0.5,       // share of the histogram distance in the combined frame distance; the rest is edge change
    edgeThreshold: 24,     // luma step that counts as an edge pixel
    windowSeconds: 2,      // neighbourhood for the adaptive threshold
    madFactor: 6,          // a hard cut must beat median + madFactor * MAD of its neighbourhood
    hardFloor: 0.12,       // and never be lower than this combined distance
    minShotSeconds: 0.5,   // cuts closer than this keep only the stronger one
    flashReturnFrames: 6,  // a change that is undone within this many frames is a flash, not a cut
    flashReturnShare: 0.45, // "undone" means the picture is within this share of the jump from where it started
    flashReturnCap: 0.35,   // ... and never farther than this
    duplicateDistance: 0.0005, // frames this alike are one repeated frame (24 fps footage played at 30)
    gradual: true,         // look for dissolves and fades
    gradualSeconds: 0.3,   // compare the frame this far before with the frame this far after
    gradualFloor: 0.5,
});

const lumaOf = (d, i) => (54 * d[i] + 183 * d[i + 1] + 19 * d[i + 2]) >> 8;

// rgba: Uint8ClampedArray of width * height * 4.
export function frameSignature(rgba, width, height, edgeThreshold = SCENE_DEFAULTS.edgeThreshold) {
    if (!rgba || width < 2 || height < 2 || rgba.length < width * height * 4) throw new Error('frameSignature: pixels do not match the size');
    const luma = new Uint8Array(width * height);
    const hist = new Float32Array(HIST_BINS);
    for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
        const y = lumaOf(rgba, i);
        luma[p] = y;
        hist[y >> 3]++;
    }
    for (let b = 0; b < HIST_BINS; b++) hist[b] /= luma.length;
    const bw = Math.ceil(width / EDGE_BLOCK), bh = Math.ceil(height / EDGE_BLOCK);
    const edges = new Uint16Array(bw * bh);
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const p = y * width + x;
            if (Math.abs(luma[p + 1] - luma[p]) + Math.abs(luma[p + width] - luma[p]) > edgeThreshold) edges[((y / EDGE_BLOCK) | 0) * bw + ((x / EDGE_BLOCK) | 0)]++;
        }
    }
    return { hist, edges };
}

// 0 for identical frames, about 1 for frames with nothing in common.
export function signatureDistance(a, b, histWeight = SCENE_DEFAULTS.histWeight) {
    let h = 0;
    for (let i = 0; i < HIST_BINS; i++) h += Math.abs(a.hist[i] - b.hist[i]);
    h /= 2;
    let total = 0, differ = 0;
    for (let i = 0; i < a.edges.length; i++) {
        total += a.edges[i] + b.edges[i];
        differ += Math.abs(a.edges[i] - b.edges[i]);
    }
    const e = total ? differ / total : 0;
    return histWeight * h + (1 - histWeight) * e;
}

function median(values) {
    const s = [...values].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Threshold that follows the footage: busy footage raises it, calm footage lowers it, never below the floor.
function adaptiveThreshold(diffs, index, halfWindow, options) {
    const lo = Math.max(0, index - halfWindow), hi = Math.min(diffs.length, index + halfWindow + 1);
    const local = diffs.slice(lo, hi);
    const med = median(local);
    const mad = median(local.map((v) => Math.abs(v - med)));
    return Math.max(options.hardFloor, med + options.madFactor * Math.max(mad, 0.01));
}

function isLocalMax(values, index, radius) {
    for (let k = Math.max(0, index - radius); k <= Math.min(values.length - 1, index + radius); k++) {
        if (k !== index && values[k] > values[index]) return false;
    }
    return true;
}

// samples: [{ time (seconds), signature }] in time order. Returns { cuts: [{ time, score, kind }], frames }.
export function detectScenes(allSamples, userOptions = {}) {
    const options = { ...SCENE_DEFAULTS, ...userOptions };
    // Repeated frames would make every second distance zero and wreck the adaptive threshold; compare distinct frames only.
    const samples = [];
    for (const sample of allSamples) {
        const last = samples[samples.length - 1];
        if (last && signatureDistance(last.signature, sample.signature, options.histWeight) < options.duplicateDistance) continue;
        samples.push(sample);
    }
    const n = samples.length;
    if (n < 3) return { cuts: [], frames: n };
    const span = (samples[n - 1].time - samples[0].time) / (n - 1) || 1 / 30;
    const perSecond = 1 / span;
    const half = Math.max(2, Math.round(options.windowSeconds * perSecond));
    const minGap = Math.max(1, Math.round(options.minShotSeconds * perSecond));

    // diffs[i] is the change from sample i to sample i + 1; a cut at i + 1.
    const diffs = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) diffs[i] = signatureDistance(samples[i].signature, samples[i + 1].signature, options.histWeight);

    const found = [];
    for (let i = 0; i < diffs.length; i++) {
        if (diffs[i] < adaptiveThreshold(diffs, i, half, options)) continue;
        if (!isLocalMax(diffs, i, Math.max(1, minGap >> 1))) continue;
        // Flash: the picture comes back within a few frames (or the frames just before match the one after), so it was not a new shot.
        const comesBack = Math.min(options.flashReturnCap, options.flashReturnShare * diffs[i]);
        let returned = false;
        for (let j = i + 2; j <= Math.min(n - 1, i + 1 + options.flashReturnFrames) && !returned; j++) {
            returned = signatureDistance(samples[i].signature, samples[j].signature, options.histWeight) < comesBack;
        }
        for (let j = Math.max(0, i - options.flashReturnFrames); j < i && !returned; j++) {
            returned = signatureDistance(samples[j].signature, samples[i + 1].signature, options.histWeight) < comesBack;
        }
        if (returned) continue;
        found.push({ index: i + 1, time: samples[i + 1].time, score: diffs[i], kind: 'hard' });
    }

    if (options.gradual) {
        const g = Math.max(2, Math.round(options.gradualSeconds * perSecond));
        const far = new Array(n).fill(0);
        // The smallest of four endpoint pairs: a flash can spoil one endpoint, but not the endpoint three frames away.
        const nudge = 3;
        for (let i = g + nudge; i < n - g - nudge; i++) {
            let least = Infinity;
            for (const a of [0, nudge]) for (const b of [0, nudge]) {
                least = Math.min(least, signatureDistance(samples[i - g - a].signature, samples[i + g + b].signature, options.histWeight));
            }
            far[i] = least;
        }
        for (let i = g + nudge; i < n - g - nudge; i++) {
            if (far[i] < options.gradualFloor || !isLocalMax(far, i, g)) continue;
            if (found.some((c) => Math.abs(c.index - i) <= g + 1)) continue; // a hard cut already explains this change
            found.push({ index: i, time: samples[i].time, score: far[i], kind: 'gradual' });
        }
    }

    found.sort((a, b) => a.index - b.index);
    const kept = [];
    for (const cut of found) {
        const last = kept[kept.length - 1];
        if (last && cut.index - last.index < minGap) { if (cut.score > last.score) kept[kept.length - 1] = cut; continue; }
        kept.push(cut);
    }
    return { cuts: kept.map(({ time, score, kind }) => ({ time, score, kind })), frames: n };
}

// Precision and recall of detected cut times against hand-marked ones; a detection within toleranceSeconds of an unmatched mark counts.
export function scoreCuts(detected, truth, toleranceSeconds = 0.25) {
    const free = [...truth];
    let hits = 0;
    for (const d of detected) {
        const k = free.findIndex((t) => Math.abs(t - d) <= toleranceSeconds);
        if (k >= 0) { hits++; free.splice(k, 1); }
    }
    return {
        hits,
        detected: detected.length,
        truth: truth.length,
        precision: detected.length ? hits / detected.length : (truth.length ? 1 : 1),
        recall: truth.length ? hits / truth.length : 1,
    };
}
