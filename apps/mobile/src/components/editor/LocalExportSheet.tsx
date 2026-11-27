import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { createNativeEditorLocalExportDependencies } from '../../lib/editorCompositorNative';
import { exportEditorMp4, type EditorLocalExportProgress, type EditorLocalExportResult } from '../../lib/editorLocalExport';
import { editorMediaArtifacts } from '../../lib/editorMedia/artifacts';
import { canvasPixelSize, framesIn, type Canvas, type Timeline } from '../../lib/nativeEditorModel';
import { formatNumber, t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { touchTarget } from '../../lib/a11y';
import { studioColors as colors } from '../../theme';
import { withEditorExportSources, type EditorExportSourceFailureCode, type EditorExportSourceResult } from '../../lib/editorExportSources';
import type { ApiClient } from '../../lib/api';
import { useSessionTask } from '../../auth/sessionTask';
import { editorFontStore } from '../../lib/editorFontFiles';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { ExportFootagePreview } from './ExportFootagePreview';

type Props = { visible: boolean; api: Pick<ApiClient, 'request'>; account: string; projectId: string; revision: number; timeline: Timeline; canvas: Canvas;
    localMediaUris: Readonly<Record<string, string>>; onClose(): void; onCloud(): void };
type Phase = 'idle' | 'exporting' | 'done' | 'error';
type ExportError = EditorExportSourceFailureCode | 'invalid-timeline' | 'unsupported-frame' | 'native-media' | 'write-failed' | 'save-permission' | 'save-failed' | 'share-unavailable';
export const localExportDimensions = (canvas: Canvas) => canvasPixelSize(canvas.aspect_ratio, canvas.aspect_ratio === '1:1' ? 960 : 1280,
    canvas.aspect_ratio === '1:1' ? 960 : 1280);
const MAX_LOCAL_EXPORT_PIXELS = 1280 * 720;
export const fittedLocalExportDimensions = (canvas: Canvas) => {
    const desired = localExportDimensions(canvas);
    if (desired.width * desired.height <= MAX_LOCAL_EXPORT_PIXELS) return desired;
    const scale = Math.sqrt(MAX_LOCAL_EXPORT_PIXELS / (desired.width * desired.height));
    return { width: Math.max(2, Math.floor(desired.width * scale / 2) * 2), height: Math.max(2, Math.floor(desired.height * scale / 2) * 2) };
};
export type LocalExportQuality = 'compact' | 'standard' | 'high';
export type LocalExportCodec = 'h264' | 'hevc';
export const LOCAL_EXPORT_QUALITY: Readonly<Record<LocalExportQuality, { videoBitRate: number; audioBitRate: number }>> = Object.freeze({
    compact: { videoBitRate: 3_000_000, audioBitRate: 128_000 },
    standard: { videoBitRate: 6_000_000, audioBitRate: 192_000 },
    high: { videoBitRate: 6_400_000, audioBitRate: 256_000 },
});
export const estimatedLocalExportBytes = (timeline: Timeline, quality: LocalExportQuality): number => {
    const seconds = framesIn(timeline) / Math.max(1, timeline.fps), preset = LOCAL_EXPORT_QUALITY[quality];
    return Math.ceil(seconds * (preset.videoBitRate + preset.audioBitRate) / 8);
};
export type LocalExportPhotoSaveResult = 'saved' | 'permission' | 'failed' | 'stale';
export async function saveLocalExportToPhotos(uri: string, isCurrent: () => boolean, dependencies = {
    requestPermission: () => requestPermissionsAsync(true), create: (value: string) => Asset.create(value),
}): Promise<LocalExportPhotoSaveResult> {
    try { const permission = await dependencies.requestPermission();
        if (!isCurrent()) return 'stale';
        if (!permission.granted) return 'permission';
        await dependencies.create(uri);
        return isCurrent() ? 'saved' : 'stale';
    } catch { return isCurrent() ? 'failed' : 'stale'; }
}
export const localExportInterruptedState = (taskCurrent: boolean, aborted: boolean): { phase: Phase; error: ExportError | null } =>
    !taskCurrent ? { phase: 'error', error: 'stale' } : aborted ? { phase: 'idle', error: null } : { phase: 'error', error: 'write-failed' };
export function LocalExportSheet({ visible, api, account, projectId, revision, timeline, canvas, localMediaUris, onClose, onCloud }: Props) {
    const insets = useOptionalSafeAreaInsets();
    const beginSessionTask = useSessionTask();
    const [phase, setPhase] = useState<Phase>('idle'), [error, setError] = useState<ExportError | null>(null);
    const [progress, setProgress] = useState<EditorLocalExportProgress | null>(null);
    const [artifact, setArtifact] = useState<Extract<EditorLocalExportResult, { ok: true }>['artifact'] | null>(null);
    const [quality, setQuality] = useState<LocalExportQuality>('standard'), [codec, setCodec] = useState<LocalExportCodec>('h264');
    const [autoSave, setAutoSave] = useState(true), [saved, setSaved] = useState(false), [saving, setSaving] = useState(false);
    const exportIdentity = `${projectId}:${revision}`;
    const controller = useRef<AbortController | null>(null), mounted = useRef(true), latestArtifact = useRef(artifact), lastIdentity = useRef(exportIdentity), saveToken = useRef(0); latestArtifact.current = artifact;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); const value = latestArtifact.current;
        latestArtifact.current = null; if (value) void editorMediaArtifacts.release(projectId, value.artifactId); }; }, [projectId]);
    useEffect(() => {
        if (lastIdentity.current === exportIdentity) return;
        lastIdentity.current = exportIdentity; controller.current?.abort(); controller.current = null;
        saveToken.current += 1;
        const value = latestArtifact.current; latestArtifact.current = null; if (value) void editorMediaArtifacts.release(projectId, value.artifactId);
        setArtifact(null); setError(null); setProgress(null); setSaved(false); setSaving(false); setPhase('idle');
    }, [exportIdentity, projectId]);
    const close = () => { if (phase !== 'exporting' && !saving) onClose(); };
    const start = async () => {
        if (controller.current) return;
        const frozen = JSON.parse(JSON.stringify(timeline)) as Timeline, abort = new AbortController(), task = beginSessionTask(); controller.current = abort;
        if (artifact) await editorMediaArtifacts.release(projectId, artifact.artifactId).catch(() => undefined);
        setArtifact(null); setError(null); setProgress(null); setSaved(false); setSaving(false); setPhase('exporting');
        const preset = LOCAL_EXPORT_QUALITY[quality];
        let prepared: EditorExportSourceResult<EditorLocalExportResult>;
        try { prepared = await withEditorExportSources({ api, task, account, projectId, timeline: frozen, localMediaUris, signal: abort.signal }, materialized =>
            exportEditorMp4({ timeline: frozen, ...fittedLocalExportDimensions(canvas), videoBitRate: preset.videoBitRate, audioBitRate: preset.audioBitRate,
                codec, signal: abort.signal, onProgress: value => { if (mounted.current && controller.current === abort && task.current()) setProgress(value); } },
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
            if (prepared.ok && prepared.value.ok) await editorMediaArtifacts.release(projectId, prepared.value.artifact.artifactId); return;
        }
        controller.current = null;
        if (!prepared.ok) {
            if (prepared.code === 'cancelled') { setError(null); setProgress(null); setPhase('idle'); }
            else { setError(prepared.code); setPhase('error'); }
            return;
        }
        const result = prepared.value;
        if (result.ok) {
            latestArtifact.current = result.artifact; setArtifact(result.artifact); setPhase('done');
            if (autoSave) {
                const token = ++saveToken.current; setSaving(true);
                const stillCurrent = () => mounted.current && task.current() && latestArtifact.current?.artifactId === result.artifact.artifactId;
                const outcome = await saveLocalExportToPhotos(result.artifact.uri, stillCurrent);
                if (!mounted.current || saveToken.current !== token) return;
                if (stillCurrent()) { if (outcome === 'saved') setSaved(true); else if (outcome === 'permission') setError('save-permission');
                    else if (outcome === 'failed') setError('save-failed'); }
                else if (!task.current()) { setError('stale'); setPhase('error'); }
                setSaving(false);
            }
        }
        else if (result.code === 'cancelled') { setPhase('idle'); setProgress(null); }
        else { setError(result.code === 'invalid-timeline' ? 'invalid-timeline' : result.code === 'unsupported-frame' ? 'unsupported-frame'
            : result.code === 'native-media' ? 'native-media' : 'write-failed'); setPhase('error'); }
    };
    const save = async () => { if (!artifact || saving) return; const target = artifact, token = ++saveToken.current; setSaving(true); setError(null);
        const stillCurrent = () => mounted.current && latestArtifact.current?.artifactId === target.artifactId;
        const outcome = await saveLocalExportToPhotos(target.uri, stillCurrent);
        if (!mounted.current || saveToken.current !== token) return;
        if (stillCurrent()) { if (outcome === 'saved') setSaved(true); else if (outcome === 'permission') setError('save-permission');
            else if (outcome === 'failed') setError('save-failed'); }
        setSaving(false); };
    const share = async () => { if (!artifact) return; try { if (!await Sharing.isAvailableAsync()) { setError('share-unavailable'); return; }
        await Sharing.shareAsync(artifact.uri, { mimeType: 'video/mp4' }); } catch { setError('write-failed'); } };
    const value = Math.round((progress?.value ?? 0) * 100), messageKey = error ? `editorLocalExport.${error}` as Parameters<typeof t>[0] : null;
    const announcedValue = Math.floor(value / 10) * 10, totalFrames = progress?.frames ?? framesIn(timeline);
    const announcement = messageKey ? t(messageKey) : phase === 'done' && artifact ? t('editorLocalExport.done', { size: formatNumber(artifact.size / 1_000_000, 1) })
        : phase === 'exporting' ? `${t(`editorLocalExport.${progress?.stage ?? 'preparing'}` as Parameters<typeof t>[0])}. ${t('editorLocalExport.progress', {
            percent: announcedValue, frame: Math.round(totalFrames * announcedValue / 100), total: totalFrames,
        })}` : null;
    useAnnouncement(visible ? announcement : null);
    return <Modal visible={visible} transparent animationType="none" onRequestClose={close}><View style={styles.backdrop} onAccessibilityEscape={close}>
        <ScrollView style={styles.sheet} contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 12), paddingLeft: Math.max(24, insets.left + 16),
            paddingRight: Math.max(24, insets.right + 16) }]}><Text accessibilityRole="header" style={styles.heading}>{t('editorLocalExport.title')}</Text>
        <Text style={styles.text}>{t('editorLocalExport.help')}</Text>
        {phase === 'exporting' ? <ExportFootagePreview timeline={timeline} frame={progress?.frame ?? 0} api={api} localMediaUris={localMediaUris} /> : null}
        {phase === 'exporting' ? <><Text style={styles.text}>{t(`editorLocalExport.${progress?.stage ?? 'preparing'}` as Parameters<typeof t>[0])}</Text>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }} style={styles.track}><View style={[styles.fill, { width: `${value}%` }]} /></View>
            <Text style={styles.text}>{t('editorLocalExport.progress', { percent: value, frame: progress?.frame ?? 0, total: progress?.frames ?? framesIn(timeline) })}</Text>
            <Button label={t('editorScenes.cancel')} onPress={() => controller.current?.abort()} /></> : null}
        {messageKey ? <Text style={styles.error}>{t(messageKey)}</Text> : null}
        {phase === 'idle' || phase === 'error' ? <><Text style={styles.label}>{t('editorLocalExport.quality')}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={rawText(t('editorLocalExport.quality'))} style={styles.row}>{(['compact', 'standard', 'high'] as const).map(value => <Pressable key={value} accessibilityRole="radio"
                accessibilityLabel={rawText(t(`editorLocalExport.quality.${value}` as Parameters<typeof t>[0]))} accessibilityState={{ checked: quality === value }} onPress={() => setQuality(value)} style={[styles.choice, quality === value && styles.choiceSelected]}>
                <Text style={styles.text}>{t(`editorLocalExport.quality.${value}` as Parameters<typeof t>[0])}</Text></Pressable>)}</View>
            <Text style={styles.label}>{t('editorLocalExport.codec')}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={rawText(t('editorLocalExport.codec'))} style={styles.row}>{(['h264', 'hevc'] as const).map(value => <Pressable key={value} accessibilityRole="radio"
                accessibilityLabel={rawText(t(`editorLocalExport.codec.${value}` as Parameters<typeof t>[0]))} accessibilityState={{ checked: codec === value }}
                onPress={() => setCodec(value)} style={[styles.choice, codec === value && styles.choiceSelected]}>
                <Text style={styles.text}>{t(`editorLocalExport.codec.${value}` as Parameters<typeof t>[0])}</Text></Pressable>)}</View>
            <Text style={styles.text}>{t(codec === 'hevc' ? 'editorLocalExport.codec.hevcHelp' : 'editorLocalExport.codec.h264Help')}</Text>
            <Text style={styles.text}>{t('editorLocalExport.estimate', { size: formatNumber(estimatedLocalExportBytes(timeline, quality) / 1_000_000, 1) })}</Text>
            <View style={styles.switchRow}><Text style={styles.text}>{t('editorLocalExport.autoSave')}</Text><Switch accessibilityLabel={rawText(t('editorLocalExport.autoSave'))}
                value={autoSave} onValueChange={setAutoSave} /></View><Button label={t('editorLocalExport.start')} onPress={() => void start()} /></> : null}
        {phase === 'done' && artifact ? <><Text style={styles.text}>{t('editorLocalExport.done', { size: formatNumber(artifact.size / 1_000_000, 1) })}</Text>
            {saving ? <Text style={styles.text}>{t('editorLocalExport.saving')}</Text> : saved ? <Text style={styles.text}>{t('editorLocalExport.saved')}</Text>
                : <Button label={t('editorLocalExport.save')} onPress={() => void save()} />}
            <Button label={t('editorServerExport.share')} disabled={saving} onPress={() => void share()} /></> : null}
        {phase !== 'exporting' && !saving ? <Button label={t('editorLocalExport.cloud')} onPress={onCloud} /> : null}<Button label={t('editorServerExport.close')} disabled={phase === 'exporting' || saving} onPress={close} />
        </ScrollView></View></Modal>;
}
function Button({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress(): void }) { return <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, touchTarget, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.text}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }, sheet: { maxHeight: '90%', backgroundColor: colors.background }, content: { padding: 24, gap: 12 },
    heading: { fontSize: 22, fontWeight: '700', color: colors.text }, label: { color: colors.text, fontSize: 14, fontWeight: '700' }, text: { color: colors.text, fontSize: 16 }, error: { color: colors.danger, fontSize: 16 },
    button: { justifyContent: 'center', paddingHorizontal: 12, marginVertical: 4, borderWidth: 1, borderColor: colors.muted, borderRadius: 8 }, disabled: { opacity: .45 }, pressed: { opacity: .7 },
    row: { flexDirection: 'row', gap: 8 }, choice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.muted, borderRadius: 8 },
    choiceSelected: { borderColor: colors.accent, backgroundColor: `${colors.accent}22` }, switchRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    track: { height: 6, backgroundColor: colors.muted, borderRadius: 3, overflow: 'hidden' }, fill: { height: 6, backgroundColor: colors.accent } });
