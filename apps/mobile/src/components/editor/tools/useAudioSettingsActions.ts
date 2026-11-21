import { t } from '../../../lib/i18n';
import { AUDIO_DEFAULTS, audioPatch, audioApplyAll, noiseStartAtPlayhead, type AudioPatch, type AudioResult } from '../../../lib/editorAudioEdit';
import { clipAt, type Clip, type Selection, type Timeline } from '../../../lib/nativeEditorModel';
import type { FrameStore } from '../editorFrameStore';
export function useAudioSettingsActions({ timeline, selection, applyTimeline, setProblem, frameStore }: {
    timeline: Timeline; selection: Selection | null; applyTimeline(next: Timeline): boolean;
    setProblem(message: string | null): void; frameStore: FrameStore;
}) {
    const commit = (result: AudioResult) => {
        if ('refused' in result) {
            const messages = { locked: t('editorAudioTools.locked'), lockedAll: t('editorAudioTools.lockedAll'), noiseRange: t('editorAudioTools.noiseRange'),
                echoTail: t('editorAudioTools.echoTail'), noSound: t('editorAudioTools.noSound'), invalid: t('editorEditGate.invalid') };
            setProblem(messages[result.refused]); return false;
        }
        if (!applyTimeline(result.timeline)) return false;
        setProblem(t('editorTools.updated')); return true;
    };
    const patch = (value: AudioPatch) => selection ? commit(audioPatch(timeline, selection, value)) : false;
    return { patch, applyAll: (settings: NonNullable<Clip['audioProcessing']>) => commit(audioApplyAll(timeline, settings)),
        usePlayhead: () => {
            const clip = clipAt(timeline, selection) as Clip | undefined, media = timeline.media[clip?.mediaId ?? ''];
            if (!clip || !media) return;
            const frame = frameStore.get();
            if (frame < clip.start || frame >= clip.start + clip.len) { setProblem(t('editorAudioTools.outside')); return; }
            const duration = (media.frames ?? 0) / 30;
            if (duration < .05) { setProblem(t('editorAudioTools.noiseRange')); return; }
            const settings = { ...AUDIO_DEFAULTS, ...clip.audioProcessing };
            settings.noiseLength = Math.min(settings.noiseLength, duration);
            const start = noiseStartAtPlayhead({ ...clip, audioProcessing: settings }, media, frame);
            if (start !== null) patch({ audioProcessing: { ...settings, noiseStart: start } });
        },
    };
}
export type AudioSettingsActions = ReturnType<typeof useAudioSettingsActions>;
