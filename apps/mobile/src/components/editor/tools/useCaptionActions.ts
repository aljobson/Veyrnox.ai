import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCacheUser } from '../../../lib/appCache';
import { t } from '../../../lib/i18n';
import { timelineOf, type Timeline, type Selection, type TextClip } from '../../../lib/nativeEditorModel';
import type { ProjectDocument } from '../../../lib/editorBridge';
import type { FrameStore } from '../editorFrameStore';
import { pickCaptionFile, shareCaptionFile } from '../../../lib/editorCaptionFiles';
import { captionTextEdit, importCaptionText, captionExport, wordEdit, wordStyleEdit, wordsDistribute, wordsClear, transcriptCut,
    transcriptCorrect, lyricsAlign, captionStyleAll, type CaptionResult, type TranscriptSelection } from '../../../lib/editorCaptionEdit';
export function useCaptionActions({ timeline, selection, applyTimeline, setProblem, setSelection, setSelections, frameStore, beginImport, currentDocument }: {
    timeline: Timeline; selection: Selection | null; applyTimeline(tl: Timeline): boolean; setProblem(message: string | null): void;
    setSelection(next: Selection | null): void; setSelections(next: Selection[]): void; frameStore: FrameStore;
    beginImport(): { valid(): boolean; end(): void } | null; currentDocument(): ProjectDocument | null;
}) {
    const [busy, setBusy] = useState(false), running = useRef(false), mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const latest = useRef({ applyTimeline, setProblem, currentDocument });
    useLayoutEffect(() => { latest.current = { applyTimeline, setProblem, currentDocument }; }, [applyTimeline, setProblem, currentDocument]);
    const current = () => timelineOf(latest.current.currentDocument()?.timeline ?? timeline);
    const select = (id: string, start: number) => {
        const next: Selection = { track: 'text', id }; setSelection(next); setSelections([next]); frameStore.set(start);
    };
    const commit = (result: CaptionResult) => {
        if ('refused' in result) { latest.current.setProblem(t(result.refused.key, result.refused.params)); return false; }
        if (!latest.current.applyTimeline(result.timeline)) return false;
        latest.current.setProblem(null); return true;
    };
    async function io(run: (live: () => boolean) => Promise<void>) {
        if (running.current) return;
        const token = beginImport(); if (!token) return;
        const owner = getCacheUser();
        const live = () => mounted.current && owner === getCacheUser() && token.valid();
        running.current = true; setBusy(true);
        try { await run(live); } finally { token.end(); running.current = false; if (mounted.current) setBusy(false); }
    }
    return {
        busy, select,
        text: (text: string) => selection?.track === 'text' && commit(captionTextEdit(current(), selection.id, text)),
        pick: () => io(async live => {
            const file = await pickCaptionFile(live); if (!live() || !file) return;
            if ('refused' in file) {
                setProblem(file.refused === 'fileTooLarge' ? t('editorCaptionTools.fileTooLarge') : t('editorCaptionTools.fileUnreadable')); return;
            }
            const result = importCaptionText(current(), file.text, file.name);
            if (!live() || !commit(result) || !('timeline' in result)) return;
            const cue = result.timeline.text.at(-1); if (cue) select(cue.id, cue.start);
            setProblem(t('editorCaptionTools.added', { count: result.count ?? 0 }));
        }),
        share: (format: 'srt' | 'vtt' | 'txt', trackId = 'all') => io(async live => {
            const file = captionExport(current(), format, trackId); if (!file) return;
            try { const status = await shareCaptionFile(file, live); if (live() && status === 'unavailable') setProblem(t('editorCaptionTools.unavailable')); }
            catch { if (live()) setProblem(t('editorCaptionTools.shareFailed')); }
        }),
        word: (index: number, key: 'start' | 'len', frames: number) => selection?.track === 'text'
            && commit(wordEdit(current(), selection.id, index, key, frames)),
        wordStyle: (change: Partial<NonNullable<TextClip['wordStyle']>>) => selection?.track === 'text' && commit(wordStyleEdit(current(), selection.id, change)),
        distribute: () => selection?.track === 'text' && commit(wordsDistribute(current(), selection.id)),
        clear: () => selection?.track === 'text' && commit(wordsClear(current(), selection.id)),
        cut: (range: TranscriptSelection, trackId: string) => commit(transcriptCut(current(), range, trackId)),
        correct: (key: string, text: string) => commit(transcriptCorrect(current(), key, text)),
        align: (lyrics: string, sourceId: string) => commit(lyricsAlign(current(), lyrics, sourceId)),
        styleAll: (style: TextClip['style'] | 'web') => commit(captionStyleAll(current(), style)),
    };
}
export type CaptionActions = ReturnType<typeof useCaptionActions>;
