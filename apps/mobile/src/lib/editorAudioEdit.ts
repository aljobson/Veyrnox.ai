import { AUDIO_DEFAULTS as defaults, VOICES as voices } from '../../../../app/veyrnox/_lib/editorAudioSettings.mjs';
import { AUDIO_EFFECT_DEFAULTS as effects } from '../../../../app/veyrnox/_lib/editorAudioEffects.mjs';
import { updateSequenceClip } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { sourceFrame } from '../../../../app/veyrnox/_lib/editorSpeed.mjs';
import { helperEnglish } from '../../../../lib/helperMessages.mjs';
import { clipAt, updateClip, type Clip, type Media, type Selection, type Timeline } from './nativeEditorModel';
export const AUDIO_DEFAULTS = defaults as Readonly<NonNullable<Clip['audioProcessing']>>;
export const AUDIO_EFFECT_DEFAULTS = effects as Readonly<NonNullable<Clip['audioEffects']>>;
export const VOICES = voices as readonly string[];
export type AudioPatch = Pick<Partial<Clip>, 'eq' | 'audioProcessing' | 'preservePitch' | 'audioEffects'>;
export type AudioRefusal = 'locked' | 'lockedAll' | 'noiseRange' | 'echoTail' | 'noSound' | 'invalid';
export type AudioResult = { timeline: Timeline } | { refused: AudioRefusal };
function refusal(message: string): AudioResult {
    if (message === 'Unlock this track to edit it.') return { refused: 'locked' };
    if (message === helperEnglish('choose_a_noiseonly_sample_within_this_source_file')) return { refused: 'noiseRange' };
    if (message === helperEnglish('echo_needs_whole_repeats_with_a_combined_delay')) return { refused: 'echoTail' };
    if (message === helperEnglish('audio_effects_need_a_source_with_sound')) return { refused: 'noSound' };
    return { refused: 'invalid' };
}
export function audioPatch(timeline: Timeline, selection: Selection, patch: AudioPatch): AudioResult {
    const clip = clipAt(timeline, selection);
    if (!clip || selection.track === 'text') return { refused: 'invalid' };
    if (timeline.tracks.some(t => t.id === clip.trackId && t.locked)) return { refused: 'locked' };
    // Legacy documents are judged by the S1 gate, which knows their original validation state.
    if (validateSequence(timeline)) return { timeline: updateClip(timeline, selection, patch) };
    const result = updateSequenceClip(timeline, selection.track, selection.id, patch) as Timeline | { error: string };
    return 'error' in result ? refusal(result.error) : { timeline: result };
}
export const audioSectionsVisible = (clip: Clip, media: Media | undefined) => !!media?.hasAudio && clip.freezeFrame === undefined;
export function audioApplyAll(timeline: Timeline, settings: NonNullable<Clip['audioProcessing']>): AudioResult {
    const affected = (clip: Clip) => audioSectionsVisible(clip, timeline.media[clip.mediaId ?? '']);
    if ([...timeline.video, ...timeline.audio].some(c => affected(c) && timeline.tracks.some(t => t.id === c.trackId && t.locked))) return { refused: 'lockedAll' };
    const apply = (clip: Clip) => affected(clip) ? { ...clip, audioProcessing: { ...AUDIO_DEFAULTS, ...clip.audioProcessing,
        voice: settings.voice, pitch: settings.pitch, gateDb: settings.gateDb } } : clip;
    const next = { ...timeline, video: timeline.video.map(apply), audio: timeline.audio.map(apply) };
    // As with audioPatch, the S1 gate decides whether an edit to a legacy document can be kept.
    if (validateSequence(timeline)) return { timeline: next };
    const problem = validateSequence(next);
    return problem ? refusal(problem) : { timeline: next };
}
export function noiseStartAtPlayhead(clip: Clip, media: Media, frame: number): number | null {
    if (!Number.isFinite(frame) || frame < clip.start || frame >= clip.start + clip.len) return null;
    const length = clip.audioProcessing?.noiseLength ?? AUDIO_DEFAULTS.noiseLength;
    return Math.floor(Math.max(0, Math.min(sourceFrame(clip, frame - clip.start) / 30, (media.frames ?? 0) / 30 - length)) * 100) / 100;
}
