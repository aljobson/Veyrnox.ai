import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { createNativeEditorAudioExportDependencies, createNativeEditorLocalExportDependencies } from '../../lib/editorCompositorNative';
import { editorLocalExportFrameCount, editorLocalExportSourceFrame, exportEditorMp4, type EditorLocalExportProgress, type EditorLocalExportResult } from '../../lib/editorLocalExport';
import { exportEditorWav, releaseWavArtifact, type EditorAudioExportResult } from '../../lib/editorAudioExport';
import { editorMediaArtifacts } from '../../lib/editorMedia/artifacts';
import { canvasPixelSize, canvasResolutionSize, framesIn, type Canvas, type Timeline } from '../../lib/nativeEditorModel';
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
import { optionalEditorMediaModule } from '../../lib/editorMedia/native';

type Props = { visible: boolean; api: Pick<ApiClient, 'request'>; account: string; projectId: string; revision: number; timeline: Timeline; canvas: Canvas;
    localMediaUris: Readonly<Record<string, string>>; onClose(): void; onCloud(): void; onPrepare(): Promise<number | null | 'failed'>;
    onCommit(credits: number): Promise<number | null>; onBeginDelivery?(): Promise<number | null>; onFinalize(): Promise<number | null>; onCancel(): Promise<boolean> };
type Phase = 'idle' | 'exporting' | 'verifying' | 'done' | 'error';
type Output = 'video' | 'audio';
type ExportArtifact = Extract<EditorLocalExportResult, { ok: true }>['artifact'] | Extract<EditorAudioExportResult, { ok: true }>['artifact'];
type ExportError = EditorExportSourceFailureCode | 'invalid-timeline' | 'unsupported-frame' | 'native-media' | 'write-failed' | 'save-permission' | 'save-failed' | 'share-unavailable' | 'credit-check-failed' | 'credit-failed';
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
export type LocalExportResolution = '720p' | '1080p' | '4k';
export type LocalExportFrameRate = 24 | 25 | 30 | 60;
export const selectedLocalExportDimensions = (canvas: Canvas, resolution: LocalExportResolution) => {
    const edge = resolution === '720p' ? 720 : resolution === '1080p' ? 1080 : 2160;
    return canvasResolutionSize(canvas.aspect_ratio, edge) ?? fittedLocalExportDimensions(canvas);
};
export const LOCAL_EXPORT_QUALITY: Readonly<Record<LocalExportQuality, { videoBitRate: number; audioBitRate: number }>> = Object.freeze({
    compact: { videoBitRate: 3_000_000, audioBitRate: 128_000 },
    standard: { videoBitRate: 6_000_000, audioBitRate: 192_000 },
    high: { videoBitRate: 6_400_000, audioBitRate: 256_000 },
});
export const estimatedLocalExportBytes = (timeline: Timeline, quality: LocalExportQuality): number => {
    const seconds = framesIn(timeline) / Math.max(1, timeline.fps), preset = LOCAL_EXPORT_QUALITY[quality];
    return Math.ceil(seconds * (preset.videoBitRate + preset.audioBitRate) / 8);
};
export const estimatedLocalAudioBytes = (timeline: Timeline) => 44 + Math.ceil(framesIn(timeline) * 48000 / Math.max(1, timeline.fps)) * 4;
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
export type LocalExportShareResult = 'completed' | 'canceled' | 'unavailable' | 'failed';
export async function shareLocalExportWithCompletion(uri: string, mimeType: string,
    module = optionalEditorMediaModule()): Promise<LocalExportShareResult> {
    if (!module?.share) return 'unavailable';
    try {
        const result = await module.share(uri, mimeType);
        if (result?.ok !== true) return result?.code === 'share-unavailable' ? 'unavailable' : 'failed';
        return result.completed === true ? 'completed' : 'canceled';
    } catch { return 'failed'; }
}
export const localExportInterruptedState = (taskCurrent: boolean, aborted: boolean): { phase: Phase; error: ExportError | null } =>
    !taskCurrent ? { phase: 'error', error: 'stale' } : aborted ? { phase: 'idle', error: null } : { phase: 'error', error: 'write-failed' };
export function LocalExportSheet({ visible, api, account, projectId, revision, timeline, canvas, localMediaUris, onClose, onCloud, onPrepare, onCommit,
    onBeginDelivery = async () => revision, onFinalize, onCancel }: Props) {
    const insets = useOptionalSafeAreaInsets();
    const beginSessionTask = useSessionTask();
    const [phase, setPhase] = useState<Phase>('idle'), [error, setError] = useState<ExportError | null>(null);
    const [progress, setProgress] = useState<EditorLocalExportProgress | null>(null);
    const [artifact, setArtifact] = useState<ExportArtifact | null>(null), [output, setOutput] = useState<Output>('video');
    const [quality, setQuality] = useState<LocalExportQuality>('standard'), [codec, setCodec] = useState<LocalExportCodec>('h264');
    const [resolution, setResolution] = useState<LocalExportResolution>('1080p');
    const [frameRate, setFrameRate] = useState<LocalExportFrameRate>([24, 25, 30, 60].includes(timeline.fps) ? timeline.fps as LocalExportFrameRate : 30);
    const [autoSave, setAutoSave] = useState(true), [saved, setSaved] = useState(false), [saving, setSaving] = useState(false), [confirming, setConfirming] = useState(false);
    const [pendingCredits, setPendingCredits] = useState<number | null>(null);
    const [commitAttempted, setCommitAttempted] = useState(false);
    const exportIdentity = `${projectId}:${revision}`;
    const contentIdentity = useMemo(() => JSON.stringify([timeline, canvas]), [timeline, canvas]);
    const controller = useRef<AbortController | null>(null), mounted = useRef(true), latestArtifact = useRef(artifact), lastIdentity = useRef(exportIdentity),
        lastContentIdentity = useRef(contentIdentity), saveToken = useRef(0), reserved = useRef(false); latestArtifact.current = artifact;
    const releaseArtifact = (value: ExportArtifact) => value.kind === 'wav' ? Promise.resolve(releaseWavArtifact(value))
        : editorMediaArtifacts.release(projectId, value.artifactId).then(() => undefined);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); if (reserved.current) { reserved.current = false; void onCancel(); } const value = latestArtifact.current;
        latestArtifact.current = null; if (value) void (value.kind === 'wav' ? Promise.resolve(releaseWavArtifact(value)) : editorMediaArtifacts.release(projectId, value.artifactId)); }; }, [projectId]);
    useEffect(() => {
        const identityChanged = lastIdentity.current !== exportIdentity, contentChanged = lastContentIdentity.current !== contentIdentity;
        if (!identityChanged && !contentChanged) return;
        const sameProject = lastIdentity.current.startsWith(`${projectId}:`);
        lastIdentity.current = exportIdentity; lastContentIdentity.current = contentIdentity;
        if (sameProject && !contentChanged && pendingCredits !== null && latestArtifact.current) return;
        controller.current?.abort(); controller.current = null;
        if (reserved.current) { reserved.current = false; void onCancel(); }
        saveToken.current += 1;
        const value = latestArtifact.current; latestArtifact.current = null; if (value) void releaseArtifact(value);
        setArtifact(null); setError(null); setProgress(null); setSaved(false); setSaving(false); setPendingCredits(null); setCommitAttempted(false); setPhase('idle');
    }, [contentIdentity, exportIdentity, pendingCredits, projectId]);
    const cancelReservation = async () => {
        if (!reserved.current) return;
        reserved.current = false;
        await onCancel().catch(() => false);
        setPendingCredits(null); setCommitAttempted(false);
    };
    const close = () => { if (phase !== 'exporting' && phase !== 'verifying' && !saving && !confirming) { void cancelReservation(); onClose(); } };
    const completeCommittedArtifact = async (target: ExportArtifact, committedRevision: number, sessionCurrent: () => boolean = () => true) => {
        lastIdentity.current = `${projectId}:${committedRevision}`;
        lastContentIdentity.current = contentIdentity;
        reserved.current = false; latestArtifact.current = target; setArtifact(target); setPendingCredits(null); setCommitAttempted(false); setPhase('done');
    };
    const commitDeliveredArtifact = async (target: ExportArtifact, credits: number, sessionCurrent: () => boolean = () => true) => {
        setCommitAttempted(true); setConfirming(true); setError(null); setPhase('verifying');
        const authorizedRevision = await onBeginDelivery().catch(() => null);
        if (!mounted.current || latestArtifact.current?.artifactId !== target.artifactId) return;
        if (!sessionCurrent()) {
            setConfirming(false); await releaseArtifact(target); latestArtifact.current = null; setArtifact(null); setPendingCredits(null);
            setError('stale'); setPhase('error'); return;
        }
        if (authorizedRevision === null) { setConfirming(false); setError('credit-failed'); setPhase('error'); return; }
        const committedRevision = await onFinalize().catch(() => null);
        if (!mounted.current || latestArtifact.current?.artifactId !== target.artifactId) return;
        setConfirming(false);
        if (!sessionCurrent()) {
            await releaseArtifact(target); latestArtifact.current = null; setArtifact(null); setPendingCredits(null);
            setError('stale'); setPhase('error'); return;
        }
        if (committedRevision === null) { setError('credit-failed'); setPhase('error'); return; }
        await completeCommittedArtifact(target, committedRevision);
    };
    const saveAndCommit = async (target: Extract<ExportArtifact, { kind: 'mp4' }>, credits: number | null, sessionCurrent: () => boolean = () => true) => {
        const token = ++saveToken.current; setSaving(true);
        const stillCurrent = () => mounted.current && sessionCurrent() && latestArtifact.current?.artifactId === target.artifactId;
        const outcome = await saveLocalExportToPhotos(target.uri, stillCurrent);
        if (!mounted.current || saveToken.current !== token) return;
        if (stillCurrent()) {
            if (outcome === 'saved') setSaved(true);
            else if (outcome === 'permission') setError('save-permission');
            else if (outcome === 'failed') setError('save-failed');
        }
        else if (!sessionCurrent()) { setError('stale'); setPhase('error'); }
        setSaving(false);
        if (outcome === 'saved' && credits !== null && stillCurrent()) await commitDeliveredArtifact(target, credits, sessionCurrent);
        else if (outcome !== 'saved' && credits !== null) {
            await cancelReservation();
            if (latestArtifact.current?.artifactId === target.artifactId) {
                await releaseArtifact(target); latestArtifact.current = null; setArtifact(null); setPhase('error');
            }
        }
    };
    const start = async () => {
        if (controller.current || confirming) return;
        // The native frame protocol is deliberately bounded to 720p. Route
        // larger selections to the server encoder instead of silently writing
        // a 720p file while the sheet still says 1080p or 4K.
        if (output === 'video' && resolution !== '720p') { onCloud(); return; }
        setConfirming(true);
        const expectedCredits = await onPrepare().catch(() => null);
        if (!mounted.current) return;
        setConfirming(false);
        if (expectedCredits === 'failed') { setError('credit-check-failed'); setPhase('error'); return; }
        if (expectedCredits === null) return;
        const reservedRevision = await onCommit(expectedCredits).catch(() => null);
        if (!mounted.current) return;
        if (reservedRevision === null) { setError('credit-failed'); setPhase('error'); return; }
        const requiresSettlement = expectedCredits > 0;
        reserved.current = requiresSettlement; setPendingCredits(requiresSettlement ? expectedCredits : null); setCommitAttempted(requiresSettlement);
        const frozen = JSON.parse(JSON.stringify(timeline)) as Timeline, abort = new AbortController(), task = beginSessionTask(); controller.current = abort;
        if (artifact) await releaseArtifact(artifact).catch(() => undefined);
        setArtifact(null); setError(null); setProgress(null); setSaved(false); setSaving(false); setPhase('exporting');
        const preset = LOCAL_EXPORT_QUALITY[quality];
        let prepared: EditorExportSourceResult<EditorLocalExportResult | EditorAudioExportResult>;
        try { prepared = await withEditorExportSources<EditorLocalExportResult | EditorAudioExportResult>({ api, task, account, projectId, timeline: frozen, localMediaUris, signal: abort.signal }, materialized => {
            const sources = { ...materialized, ...editorFontStore.exportSources(projectId, frozen.fonts ?? []) };
            return output === 'audio'
                ? exportEditorWav({ timeline: frozen, signal: abort.signal, onProgress: next => {
                    if (mounted.current && controller.current === abort && task.current()) setProgress({ stage: next < .8 ? 'preparing' : 'finishing', value: next,
                        frame: Math.round(framesIn(frozen) * next), frames: framesIn(frozen) });
                } }, createNativeEditorAudioExportDependencies(account, projectId, frozen, sources))
                : exportEditorMp4({ timeline: frozen, fps: frameRate, ...selectedLocalExportDimensions(canvas, resolution), videoBitRate: preset.videoBitRate, audioBitRate: preset.audioBitRate,
                    codec, signal: abort.signal, onProgress: value => { if (mounted.current && controller.current === abort && task.current()) setProgress(value); } },
                createNativeEditorLocalExportDependencies(account, projectId, frozen, sources));
        });
        } catch {
            const owns = controller.current === abort;
            if (owns) controller.current = null;
            if (mounted.current && owns) { const next = localExportInterruptedState(task.current(), abort.signal.aborted);
                setError(next.error); setPhase(next.phase); setProgress(null); }
            await cancelReservation();
            return;
        }
        if (!mounted.current || controller.current !== abort || !task.current()) {
            const owns = controller.current === abort;
            if (owns) controller.current = null;
            if (mounted.current && owns) { const next = localExportInterruptedState(task.current(), abort.signal.aborted);
                setError(next.error); setPhase(next.phase); setProgress(null); }
            if (prepared.ok && prepared.value.ok) await releaseArtifact(prepared.value.artifact);
            await cancelReservation(); return;
        }
        controller.current = null;
        if (!prepared.ok) {
            if (prepared.code === 'cancelled') { setError(null); setProgress(null); setPhase('idle'); }
            else { setError(prepared.code); setPhase('error'); }
            await cancelReservation();
            return;
        }
        const result = prepared.value;
        if (result.ok) {
            // Paid credits are reserved before rendering. Only paid delivery
            // needs the completion handshake; covered and rollout-disabled
            // exports retain the ordinary Photos/share behavior.
            latestArtifact.current = result.artifact; setArtifact(result.artifact);
            setPendingCredits(requiresSettlement ? expectedCredits : null); setCommitAttempted(requiresSettlement);
            setPhase('done'); setProgress(null);
            if (autoSave && result.artifact.kind === 'mp4')
                await saveAndCommit(result.artifact, requiresSettlement ? expectedCredits : null, task.current);
        }
        else if (result.code === 'cancelled') { setPhase('idle'); setProgress(null); await cancelReservation(); }
        else { setError(result.code === 'invalid-timeline' ? 'invalid-timeline' : result.code === 'unsupported-frame' ? 'unsupported-frame'
            : result.code === 'native-media' ? 'native-media' : 'write-failed'); setPhase('error'); await cancelReservation(); }
    };
    const retryCommit = async () => {
        const retained = latestArtifact.current;
        if (!retained || pendingCredits === null || !commitAttempted || confirming) return;
        await commitDeliveredArtifact(retained, pendingCredits);
    };
    const save = async () => { if (!artifact || artifact.kind !== 'mp4' || saving) return; setError(null);
        await saveAndCommit(artifact, pendingCredits !== null && commitAttempted ? pendingCredits : null); };
    const abandonArtifact = async (target: ExportArtifact, code: ExportError) => {
        await cancelReservation();
        if (latestArtifact.current?.artifactId === target.artifactId) {
            await releaseArtifact(target); latestArtifact.current = null; setArtifact(null); setError(code); setPhase('error');
        }
    };
    const share = async () => { if (!artifact) return; const mimeType = artifact.kind === 'wav' ? 'audio/wav' : 'video/mp4';
        if (pendingCredits !== null && commitAttempted) {
            setSaving(true);
            const outcome = await shareLocalExportWithCompletion(artifact.uri, mimeType);
            if (!mounted.current || latestArtifact.current?.artifactId !== artifact.artifactId) return;
            setSaving(false);
            if (outcome === 'completed') await commitDeliveredArtifact(artifact, pendingCredits);
            else if (outcome === 'canceled') {
                await cancelReservation();
                if (latestArtifact.current?.artifactId === artifact.artifactId) {
                    await releaseArtifact(artifact); latestArtifact.current = null; setArtifact(null); setError(null); setPhase('idle');
                }
            } else await abandonArtifact(artifact, outcome === 'unavailable' ? 'share-unavailable' : 'write-failed');
            return;
        }
        try {
            if (!await Sharing.isAvailableAsync()) { setError('share-unavailable'); return; }
            await Sharing.shareAsync(artifact.uri, { mimeType });
        } catch { setError('write-failed'); }
    };
    const openCloud = () => { void cancelReservation(); onCloud(); };
    const value = Math.round((progress?.value ?? 0) * 100), messageKey = error ? `editorLocalExport.${error}` as Parameters<typeof t>[0] : null;
    const announcedValue = Math.floor(value / 10) * 10, totalFrames = progress?.frames ?? editorLocalExportFrameCount(timeline, frameRate);
    const announcement = messageKey ? t(messageKey) : phase === 'done' && artifact ? t('editorLocalExport.done', { size: formatNumber(artifact.size / 1_000_000, 1) })
        : phase === 'verifying' ? t('editorLocalExport.verifying')
        : phase === 'exporting' ? `${t(`editorLocalExport.${progress?.stage ?? 'preparing'}` as Parameters<typeof t>[0])}. ${t('editorLocalExport.progress', {
            percent: announcedValue, frame: Math.round(totalFrames * announcedValue / 100), total: totalFrames,
        })}` : null;
    useAnnouncement(visible ? announcement : null);
    return <Modal visible={visible} transparent animationType="none" onRequestClose={close}><View style={styles.backdrop} onAccessibilityEscape={close}>
        <ScrollView style={styles.sheet} contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 12), paddingLeft: Math.max(24, insets.left + 16),
            paddingRight: Math.max(24, insets.right + 16) }]}><Text accessibilityRole="header" style={styles.heading}>{t('editorLocalExport.title')}</Text>
        <Text style={styles.text}>{t('editorLocalExport.help')}</Text>
        {phase === 'exporting' && output === 'video' ? <ExportFootagePreview timeline={timeline} frame={editorLocalExportSourceFrame(timeline, progress?.frame ?? 0, frameRate)} api={api} localMediaUris={localMediaUris} /> : null}
        {phase === 'exporting' ? <><Text style={styles.text}>{t(`editorLocalExport.${progress?.stage ?? 'preparing'}` as Parameters<typeof t>[0])}</Text>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }} style={styles.track}><View style={[styles.fill, { width: `${value}%` }]} /></View>
            <Text style={styles.text}>{t('editorLocalExport.progress', { percent: value, frame: progress?.frame ?? 0, total: progress?.frames ?? editorLocalExportFrameCount(timeline, frameRate) })}</Text>
            <Button label={t('editorScenes.cancel')} onPress={() => controller.current?.abort()} /></> : null}
        {phase === 'verifying' ? <Text style={styles.text}>{t('editorLocalExport.verifying')}</Text> : null}
        {messageKey ? <Text style={styles.error}>{t(messageKey)}</Text> : null}
        {phase === 'error' && artifact && pendingCredits !== null && commitAttempted ? <Button label={t('musicExport.retry')} disabled={confirming} onPress={() => void retryCommit()} /> : null}
        {phase === 'idle' || phase === 'error' && pendingCredits === null ? <><View style={styles.readyCard}><View style={styles.readyIcon}><Text style={styles.readyIconText}>{output === 'audio' ? '♫' : '▣'}</Text></View><View style={{ flex: 1 }}><Text style={styles.readyTitle}>{t('editorParity.readyToExport')}</Text><Text style={styles.readyMeta}>{output === 'audio' ? t('editorParity.audioExportMeta', { size: formatNumber(estimatedLocalAudioBytes(timeline) / 1_000_000, 1) }) : t('editorParity.videoExportMeta', { width: selectedLocalExportDimensions(canvas, resolution).width, height: selectedLocalExportDimensions(canvas, resolution).height, fps: frameRate, size: formatNumber(estimatedLocalExportBytes(timeline, quality) / 1_000_000, 1) })}</Text></View></View>
            <Text style={styles.label}>{t('editorParity.output')}</Text><View accessibilityRole="radiogroup" accessibilityLabel={t('editorParity.output')} style={styles.outputSegment}>{(['video', 'audio'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t(value === 'video' ? 'editorSimple.video' : 'editorParity.audioOnly')} accessibilityState={{ checked: output === value }} onPress={() => setOutput(value)} style={[styles.outputChoice, output === value && styles.outputSelected]}><Text style={output === value ? styles.outputSelectedText : styles.outputChoiceText}>{t(value === 'video' ? 'editorSimple.video' : 'editorParity.audioOnly')}</Text></Pressable>)}</View>
            {output === 'video' ? <><Text style={styles.label}>{t('editorParity.resolution')}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('editorParity.resolution')} style={styles.row}>{(['720p', '1080p', '4k'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={value === '4k' ? t('editorParity.fourK') : value.toUpperCase()} accessibilityState={{ checked: resolution === value }} onPress={() => setResolution(value)} style={[styles.choice, resolution === value && styles.choiceSelected]}><Text style={styles.text}>{value === '4k' ? t('editorParity.fourK') : value.toUpperCase()}</Text></Pressable>)}</View>
            {resolution === '4k' ? <Text style={styles.help}>{t('editorParity.fourKHelp')}</Text> : null}
            <Text style={styles.label}>{t('editorParity.frameRate')}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('editorParity.frameRate')} style={styles.row}>{([24, 25, 30, 60] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={t('editorParity.fps', { n: value })} accessibilityState={{ checked: frameRate === value }} onPress={() => setFrameRate(value)} style={[styles.choice, frameRate === value && styles.choiceSelected]}><Text style={styles.text}>{value}</Text></Pressable>)}</View>
            <Text style={styles.label}>{t('editorLocalExport.quality')}</Text>
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
                value={autoSave} onValueChange={setAutoSave} /></View></> : <Text style={styles.help}>{t('editorParity.audioExportHelp')}</Text>}
            <Button label={output === 'video' && resolution !== '720p' ? t('editorLocalExport.cloud') : output === 'audio' ? t('editorParity.exportAudio') : t('editorLocalExport.start')} disabled={confirming} onPress={() => void start()} /></> : null}
        {artifact && (phase === 'done' || phase === 'error' && pendingCredits !== null) ? <><Text style={styles.text}>{t('editorLocalExport.done', { size: formatNumber(artifact.size / 1_000_000, 1) })}</Text>
            {artifact.kind === 'mp4' ? saving ? <Text style={styles.text}>{t('editorLocalExport.saving')}</Text> : saved ? <Text style={styles.text}>{t('editorLocalExport.saved')}</Text>
                : <Button label={t('editorLocalExport.save')} onPress={() => void save()} /> : <Text style={styles.help}>{t('editorParity.shareWavHelp')}</Text>}
            <Button label={t('editorServerExport.share')} disabled={saving} onPress={() => void share()} /></> : null}
        {phase !== 'exporting' && phase !== 'verifying' && !saving ? <Button label={t('editorLocalExport.cloud')} disabled={confirming} onPress={openCloud} /> : null}<Button label={t('editorServerExport.close')} disabled={phase === 'exporting' || phase === 'verifying' || saving || confirming} onPress={close} />
        </ScrollView></View></Modal>;
}
function Button({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress(): void }) { return <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, touchTarget, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.text}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }, sheet: { maxHeight: '90%', backgroundColor: colors.background }, content: { padding: 24, gap: 12 },
    heading: { fontSize: 22, fontWeight: '700', color: colors.text }, label: { color: colors.text, fontSize: 14, fontWeight: '700' }, text: { color: colors.text, fontSize: 16 }, error: { color: colors.danger, fontSize: 16 },
    button: { justifyContent: 'center', paddingHorizontal: 12, marginVertical: 4, borderWidth: 1, borderColor: colors.muted, borderRadius: 8 }, disabled: { opacity: .45 }, pressed: { opacity: .7 },
    readyCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.accentSoft }, readyIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: `${colors.accent}28` }, readyIconText: { color: colors.accent, fontSize: 24 }, readyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, readyMeta: { marginTop: 3, color: colors.muted, fontSize: 13 },
    outputSegment: { height: 44, flexDirection: 'row', padding: 3, borderRadius: 22, backgroundColor: colors.surface }, outputChoice: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 19 }, outputSelected: { backgroundColor: colors.text }, outputSelectedText: { color: colors.background, fontWeight: '800' }, outputChoiceText: { color: colors.text, fontWeight: '700' }, help: { color: colors.muted, fontSize: 14, lineHeight: 20 }, settingRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, settingValue: { color: colors.accent, fontSize: 16, fontWeight: '800' },
    row: { flexDirection: 'row', gap: 8 }, choice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.muted, borderRadius: 8 },
    choiceSelected: { borderColor: colors.accent, backgroundColor: `${colors.accent}22` }, switchRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    track: { height: 6, backgroundColor: colors.muted, borderRadius: 3, overflow: 'hidden' }, fill: { height: 6, backgroundColor: colors.accent } });
