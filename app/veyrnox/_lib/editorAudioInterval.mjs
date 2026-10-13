import { audioProcessingActive } from './editorAudioSettings.mjs';

/** Frame interval that the mixer can actually play, including an available outgoing transition tail. */
export function audioClipInterval(clip, media, transitionOut = 0) {
    const processed = Boolean(clip.reverse || clip.speedCurve?.length || audioProcessingActive(clip)), rate = clip.rate ?? 1;
    // Remapped/DSP audio retains its original context and tail. Dry forward playback ends at its source boundary.
    const extra = processed ? transitionOut : Math.max(0, Math.min(transitionOut, (media.frames - (clip.in + clip.len * rate)) / rate));
    return { startFrame: clip.start, endFrame: clip.start + clip.len + extra, extra, processed };
}
