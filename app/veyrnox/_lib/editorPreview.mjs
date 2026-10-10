import { graphicCanvas } from './editorGraphics.mjs';
// Browser timeline editor (ADR-0080): draws the frame under the playhead on a canvas through editorRender.mjs, as the export does. Transport sound is provided by editorPlayback.mjs.
// One decoder per clip, created on first use. Frames are asked for by time, so scrubbing in any direction works; a newer request
// always wins, so a slow decode never paints over a later position.
import { frameLayers, resolvePictures, paintFrame } from './editorRender.mjs';

export function createPreviewer(blobs) {
    const sinks = new Map(), images = new Map();
    let latest = 0, disposed = false, painting = Promise.resolve();
    async function sinkFor(id, key) {
        if (!sinks.has(key)) {
            const entry = { input: null, ready: null, mediaId: id };
            entry.ready = (async () => {
                const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
                if (disposed || sinks.get(key) !== entry) return null;
                const input = new Input({ source: new BlobSource(blobs.get(id)), formats: ALL_FORMATS });
                entry.input = input;
                const track = await input.getPrimaryVideoTrack();
                if (disposed || sinks.get(key) !== entry) return null;
                return track ? new CanvasSink(track, { poolSize: 2 }) : null;
            })().catch(error => {
                entry.input?.dispose();
                if (sinks.get(key) === entry) sinks.delete(key);
                throw error;
            });
            sinks.set(key, entry);
        }
        return sinks.get(key).ready;
    }
    return {
        /** Returns true when the frame was painted, false when a newer request replaced it. */
        async draw(tl, frame, canvas) {
            const ticket = ++latest;
            const task = painting.then(async () => {
            if (disposed || ticket !== latest) return false;
            const layers = frameLayers(tl, frame);
            const pics = await resolvePictures(layers, async (k, time) => {
                const id = tl.video[k].mediaId;
                if (tl.media[id].kind === 'graphic') { if (!images.has(id)) images.set(id, Promise.resolve(graphicCanvas(tl.media[id].graphic))); return await images.get(id); }
                if (!blobs.has(id)) return null;
                if (tl.media[id].kind === 'image') {
                    if (!images.has(id)) images.set(id, createImageBitmap(blobs.get(id)));
                    return await images.get(id);
                }
                const sink = await sinkFor(id, `${id}:${tl.video[k].id}`);
                return sink && !disposed ? (await sink.getCanvas(time))?.canvas ?? null : null;
            });
            if (disposed || ticket !== latest) return false;
            paintFrame(canvas.getContext('2d'), canvas.width, canvas.height, layers, pics);
            const used = new Set(layers.visuals.map(v => `${tl.video[v.k].mediaId}:${tl.video[v.k].id}`)), usedMedia = new Set(layers.visuals.map(v => tl.video[v.k].mediaId));
            for (const [key, entry] of sinks) if (!used.has(key)) { entry.input?.dispose(); sinks.delete(key); }
            for (const [id, picture] of images) if (!usedMedia.has(id)) { picture.then(b => b.close?.(), () => {}); images.delete(id); }
            return true;
            });
            painting = task.catch(() => {});
            return task.catch(error => { if (disposed || ticket !== latest) return false; throw error; });
        },
        retain(ids, clipIds) { for (const [id, bitmap] of images) if (!ids.has(id)) { bitmap.then(b => b.close?.(), () => {}); images.delete(id); } for (const [key, entry] of sinks) if (!ids.has(entry.mediaId) || (clipIds && !clipIds.has(key.slice(key.lastIndexOf(':') + 1)))) { entry.input?.dispose(); sinks.delete(key); } },
        dispose() { for (const bitmap of images.values()) bitmap.then(b => b.close?.(), () => {}); images.clear(); disposed = true; latest++; for (const { input } of sinks.values()) input?.dispose(); sinks.clear(); },
    };
}
