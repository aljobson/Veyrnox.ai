import { audioClipInterval } from './editorAudioInterval.mjs';
import { AUDIO_EFFECT_DEFAULTS } from './editorAudioEffects.mjs';
import { AUDIO_DEFAULTS } from './editorAudioSettings.mjs';
import { trackAudible } from './editorSelection.mjs';
import { sequenceTransitionAfter } from './editorSequence.mjs';

/**
 * Frame-domain transport shared by web fixtures and the iOS offline renderer.
 * Keeping canonical editor values in frames avoids fractional-second drift at 24/25/30/60 fps.
 */
export function advancedAudioMixClips(timeline) {
    const result = [];
    for (const kind of ['video', 'audio']) for (const clip of timeline[kind]) {
        const media = clip.mediaId ? timeline.media[clip.mediaId] : undefined;
        if (!media?.hasAudio || (clip.volume ?? 1) <= 0 || clip.freezeFrame !== undefined || !trackAudible(timeline, clip)) continue;
        const transitionOut = kind === 'video' ? sequenceTransitionAfter(timeline, clip) : 0;
        const interval = audioClipInterval(clip, media, transitionOut);
        const contentFrames = Math.max(0, Math.min(clip.len,
            interval.endFrame - clip.start - interval.extra));
        if (!contentFrames && !interval.extra) continue;
        result.push({
            mediaId: clip.mediaId,
            start: clip.start,
            in: clip.in ?? 0,
            len: contentFrames,
            transitionOut: interval.extra,
            volume: clip.volume ?? 1,
            fadeIn: clip.fadeIn ?? 0,
            fadeOut: clip.fadeOut ?? 0,
            rate: clip.rate ?? 1,
            reverse: !!clip.reverse,
            preservePitch: !!clip.preservePitch,
            speedCurve: clip.speedCurve ?? undefined,
            audioProcessing: { ...AUDIO_DEFAULTS, ...clip.audioProcessing },
            audioEffects: { ...AUDIO_EFFECT_DEFAULTS, ...clip.audioEffects },
            pan: clip.pan ?? 0,
            eq: { low: 0, mid: 0, high: 0, ...clip.eq },
        });
    }
    return result;
}
