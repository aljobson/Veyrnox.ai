import { FPS, videoLayout, effectiveTransition } from './editorTimeline.mjs';
import { AudioBufferSink } from 'mediabunny';
export const SAMPLE_RATE = 48000;
const abortError = () => Object.assign(new Error('Playback cancelled.'), { name: 'AbortError' });

export async function mixAudio(tl, inputs, length, signal) {
    const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
    const layers = [
        ...videoLayout(tl).map(({ clip, start }, k) => ({ clip, start, fadeIn: effectiveTransition(tl, k), fadeOut: effectiveTransition(tl, k + 1) })),
        ...tl.audio.map(clip => ({ clip, start: clip.start, fadeIn: 0, fadeOut: 0 })),
    ];
    let used = 0;
    for (const { clip, start, fadeIn, fadeOut } of layers) {
        if (signal.aborted) throw abortError();
        const media = tl.media[clip.mediaId];
        if (!media.hasAudio || clip.volume === 0) continue;
        const track = await inputs.get(clip.mediaId).getPrimaryAudioTrack();
        if (!track) continue;
        // A dissolve crossfades the sound the way it does the picture: this clip keeps playing UNDER the next clip's dissolve (as far
        // as its file goes) while ramping down, and ramps up over its own dissolve.
        const extra = Math.min(fadeOut, media.frames - (clip.in + clip.len));
        const from = clip.in / FPS, to = (clip.in + clip.len + extra) / FPS, at = start / FPS, cut = at + clip.len / FPS, end = cut + extra / FPS;
        const gain = ctx.createGain();
        gain.gain.value = clip.volume;
        if (fadeIn > 0) { gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(clip.volume, at + fadeIn / FPS); }
        if (fadeOut > 0) { gain.gain.setValueAtTime(clip.volume, cut); gain.gain.linearRampToValueAtTime(0, cut + fadeOut / FPS); }
        gain.connect(ctx.destination);
        for await (const wrapped of new AudioBufferSink(track).buffers(from, to)) {
            if (signal.aborted) throw abortError();
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
    if (signal.aborted) throw abortError();
    return used ? await ctx.startRendering() : null;
}
