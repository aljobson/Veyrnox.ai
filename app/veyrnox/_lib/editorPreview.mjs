// Browser timeline editor (ADR-0080): draws the frame under the playhead on a canvas through editorRender.mjs, as the export does. Transport sound is provided by editorPlayback.mjs.
// One decoder per file, created on first use. Frames are asked for by time, so scrubbing in any direction works; a newer request
// always wins, so a slow decode never paints over a later position.
import { frameLayers, resolvePictures, paintFrame } from './editorRender.mjs';

export function createPreviewer(blobs) {
    const sinks = new Map();
    let latest = 0, disposed = false;
    async function sinkFor(id) {
        if (!sinks.has(id)) {
            const entry = { input: null, ready: null };
            entry.ready = (async () => {
                const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
                if (disposed || sinks.get(id) !== entry) return null;
                const input = new Input({ source: new BlobSource(blobs.get(id)), formats: ALL_FORMATS });
                entry.input = input;
                const track = await input.getPrimaryVideoTrack();
                if (disposed || sinks.get(id) !== entry) return null;
                return track ? new CanvasSink(track, { poolSize: 2 }) : null;
            })().catch(error => {
                entry.input?.dispose();
                if (sinks.get(id) === entry) sinks.delete(id);
                throw error;
            });
            sinks.set(id, entry);
        }
        return sinks.get(id).ready;
    }
    return {
        /** Returns true when the frame was painted, false when a newer request replaced it. */
        async draw(tl, frame, canvas) {
            const ticket = ++latest;
            const layers = frameLayers(tl, frame);
            const pics = await resolvePictures(layers, async (k, time) => {
                const id = tl.video[k].mediaId;
                if (!blobs.has(id)) return null;
                const sink = await sinkFor(id);
                return sink && !disposed ? (await sink.getCanvas(time))?.canvas ?? null : null;
            });
            if (disposed || ticket !== latest) return false;
            paintFrame(canvas.getContext('2d'), canvas.width, canvas.height, layers, pics);
            return true;
        },
        retain(ids) { for (const [id, entry] of sinks) if (!ids.has(id)) { entry.input?.dispose(); sinks.delete(id); } },
        dispose() { disposed = true; latest++; for (const { input } of sinks.values()) input?.dispose(); sinks.clear(); },
    };
}
