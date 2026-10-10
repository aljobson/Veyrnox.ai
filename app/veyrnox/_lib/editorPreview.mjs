// Browser timeline editor (ADR-0080): draws the frame under the playhead on a canvas through editorRender.mjs, as the export does. Silent (sound is mixed at export).
// One decoder per file, created on first use. Frames are asked for by time, so scrubbing in any direction works; a newer request
// always wins, so a slow decode never paints over a later position.
import { frameLayers, resolvePictures, paintFrame } from './editorRender.mjs';

export function createPreviewer(blobs) {
    const sinks = new Map();
    let latest = 0, disposed = false;
    async function sinkFor(id) {
        if (!sinks.has(id)) {
            const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
            const input = new Input({ source: new BlobSource(blobs.get(id)), formats: ALL_FORMATS });
            const track = await input.getPrimaryVideoTrack();
            sinks.set(id, { input, sink: track ? new CanvasSink(track, { poolSize: 2 }) : null });
        }
        return sinks.get(id).sink;
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
        dispose() { disposed = true; for (const { input } of sinks.values()) input.dispose(); sinks.clear(); },
    };
}
