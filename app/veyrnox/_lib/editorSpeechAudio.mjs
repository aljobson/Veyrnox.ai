import { mixAudio, SAMPLE_RATE } from './editorAudio.mjs';
import { audioClipInterval } from './editorAudioInterval.mjs';
import { sequenceEnd, sequenceTransitionAfter } from './editorSequence.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';
import { trackAudible } from './editorSelection.mjs';
export const SPEECH_LIMITS = Object.freeze({ seconds: 120, sampleRate: 16000, samples: 120 * 16000 });
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Transcription cancelled.', 'AbortError'); };
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
/** A windowed sinc low-pass prevents high-frequency audio aliasing into speech frequencies. */
function sampleAt(channels, at, cutoff) {
    const middle = Math.floor(at), radius = 15; let sum = 0, weight = 0;
    for (let i = middle - radius; i <= middle + radius; i++) {
        const distance = at - i, x = distance * 2 * cutoff;
        if (Math.abs(distance) > radius) continue;
        const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x), hann = .5 + .5 * Math.cos(Math.PI * distance / radius), coefficient = sinc * hann;
        const index = Math.min(channels[0].length - 1, Math.max(0, i)); let value = 0;
        for (const channel of channels) { const sample = channel[index]; if (!Number.isFinite(sample)) throw new Error('The decoded sound contains invalid samples.'); value += sample / channels.length; }
        sum += value * coefficient; weight += coefficient;
    }
    return Math.max(-1, Math.min(1, weight ? sum / weight : 0));
}
export async function resampleSpeechPCM(channels, sampleRate, { signal, onProgress = () => {} } = {}) {
    if (!Array.isArray(channels) || !channels.length || channels.length > 2 || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== channels[0].length) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || channels[0].length < 1 || channels[0].length > SPEECH_LIMITS.seconds * sampleRate) throw new Error('Choose valid decoded audio up to two minutes.');
    checkAbort(signal);
    const count = Math.round(channels[0].length / sampleRate * SPEECH_LIMITS.sampleRate), output = new Float32Array(count), step = sampleRate / SPEECH_LIMITS.sampleRate, cutoff = Math.min(.5, 1 / step * .45);
    for (let i = 0; i < count; i++) {
        output[i] = sampleAt(channels, i * step, cutoff);
        if (i % 16384 === 0) { checkAbort(signal); onProgress({ stage: 'audio', fraction: i / count }); await yieldToBrowser(); }
    }
    checkAbort(signal); onProgress({ stage: 'audio', fraction: 1 }); return output;
}
/** A bounded view, never a persisted project or a destructive trim. Track selection respects mute and ignores other tracks' solo. */
export function speechSelection(timeline, { trackId = 'mix', startFrame = 0, endFrame = sequenceEnd(timeline) } = {}) {
    const problem = validateSequence(timeline); if (problem) throw new Error(problem);
    if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame > sequenceEnd(timeline) || endFrame <= startFrame || endFrame - startFrame > SPEECH_LIMITS.seconds * timeline.fps) throw new Error('Choose a range within this edit, up to two minutes long.');
    if (trackId !== 'mix' && !timeline.tracks.some(track => track.id === trackId && ['video', 'audio'].includes(track.kind))) throw new Error('Choose an existing video or audio track.');
    const selected = trackId === 'mix' ? timeline : { ...timeline,
        video: timeline.video.filter(clip => clip.trackId === trackId), audio: timeline.audio.filter(clip => clip.trackId === trackId),
        tracks: timeline.tracks.map(track => ({ ...track, solo: false })) };
    const ids = new Set();
    for (const clip of [...selected.video, ...selected.audio]) {
        const media = selected.media[clip.mediaId], interval = audioClipInterval(clip, media, sequenceTransitionAfter(selected, clip));
        if (media?.hasAudio && clip.volume > 0 && clip.freezeFrame === undefined && trackAudible(selected, clip) && interval.startFrame < endFrame && interval.endFrame > startFrame) ids.add(media.id);
    }
    return { timeline: selected, startFrame, endFrame, seconds: (endFrame - startFrame) / timeline.fps, mediaIds: [...ids] };
}
/** Recognition consumes the chosen audible range with original fades, source-time mapping and DSP context. */
export async function timelineSpeechPCM(timeline, blobs, { signal = new AbortController().signal, onProgress = () => {}, trackId = 'mix', startFrame = 0, endFrame = sequenceEnd(timeline), audioRuntime } = {}) {
    const selection = speechSelection(timeline, { trackId, startFrame, endFrame });
    checkAbort(signal); onProgress({ stage: 'audio', fraction: 0 });
    const { Input, BlobSource, ALL_FORMATS } = audioRuntime || await import('mediabunny'), inputs = new Map();
    try {
        for (const id of selection.mediaIds) {
            const media = timeline.media[id], blob = blobs.get(id);
            if (!(blob instanceof Blob)) throw new Error(`Relink ${media.name} before transcribing this range.`);
            inputs.set(id, new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }));
        }
        checkAbort(signal);
        const audio = await (audioRuntime?.mixAudio || mixAudio)(selection.timeline, inputs, Math.round(selection.seconds * SAMPLE_RATE), signal, { startFrame, endFrame });
        checkAbort(signal);
        if (!audio) throw new Error('This selected range has no audible sound. Unmute its track or choose another range.');
        return await resampleSpeechPCM(Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, channel) => audio.getChannelData(channel)), audio.sampleRate, { signal, onProgress });
    } finally { for (const input of inputs.values()) input.dispose(); }
}
