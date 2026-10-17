// Slice A (ADR-0105) page code: decode a clip sequentially with Mediabunny, shrink each frame, build signatures and time it.
// Detection itself is the shipped pure module, so what is measured here is what a later UI slice would run.
import { Input, BlobSource, ALL_FORMATS, CanvasSink } from './mediabunny.mjs';
import { frameSignature, detectScenes, signatureDistance } from './lib/editorSceneDetect.mjs';
import { detectClipScenes } from './lib/editorSceneRun.mjs';

const WIDTH = 128, HEIGHT = 72;
const heapMB = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);

window.analyse = async function analyse(name, maxSeconds) {
    const blob = await (await fetch(`/media/${name}`)).blob();
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const duration = Math.min(await input.computeDuration(), maxSeconds);
    const sink = new CanvasSink(track, { width: WIDTH, height: HEIGHT, fit: 'fill' });
    const scratch = new OffscreenCanvas(WIDTH, HEIGHT);
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    const samples = [];
    const heapBefore = heapMB();
    let heapPeak = heapBefore || 0, decodeSignatureMs = 0;
    const t0 = performance.now();
    for await (const wrapped of sink.canvases(0, duration)) {
        const a = performance.now();
        ctx.drawImage(wrapped.canvas, 0, 0);
        const px = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
        samples.push({ time: wrapped.timestamp, signature: frameSignature(px, WIDTH, HEIGHT) });
        decodeSignatureMs += performance.now() - a;
        const h = heapMB();
        if (h && h > heapPeak) heapPeak = h;
    }
    const wallMs = performance.now() - t0;
    window.__samples = samples;
    window.__blob = blob;
    return {
        name, duration, frames: samples.length, width: track.displayWidth, height: track.displayHeight, codec: track.codec,
        wallMs, signatureMs: decodeSignatureMs, heapPeakMB: heapPeak, heapBeforeMB: heapBefore,
    };
};

// The shipped helper (what the editor will call) on the same clip; its cuts must equal the harness detection above.
window.shipped = async (frames) => {
    const r = await detectClipScenes(window.__blob, { in: 0, len: frames });
    return r.cuts.map((c) => `${c.time.toFixed(2)}${c.kind === 'gradual' ? 'g' : ''}`);
};

window.detect = (options, stride = 1) => {
    const picked = window.__samples.filter((_, i) => i % stride === 0);
    const t = performance.now();
    const result = detectScenes(picked, options);
    return { ...result, detectMs: performance.now() - t };
};
window.scenesReady = true;

// Diagnostics for tuning: adjacent distances and the 0.3 s apart distance around the given times.
window.series = (from, to, gap = 9) => {
    const s = window.__samples, out = [];
    for (let i = gap; i < s.length - gap; i++) {
        if (s[i].time < from || s[i].time > to) continue;
        out.push([s[i].time.toFixed(2), signatureDistance(s[i - 1].signature, s[i].signature).toFixed(3), signatureDistance(s[i - gap].signature, s[i + gap].signature).toFixed(3)].join(' '));
    }
    return out;
};
