// Slice 0 spike (ADR-0080): can the pinned Mediabunny 1.60.0 decode several clips at once, composite them with a text layer on a
// canvas, mix audio, and write one MP4, entirely in the browser? Not production code and not shipped: it exists to measure.
// Served by run.mjs, which maps ./mediabunny.mjs to node_modules/mediabunny/dist/bundles/mediabunny.min.mjs.
import * as MB from './mediabunny.mjs';

const {
    Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat,
    CanvasSink, CanvasSource, AudioBufferSink, AudioBufferSource, canEncodeVideo, canEncodeAudio, QUALITY_HIGH,
} = MB;

const SAMPLE_RATE = 48000;
const inputs = new Map();

async function open(name) {
    if (!inputs.has(name)) {
        const res = await fetch(`/media/${name}`);
        if (!res.ok) throw new Error(`fixture ${name}: HTTP ${res.status}`);
        inputs.set(name, new Input({ source: new BlobSource(await res.blob()), formats: ALL_FORMATS }));
    }
    return inputs.get(name);
}

const heapMB = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);

// Sequential reader: Mediabunny's docs say canvasesAtTimestamps() is for sparse access and canvases() for sequential access, which is
// what playback and export are. Keeps the frame at or before the asked time (repeats or drops frames when rates differ).
class Reader {
    constructor(sink, start, end) { this.it = sink.canvases(start, end); this.cur = null; this.nxt = null; this.done = false; }
    async at(t) {
        if (!this.cur && !this.done) { const r = await this.it.next(); if (r.done) this.done = true; else this.cur = r.value; }
        while (!this.done) {
            if (!this.nxt) { const r = await this.it.next(); if (r.done) { this.done = true; break; } this.nxt = r.value; }
            if (this.nxt.timestamp <= t + 1e-6) { this.cur = this.nxt; this.nxt = null; } else break;
        }
        return this.cur ? this.cur.canvas : null;
    }
}

// The timeline an editor would hold. Times are seconds; a clip plays source [in, out) at timeline `start`.
// `fadeIn` is a crossfade over the previous clip; `fadeOut` is the matching audio ramp on the clip being faded out.
function frameTimes(clip, fps) {
    const first = Math.ceil(clip.start * fps - 1e-9);
    const last = Math.ceil((clip.start + clip.out - clip.in) * fps - 1e-9);
    return { first, last };
}

async function mixAudio(scenario) {
    const length = Math.ceil(scenario.duration * SAMPLE_RATE);
    const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
    const layers = [...scenario.clips.map(c => ({ ...c, kind: 'clip' })), ...(scenario.audio || []).map(a => ({ ...a, kind: 'audio' }))];
    let used = 0;
    for (const layer of layers) {
        if (layer.mute) continue;
        const track = await (await open(layer.src)).getPrimaryAudioTrack();
        if (!track) continue;
        if (!await track.canDecode()) throw new Error(`audio of ${layer.src} cannot be decoded here`);
        const len = layer.out - layer.in, end = layer.start + len;
        const gain = ctx.createGain();
        gain.gain.value = layer.gain ?? 1;
        if (layer.fadeIn) { gain.gain.setValueAtTime(0, layer.start); gain.gain.linearRampToValueAtTime(layer.gain ?? 1, layer.start + layer.fadeIn); }
        if (layer.fadeOut) { gain.gain.setValueAtTime(layer.gain ?? 1, end - layer.fadeOut); gain.gain.linearRampToValueAtTime(0, end); }
        gain.connect(ctx.destination);
        for await (const wrapped of new AudioBufferSink(track).buffers(layer.in, layer.out)) {
            const node = ctx.createBufferSource();
            node.buffer = wrapped.buffer;
            node.connect(gain);
            let when = layer.start + (wrapped.timestamp - layer.in), offset = 0;
            if (when < layer.start) { offset = layer.start - when; when = layer.start; }
            node.start(when, offset);
            node.stop(end);
        }
        used += 1;
    }
    return { buffer: used ? await ctx.startRendering() : null, layers: used };
}

function slice(mix, from, to) {
    const out = new AudioBuffer({ length: to - from, sampleRate: SAMPLE_RATE, numberOfChannels: 2 });
    for (let ch = 0; ch < 2; ch++) out.copyToChannel(mix.getChannelData(ch).subarray(from, to), ch);
    return out;
}

// Warm-up with the library itself: a throwaway 6-frame export at the target size and quality (a raw WebCodecs encoder did not help:
// the cost sits in Mediabunny's own encoder start-up, so the warm-up has to use the same path).
async function prewarm(width, height, fps) {
    const t = performance.now();
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d');
    const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH, keyFrameInterval: 2 });
    out.addVideoTrack(video, { frameRate: fps });
    await out.start();
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#222' : '#ddd'; g.fillRect(0, 0, width, height); await video.add(i / fps, 1 / fps); }
    video.close();
    await out.finalize();
    return Math.round(performance.now() - t);
}

async function render(scenario, { cancelAfterMs, prewarmFirst } = {}) {
    const { width: W, height: H, fps, duration } = scenario;
    const result = { name: scenario.name, ok: false, stage: 'caps', heapStartMB: heapMB(), peakHeapMB: heapMB() };
    if (prewarmFirst) {
        // What an editor would do on open: warm the encoder, and decode a first frame of each clip as it is added to the timeline.
        const tw = performance.now();
        result.prewarmEncoderMs = await prewarm(scenario.width, scenario.height, scenario.fps);
        for (const name of new Set(scenario.clips.map(c => c.src))) {
            const track = await (await open(name)).getPrimaryVideoTrack();
            if (track && await track.canDecode()) await new CanvasSink(track).getCanvas(0);
        }
        result.prewarmMs = Math.round(performance.now() - tw);
    }
    const t0 = performance.now();
    let output, cancelled = false, cancelAt = 0;
    const controller = new AbortController();
    if (cancelAfterMs) setTimeout(() => { cancelAt = performance.now(); cancelled = true; controller.abort(); }, cancelAfterMs);
    try {
        result.caps = {
            avc: await canEncodeVideo('avc', { width: W, height: H, quality: QUALITY_HIGH }),
            aac: await canEncodeAudio('aac'),
        };
        if (!result.caps.avc || !result.caps.aac) throw new Error('this browser cannot encode H.264 + AAC at this size');

        result.stage = 'open';
        const tOpen = performance.now();
        const canvas = new OffscreenCanvas(W, H);
        const g = canvas.getContext('2d');
        const clips = [];
        for (const c of scenario.clips) {
            const track = await (await open(c.src)).getPrimaryVideoTrack();
            if (!track) throw new Error(`${c.src} has no video track`);
            if (!await track.canDecode()) throw new Error(`video of ${c.src} cannot be decoded here`);
            const { first, last } = frameTimes(c, fps);
            const sink = new CanvasSink(track, { poolSize: scenario.poolSize ?? 6 });
            clips.push({ ...c, first, last, reader: new Reader(sink, c.in, c.out), lastFrame: null });
        }

        result.openMs = Math.round(performance.now() - tOpen);
        result.stage = 'audio';
        const tAudio = performance.now();
        const { buffer: mix, layers } = await mixAudio(scenario);
        result.audioLayers = layers;
        result.audioMixMs = Math.round(performance.now() - tAudio);

        result.stage = 'encode';
        output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
        const video = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH, keyFrameInterval: 2, ...(scenario.hw ? { hardwareAcceleration: scenario.hw } : {}) });
        output.addVideoTrack(video, { frameRate: fps });
        const audio = mix ? new AudioBufferSource({ codec: 'aac', bitrate: 128000 }) : null;
        if (audio) output.addAudioTrack(audio);
        await output.start();
        result.startMs = Math.round(performance.now() - t0);

        const total = Math.round(duration * fps);
        const perSecond = [];
        let secondStart = performance.now(), audioDone = 0, acc = { dec: 0, draw: 0, add: 0 };
        const phases = [];
        const flushAudio = async upto => {
            while (audio && audioDone < Math.min(upto, mix.length)) {
                const to = Math.min(audioDone + SAMPLE_RATE, mix.length, upto);
                await audio.add(slice(mix, audioDone, to));
                audioDone = to;
            }
        };
        for (let i = 0; i < total; i++) {
            if (controller.signal.aborted) break;
            const t = i / fps;
            g.fillStyle = '#000';
            g.fillRect(0, 0, W, H);
            for (const c of clips) {
                if (i < c.first || i >= c.last) continue;
                const tDec = performance.now();
                const frame = await c.reader.at(c.in + (t - c.start));
                acc.dec += performance.now() - tDec;
                if (!result.firstDecodeMs) result.firstDecodeMs = Math.round(performance.now() - tDec);
                if (frame) c.lastFrame = frame;
                if (!c.lastFrame) continue;
                const s = Math.min(W / c.lastFrame.width, H / c.lastFrame.height);
                g.globalAlpha = c.fadeIn && t - c.start < c.fadeIn ? Math.max(0, (t - c.start) / c.fadeIn) : 1;
                g.drawImage(c.lastFrame, (W - c.lastFrame.width * s) / 2, (H - c.lastFrame.height * s) / 2, c.lastFrame.width * s, c.lastFrame.height * s);
                g.globalAlpha = 1;
            }
            for (const x of scenario.texts || []) {
                if (t < x.from || t >= x.to) continue;
                g.font = `bold ${x.size}px system-ui, sans-serif`;
                g.textAlign = 'center';
                g.lineWidth = Math.max(2, x.size / 12);
                g.strokeStyle = '#000';
                g.fillStyle = '#fff';
                g.strokeText(x.text, W * x.x, H * x.y);
                g.fillText(x.text, W * x.x, H * x.y);
            }
            const tAdd = performance.now();
            await video.add(t, 1 / fps);
            const addMs = Math.round(performance.now() - tAdd);
            acc.add += addMs;
            if (i === 0) result.firstAddMs = addMs;
            if (addMs > (result.maxAddMs ?? 0)) { result.maxAddMs = addMs; result.maxAddAtFrame = i; }
            if ((i + 1) % fps === 0) {
                const tFlush = performance.now();
                await flushAudio((i + 1) / fps * SAMPLE_RATE);
                if (i + 1 === fps) result.firstAudioFlushMs = Math.round(performance.now() - tFlush);
                perSecond.push(Math.round(performance.now() - secondStart));
                acc.draw = performance.now() - secondStart - acc.dec - acc.add;
                phases.push({ dec: Math.round(acc.dec), draw: Math.round(acc.draw), add: Math.round(acc.add) });
                acc = { dec: 0, draw: 0, add: 0 };
                secondStart = performance.now();
                result.peakHeapMB = Math.max(result.peakHeapMB ?? 0, heapMB() ?? 0);
                if (window.reportProgress) window.reportProgress(scenario.name, i + 1, total);
            }
        }
        if (controller.signal.aborted) {
            await output.cancel();
            result.cancelled = true;
            result.cancelLatencyMs = Math.round(performance.now() - cancelAt);
            result.frames = null;
            return { ...result, ok: true, stage: 'cancelled', wallMs: Math.round(performance.now() - t0) };
        }
        await flushAudio(mix ? mix.length : 0);
        result.stage = 'finalize';
        const tFin = performance.now();
        video.close();
        audio?.close();
        await output.finalize();
        result.finalizeMs = Math.round(performance.now() - tFin);
        const bytes = output.target.buffer;
        result.outBytes = bytes.byteLength;
        result.frames = total;
        result.perSecondMs = perSecond;
        result.phases = phases;
        result.peakHeapMB = Math.max(result.peakHeapMB ?? 0, heapMB() ?? 0);
        result.wallMs = Math.round(performance.now() - t0);
        result.encodeFps = Math.round(total / (result.wallMs / 1000) * 10) / 10;
        result.speedVsRealtime = Math.round(duration / (result.wallMs / 1000) * 100) / 100;
        const up = await fetch(`/out/${scenario.name}.mp4`, { method: 'POST', body: new Blob([bytes], { type: 'video/mp4' }) });
        result.uploaded = up.ok;
        result.ok = true;
        result.stage = 'done';
    } catch (error) {
        result.error = `${error?.name || 'Error'}: ${error?.message || error}`;
        result.wallMs = Math.round(performance.now() - t0);
        if (output && !cancelled) await output.cancel().catch(() => {});
    }
    return result;
}

// Can this file be opened, and can its first video frame and audio be decoded? (Slice 0 compatibility matrix.)
async function probe(name) {
    const r = { file: name };
    try {
        const input = await open(name);
        r.format = (await input.getFormat()).name;
        const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
        if (v) {
            r.video = { codec: v.codec, canDecode: await v.canDecode(), w: await v.getDisplayWidth(), h: await v.getDisplayHeight() };
            if (r.video.canDecode) r.video.firstFrame = !!(await new CanvasSink(v).getCanvas(0.1));
        }
        if (a) {
            r.audio = { codec: a.codec, canDecode: await a.canDecode() };
            if (r.audio.canDecode) r.audio.firstBuffer = !!(await new AudioBufferSink(a).getBuffer(0.1));
        }
        r.duration = Math.round(await input.computeDuration() * 100) / 100;
    } catch (error) {
        r.error = `${error?.name || 'Error'}: ${error?.message || error}`;
    }
    return r;
}

window.spike = { render, probe, version: '1.60.0', ua: navigator.userAgent, hasMemoryApi: !!performance.memory };
window.spikeReady = true;
