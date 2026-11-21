import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { randomUUID } from 'expo-crypto';
import { createAudition, ensureOriginalAudioFile } from '../../../lib/editorOriginalAudioFiles';
import { originalAudioMedia, originalAudioProblem } from '../../../lib/editorOriginalAudio';
import { clampFrame } from '../../../lib/editorInsertMedia';
import { t } from '../../../lib/i18n';
import { formatTimecode } from '../../../lib/editorTimeline';
import type { Media, Timeline } from '../../../lib/nativeEditorModel';
import type { FrameStore } from '../editorFrameStore';
import type { InsertFailure, InsertResult } from '../useEditorGenerationReturns';
type Props = {
    currentTimeline(): Timeline; onPlacement(message: string): void;
    timeline: Timeline; localMediaUris: Record<string, string>; setLocalMediaUris: Dispatch<SetStateAction<Record<string, string>>>;
    insertMedia(media: Media, at: number, select: boolean, onPlaced: (trimmed: boolean) => void, onFailed: (result: InsertFailure) => void): InsertResult; frameStore: FrameStore; playing: boolean; setProblem(message: string | null): void;
};
export function useOriginalAudio(props: Props) {
    const latest = useRef(props); useLayoutEffect(() => { latest.current = props; });
    const mounted = useRef(true), busy = useRef(false), previewToken = useRef(0), lifetime = useRef(0);
    const [preparing, setPreparing] = useState(false), [preview, setPreview] = useState<string | null>(null);
    const audition = useRef<ReturnType<typeof createAudition> | null>(null);
    const stop = useCallback(() => { previewToken.current++; audition.current?.stop(); if (mounted.current) setPreview(null); }, []);
    useEffect(() => {
        mounted.current = true; const life = lifetime.current;
        return () => { mounted.current = false; lifetime.current = life + 1; stop(); audition.current?.release(); audition.current = null; };
    }, [stop]);
    useEffect(() => { if (props.playing) stop(); }, [props.playing, stop]);
    const missing = Object.values(props.timeline.media).filter(m => m.originalAudio && !originalAudioProblem(m.originalAudio) && !props.localMediaUris[m.id]);
    const restoreKey = JSON.stringify(missing.map(m => [m.id, m.originalAudio!.presetId]));
    useEffect(() => {
        let cancelled = false;
        const entries = JSON.parse(restoreKey) as [string, string][];
        void (async () => {
            for (const [id, presetId] of entries) {
                if (cancelled) return;
                try {
                    const uri = await ensureOriginalAudioFile(presetId);
                    if (cancelled || !mounted.current || latest.current.timeline.media[id]?.originalAudio?.presetId !== presetId) continue;
                    latest.current.setLocalMediaUris(current => current[id] ? current : { ...current, [id]: uri });
                } catch { if (!cancelled && mounted.current) latest.current.setProblem(t('editorAudioTools.prepareFailed')); }
            }
        })();
        return () => { cancelled = true; };
    }, [restoreKey]);
    const prepare = async (id: string, insert: boolean) => {
        if (busy.current) return;
        busy.current = true; setPreparing(true); stop(); const token = previewToken.current, life = lifetime.current;
        try {
            const uri = await ensureOriginalAudioFile(id);
            if (!mounted.current || lifetime.current !== life) return;
            const current = latest.current;
            if (insert) {
                const media = originalAudioMedia(id, `l-${randomUUID()}`), at = clampFrame(current.frameStore.get());
                current.insertMedia(media, at, true, trimmed => {
                    if (!mounted.current || lifetime.current !== life) return;
                    const timeline = latest.current.currentTimeline(), clip = timeline.audio.find(c => c.mediaId === media.id);
                    if (clip) latest.current.onPlacement(t(trimmed ? 'editorAudioTools.addedTrimmed' : 'editorAudioTools.added',
                        { name: media.name!, time: formatTimecode(clip.start, timeline.fps) }));
                    latest.current.setLocalMediaUris(uris => ({ ...uris, [media.id]: uri }));
                }, result => {
                    if (!mounted.current || lifetime.current !== life) return;
                    latest.current.setProblem(typeof result === 'object' && result.status === 'refused' ?
                        t(result.reason === 'tooLarge' ? 'editorEditGate.tooLarge' : 'editorEditGate.invalid') : t('editorAudioTools.prepareFailed'));
                });
            } else if (token === previewToken.current && !current.playing) {
                audition.current ??= createAudition(active => { if (!active && mounted.current) setPreview(null); });
                await audition.current.play(uri);
                if (mounted.current && token === previewToken.current) setPreview(id);
            }
        } catch { if (mounted.current) latest.current.setProblem(t('editorAudioTools.prepareFailed')); }
        finally { busy.current = false; if (mounted.current) setPreparing(false); }
    };
    return { preparing, preview, stop, insert: (id: string) => prepare(id, true), play: (id: string) => prepare(id, false) };
}
export type OriginalAudioActions = ReturnType<typeof useOriginalAudio>;
