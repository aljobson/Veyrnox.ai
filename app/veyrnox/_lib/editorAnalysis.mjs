import { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioBufferSink } from 'mediabunny';
import { graphicCanvas } from './editorGraphics.mjs';
import {registerLocalVp9AlphaDecoder} from './editorAlphaVideo.mjs';
const cache = new WeakMap();
async function inspect(media, blob) {
    const thumbnails = [], peaks = new Array(120).fill(0); let input;
    const thumbnail = async picture => { if (!picture) return; const canvas = new OffscreenCanvas(160, 90), g = canvas.getContext('2d'); g.fillStyle = '#000000'; g.fillRect(0, 0, 160, 90); const scale = Math.min(160 / picture.width, 90 / picture.height); g.drawImage(picture, (160 - picture.width * scale) / 2, (90 - picture.height * scale) / 2, picture.width * scale, picture.height * scale); thumbnails.push(URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }))); };
    try {
        if (media.kind === 'image') { const image = await createImageBitmap(blob); try { await thumbnail(image); } finally { image.close(); } }
        else {
            input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
            const video = await input.getPrimaryVideoTrack();
            if (video) { if(await video.canBeTransparent())await registerLocalVp9AlphaDecoder();const sink = new CanvasSink(video, { width: 160, height: 90, fit: 'contain', poolSize: 1, alpha: true }); for (const fraction of [0, 0.33, 0.66]) await thumbnail((await sink.getCanvas(media.frames / 30 * fraction))?.canvas); }
            const audio = media.hasAudio && await input.getPrimaryAudioTrack();
            if (audio) for await (const part of new AudioBufferSink(audio).buffers()) { const data = part.buffer.getChannelData(0); for (let i = 0; i < data.length; i += 32) { const at = Math.min(119, Math.max(0, Math.floor((part.timestamp + i / part.buffer.sampleRate) / (media.frames / 30) * 120))); peaks[at] = Math.max(peaks[at], Math.abs(data[i])); } }
        }
        return { thumbnails, peaks: media.hasAudio ? peaks : [] };
    } catch (error) { thumbnails.forEach(URL.revokeObjectURL); throw error; }
    finally { input?.dispose(); }
}
export function acquireMediaAnalysis(media, blob) {
    if (media.kind === 'graphic') { const canvas = graphicCanvas(media.graphic); return { ready: canvas.convertToBlob({ type: 'image/png' }).then(value => ({ thumbnails: [URL.createObjectURL(value)], peaks: [] })), release: value => value?.thumbnails.forEach(URL.revokeObjectURL) }; }
    let entry = cache.get(blob); if (!entry) { entry = { refs: 0, ready: inspect(media, blob) }; cache.set(blob, entry); }
    entry.refs++;
    return { ready: entry.ready, release() { entry.refs--; if (entry.refs === 0) { if (cache.get(blob) === entry) cache.delete(blob); entry.ready.then(value => value.thumbnails.forEach(URL.revokeObjectURL), () => {}); } } };
}
