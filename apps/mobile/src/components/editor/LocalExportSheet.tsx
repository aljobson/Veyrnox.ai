import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { createNativeEditorLocalExportDependencies } from '../../lib/editorCompositorNative';
import { exportEditorMp4, type EditorLocalExportProgress, type EditorLocalExportResult } from '../../lib/editorLocalExport';
import { editorMedia } from '../../lib/editorMedia';
import { framesIn, type Canvas, type Timeline } from '../../lib/nativeEditorModel';
import { formatNumber, t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { touchTarget } from '../../lib/a11y';
import { colors } from '../../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withEditorExportSources, type EditorExportSourceFailureCode, type EditorExportSourceResult } from '../../lib/editorExportSources';
import type { ApiClient } from '../../lib/api';
import { useSessionTask } from '../../auth/sessionTask';
import { editorFontStore } from '../../lib/editorFontFiles';

type Props = { visible: boolean; api: Pick<ApiClient, 'request'>; account: string; projectId: string; revision: number; timeline: Timeline; canvas: Canvas;
    localMediaUris: Readonly<Record<string, string>>; onClose(): void; onCloud(): void };
type Phase = 'idle' | 'exporting' | 'done' | 'error';
type ExportError = EditorExportSourceFailureCode | 'invalid-timeline' | 'unsupported-frame' | 'native-media' | 'write-failed' | 'save-permission' | 'share-unavailable';
export const localExportDimensions = (canvas: Canvas) => canvas.aspect_ratio === '9:16' ? { width: 720, height: 1280 }
    : canvas.aspect_ratio === '1:1' ? { width: 960, height: 960 } : { width: 1280, height: 720 };
export const localExportInterruptedState = (taskCurrent: boolean, aborted: boolean): { phase: Phase; error: ExportError | null } =>
    !taskCurrent ? { phase: 'error', error: 'stale' } : aborted ? { phase: 'idle', error: null } : { phase: 'error', error: 'write-failed' };
export function LocalExportSheet({ visible, api, account, projectId, revision, timeline, canvas, localMediaUris, onClose, onCloud }: Props) {
    const insets = useSafeAreaInsets();
    const beginSessionTask = useSessionTask();
    const [phase, setPhase] = useState<Phase>('idle'), [error, setError] = useState<ExportError | null>(null);
    const [progress, setProgress] = useState<EditorLocalExportProgress | null>(null);
    const [artifact, setArtifact] = useState<Extract<EditorLocalExportResult, { ok: true }>['artifact'] | null>(null);
    const exportIdentity = `${projectId}:${revision}`;
    const controller = useRef<AbortController | null>(null), mounted = useRef(true), latestArtifact = useRef(artifact), lastIdentity = useRef(exportIdentity); latestArtifact.current = artifact;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); const value = latestArtifact.current;
        latestArtifact.current = null; if (value) void editorMedia.release(projectId, value.artifactId); }; }, [projectId]);
    useEffect(() => {
        if (lastIdentity.current === exportIdentity) return;
        lastIdentity.current = exportIdentity; controller.current?.abort(); controller.current = null;
        const value = latestArtifact.current; latestArtifact.current = null; if (value) void editorMedia.release(projectId, value.artifactId);
        setArtifact(null); setError(null); setProgress(null); setPhase('idle');
    }, [exportIdentity, projectId]);
    const close = () => { if (phase !== 'exporting') onClose(); };
    const start = async () => {
        if (controller.current) return;
        const frozen = JSON.parse(JSON.stringify(timeline)) as Timeline, abort = new AbortController(), task = beginSessionTask(); controller.current = abort;
        if (artifact) await editorMedia.release(projectId, artifact.artifactId).catch(() => undefined);
        setArtifact(null); setError(null); setProgress(null); setPhase('exporting');
        let prepared: EditorExportSourceResult<EditorLocalExportResult>;
        try { prepared = await withEditorExportSources({ api, task, account, projectId, timeline: frozen, localMediaUris, signal: abort.signal }, materialized =>
            exportEditorMp4({ timeline: frozen, ...localExportDimensions(canvas), videoBitRate: 6_000_000, audioBitRate: 192_000,
                signal: abort.signal, onProgress: value => { if (mounted.current && controller.current === abort && task.current()) setProgress(value); } },
            createNativeEditorLocalExportDependencies(account, projectId, frozen,
                { ...materialized, ...editorFontStore.exportSources(projectId, frozen.fonts ?? []) })));
        } catch {
            const owns = controller.current === abort;
            if (owns) controller.current = null;
            if (mounted.current && owns) { const next = localExportInterruptedState(task.current(), abort.signal.aborted);
                setError(next.error); setPhase(next.phase); setProgress(null); }
            return;
        }
        if (!mounted.current || controller.current !== abort || !task.current()) {
            const owns = controller.current === abort;
            if (owns) controller.current = null;
            if (mounted.current && owns) { const next = localExportInterruptedState(task.current(), abort.signal.aborted);
                setError(next.error); setPhase(next.phase); setProgress(null); }
            if (prepared.ok && prepared.value.ok) await editorMedia.release(projectId, prepared.value.artifact.artifactId); return;
        }
        controller.current = null;
        if (!prepared.ok) {
            if (prepared.code === 'cancelled') { setError(null); setProgress(null); setPhase('idle'); }
            else { setError(prepared.code); setPhase('error'); }
            return;
        }
        const result = prepared.value;
        if (result.ok) { setArtifact(result.artifact); setPhase('done'); }
        else if (result.code === 'cancelled') { setPhase('idle'); setProgress(null); }
        else { setError(result.code === 'invalid-timeline' ? 'invalid-timeline' : result.code === 'unsupported-frame' ? 'unsupported-frame'
            : result.code === 'native-media' ? 'native-media' : 'write-failed'); setPhase('error'); }
    };
    const save = async () => { if (!artifact) return; const permission = await requestPermissionsAsync(true);
        if (!permission.granted) { setError('save-permission'); return; } try { await Asset.create(artifact.uri); } catch { setError('write-failed'); } };
    const share = async () => { if (!artifact) return; try { if (!await Sharing.isAvailableAsync()) { setError('share-unavailable'); return; }
        await Sharing.shareAsync(artifact.uri, { mimeType: 'video/mp4' }); } catch { setError('write-failed'); } };
    const value = Math.round((progress?.value ?? 0) * 100), messageKey = error ? `editorLocalExport.${error}` as Parameters<typeof t>[0] : null;
    return <Modal visible={visible} transparent animationType="none" onRequestClose={close}><View style={styles.backdrop} onAccessibilityEscape={close}>
        <ScrollView style={styles.sheet} contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 12), paddingLeft: Math.max(24, insets.left + 16),
            paddingRight: Math.max(24, insets.right + 16) }]}><Text accessibilityRole="header" style={styles.heading}>{t('editorLocalExport.title')}</Text>
        <Text style={styles.text}>{t('editorLocalExport.help')}</Text>
        {phase === 'exporting' ? <><Text accessibilityLiveRegion="polite" style={styles.text}>{t(`editorLocalExport.${progress?.stage ?? 'preparing'}` as Parameters<typeof t>[0])}</Text>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }} style={styles.track}><View style={[styles.fill, { width: `${value}%` }]} /></View>
            <Text style={styles.text}>{t('editorLocalExport.progress', { percent: value, frame: progress?.frame ?? 0, total: progress?.frames ?? framesIn(timeline) })}</Text>
            <Button label={t('editorScenes.cancel')} onPress={() => controller.current?.abort()} /></> : null}
        {messageKey ? <Text accessibilityRole="alert" style={styles.error}>{t(messageKey)}</Text> : null}
        {phase === 'idle' || phase === 'error' ? <Button label={t('editorLocalExport.start')} onPress={() => void start()} /> : null}
        {phase === 'done' && artifact ? <><Text accessibilityLiveRegion="polite" style={styles.text}>{t('editorLocalExport.done', { size: formatNumber(artifact.size / 1048576, 1) })}</Text>
            <Button label={t('editorServerExport.save')} onPress={() => void save()} /><Button label={t('editorServerExport.share')} onPress={() => void share()} /></> : null}
        {phase !== 'exporting' ? <Button label={t('editorLocalExport.cloud')} onPress={onCloud} /> : null}<Button label={t('editorServerExport.close')} disabled={phase === 'exporting'} onPress={close} />
        </ScrollView></View></Modal>;
}
function Button({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress(): void }) { return <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, touchTarget, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.text}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }, sheet: { maxHeight: '90%', backgroundColor: colors.background }, content: { padding: 24, gap: 12 },
    heading: { fontSize: 22, fontWeight: '700', color: colors.text }, text: { color: colors.text, fontSize: 16 }, error: { color: colors.danger, fontSize: 16 },
    button: { justifyContent: 'center', paddingHorizontal: 12, marginVertical: 4, borderWidth: 1, borderColor: colors.muted, borderRadius: 8 }, disabled: { opacity: .45 }, pressed: { opacity: .7 },
    track: { height: 6, backgroundColor: colors.muted, borderRadius: 3, overflow: 'hidden' }, fill: { height: 6, backgroundColor: colors.accent } });
