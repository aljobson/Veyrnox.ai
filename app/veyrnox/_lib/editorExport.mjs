import { backgroundMediaIds } from './editorBackground.mjs';
import { sourceRange } from './editorSpeed.mjs';
import { exportMemoryProblem } from './editorExportMemory.mjs';
import { validateExportSettings, EXPORT_BITRATES } from './editorExportSettings.mjs';
import { graphicCanvas } from './editorGraphics.mjs';
// Browser timeline editor, slice 1 (ADR-0080): the local export. Decodes the timeline's clips, draws them on a canvas, mixes the audio, and
// writes one MP4 (H.264 + AAC) in the browser. Nothing is uploaded and nothing is charged. Imported on demand by the page, never on the server.
//
// What slice 0 measured (docs/editor/SLICE-0-RESULTS-2026-10-10.md), and so what this does:
//   - SOFTWARE H.264 encoding. The default hardware encoder stalled for 4.5 to 86 s the first time a browser used it.
//   - The SEQUENTIAL decode iterator (`canvases()`), not the sparse-access one, which made the first second take 5 to 25 s.
//   - Audio is mixed with an OfflineAudioContext and added to the muxer a second at a time, between video frames.
//   - Cancel stops within a frame; the half-written output is discarded.
import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, MovOutputFormat, Quality, CanvasSink, CanvasSource, AudioBufferSource, canEncodeVideo, canEncodeAudio, QUALITY_HIGH } from 'mediabunny';
import {registerLocalVp9AlphaDecoder} from './editorAlphaVideo.mjs';
import { FPS, videoLayout, totalFrames, effectiveTransition } from './editorTimeline.mjs';
import { frameLayers, resolvePictures, paintFrame, timelineSize } from './editorRender.mjs';
export { EXPORT_HEIGHTS, outputSize } from './editorRender.mjs';
import { validateExportBrowser } from './videoEnhance.mjs';

import { sequenceTransitionAfter } from './editorSequence.mjs';
import { SAMPLE_RATE, mixAudio } from './editorAudio.mjs';
class Reader {
    constructor(sink, from, to) { this.it = sink.canvases(from, to); this.cur = null; this.nxt = null; this.done = false; }
    async close() { await this.it.return?.(); this.cur = null; this.nxt = null; }
    async at(t) {
        if (!this.cur && !this.done) { const r = await this.it.next(); if (r.done) this.done = true; else this.cur = r.value; }
        while (!this.done) {
            if (!this.nxt) { const r = await this.it.next(); if (r.done) { this.done = true; break; } this.nxt = r.value; }
            if (this.nxt.timestamp <= t + 1e-6) { this.cur = this.nxt; this.nxt = null; } else break;
        }
        return this.cur ? this.cur.canvas : null;
    }
}

class SeekReader {
    constructor(sink) {this.sink=sink;this.time=null;this.picture=null;}
    async at(time) {if(time!==this.time){this.picture=(await this.sink.getCanvas(time))?.canvas ?? null;this.time=time;}return this.picture;}
    async close() {this.picture=null;this.sink=null;}
}

const abortError = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });


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
export async function exportTimeline(tl, blobs, { signal = new AbortController().signal, height = 720, frameRate = 30, format = 'mp4', quality = 'standard', bitrate = EXPORT_BITRATES[quality], fitMode = 'contain', onProgress = () => {} } = {}) {
    if (signal.aborted) throw abortError();
    if(!Number.isFinite(bitrate)||bitrate<128000||bitrate>32000000)throw new Error('Choose a supported video bitrate.');
    const total = totalFrames(tl);
    if (total < 1) throw new Error('Add a clip first.');
    const settingsProblem = validateExportSettings({ height, frameRate, format, quality }, total / FPS);
    if (settingsProblem) throw new Error(settingsProblem);
    if (!['contain', 'cover'].includes(fitMode)) throw new Error('Choose valid frame fitting.');
    const memoryProblem = exportMemoryProblem(tl, height, quality, bitrate); if (memoryProblem) throw new Error(memoryProblem);
    const outputFrames = Math.ceil(total / FPS * frameRate);
    const { width: W, height: H } = timelineSize(tl, height);
    const blocked = await exportBlocker({ width: W, height: H });
    if (blocked) throw new Error(blocked);

    const inputs = new Map();
    const readers = [], images = new Map(), retired = new Set();
    let output;
    try {
        for (const id of new Set([...tl.video, ...tl.audio].flatMap(c => [c.mediaId,...backgroundMediaIds(c)]))) {
            if (tl.media[id].kind === 'graphic') { images.set(id, graphicCanvas(tl.media[id].graphic)); continue; }
            const blob = blobs.get(id);
            if (!blob) throw new Error('A file in this project is not loaded. Add it again.');
            if (tl.media[id].kind === 'image') { images.set(id, await createImageBitmap(blob)); continue; }
            inputs.set(id, new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }));
        }
        const canvas = new OffscreenCanvas(W, H);
        const g = canvas.getContext('2d');
        const layout = videoLayout(tl);
        for (const [k, { clip }] of layout.entries()) {
            if (images.has(clip.mediaId)) { readers.push({ at: async () => images.get(clip.mediaId), close: async () => {} }); continue; }
            const track = await inputs.get(clip.mediaId).getPrimaryVideoTrack();
            if (!track || !await track.canDecode()) throw new Error('This browser cannot decode one of the videos.');
            if(await track.canBeTransparent())await registerLocalVp9AlphaDecoder();
            // A clip keeps playing under the next clip's dissolve, so its reader runs that much further (never past the file).
            const sink=new CanvasSink(track,{poolSize:2,alpha:true}),range=sourceRange(clip,tl.schemaVersion===3?sequenceTransitionAfter(tl,clip):effectiveTransition(tl,k+1));
            readers.push(clip.reverse || clip.freezeFrame!==undefined ? new SeekReader(sink) : new Reader(sink, Math.max(0,range.from)/FPS, Math.min(range.to+1,tl.media[clip.mediaId].frames)/FPS));
        }

        onProgress({ stage: 'audio', done: 0, total });
        const mix = await mixAudio(tl, inputs, Math.ceil(total / FPS * SAMPLE_RATE), signal);

        output = new Output({ format: format === 'mov' ? new MovOutputFormat({ fastStart: 'in-memory' }) : new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
        const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate }), keyFrameInterval: 2, hardwareAcceleration: 'prefer-software' });
        output.addVideoTrack(video, { frameRate });
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
        for (let i = 0; i < outputFrames; i++) {
            if (signal.aborted) throw abortError();
            const layers = frameLayers(tl, Math.min(total - 1, i / frameRate * FPS));
            paintFrame(g, W, H, layers, await resolvePictures(layers, (k, time, backgroundId) => backgroundId ? images.get(backgroundId) : readers[k].at(time)), fitMode);
            for (const [k, entry] of layout.entries()) {
                const until = entry.start + entry.clip.len + (tl.schemaVersion === 3 ? sequenceTransitionAfter(tl, entry.clip) : effectiveTransition(tl, k + 1));
                if (!retired.has(k) && (i + 1) / frameRate * FPS >= until) { await readers[k].close(); retired.add(k); }
            }
            await video.add(i / frameRate, Math.min(1 / frameRate, total / FPS - i / frameRate));
            if ((i + 1) % frameRate === 0) { await flush(Math.floor((i + 1) / frameRate * SAMPLE_RATE)); onProgress({ stage: 'encode', done: i + 1, total: outputFrames }); }
        }
        await flush(mix ? mix.length : 0);
        video.close();
        audio?.close();
        await output.finalize();
        onProgress({ stage: 'done', done: total, total });
        return new Blob([output.target.buffer], { type: format === 'mov' ? 'video/quicktime' : 'video/mp4' });
    } catch (error) {
        if (output) await output.cancel().catch(() => {});
        throw signal.aborted ? abortError() : error;
    } finally {
        await Promise.allSettled(readers.filter((_, k) => !retired.has(k)).map(reader => reader.close()));
        for (const input of inputs.values()) input.dispose();
        for (const bitmap of images.values()) bitmap.close?.();
    }
}

export const exportFileName = (title = 'veyrnox-edit', format = 'mp4') =>
    `${String(title).replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'veyrnox-edit'}.${format === 'mov' ? 'mov' : 'mp4'}`;
