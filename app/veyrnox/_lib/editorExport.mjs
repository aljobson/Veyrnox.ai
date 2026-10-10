// Browser timeline editor, slice 1 (ADR-0080): the local export. Decodes the timeline's clips, draws them on a canvas, mixes the audio, and
// writes one MP4 (H.264 + AAC) in the browser. Nothing is uploaded and nothing is charged. Imported on demand by the page, never on the server.
//
// What slice 0 measured (docs/editor/SLICE-0-RESULTS-2026-10-10.md), and so what this does:
//   - SOFTWARE H.264 encoding. The default hardware encoder stalled for 4.5 to 86 s the first time a browser used it.
//   - The SEQUENTIAL decode iterator (`canvases()`), not the sparse-access one, which made the first second take 5 to 25 s.
//   - Audio is mixed with an OfflineAudioContext and added to the muxer a second at a time, between video frames.
//   - Cancel stops within a frame; the half-written output is discarded.
import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, CanvasSink, CanvasSource, AudioBufferSink, AudioBufferSource, canEncodeVideo, canEncodeAudio, QUALITY_HIGH } from 'mediabunny';
import { FPS, totalFrames, videoLayout } from './editorTimeline.mjs';
import { validateExportBrowser } from './videoEnhance.mjs';

const SAMPLE_RATE = 48000;
export const EXPORT_HEIGHTS = Object.freeze([720, 1080]);

/** Even pixel sizes at the first clip's shape, with the long edge no wider than 1920. */
export function outputSize(width, height, targetHeight = 720) {
    const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
    let h = EXPORT_HEIGHTS.includes(targetHeight) ? targetHeight : 720;
    let w = h * aspect;
    if (w > 1920) { w = 1920; h = w / aspect; }
    const even = n => Math.max(2, Math.round(n / 2) * 2);
    return { width: even(w), height: even(h) };
}

class Reader {
    constructor(sink, from, to) { this.it = sink.canvases(from, to); this.cur = null; this.nxt = null; this.done = false; }
    async at(t) {
        if (!this.cur && !this.done) { const r = await this.it.next(); if (r.done) this.done = true; else this.cur = r.value; }
        while (!this.done) {
            if (!this.nxt) { const r = await this.it.next(); if (r.done) { this.done = true; break; } this.nxt = r.value; }
            if (this.nxt.timestamp <= t + 1e-6) { this.cur = this.nxt; this.nxt = null; } else break;
        }
        return this.cur ? this.cur.canvas : null;
    }
}

const abortError = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });

async function mixAudio(tl, inputs, length, signal) {
    const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
    const layers = [
        ...videoLayout(tl).map(({ clip, start }) => ({ clip, start })),
        ...tl.audio.map(clip => ({ clip, start: clip.start })),
    ];
    let used = 0;
    for (const { clip, start } of layers) {
        if (signal.aborted) throw abortError();
        const media = tl.media[clip.mediaId];
        if (!media.hasAudio || clip.volume === 0) continue;
        const track = await inputs.get(clip.mediaId).getPrimaryAudioTrack();
        if (!track) continue;
        const from = clip.in / FPS, to = (clip.in + clip.len) / FPS, at = start / FPS, end = at + clip.len / FPS;
        const gain = ctx.createGain();
        gain.gain.value = clip.volume;
        gain.connect(ctx.destination);
        for await (const wrapped of new AudioBufferSink(track).buffers(from, to)) {
            const node = ctx.createBufferSource();
            node.buffer = wrapped.buffer;
            node.connect(gain);
            let when = at + (wrapped.timestamp - from), offset = 0;
            if (when < at) { offset = at - when; when = at; }
            node.start(when, offset);
            node.stop(end);
        }
        used += 1;
    }
    return used ? await ctx.startRendering() : null;
}

const slice = (mix, from, to) => {
    const out = new AudioBuffer({ length: to - from, sampleRate: SAMPLE_RATE, numberOfChannels: 2 });
    for (let ch = 0; ch < 2; ch++) out.copyToChannel(mix.getChannelData(ch).subarray(from, to), ch);
    return out;
};

/** Why export cannot run here, or null. A cheap check the page shows before the user spends time editing. */
export async function exportBlocker(size = { width: 1280, height: 720 }) {
    const browser = validateExportBrowser();
    if (browser) return browser;
    if (typeof VideoEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return 'This browser cannot export video. Use desktop Google Chrome.';
    try {
        if (!await canEncodeVideo('avc', { width: size.width, height: size.height, quality: QUALITY_HIGH })) return 'This browser cannot encode H.264 video. Use desktop Google Chrome.';
        if (!await canEncodeAudio('aac')) return 'This browser cannot encode AAC audio. Use desktop Google Chrome.';
    } catch { return 'Export compatibility could not be checked. Use desktop Google Chrome.'; }
    return null;
}

/**
 * Render the timeline to an MP4 Blob. `blobs` maps media id to the file's bytes. `onProgress({ stage, done, total })`.
 * Rejects with an AbortError when `signal` aborts; any partial output is discarded.
 */
export async function exportTimeline(tl, blobs, { signal = new AbortController().signal, height = 720, onProgress = () => {} } = {}) {
    if (signal.aborted) throw abortError();
    const total = totalFrames(tl);
    if (total < 1) throw new Error('Add a clip first.');
    const firstVideo = tl.video.length ? tl.media[tl.video[0].mediaId] : null;
    const { width: W, height: H } = outputSize(firstVideo?.width, firstVideo?.height, height);
    const blocked = await exportBlocker({ width: W, height: H });
    if (blocked) throw new Error(blocked);

    const inputs = new Map();
    for (const id of new Set([...tl.video, ...tl.audio].map(c => c.mediaId))) {
        const blob = blobs.get(id);
        if (!blob) throw new Error('A file in this project is not loaded. Add it again.');
        inputs.set(id, new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }));
    }
    let output;
    try {
        const canvas = new OffscreenCanvas(W, H);
        const g = canvas.getContext('2d');
        const layout = videoLayout(tl);
        const readers = [];
        for (const { clip } of layout) {
            const track = await inputs.get(clip.mediaId).getPrimaryVideoTrack();
            if (!track || !await track.canDecode()) throw new Error('This browser cannot decode one of the videos.');
            readers.push(new Reader(new CanvasSink(track, { poolSize: 6 }), clip.in / FPS, (clip.in + clip.len) / FPS));
        }

        onProgress({ stage: 'audio', done: 0, total });
        const mix = await mixAudio(tl, inputs, Math.ceil(total / FPS * SAMPLE_RATE), signal);

        output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
        const video = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH, keyFrameInterval: 2, hardwareAcceleration: 'prefer-software' });
        output.addVideoTrack(video, { frameRate: FPS });
        const audio = mix ? new AudioBufferSource({ codec: 'aac', bitrate: 128000 }) : null;
        if (audio) output.addAudioTrack(audio);
        await output.start();

        let sent = 0;
        const flush = async upTo => {
            while (audio && sent < Math.min(upTo, mix.length)) {
                const to = Math.min(sent + SAMPLE_RATE, mix.length, upTo);
                await audio.add(slice(mix, sent, to));
                sent = to;
            }
        };
        for (let i = 0; i < total; i++) {
            if (signal.aborted) throw abortError();
            g.fillStyle = '#000';
            g.fillRect(0, 0, W, H);
            const k = layout.findIndex(item => i >= item.start && i < item.end);
            if (k >= 0) {
                const { clip, start } = layout[k];
                const frame = await readers[k].at((clip.in + (i - start)) / FPS);
                if (frame) {
                    const s = Math.min(W / frame.width, H / frame.height);
                    g.drawImage(frame, (W - frame.width * s) / 2, (H - frame.height * s) / 2, frame.width * s, frame.height * s);
                }
            }
            await video.add(i / FPS, 1 / FPS);
            if ((i + 1) % FPS === 0) { await flush((i + 1) / FPS * SAMPLE_RATE); onProgress({ stage: 'encode', done: i + 1, total }); }
        }
        await flush(mix ? mix.length : 0);
        video.close();
        audio?.close();
        await output.finalize();
        onProgress({ stage: 'done', done: total, total });
        return new Blob([output.target.buffer], { type: 'video/mp4' });
    } catch (error) {
        if (output) await output.cancel().catch(() => {});
        throw signal.aborted ? abortError() : error;
    } finally {
        for (const input of inputs.values()) input.dispose();
    }
}

export const exportFileName = (title = 'veyrnox-edit') =>
    `${String(title).replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'veyrnox-edit'}.mp4`;
