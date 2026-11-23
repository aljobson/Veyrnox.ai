import { useEffect, useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { AccessibilityInfo, Platform } from 'react-native';
import { File } from 'expo-file-system';
import { addCustomFont, removeCustomFont } from '../../../../../app/veyrnox/_lib/editorOrganization.mjs';
import { EDITOR_ORGANIZATION_ENABLED } from '../../lib/editorFlag';
import { editorFontStore, type FontDraft, type FontFileProblem } from '../../lib/editorFontFiles';
import { t } from '../../lib/i18n';
import { validCustomFonts, type CustomFont, type Timeline } from '../../lib/nativeEditorModel';
import type { DocumentCommitResult } from '../../lib/editorDocumentGate';

type ImportToken = { valid(): boolean; end(): void };
type Params = {
    projectId: string; timeline: Timeline; ready: boolean;
    beginImport(): ImportToken | null; currentTimeline(): Timeline; applyTimeline(next: Timeline): DocumentCommitResult;
};
const problemCopy: Record<FontFileProblem, string> = {
    invalidFile: 'editorFont.invalidFile', unsupportedFormat: 'editorFont.unsupportedFormat', invalidMetadata: 'editorFont.invalidMetadata',
    originalMismatch: 'editorFont.originalMismatch', loadFailed: 'editorFont.loadFailed', accountChanged: 'editorFont.accountChanged',
};

export function useEditorFonts({ projectId, timeline, ready, beginImport, currentTimeline, applyTimeline }: Params) {
    const available = EDITOR_ORGANIZATION_ENABLED && Platform.OS === 'ios';
    const [version, setVersion] = useState(0), [busy, setBusy] = useState<string | null>(null), [problem, setProblem] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const fonts = useMemo(() => validCustomFonts({ fonts: timeline.fonts }), [timeline.fonts]);
    const identity = useMemo(() => JSON.stringify(fonts.map(font => [font.family, font.sha256, font.bytes, font.format])), [fonts]);
    useEffect(() => { const off = editorFontStore.subscribe(() => setVersion(value => value + 1)); return () => { off(); }; }, []);
    useEffect(() => {
        if (!ready || !available) return;
        void editorFontStore.setProject(projectId);
        return () => { void editorFontStore.releaseProject(projectId); };
    }, [projectId, ready, available]);
    useEffect(() => { let live = true; void (async () => { await Promise.resolve(); if (!live) return;
        if (!ready || !available) { setChecking(false); return; } setChecking(true);
        await editorFontStore.hydrate(projectId, fonts); if (live) setChecking(false);
    })(); return () => { live = false; }; }, [projectId, identity, ready, version]); // eslint-disable-line react-hooks/exhaustive-deps
    const finishPick = async (draft: FontDraft, declared?: CustomFont) => {
        if (!available) return false;
        const token = beginImport(); if (!token) return false;
        let cache: File | undefined, settledFonts: readonly CustomFont[] | undefined;
        setBusy(declared?.family ?? 'new'); setProblem(null);
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-woff', 'application/font-woff2',
                'application/x-font-ttf', 'application/x-font-opentype'], copyToCacheDirectory: true, multiple: false });
            if (result.canceled || !result.assets[0]) return false;
            const asset = result.assets[0]; cache = new File(asset.uri); if (!token.valid()) return false;
            const installed = await editorFontStore.install(projectId, { uri: asset.uri, name: asset.name, size: asset.size }, draft, declared);
            if (!token.valid()) return false;
            if ('problem' in installed) { const message = t(problemCopy[installed.problem], { name: declared?.name ?? draft.name }); setProblem(message);
                AccessibilityInfo.announceForAccessibility(message); return false; }
            if (!declared) {
                const current = currentTimeline();
                const duplicate = validCustomFonts(current).find(font => font.family === installed.font.family);
                if (duplicate) { settledFonts = validCustomFonts(current); setProblem(t('editorFont.alreadyAdded'));
                    AccessibilityInfo.announceForAccessibility(t('editorFont.alreadyAdded')); return true; }
                if ((current.fonts?.length ?? 0) !== validCustomFonts(current).length) { const message = t('editorFont.invalidMetadata');
                    setProblem(message); AccessibilityInfo.announceForAccessibility(message); return false; }
                const next = addCustomFont(current, installed.font) as Timeline | { error: string };
                if ('error' in next) { const message = t('editorFont.projectFull'); setProblem(message);
                    AccessibilityInfo.announceForAccessibility(message); return false; }
                const commit = applyTimeline(next);
                if (commit.status !== 'accepted') { const message = commit.status === 'refused'
                    ? t(`editorEditGate.${commit.reason}`) : t('editorFont.accountChanged'); setProblem(message); AccessibilityInfo.announceForAccessibility(message); return false; }
                settledFonts = validCustomFonts(next);
            } else {
                settledFonts = validCustomFonts(currentTimeline());
            }
            setProblem(null); AccessibilityInfo.announceForAccessibility(t('editorFont.ready')); return true;
        } catch { if (token.valid()) { const message = t('editorFont.loadFailed'); setProblem(message); AccessibilityInfo.announceForAccessibility(message); } return false; }
        finally {
            // Reconcile the provisional on-disk publication with the document that
            // actually won. Expired editor/import tokens must not mutate a newer
            // project generation that happens to reuse the same project ID.
            if (token.valid()) editorFontStore.declare(projectId, settledFonts ?? validCustomFonts(currentTimeline()));
            token.end(); setBusy(null);
            try { if (cache?.exists) cache.delete(); } catch { /* Best-effort document-picker cache cleanup. */ }
        }
    };
    const remove = async (font: CustomFont) => {
        const current = currentTimeline();
        if ((current.fonts?.length ?? 0) !== validCustomFonts(current).length) { const message = t('editorFont.invalidMetadata'); setProblem(message);
            AccessibilityInfo.announceForAccessibility(message); return false; }
        const next = removeCustomFont(current, font.family) as Timeline | { error: string };
        if ('error' in next) { const message = t('editorFont.used'); setProblem(message); AccessibilityInfo.announceForAccessibility(message); return false; }
        const commit = applyTimeline(next); if (commit.status !== 'accepted') { const message = commit.status === 'refused' ? t(`editorEditGate.${commit.reason}`) :
            t('editorFont.accountChanged'); setProblem(message); AccessibilityInfo.announceForAccessibility(message); return false; }
        editorFontStore.declare(projectId, validCustomFonts(next));
        await editorFontStore.remove(projectId, font); setProblem(null); AccessibilityInfo.announceForAccessibility(t('editorFont.removed')); return true;
    };
    return {
        available, busy, problem, checking, clearProblem: () => setProblem(null),
        has: (family: string) => editorFontStore.has(projectId, family),
        failed: (family: string) => editorFontStore.failed(projectId, family),
        add: (draft: FontDraft) => finishPick(draft),
        relink: (font: CustomFont) => finishPick({ name: font.name, rights: font.rights }, font),
        remove,
    };
}
export type EditorFontActions = ReturnType<typeof useEditorFonts>;
