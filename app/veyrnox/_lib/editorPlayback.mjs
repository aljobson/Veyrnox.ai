import { FPS, totalFrames } from './editorTimeline.mjs';
import { SAMPLE_RATE, mixAudio } from './editorAudio.mjs';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';

/** One audio clock drives picture and sound. Each source belongs to this player and is stopped on pause. */
export function createAudioPlayer() {
    let context, source, abort, generation = 0, origin = 0, firstFrame = 0;
    let cachedTimeline, cachedFiles, cachedMix, peak = 0;
    const stop = () => { generation++; abort?.abort(); abort = null; if (source) { source.stop(); source.disconnect(); source = null; } };
    return {
        async start(tl, blobs, frame) {
            stop();
            const ticket = generation;
            // Called directly from Play: create/resume before awaiting decode, preserving the user gesture.
            context ||= new AudioContext({ sampleRate: SAMPLE_RATE });
            await context.resume();
            if (generation !== ticket) return false;
            const controller = new AbortController(); abort = controller;
            const ids = [...new Set([...tl.video, ...tl.audio].map(x => x.mediaId))];
            const files = ids.map(id => blobs.get(id));
            const reusable = cachedTimeline === tl && cachedFiles?.length === files.length && files.every((file, i) => file === cachedFiles[i]);
            let mix = reusable ? cachedMix : null;
            if (!reusable) {
                const inputs = new Map();
                try {
                    for (const id of ids) {
                        const blob = blobs.get(id);
                        if (!blob) throw new Error('Relink the missing files before playing this project.');
                        inputs.set(id, new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }));
                    }
                    mix = await mixAudio(tl, inputs, Math.max(1, Math.ceil(totalFrames(tl) / FPS * SAMPLE_RATE)), controller.signal);
                } finally { for (const input of inputs.values()) input.dispose(); }
                if (controller.signal.aborted || generation !== ticket) return false;
                peak = 0;
                if (mix) for (const sample of mix.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
                cachedTimeline = tl; cachedFiles = files; cachedMix = mix;
            }
            if (controller.signal.aborted || generation !== ticket) return false;
            if (mix) {
                source = context.createBufferSource(); source.buffer = mix; source.connect(context.destination);
                source.start(0, Math.min(frame / FPS, Math.max(0, mix.duration - 1 / FPS)));
            }
            firstFrame = frame; origin = context.currentTime; abort = null;
            return true;
        },
        frame() { return firstFrame + Math.floor((context.currentTime - origin) * FPS); },
        status() { return { contextState: context?.state || 'uninitialized', hasSound: !!cachedMix, peak }; },
        stop,
        dispose() { stop(); cachedMix = null; cachedFiles = null; cachedTimeline = null; void context?.close(); },
    };
}
