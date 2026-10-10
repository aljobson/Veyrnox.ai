// Browser timeline editor, slice 1 (ADR-0080): draws the frame under the playhead on a canvas. Silent (sound is mixed at export).
// One decoder per file, created on first use. Frames are asked for by time, so scrubbing in any direction works; a newer request
// always wins, so a slow decode never paints over a later position.
import { FPS, videoClipAt } from './editorTimeline.mjs';

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
            const g = canvas.getContext('2d');
            const hit = videoClipAt(tl, frame);
            let picture = null;
            if (hit && blobs.has(hit.clip.mediaId)) {
                const sink = await sinkFor(hit.clip.mediaId);
                if (sink && !disposed) picture = (await sink.getCanvas((hit.clip.in + (frame - hit.start)) / FPS))?.canvas ?? null;
            }
            if (disposed || ticket !== latest) return false;
            g.fillStyle = '#000';
            g.fillRect(0, 0, canvas.width, canvas.height);
            if (picture) {
                const s = Math.min(canvas.width / picture.width, canvas.height / picture.height);
                g.drawImage(picture, (canvas.width - picture.width * s) / 2, (canvas.height - picture.height * s) / 2, picture.width * s, picture.height * s);
            }
            return true;
        },
        dispose() { disposed = true; for (const { input } of sinks.values()) input.dispose(); sinks.clear(); },
    };
}
