import { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioBufferSink } from 'mediabunny';
import { graphicCanvas } from './editorGraphics.mjs';
import { registerLocalVp9AlphaDecoder } from './editorAlphaVideo.mjs';
import { createArtworkQueue, TIMELINE_ARTWORK_LIMITS } from './editorTimelineArtwork.mjs';
const cache = new WeakMap(), filmstrips = new WeakMap(), schedule = createArtworkQueue();
const assertActive = active => { if (!active()) throw Object.assign(new Error('Artwork cancelled.'), { name: 'AbortError' }); };
const disposeArtwork = value => new Set(value?.thumbnails || []).forEach(URL.revokeObjectURL);
async function thumbnail(picture, active) {
    if (!picture) return null;
    assertActive(active);
    const canvas = new OffscreenCanvas(160, 90), g = canvas.getContext('2d');
    g.fillStyle = '#000000'; g.fillRect(0, 0, 160, 90);
    const scale = Math.min(160 / picture.width, 90 / picture.height);
    g.drawImage(picture, (160 - picture.width * scale) / 2, (90 - picture.height * scale) / 2, picture.width * scale, picture.height * scale);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    assertActive(active);
    return URL.createObjectURL(blob);
}
async function inspect(media, blob, active) {
    const thumbnails = [], peaks = new Array(TIMELINE_ARTWORK_LIMITS.sourcePeaks).fill(0); let input;
    try {
        assertActive(active);
        if (media.kind === 'image' || media.kind === 'graphic') {
            const image = media.kind === 'graphic' ? graphicCanvas(media.graphic) : await createImageBitmap(blob);
            try { const url = await thumbnail(image, active); if (url) thumbnails.push(url); } finally { image.close?.(); }
        } else {
            input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
            const video = await input.getPrimaryVideoTrack();
            if (video) {
                if (await video.canBeTransparent()) await registerLocalVp9AlphaDecoder();
                const sink = new CanvasSink(video, { width: 160, height: 90, fit: 'contain', poolSize: 1, alpha: true });
                for (const fraction of [0, 0.33, 0.66]) { assertActive(active); const url = await thumbnail((await sink.getCanvas(media.frames / 30 * fraction))?.canvas, active); if (url) thumbnails.push(url); }
            }
            const audio = media.hasAudio && await input.getPrimaryAudioTrack();
            if (audio) for await (const part of new AudioBufferSink(audio).buffers()) {
                assertActive(active);
                const channels = Array.from({ length: part.buffer.numberOfChannels }, (_, channel) => part.buffer.getChannelData(channel));
                for (let i = 0; i < part.buffer.length; i += 32) {
                    const at = Math.min(peaks.length - 1, Math.max(0, Math.floor((part.timestamp + i / part.buffer.sampleRate) / (media.frames / 30) * peaks.length)));
                    for (const channel of channels) peaks[at] = Math.max(peaks[at], Math.abs(channel[i]));
                }
            }
        }
        return { thumbnails, peaks: media.hasAudio ? peaks : [] };
    } catch (error) { disposeArtwork({ thumbnails }); throw error; }
    finally { input?.dispose(); }
}
function lease(entry, remove) {
    entry.refs++;
    let released = false;
    return { ready: entry.ready, release() {
        if (released) return;
        released = true;
        if (--entry.refs === 0) { remove(); entry.ready.then(disposeArtwork, () => {}); }
    } };
}
export function acquireMediaAnalysis(media, blob) {
    const key = media.kind === 'graphic' ? media : blob;
    let entry = cache.get(key);
    if (!entry) {
        entry = { refs: 0 }; cache.set(key, entry);
        entry.ready = schedule(() => inspect(media, blob, () => entry.refs > 0), () => entry.refs > 0);
    }
    return lease(entry, () => { if (cache.get(key) === entry) cache.delete(key); });
}
async function inspectFilmstrip(media, blob, frames, active) {
    const pictures = new Map(); let input;
    try {
        assertActive(active);
        input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const video = await input.getPrimaryVideoTrack();
        if (!video) return { thumbnails: [] };
        if (await video.canBeTransparent()) await registerLocalVp9AlphaDecoder();
        const sink = new CanvasSink(video, { width: 160, height: 90, fit: 'contain', poolSize: 1, alpha: true });
        for (const frame of new Set(frames)) {
            assertActive(active);
            const url = await thumbnail((await sink.getCanvas(frame / 30))?.canvas, active);
            if (url) pictures.set(frame, url);
        }
        return { thumbnails: frames.map(frame => pictures.get(frame)).filter(Boolean) };
    } catch (error) { disposeArtwork({ thumbnails: [...pictures.values()] }); throw error; }
    finally { input?.dispose(); }
}
/** Shared only when original bytes and mapped source sample positions match. */
export function acquireTimelineFilmstrip(media, blob, frames) {
    let entries = filmstrips.get(blob);
    if (!entries) { entries = new Map(); filmstrips.set(blob, entries); }
    const key = frames.join(','); let entry = entries.get(key);
    if (!entry) {
        entry = { refs: 0 }; entries.set(key, entry);
        entry.ready = schedule(() => inspectFilmstrip(media, blob, frames, () => entry.refs > 0), () => entry.refs > 0);
    }
    return lease(entry, () => { if (entries.get(key) === entry) entries.delete(key); if (!entries.size) filmstrips.delete(blob); });
}
