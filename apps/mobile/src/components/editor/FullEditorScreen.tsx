import { MotionPanel } from './tools/MotionPanel'; import { MaskPanel } from './tools/MaskPanel';
import { useMotionActions } from './tools/useMotionActions'; import { useMaskActions } from './tools/useMaskActions';
import { useLookActions } from './tools/useLookActions'; import { useAudioSettingsActions } from './tools/useAudioSettingsActions';
import { useOriginalAudio } from './tools/useOriginalAudio'; import { useCaptionActions } from './tools/useCaptionActions';
import { useTextActions } from './tools/useTextActions'; import { useSpeedActions } from './tools/useSpeedActions';
import type { VoiceoverProps } from './useVoiceoverRecorder';
import { ToolRail } from './tools/ToolRail'; import type { Tool } from './tools/editorTools';
import type { ToolPanelProps } from './tools/types';
import { MediaPanel } from './tools/MediaPanel'; import { AudioPanel } from './tools/AudioPanel';
import { TextPanel } from './tools/TextPanel';
import { CaptionsPanel, TranscriptPanel } from './tools/CaptionsPanels';
import { EffectsPanel, TransitionsPanel, FiltersPanel } from './tools/LookPanels';
import { AnimationPanel } from './tools/AnimationPanel';
import { MarkersPanel } from './tools/MarkersPanel'; import { AdjustPanel } from './tools/AdjustPanel';
import { ScenesPanel } from './tools/ScenesPanel'; import { sceneAnalysisBlocker, useEditorSceneAnalysis } from './tools/useEditorSceneAnalysis';
import { ClipFinderPanel } from './tools/ClipFinderPanel'; import { clipFinderBlocker, useEditorClipFinder } from './tools/useEditorClipFinder';
import { useBestCutEditor } from './useBestCutEditor';
import { EditorSpeechCutSheet } from './EditorSpeechCutSheet';
import { useSpeechCutAvailability } from './useSpeechCutAvailability';
import { EditorAiEditSheet, useAiEditAvailability } from './EditorAiEditSheet';
import { sameRevision, type Freshness } from '../../lib/editorAgentPlan';
import { VoiceoverSheet } from './VoiceoverSheet';
import { VOICEOVER_AVAILABLE } from '../../lib/voiceoverRecorder';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { addPending } from '../../lib/editorGenerationReturns';
import { placeTitle } from '../../lib/editorTitlePlacement';
import { clampFrame, insertMediaAt } from '../../lib/editorInsertMedia';
import { libraryStems, type EditorStem } from '../../lib/editorStems';
import { kindOf, type Kind } from '../../lib/media';
import { MakePanel } from '../chat/MakePanel';
import { EditorGeneratePanel } from './EditorGeneratePanel';
import { EditorStemSheet } from './EditorStemSheet';
import { useEditorGenerationReturns, type InsertResult } from './useEditorGenerationReturns';
import { Text as StatusText } from '../ui/Text';
import { Command, Action, Choice, WorkflowPanel } from './EditorControls';
import { useEditorTrackActions } from './useEditorTrackActions';
import { PlaybackPreview, PlaybackTimeline, PlaybackTransport } from './EditorPlayback';
import { fitPpf, formatTimecode as timecode, moveItems, trimItem, PPF_MIN, PPF_MAX } from '../../lib/editorTimeline';
import { libraryMedia, LIBRARY_STOPPED } from '../../lib/editorLibraryLength';
import { isAccountChanged } from '../../auth/sessionTask';
import { useEditorLeaveGuard } from './useEditorLeaveGuard';
import { EditorSaveSheets } from './EditorSaveSheets';
import { EditorVersionsSheet } from './EditorVersionsSheet';
import { Button } from '../ui/Button';
import { EditorLoadState } from './EditorLoadState';
import { useContext, useEffect, useRef, useState } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { editorLayoutBudget } from '../../lib/editorLayoutBudget';
import { EDITOR_SERVER_EXPORT_ENABLED } from '../../lib/editorFlag';
import type { Cut } from '../../lib/smartCutHandoff';
import { requireOnline, OFFLINE_PAID_MESSAGE } from '../../lib/network';
import { exportUnavailable } from '../../lib/editorServerExport';
import { EDITOR_EXPORT_GATE as exportGate } from '../../lib/editorExportGate';
import { ServerExportSheet } from './ServerExportSheet';
import { LocalExportSheet } from './LocalExportSheet';
import { styles } from './fullEditorStyles'; import { EditorToolSheet } from './EditorToolSheet';
import { SimpleEditorBar, SimpleEditorSheet, type SheetRow, type SimpleSheetName } from './SimpleEditorChrome';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { Platform, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { HEADER_MAX_FONT_SCALE, touchTarget } from '../../lib/a11y';
import { formatNumber, plural, t } from '../../lib/i18n';
import type { LibraryChoice } from '../../lib/librarySource';
import { DEFAULT_TEXT_STYLE, addMarker, addTrack, canvasOf, clipAt, copySelections, duplicateSelections, framesIn, groupSelections, invalidateChangedSemanticMasks, moveClip, pasteClipboard, pruneEmptiedExtraTracks,
    removeSelections, splitClip, splitClipAtFrames, timelineOf, updateClip, validCustomFonts, type Canvas, type Clip, type EditorTrack, type Media, type Selection, type TextClip, type Timeline, type TrackKind } from
    '../../lib/nativeEditorModel';
import type { SlotKind } from '../../lib/sources';
import { HeaderAction } from '../HeaderAction';
import { LibraryChooser } from '../LibraryChooser';
import { JobThumb, useAssetLinks } from '../JobThumb';
import { mediaFrames, overlaySpan } from '../../lib/editorOverlay';
import { appendSelectedClipFinderRows } from '../../lib/editorClipAnalysis';
import { useFullEditorSession } from './useFullEditorSession';
import { useEditorFonts } from './useEditorFonts';
import { AssetPackLibrarySheet } from './assetPacks/AssetPackLibrarySheet';
import { packFileMime, packMediaDetails, type AssetPack, type PackAsset, type PickedPackFile } from '../../lib/editorAssetPackCatalog';
import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { useEditorSpeechCaptions } from './tools/useEditorSpeechCaptions';
import { editorMotionSelectedRange, useEditorMotionProcessing } from './tools/useEditorMotionProcessing';
import { useEditorPersonMask } from './tools/useEditorPersonMask';
export function FullEditorScreen({ projectId, jobId, cuts, startAdvanced = false, startBestCut = false }: { projectId: string; jobId?: string; cuts?: readonly Cut[] | null; startAdvanced?:
    boolean; startBestCut?: boolean }) {
    const mounted = useRef(true); const [libraryPending, setLibraryPending] = useState(false); const [viewport, setViewport] = useState(0);
    const [timelineTouch, setTimelineTouch] = useState(false); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const [voiceoverAt, setVoiceoverAt] = useState<number | null>(null);
    const [assetPackAt, setAssetPackAt] = useState<number | null>(null);
    const [voiceoverMessage, setVoiceoverMessage] = useState<string | null>(null); useAnnouncement(voiceoverMessage); const onVoiceoverAdded = () => {
        setVoiceoverMessage(t('editorVoiceover.added')); setVoiceoverAt(null); };
    const [exportVisible, setExportVisible] = useState(false);
    const [localExportVisible, setLocalExportVisible] = useState(false);
    // Simple view is the default: preview, short timeline and Add / AI Edit / More. "All editing tools" opens the full set.
    const [advanced, setAdvanced] = useState(startAdvanced); const [sheet, setSheet] = useState<SimpleSheetName | null>(null); const [panelOpen, setPanelOpen] = useState(false);
    const session = useFullEditorSession({ projectId, jobId, cuts, onOwnerChange: () => guard.teardown(() => router.back()), onCopy: id => guard.teardown(() => router.replace({ pathname:
        '/editor/[projectId]', params: { projectId: id } })) });
    const { getEditRevision, beginImport, replacing, leaveEditor, saveStatus, sync, currentDocument, preparePicked, savedDocument, api, router, name, document, dirty, problem, setProblem, tool,
        setTool, selection, setSelection, selections, setSelections, multiSelect, setMultiSelect, clipboard, setClipboard, snap, setSnap, ripple, setRipple, zoom, setZoom, privacyNotice,
        history, frameStore, setFrame, playing, setPlaying, projectAssets, localMediaUris, libraryKind, setLibraryKind, markDocument, save, acknowledgePrivacy, travel } = session;
    const bestCut = useBestCutEditor(session, projectId, startBestCut); const thumbLinks = useAssetLinks(api);
    const { aiQuote, setAiQuote, aiEditOpen, setAiEditOpen } = useAiEditAvailability(api, projectId);
    const [aiAnnouncement, setAiAnnouncement] = useState<string | null>(null); useAnnouncement(aiAnnouncement);
    const [sceneAnnouncement, setSceneAnnouncement] = useState<string | null>(null); useAnnouncement(sceneAnnouncement);
    const [clipAnnouncement, setClipAnnouncement] = useState<string | null>(null); useAnnouncement(clipAnnouncement);
    const [clipPreview, setClipPreview] = useState<{ id: string; endFrame: number } | null>(null);
    const [placement, setPlacement] = useState(0);
    const { speechQuote, setSpeechQuote, speechMode, setSpeechMode } = useSpeechCutAvailability(api, projectId);
    const editFreshness = (): Freshness => ({ projectId, accountId: getCacheUser() ?? '', editRevision: getEditRevision() }); const guard = useEditorLeaveGuard(leaveEditor, router.back);
    const [generate, setGenerate] = useState<{ visible: boolean; kind: Kind; frame: number; owner?: string; prompt?: string } | null>(null);
    const [stemChoice, setStemChoice] = useState<{ choice: LibraryChoice; stems: EditorStem[] } | null>(null);
    const isReady = () => currentDocument()?.project_id === projectId && sync.draftDecided && !sync.sheet && !sync.replacing && sync.live(), ready = isReady();
    const liveProject = useRef(projectId), readiness = useRef(ready); liveProject.current = projectId; readiness.current = ready;
    useEffect(() => { setGenerate(null); setStemChoice(null); setAssetPackAt(null); return subscribeCacheUser(() => { setGenerate(null); setStemChoice(null); setAssetPackAt(null); }); }, [projectId]);
    useEffect(() => { if (!ready && assetPackAt !== null) setAssetPackAt(null); }, [assetPackAt, ready]);
    const returns = useEditorGenerationReturns({ api, projectId, announce: tool !== 'generate', get ready() { return isReady(); }, currentDocument, get dirty() { return sync.dirty; }, get
        saving() { return sync.saving; }, get revision() { return sync.revision; }, beginImport, sessionLive: () => sync.live(), insert: insertMedia });
    function insertMedia(media: Media, at: number, select = false, onPlaced?: (trimmed: boolean) => void): InsertResult {
        const current = currentDocument(); if (!isReady() || !current || current.project_id !== projectId) return 'dropped';
        const result = insertMediaAt(timelineOf(current.timeline), media, at);
        if ('error' in result) { setProblem(result.error === 'full' ? t('editorAi.projectFull') : t('editor.unlockoraddatrackfirst', { value1: media.kind === 'audio' ? 'audio' : 'video' }));
            return result.error; }
        const commit = markDocument({ ...current, schema_version: 3, timeline: result.timeline });
        if (commit.status !== 'accepted') return commit;
        if (result.trimmed && (!media.originalAudio || Object.hasOwn(timelineOf(current.timeline).media, media.id))) { setProblem(t('editor.musicTrimmed')); setPlacement(value => value + 1); }
        onPlaced?.(result.trimmed);
        if (select || media.kind === 'audio') { setSelection(result.selection); setSelections([result.selection]); } return 'placed';
    }
    const openGenerate = (kind: Kind, prompt = '') => setGenerate({ visible: true, kind, prompt, frame: clampFrame(frameStore.get()), owner: getCacheUser() });
    // Short phones: shrink the preview so the toolbars and tool rail are never pushed off screen.
    const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions(); const insets = useContext(SafeAreaInsetsContext);
    const budget = editorLayoutBudget({ windowWidth, windowHeight, fontScale, topInset: insets?.top ?? 0, bottomInset: insets?.bottom ?? 0,
        trackCount: document ? timelineOf(document.timeline).tracks.length : 1 });
    const previewHeight = advanced ? budget.previewHeight : Math.max(72, Math.min(178, Math.round(windowHeight * (panelOpen ? 0.1 : 0.14))));
    const timeline = timelineOf(document?.timeline);
    const fontActions = useEditorFonts({ projectId, timeline, ready, beginImport, currentTimeline: () => timelineOf(currentDocument()?.timeline),
        applyTimeline: next => { const current = currentDocument(); return !current || current.project_id !== projectId ? { status: 'not-live' as const }
            : markDocument({ ...current, schema_version: 3, timeline: next }); } });
    const textActions = useTextActions({ timeline, selection, applyTimeline: next => applyTimeline(next), setProblem,
        frameStore, setSelection, setSelections, setTool });
    const captionActions = useCaptionActions({ timeline, selection, applyTimeline: next => applyTimeline(next), setProblem,
        setSelection, setSelections, frameStore, beginImport, currentDocument, getEpoch: () => sync.epoch });
    const motionActions = useMotionActions({ timeline, selection, applyTimeline: next => applyTimeline(next), setProblem, frameStore, setFrame, setPlaying });
    const maskActions = useMaskActions({ timeline, selection, applyTimeline: next => applyTimeline(next), setProblem, frameStore });
    const lookActions = useLookActions({ timeline, selection, applyTimeline: next => applyTimeline(next), setProblem, frameStore });
    const audioActions = useAudioSettingsActions({ timeline, selection, applyTimeline: next => applyTimeline(next), setProblem, frameStore });
    const originalAudio = useOriginalAudio({ timeline, localMediaUris, setLocalMediaUris: session.setLocalMediaUris, playing, setProblem: message => { if (sync.live()) setProblem(message); },
        insertMedia: returns.place, frameStore, currentTimeline: () => timelineOf(currentDocument()?.timeline), onPlacement: message => { setProblem(message); setPlacement(value => value + 1); } });
    const selected = clipAt(timeline, selection);
    const selectedMedia = selected && 'mediaId' in selected && selected.mediaId ? timeline.media[selected.mediaId] : undefined;
    const selectedTrack = selection ? timeline.tracks.find((track) => track.id === selected?.trackId) : undefined;
    const speechSourceUri = selectedMedia && (selectedMedia.kind === 'audio' || selectedMedia.hasAudio) ? localMediaUris[selectedMedia.id] : undefined;
    const speechSource = speechSourceUri && selected && 'mediaId' in selected && selected.mediaId ? { uri: speechSourceUri, mediaId: selected.mediaId,
        startFrame: selected.start, inFrame: selected.in ?? 0, lenFrames: selected.len, fps: timeline.fps, rate: selected.rate, reverse: selected.reverse,
        speedCurve: selected.speedCurve, freezeFrame: selected.freezeFrame } : undefined;
    const speechCaptionActions = useEditorSpeechCaptions({ account: getCacheUser() ?? '', projectId, source: speechSource,
        sourceKey: `${selection?.track ?? ''}:${selection?.id ?? ''}:${selectedMedia?.id ?? ''}:${selected?.start ?? ''}:${selected && 'in' in selected ? selected.in ?? 0 : ''}`
            + `:${selected?.len ?? ''}:${selected && 'rate' in selected ? selected.rate ?? 1 : ''}:${selected && 'reverse' in selected ? selected.reverse === true : ''}`,
        currentTimeline: () => timelineOf(currentDocument()?.timeline), applyTimeline: next => {
            const current = currentDocument();
            return !!current && current.project_id === projectId && markDocument({ ...current, schema_version: 3, timeline: next }).status === 'accepted';
        } });
    const selectedLocalSource = selection?.track === 'video' && selectedMedia ? localMediaUris[selectedMedia.id] : undefined;
    const nativeMotionSource = selectedMedia?.kind === 'video' ? selectedLocalSource : undefined;
    const personMaskSource = selectedMedia && ['image', 'graphic', 'video'].includes(String(selectedMedia.kind)) ? selectedLocalSource : undefined;
    const nativeMotionKey = `${projectId}:${getCacheUser() ?? ''}:${getEditRevision()}:${selection?.track ?? ''}:${selection?.id ?? ''}:${selectedMedia?.id ?? ''}`;
    const motionProcessingActions = useEditorMotionProcessing({ account: getCacheUser() ?? '', projectId, sourceUri: nativeMotionSource, sourceKind: selectedMedia?.kind,
        sourceMediaId: selectedMedia?.id, sourceKey: nativeMotionKey, sources: localMediaUris,
        range: selected && 'mediaId' in selected ? editorMotionSelectedRange(selected, timeline.fps) : undefined,
        selection, timeline, commit: next => {
            const current = currentDocument(); return !!current && current.project_id === projectId
                && markDocument({ ...current, schema_version: 3, timeline: next }).status === 'accepted';
        }, addLocalUri: (mediaId, uri) => session.setLocalMediaUris(current => ({ ...current, [mediaId]: uri })) });
    const personMaskActions = useEditorPersonMask({ account: getCacheUser() ?? '', projectId, sourceUri: personMaskSource, sourceKey: nativeMotionKey,
        selection, timeline, commit: next => {
            const current = currentDocument(); return !!current && current.project_id === projectId
                && markDocument({ ...current, schema_version: 3, timeline: next }).status === 'accepted';
        }, addLocalUri: (mediaId, uri) => session.setLocalMediaUris(current => ({ ...current, [mediaId]: uri })) });
    const sceneClip = selection?.track === 'video' && selected && 'mediaId' in selected ? selected as Clip : undefined;
    const sceneRunKey = `${projectId}:${getCacheUser() ?? ''}:${getEditRevision()}:${selection?.track ?? ''}:${selection?.id ?? ''}:${sceneClip?.start ?? ''}:${sceneClip?.in ?? ''}:${sceneClip?.len ?? ''}`;
    const scenes = useEditorSceneAnalysis({ api, projectId, media: selectedMedia, clip: sceneClip, localUri: selectedMedia ? localMediaUris[selectedMedia.id] : undefined,
        runKey: sceneRunKey });
    const sceneRows = scenes.resultKey === sceneRunKey ? scenes.rows : [];
    const sceneBlockerCode = sceneAnalysisBlocker(selectedMedia, sceneClip, !!selectedTrack?.locked);
    const sceneBlockerKeys = { select: 'editorScenes.select', transform: 'editorScenes.transform', short: 'editorScenes.short', long: 'editorScenes.long', locked: 'editorScenes.locked' } as const;
    const sceneBlockerBase = sceneBlockerCode ? t(sceneBlockerKeys[sceneBlockerCode]) : null;
    const sceneError = scenes.error === 'source' ? t('editorScenes.sourceError') : scenes.error === 'invalid-input' || scenes.error === 'unsupported-codec' || scenes.error === 'corrupt-media'
        ? t('editorScenes.invalidError') : scenes.error === 'disk-full' ? t('editorScenes.spaceError') : scenes.error ? t('editorScenes.error') : null;
    const sceneMarks = sceneRows.map(row => ({ frame: row.frame, kind: row.kind, selected: row.ticked }));
    const clipRunKey = `${sceneRunKey}:${selectedMedia?.hasAudio ? 'audio' : 'silent'}`;
    const clips = useEditorClipFinder({ api, projectId, media: selectedMedia, clip: sceneClip, timeline,
        localUri: selectedMedia ? localMediaUris[selectedMedia.id] : undefined, runKey: clipRunKey });
    const clipRows = clips.resultKey === clipRunKey ? clips.rows : [];
    const clipBlockerCode = clipFinderBlocker(selectedMedia, sceneClip);
    const clipBlockerBase = clipBlockerCode === 'select' ? t('editorClips.blocker.select')
        : clipBlockerCode === 'transform' ? t('editorClips.blocker.transform')
        : clipBlockerCode === 'short' ? t('editorClips.blocker.short')
        : clipBlockerCode === 'long' ? t('editorClips.blocker.long')
        : clipBlockerCode === 'resolution' ? t('editorClips.blocker.resolution') : null;
    const sceneRunning = scenes.status === 'preparing' || scenes.status === 'analyzing';
    const clipRunning = clips.status === 'preparing' || clips.status === 'reading-picture' || clips.status === 'reading-sound' || clips.status === 'ranking';
    const sceneBusyText = scenes.status === 'preparing' ? t('editorScenes.preparing')
        : t('editorScenes.analyzing', { value1: Math.round(scenes.progress * 100) });
    const clipBusyText = clips.status === 'reading-picture' ? t('editorClips.readingPicture')
        : clips.status === 'reading-sound' ? t('editorClips.readingSound')
        : clips.status === 'ranking' ? t('editorClips.ranking') : t('editorClips.preparing');
    const sceneBlocker = clipRunning ? `${t('editorClips.title')}: ${clipBusyText}` : sceneBlockerBase;
    const clipBlocker = sceneRunning ? `${t('editorScenes.title')}: ${sceneBusyText}` : clipBlockerBase;
    const clipError = clips.error === 'source' ? t('editorClips.sourceError')
        : clips.error === 'resolution' ? t('editorClips.blocker.resolution')
        : clips.error === 'invalid-input' || clips.error === 'unsupported-codec' || clips.error === 'corrupt-media' ? t('editorClips.invalidError')
        : clips.error === 'disk-full' ? t('editorClips.spaceError') : clips.error ? t('editorClips.error') : null;
    useEffect(() => {
        if (!clipPreview) return;
        if (!playing) { setClipPreview(null); return; }
        const stopAtEnd = () => {
            if (frameStore.get() < clipPreview.endFrame) return;
            setPlaying(false); setClipPreview(null);
        };
        stopAtEnd(); return frameStore.subscribe(stopAtEnd);
    }, [clipPreview, frameStore, playing, setPlaying]);
    useEffect(() => { setClipPreview(null); }, [clipRunKey, tool]);
    if (!document) return <EditorLoadState problem={problem} onRetry={session.retryLoad} onBack={() => router.back()} />;
    const canvas = canvasOf(document.canvas);
    const total = framesIn(timeline);
    const clipCount = timeline.video.length + timeline.audio.length + timeline.text.length; const selectedGroup = selected?.groupId;
    const availableMedia = [...Object.values(timeline.media), ...projectAssets.filter((asset) => !Object.values(timeline.media).some((item) => item.assetSource?.assetId ===
        asset.assetSource?.assetId))];
    const commitTimeline = (next: Timeline) => { const current = currentDocument() ?? document;
        return markDocument({ ...current, schema_version: 3, timeline: invalidateChangedSemanticMasks(timelineOf(current.timeline), next) }); };
    const applyTimeline = (next: Timeline) => commitTimeline(next).status === 'accepted';
    const applySceneCuts = () => {
        const frames = sceneRows.filter(row => row.ticked).map(row => row.frame), current = currentDocument();
        if (!current || !sceneClip || !selection || scenes.resultKey !== sceneRunKey) { setSceneAnnouncement(t('editorScenes.stale')); scenes.clear(); return; }
        const next = splitClipAtFrames(timelineOf(current.timeline), { track: 'video', id: sceneClip.id }, frames);
        if (!next) { setProblem(t('editorScenes.locked')); return; }
        const result = commitTimeline(next);
        if (result.status !== 'accepted') return;
        const selectedScene = { track: 'video' as const, id: sceneClip.id };
        setSelection(selectedScene); setSelections([selectedScene]); setPlaying(false); setFrame(frames[0] ?? sceneClip.start);
        setSceneAnnouncement(t('editorScenes.applied', { value1: frames.length })); scenes.clear();
    };
    const previewClip = (id: string) => {
        const row = clipRows.find(item => item.id === id);
        if (!row) return;
        if (clipPreview?.id === id && playing) { setPlaying(false); setClipPreview(null); return; }
        setFrame(row.startFrame); setClipPreview({ id, endFrame: row.endFrame }); setPlaying(true);
    };
    const applyFoundClips = () => {
        const current = currentDocument();
        const before = timelineOf(current?.timeline), liveSelected = selection?.track === 'video' ? clipAt(before, selection) : undefined;
        const liveClip = liveSelected && 'mediaId' in liveSelected ? liveSelected as Clip : undefined;
        const liveMedia = liveClip?.mediaId ? before.media[liveClip.mediaId] : undefined;
        const liveSceneKey = `${projectId}:${getCacheUser() ?? ''}:${getEditRevision()}:${selection?.track ?? ''}:${selection?.id ?? ''}:${liveClip?.start ?? ''}:${liveClip?.in ?? ''}:${liveClip?.len ?? ''}`;
        const liveRunKey = `${liveSceneKey}:${liveMedia?.hasAudio ? 'audio' : 'silent'}`;
        if (!current || !liveClip || !liveMedia || clips.resultKey !== clipRunKey || liveRunKey !== clipRunKey) {
            setClipAnnouncement(t('editorClips.stale')); clips.clear(); setClipPreview(null); return;
        }
        const next = appendSelectedClipFinderRows(before, liveMedia.id, clipRows);
        if ('error' in next) { setProblem(t('editorClips.cannotAdd')); return; }
        const existing = new Set(before.video.map(item => item.id));
        const added = next.video.filter(item => !existing.has(item.id));
        const result = markDocument({ ...current, schema_version: 3, timeline: next });
        if (result.status !== 'accepted') return;
        const first = added[0];
        if (first) { const nextSelection = { track: 'video' as const, id: first.id }; setSelection(nextSelection); setSelections([nextSelection]); setFrame(first.start); }
        setPlaying(false); setClipPreview(null); setClipAnnouncement(plural('editorClips.applied', added.length)); clips.clear();
    };
    const trackActions = useEditorTrackActions(timeline, () => timelineOf(currentDocument()?.timeline ?? document.timeline), applyTimeline);
    const placeVoiceover: VoiceoverProps['insert'] = media => {
        const result = insertMediaAt(timelineOf(currentDocument()?.timeline), media, voiceoverAt ?? 0);
        if ('error' in result) return result.error; const commit = commitTimeline(result.timeline);
        if (commit.status !== 'accepted') return commit;
        setSelection(result.selection); setSelections([result.selection]); return 'placed';
    };
    const updateCanvas = (patch: Partial<Canvas>) => { const nextCanvas = { ...canvas, ...patch }; const nextTimeline = { ...timeline, aspect: nextCanvas.aspect_ratio };
        markDocument({ ...document, schema_version: 3, canvas: nextCanvas, ...(nextTimeline ? { timeline: nextTimeline } : {}) }); };
    const selectClip = (next: Selection) => { setSelection(next); setSelections((current) => { if (!multiSelect) return [next];
            return current.some((item) => item.track === next.track && item.id === next.id) ? current.filter((item) => item.track !== next.track || item.id !== next.id) : [...current, next];
        }); };
    const canMove = (direction: -1 | 1) => !!selection && !timeline.tracks.find((track) => track.id === clipAt(timeline, selection)?.trackId)?.locked && moveClip(timeline, selection, direction)
        !== null; const moveSelection = (direction: -1 | 1) => { const next = selection && canMove(direction) ? moveClip(timeline, selection, direction) : null;
        if (next) applyTimeline(next); };
    const removeSelection = () => { const targets = selections.length ? selections : selection ? [selection] : []; if (!targets.length) return;
        if (targets.some(target => timeline.tracks.some(track => track.id === clipAt(timeline, target)?.trackId && track.locked))) {
            setProblem(t('editor.unlockoraddatrackfirst', { value1: selection?.track ?? 'video' })); return; }
        // An extra track emptied by this delete goes with it (one undo step); the first track of each kind always stays.
        const next = pruneEmptiedExtraTracks(removeSelections(timeline, targets, ripple), targets.map(target => clipAt(timeline, target)?.trackId)); if (!applyTimeline(next)) return;
        setSelection(null); setSelections([]); };
    const duplicateSelection = () => { const result = duplicateSelections(timeline, selections.length ? selections : selection ? [selection] : []); if (!result) return;
        if (!applyTimeline(result.timeline)) return; setSelections(result.selections); setSelection(result.selections.at(-1) ?? null); };
    const addOverlay = (kind: 'title' | 'caption') => { const seq = timeline.seq + 1; const trackId = timeline.tracks.find((track) => track.kind === 'text' && !track.locked)?.id;
        const caption = kind === 'caption';
        const span = caption ? overlaySpan(timeline, frameStore.get(), Math.round(timeline.fps * 2)) : placeTitle(frameStore.get(), mediaFrames(timeline), total);
        const item: TextClip = { id: `t${seq}`, text: caption ? t('editor.captiondefault') : t('editor.yourtitle'), ...span, x: 0.5, y: caption ? 0.92 : 0.85, size: caption ? 4 : 6, trackId,
            style: DEFAULT_TEXT_STYLE, ...(caption ? { caption: true } : {}) }; if (!applyTimeline({ ...timeline, seq, text: [...timeline.text, item] })) return;
        setSelection({ track: 'text', id: item.id });
        setSelections([{ track: 'text', id: item.id }]); setTool(caption ? 'captions' : 'text'); };
    const addText = () => addOverlay('title'), addCaption = () => addOverlay('caption'); const updateSelectedText = (text: string) => { if (selection?.track !== 'text') return;
        const value = text.slice(0, 1000);
        applyTimeline(updateClip(timeline, selection, { text: value, ...(selected && 'text' in selected && value !== selected.text && selected.words?.length ? { words: [] } : {}) })); };
    const patchSelected = (patch: Partial<Clip & TextClip>) => { if (!selection) return; applyTimeline(updateClip(timeline, selection, patch)); };
    const adjustStart = (delta: number) => { if (selection) { const next = moveItems(timeline, [selection], selection, delta, undefined, false, frameStore.get()); if (next) applyTimeline(next);
        } };
    const adjustLength = (delta: number) => { if (selection) { const next = trimItem(timeline, selection, 'out', delta, false, frameStore.get(), advanced ? ripple : 'lane'); if (next)
        applyTimeline(next); } };
    const speedActions = useSpeedActions({ timeline, selection, applyTimeline, setProblem, frameStore, setSelection, setSelections });
    const splitSelection = () => { if (!selection) return;
        if (selectedTrack?.locked) { setProblem(t('editor.unlockoraddatrackfirst', { value1: selection.track })); return; }
        const next = splitClip(timeline, selection, frameStore.get());
        if (!next) { setProblem(t('editor.movetheplayheadinsidetheselectedclip')); return; } applyTimeline(next); };
    const paste = () => { const result = pasteClipboard(timeline, clipboard, frameStore.get()); if (!result) return; if (!applyTimeline(result.timeline)) return;
        setSelections(result.selections); setSelection(result.selections.at(-1) ?? null); };
    const toggleMultiSelect = () => { setMultiSelect((value) => !value); if (multiSelect && selection) setSelections([selection]); };
    const setGrouped = (grouped: boolean) => { const targets = selections.length ? selections : selection ? [selection] : []; applyTimeline(groupSelections(timeline, targets, grouped)); };
    const addTimelineTrack = (kind: TrackKind) => applyTimeline(addTrack(timeline, kind)); const addTimelineMarker = () => applyTimeline(addMarker(timeline, frameStore.get()));
    const updateTrack = (track: EditorTrack, patch: Partial<EditorTrack>) => applyTimeline({ ...timeline, tracks: timeline.tracks.map((item) => item.id === track.id ? { ...item, ...patch, id:
        item.id, kind: item.kind } : item) }); const addMediaToTimeline = (media: Media) => returns.place(media, clampFrame(frameStore.get()), true);
    const importLibrary = async (choice: LibraryChoice, kind: SlotKind) => { const token = beginImport(); if (!token) return; setLibraryKind(null); setLibraryPending(true); setProblem(null);
        try { if (kind === 'audio') { const stems = await libraryStems(api, choice.jobId);
                if (!mounted.current || !readiness.current || liveProject.current !== projectId || !token.valid()) return; if (stems.length) { setStemChoice({ choice, stems }); return; } }
            const media = await libraryMedia(api, choice, kind, () => token.valid()); if (media === LIBRARY_STOPPED || !token.valid()) return;
            if (!media) { setProblem(t('editorCore.lengthUnknown')); return; } addMediaToTimeline(media);
        } catch (error) { if (isAccountChanged(error)) sync.accountChanged(); else if (token.valid()) setProblem(t('editorCore.lengthUnknown')); }
        finally { token.end(); if (mounted.current) setLibraryPending(false); } };
    const importPicked = async (asset: { uri: string; fileName?: string | null; name?: string; mimeType?: string | null; duration?: number | null; width?: number; height?: number }) => {
        const token = beginImport(); if (!token) return; try { const mime = String(asset.mimeType || '').toLowerCase();
            const kind = mime.startsWith('audio/') ? 'audio' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null;
            if (!kind) { setProblem(t('editor.chooseavideoimageoraudiofile')); return; } const id = `l-${randomUUID()}`; const durationSeconds = await preparePicked(asset, id, kind);
            if (!token.valid() || durationSeconds === null) return; const media: Media = { id, name: String(asset.fileName || asset.name || `Device ${kind}`).slice(0, 120),
                kind, frames: Math.max(1, Math.floor(durationSeconds * timeline.fps)), hasAudio: kind !== 'image',
                width: Math.max(0, Math.round(asset.width || 0)), height: Math.max(0, Math.round(asset.height || 0)), }; addMediaToTimeline(media); } finally { token.end(); } };
    const choosePhotos = async () => { setProblem(null); try {
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: false, quality: 1, preferredAssetRepresentationMode:
                ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible }); if (!result.canceled && result.assets[0]) await importPicked(result.assets[0]);
        } catch { setProblem(t('editor.couldnotopenPhotosCheckVeyrnoxaccess')); } };
    const chooseFiles = async () => { setProblem(null); try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['video/*', 'audio/*', 'image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true });
            if (!result.canceled && result.assets[0]) await importPicked(result.assets[0]); } catch { setProblem(t('editor.couldnotopenFilesTryagain')); } };
    const openAssetPacks = () => { setPlaying(false); setSheet(null); setAssetPackAt(clampFrame(frameStore.get())); };
    const addPackAsset = async (pack: AssetPack, asset: PackAsset, picked: PickedPackFile,
        progress: (stage: 'copying' | 'verifying' | 'placing') => void, operationLive: () => boolean) => {
        const token = beginImport(); if (!token) return 'changed' as const;
        const id = `l-${randomUUID()}`;
        try {
            const seconds = await preparePicked({ uri: picked.uri, mimeType: packFileMime(picked) }, id, asset.kind, { requireCopy: true, backup: false,
                expectedSha256: asset.sha256, expectedKind: asset.kind, onProgress: progress, live: operationLive });
            if (!token.valid() || !operationLive()) { await editorDeviceMedia.remove(projectId, id); session.setLocalMediaUris(current => {
                    const next = { ...current }; delete next[id]; return next;
                }); return 'changed' as const; }
            if (seconds === null) { await editorDeviceMedia.remove(projectId, id); return isReady() ? 'invalidFile' as const : 'changed' as const; }
            progress('placing'); const media: Media = { id, name: asset.name, kind: asset.kind, frames: Math.max(1, Math.floor(seconds * timeline.fps)),
                hasAudio: asset.kind !== 'image', width: 0, height: 0, ...packMediaDetails(pack, asset) };
            const result = insertMedia(media, assetPackAt ?? clampFrame(frameStore.get()), true);
            if (result !== 'placed') {
                await editorDeviceMedia.remove(projectId, id); session.setLocalMediaUris(current => { const next = { ...current }; delete next[id]; return next; });
                if (!token.valid() || !operationLive() || result === 'dropped' || typeof result === 'object' && result.status === 'not-live') return 'changed' as const;
                if (result === 'full') return 'projectFull' as const;
                if (typeof result === 'object' && result.status === 'refused' && result.reason === 'tooLarge') return 'tooLarge' as const;
                return 'cannotAdd' as const;
            }
            return 'placed' as const;
        } finally { token.end(); }
    };
    const openWorkflow = async (path: string) => { const saved = await save(); if (saved) router.push(path as never); };
    const openCloudExport = async () => { const rawFonts = (timeline as unknown as { fonts?: unknown }).fonts, declaredFonts = validCustomFonts(timeline);
        if (rawFonts !== undefined && (!Array.isArray(rawFonts) || rawFonts.length !== declaredFonts.length)) { setProblem(t('editorEditGate.invalid')); return; }
        if (declaredFonts.length) { setProblem(t('editorFont.exportNote')); return; }
        if (!exportGate.available) { if (await save()) setProblem(t(exportGate.messageKey)); return; } try { requireOnline(); } catch {
        setProblem(OFFLINE_PAID_MESSAGE); return; } if (exportUnavailable()) { setProblem(t('handoff.exportUnavailable')); return; } if (await savedDocument()) setExportVisible(true); };
    const openExport = () => { setPlaying(false); setLocalExportVisible(true); };
    // Simple view: three entries open sheets that reuse the same handlers as the full tool set.
    const showPanel = (next: Tool) => { setTool(next); setPanelOpen(true); }; const addRows: SheetRow[] = [
        { id: 'library-video', icon: '▣', label: t('editor.libraryvideo'), disabled: libraryPending || replacing, onPress: () => setLibraryKind('video') },
        { id: 'library-image', icon: '▧', label: t('editor.libraryimage'), disabled: libraryPending || replacing, onPress: () => setLibraryKind('image') },
        { id: 'library-audio', icon: '♫', label: t('editor.libraryaudio'), disabled: libraryPending || replacing, onPress: () => setLibraryKind('audio') },
        { id: 'photos', icon: '▤', label: t('editor.photosvideos'), disabled: replacing, afterClose: true, onPress: () => void choosePhotos() },
        { id: 'files', icon: '▥', label: t('editor.files'), disabled: replacing, afterClose: true, onPress: () => void chooseFiles() },
        { id: 'asset-packs', icon: '▦', label: t('editorPack.title'), disabled: replacing, onPress: openAssetPacks },
        ...(VOICEOVER_AVAILABLE ? [{ id: 'voiceover', icon: '●', label: t('editorVoiceover.open'), hint: t('editorSimple.voiceoverHint'), disabled: replacing, onPress: () => { setPlaying(false);
            setVoiceoverAt(clampFrame(frameStore.get())); setVoiceoverMessage(null); } }] : []), ]; const aiRows: SheetRow[] = [
        ...(bestCut.available ? [{ id: 'best-cut', icon: '✦', label: t('bestCut.title'), disabled: !ready, onPress: () => { setSheet(null); bestCut.launch(); } }] : []),
        ...(speechQuote ? (['silences', 'retakes', 'fillers'] as const).map(mode => ({ id: `speech-${mode}`, icon: '✦', label: t(`editorSpeech.${mode}`), disabled: !ready, onPress: () => {
            setPlaying(false); setSheet(null); setSpeechMode(mode); } })) : []),
        ...(aiQuote ? [{ id: 'describe', icon: '✦', label: t('editorAi.describe'), disabled: !ready, onPress: () => { setPlaying(false); setAiAnnouncement(null); setAiEditOpen(true); } }] : []),
        { id: 'smart-cut', icon: '✦', label: t('editorSimple.smartCut'), hint: t('editorSimple.smartCutHint'), onPress: () => void openWorkflow('/smart-cut') },
        { id: 'make-clip', icon: '▶', label: t('editorSimple.makeClip'), hint: t('editorSimple.makeClipHint'), onPress: () => { showPanel('generate'); openGenerate('video'); } },
        { id: 'make-audio', icon: '♫', label: t('editorSimple.makeAudio'), hint: t('editorSimple.makeAudioHint'), onPress: () => { showPanel('generate'); openGenerate('audio'); } },
        { id: 'captions', icon: 'CC', label: t('editor.captions'), hint: t('editorSimple.captionsHint'), onPress: () => showPanel('captions') }, ]; const moreRows: SheetRow[] = [
        { id: 'text', icon: 'T', label: t('editor.addText'), hint: t('editorSimple.textHint'), onPress: () => { addText(); setPanelOpen(true); } },
        { id: 'scenes', icon: '⌇', label: t('editor.scenes'), hint: t('editorScenes.private'), onPress: () => showPanel('scenes') },
        { id: 'clips', icon: '▶', label: t('editorClips.find'), hint: t('editorClips.private'), onPress: () => showPanel('clips') },
        { id: 'export', icon: '⇩', label: t('editor.export'), hint: t('editorLocalExport.help'), onPress: openExport },
        { id: 'versions', icon: '↺', label: t('editorSave.versions'), hint: t('editorSimple.versionsHint'), onPress: sync.openVersions },
        { id: 'all-tools', icon: '☷', label: t('editorSimple.allTools'), hint: t('editorSimple.allToolsHint'), onPress: () => setAdvanced(true) }, ];
    const openVoiceover = () => { setPlaying(false); setVoiceoverAt(clampFrame(frameStore.get())); setVoiceoverMessage(null); };
    const brandProps = { title: t('editor.brandkit'), body: t('editor.managelogosfontscoloursandapprovedassets'),
        action: t('editor.openBrandkit'), onPress: () => void openWorkflow('/brand-kit') };
    const panelProps: ToolPanelProps = { lookActions, motionActions, maskActions, fontActions, speechCaptionActions, motionProcessingActions, personMaskActions,
        audioActions, originalAudio, timeline, selection, selected, textActions, captionActions, patchSelected, applyTimeline, availableMedia, addMediaToTimeline, libraryPending, replacing,
        setLibraryKind, choosePhotos, chooseFiles, openAssetPacks, selections, selectClip, openVoiceover, openGenerate, addTimelineTrack,
        addText, updateSelectedText, addCaption, setFrame, addTimelineMarker, setPlaying, currentDocument, selectedMedia, selectedTrack,
        canMove, moveSelection, removeSelection, adjustStart, adjustLength, speedActions, document, markDocument, canvas, updateCanvas, updateTrack, };
    return <View style={[styles.screen, { paddingLeft: insets?.left ?? 0, paddingRight: insets?.right ?? 0 }]}>
        <LocalExportSheet visible={localExportVisible} api={api} account={getCacheUser() ?? ''} projectId={projectId} revision={getEditRevision()} timeline={timeline} canvas={canvas} localMediaUris={localMediaUris}
            onClose={() => setLocalExportVisible(false)} onCloud={() => { setLocalExportVisible(false); void openCloudExport(); }} />
        {EDITOR_SERVER_EXPORT_ENABLED ? <ServerExportSheet api={api} router={router} now={Date.now} projectId={projectId} name={name} document={document} dirty={dirty} visible={exportVisible}
            onOpen={() => setExportVisible(true)} onClose={() => setExportVisible(false)} onFallback={() => { setExportVisible(false); setProblem(t('handoff.exportUnavailable')); }} /> : null}
        <Stack.Screen options={{ gestureEnabled: !timelineTouch && !selection /* a selected clip is about to be dragged: swipe-back must not steal that drag; Done and the leave guard still exit
            */, title: t('editor.cut'), headerRight: () => <HeaderAction label={t('editor.done')} onPress={guard.done} /> }} />
        <View style={styles.projectBar}>
            {advanced ? <View style={styles.cutBadge}><Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.cutMark}>{t('editor.v')}</Text><Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.cutLabel}>{t('editor.cUT')}</Text></View> : null}
            <View style={styles.titleGroup}>
                <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.title}>{name}</Text>
                <StatusText variant="inherit" maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined} style={styles.status}>{saveStatus}</StatusText>
            </View>
            {advanced ? <><Button label={t('editorSave.versions')} variant="tertiary" size="sm" containerStyle={{ marginVertical: -2 }} onPress={sync.openVersions} /><View
                style={styles.formatBadge}><Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.formatText}>{canvas.aspect_ratio}</Text><Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.formatMeta}>{t('editor.fPS', { value1: canvas.frame_rate
                })}</Text></View></> : null}
        </View>
        {problem ? <StatusText key={placement} variant="inherit" accessibilityRole="alert" style={styles.problem}>{problem}</StatusText> : null}
        {advanced ? null : <View style={styles.simpleActions}>
            <Command icon="↶" label={t('editor.undo')} disabled={!history.canUndo} onPress={() => travel('undo')} />
            <Command icon="↷" label={t('editor.redo')} disabled={!history.canRedo} onPress={() => travel('redo')} />
            {selection ? <>
                <Command icon="⇥" label={t('editorSimple.closeGaps')} selected={ripple !== 'none'} onPress={() => setRipple(ripple === 'none' ? 'lane' : 'none')} />{selection.track === 'audio' ?
                    <Command icon="♪" label={t('editor.volume')} onPress={() => showPanel('adjust')} /> : null}
                <Command icon="✂" label={t('editor.split')} onPress={splitSelection} />
                <Command icon="⧉" label={t('editor.duplicate')} onPress={duplicateSelection} />
                <Command icon="◀" label={t('editor.moveLeft')} disabled={!canMove(-1)} onPress={() => moveSelection(-1)} />
                <Command icon="▶" label={t('editor.moveRight')} disabled={!canMove(1)} onPress={() => moveSelection(1)} />
                <Command icon="⌫" label={t('editor.delete')} danger onPress={removeSelection} />
            </> : null}
            <View style={styles.simpleSpacer} />
            <Command icon="⇩" label={t('editor.export')} onPress={openExport} />
        </View>}
        {advanced ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.commandStrip} contentContainerStyle={styles.commandContent}>
            <Command icon="↶" label={t('editor.undo')} disabled={!history.canUndo} onPress={() => travel('undo')} />
            <Command icon="↷" label={t('editor.redo')} disabled={!history.canRedo} onPress={() => travel('redo')} />
            <View style={styles.commandDivider} />
            <Command icon="◉" label={t('editor.selectmultiple')} selected={multiSelect} onPress={toggleMultiSelect} />
            <Command icon="⧉" label={t('editor.duplicate')} disabled={!selection} onPress={duplicateSelection} />
            <Command icon="✂" label={t('editor.split')} disabled={!selection} onPress={splitSelection} />
            <Command icon="□" label={t('editor.copy')} disabled={!selection} onPress={() => setClipboard(copySelections(timeline, selections.length ? selections : selection ? [selection] : []))}
                />
            <Command icon="▣" label={t('editor.pasteatplayhead')} disabled={!clipboard} onPress={paste} />
            <Command icon="⌫" label={t('editor.delete')} danger disabled={!selection} onPress={removeSelection} />
            <Command icon="⌘" label={t('editor.group')} disabled={selections.length < 2} onPress={() => setGrouped(true)} />
            <Command icon="⌁" label={t('editor.ungroup')} disabled={!selectedGroup} onPress={() => setGrouped(false)} />
            <View style={styles.commandDivider} />
            <Command icon="▣+" label={t('editor.addvideotrack')} onPress={() => addTimelineTrack('video')} />
            <Command icon="♫+" label={t('editor.addaudiotrack')} onPress={() => addTimelineTrack('audio')} />
            <Command icon="T+" label={t('editor.addtexttrack')} onPress={() => addTimelineTrack('text')} />
            <Command icon="▣−" label={t('editor.removeemptytrack')} disabled={!trackActions.emptyCount} onPress={trackActions.removeEmptyTracks} />
            <Command icon="◆" label={t('editor.addmarker')} onPress={addTimelineMarker} />
            <Command icon="＋" label={t('editor.addtext')} onPress={addText} />
            <View style={styles.commandDivider} />
            <Command icon="⇩" label={t('editor.export')} onPress={openExport} />
            <Command icon="◈" label={t('editor.credits')} onPress={() => void openWorkflow('/credits')} />
            <View style={styles.commandDivider} />
            <Command icon="◧" label={t('editorSimple.simpleView')} onPress={() => setAdvanced(false)} />
        </ScrollView> : null}
        {advanced ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionStrip} contentContainerStyle={styles.optionContent}>
            <Choice label={t('editor.snap')} selected={snap} onPress={() => setSnap((value) => !value)} compact />
            <Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.optionLabel}>{t('editor.ripple')}</Text>
            {(['none', 'lane', 'all'] as const).map((value) => <Choice key={value} label={value === 'none' ? t('editor.off') : value === 'lane' ? t('editor.selectedtrack') :
                t('editor.alltracks')} selected={ripple === value} onPress={() => setRipple(value)} compact />)}
            <View style={styles.optionSpacer} />
            <Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.optionLabel}>{t('editor.zoom')}</Text>
            <Action label={t('editorCore.zoomOut')} disabled={zoom <= PPF_MIN} onPress={() => setZoom(value => Math.max(PPF_MIN, value / 2))} compact />
            <Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.zoomValue}>{t('editorCore.zoomValue', { value1: formatNumber(zoom, 2) })}</Text>
            <Action label={t('editorCore.zoomIn')} disabled={zoom >= PPF_MAX} onPress={() => setZoom(value => Math.min(PPF_MAX, value * 2))} compact />
            <Action label={t('editorCore.fit')} onPress={() => setZoom(fitPpf(viewport, total))} compact />
        </ScrollView> : null}
        <View testID="editor-workspace" style={[styles.editorWorkspace, advanced && budget.wideShort && styles.editorWorkspaceWide]}>
        <View style={[styles.previewArea, !advanced && !panelOpen && styles.simpleFill, advanced && budget.wideShort && styles.previewAreaWide]}>
            {bestCut.result}
            {advanced && !budget.showPreviewHeading ? null : <View style={styles.previewHeading}>
                <Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.eyebrow}>{t('editor.pREVIEW')}</Text>
                <Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.previewMeta}>{clipCount ? plural('editor.clipsOnTimelineCount', clipCount) : t('editor.emptysequence')}</Text>
            </View>}
            <View style={[styles.previewFrame, advanced || panelOpen ? { height: previewHeight } : styles.simpleFill]}>
                <View style={[styles.canvas, { aspectRatio: canvas.aspect_ratio === '9:16' ? 9 / 16 : canvas.aspect_ratio === '1:1' ? 1 : 16 / 9 }]}>
                    <PlaybackPreview frameStore={frameStore} timeline={timeline} api={api} playing={playing} localMediaUris={localMediaUris} fontReady={fontActions.has} staticPreview
                        motionHandle={(advanced || panelOpen) && tool === 'motion' ? { selection, actions: motionActions } : undefined} />
                </View>
            </View>
            <PlaybackTransport frameStore={frameStore} total={total} fps={timeline.fps} playing={playing} onSeek={setFrame} onPlaying={setPlaying} />
        </View>
        <View testID="editor-timeline-section" style={[styles.timelineSection, advanced && (budget.wideShort ? styles.timelineSectionWide
            : { flexShrink: 1, flexGrow: 0, maxHeight: budget.timelineMax, minHeight: Math.min(budget.timelineMax, 119) })]}>
            <View style={styles.timelineHeading}>
                <Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.eyebrow}>{t('editor.tIMELINE')}</Text>
                <Text maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} style={styles.timelineHelp}>{multiSelect ? t('editor.selectedtapclipstoadd', { value1: selections.length }) : selection ? (advanced ? t('editor.tapacommandtoeditselection')
                    : t('editor.clipSelectedUseButtons')) : t('editor.tapacliptoselect')}</Text>
            </View>
            {advanced ? <ScrollView testID="editor-timeline-scroll" nestedScrollEnabled scrollEnabled={!timelineTouch} style={{ maxHeight: budget.timelineScrollMax }}
                showsVerticalScrollIndicator>
                <PlaybackTimeline clipThumb={mediaId => mediaId.startsWith('j-') ? <JobThumb links={thumbLinks} jobId={mediaId.slice(2)} size={36} /> : null} onGestureActive={(active:
                    boolean) => { setTimelineTouch(active); returns.gestureActive(active); }} timeline={timeline} selections={selections} ppf={zoom} total={total} frameStore={frameStore}
                    playing={playing} snap={snap} ripple={advanced ? ripple : 'lane'} analysisMarks={tool === 'scenes' ? sceneMarks : []}
                    clipRanges={tool === 'clips' ? clipRows.map(row => ({ id: row.id, startFrame: row.startFrame, endFrame: row.endFrame, rank: row.rank, selected: row.ticked })) : []}
                    onTrackPress={trackActions.pressTrack} onViewport={setViewport} onSeek={value => { setPlaying(false);
                    setFrame(value); }} onSelect={selectClip} onApply={applyTimeline} />
            </ScrollView> : <PlaybackTimeline clipThumb={mediaId => mediaId.startsWith('j-') ? <JobThumb links={thumbLinks} jobId={mediaId.slice(2)} size={36} /> : null}
                onGestureActive={(active: boolean) => { setTimelineTouch(active); returns.gestureActive(active); }} timeline={timeline} selections={selections} ppf={zoom} total={total}
                frameStore={frameStore} playing={playing} snap={snap} ripple={advanced ? ripple : 'lane'} analysisMarks={tool === 'scenes' ? sceneMarks : []}
                clipRanges={tool === 'clips' ? clipRows.map(row => ({ id: row.id, startFrame: row.startFrame, endFrame: row.endFrame, rank: row.rank, selected: row.ticked })) : []}
                onTrackPress={trackActions.pressTrack} onViewport={setViewport} onSeek={value => {
                setPlaying(false); setFrame(value); }} onSelect={selectClip} onApply={applyTimeline} />}
        </View>
        {advanced || panelOpen ? <EditorToolSheet inline={advanced} wide={advanced && budget.wideShort} minHeight={budget.wideShort ? undefined : budget.panelMin}
            rail={advanced ? <ToolRail tool={tool} setTool={setTool} /> : undefined}>
        {!advanced && panelOpen ? <View style={styles.simpleActions}><Action label={t('editorSimple.closePanel')} onPress={() => setPanelOpen(false)} /></View> : null}
        <ScrollView style={styles.inspector} contentContainerStyle={styles.inspectorContent} keyboardShouldPersistTaps="handled">
            {tool === 'media' ? <MediaPanel {...panelProps} /> : null}
            {tool === 'audio' ? <AudioPanel {...panelProps} /> : null}
            {tool === 'generate' ? <EditorGeneratePanel rows={returns.rows} note={returns.note} onOpen={() => openGenerate('video')} onAdd={id => void returns.addAtPlayhead(id,
                clampFrame(frameStore.get()))} onDismiss={id => void returns.dismiss(id)} /> : null}
            {tool === 'text' ? <TextPanel {...panelProps} /> : null}
            {tool === 'captions' ? <CaptionsPanel {...panelProps} /> : null}
            {tool === 'transcript' ? <TranscriptPanel {...panelProps} /> : null}
            {tool === 'scenes' ? <ScenesPanel availability={scenes.availability} blocker={sceneBlocker} status={scenes.status} progress={scenes.progress} rows={sceneRows} error={sceneError}
                onDetect={() => { if (clipRunning) return; setPlaying(false); setSceneAnnouncement(null); void scenes.detect(); }} onCancel={scenes.cancel} onToggle={scenes.toggle}
                onPreview={frame => { setPlaying(false); setFrame(frame); }} onApply={applySceneCuts} /> : null}
            {tool === 'clips' ? <ClipFinderPanel availability={clips.availability} blocker={clipBlocker} status={clips.status} progress={clips.progress} fps={timeline.fps}
                rows={clipRows} error={clipError} hadAudio={clips.hadAudio} previewingId={clipPreview?.id}
                onFind={() => { if (sceneRunning) return; setPlaying(false); setClipPreview(null); setClipAnnouncement(null); void clips.find(); }} onCancel={clips.cancel} onToggle={clips.toggle}
                onPreview={previewClip} onApply={applyFoundClips} /> : null}
            {tool === 'effects' ? <EffectsPanel {...panelProps} /> : null}
            {tool === 'transitions' ? <TransitionsPanel {...panelProps} /> : null}
            {tool === 'filters' ? <FiltersPanel {...panelProps} /> : null}
            {tool === 'motion' ? <MotionPanel {...panelProps} /> : null}{tool === 'mask' ? <MaskPanel {...panelProps} /> : null}
            {tool === 'animation' ? <AnimationPanel {...panelProps} /> : null}
            {tool === 'brand' ? <WorkflowPanel {...brandProps} /> : null}
            {tool === 'markers' ? <MarkersPanel {...panelProps} /> : null}
            {tool === 'adjust' ? <AdjustPanel {...panelProps} /> : null}
        </ScrollView>
        </EditorToolSheet> : null}
        </View>
        {advanced || panelOpen ? null : <SimpleEditorBar onOpen={setSheet} />}
        {bestCut.sheet}
        {speechMode && speechQuote ? <EditorSpeechCutSheet api={api} quote={speechQuote} mode={speechMode} snapshot={() => ({ timeline: timelineOf(currentDocument()?.timeline), freshness:
            editFreshness(), selection })}
            apply={(next, expected) => { if (!isReady()) return { status: 'not-live' };
                if (!sameRevision(expected, editFreshness())) return { status: 'stale' };
                const result = commitTimeline(next); if (result.status !== 'accepted') return result;
                setAiAnnouncement(t('editorSpeech.applied')); return result; }}
            onClose={() => setSpeechMode(null)} onUnavailable={() => { setSpeechMode(null); setSpeechQuote(null); }} /> : null}
        {aiEditOpen && aiQuote ? <EditorAiEditSheet api={api} quote={aiQuote} snapshot={() => ({ timeline: timelineOf(currentDocument()?.timeline), freshness: editFreshness() })}
            apply={(next, expected) => { if (!isReady()) return { status: 'not-live' };
                if (!sameRevision(expected, editFreshness())) return { status: 'stale' };
                const result = commitTimeline(next); if (result.status !== 'accepted') return result;
                setAiAnnouncement(t('editorAi.applied')); return result; }}
            onClose={() => setAiEditOpen(false)} onUnavailable={() => { setAiEditOpen(false); setAiQuote(null); }} /> : null}
        {sheet === 'add' ? <SimpleEditorSheet title={t('editorSimple.addTitle')} rows={addRows} onClose={() => setSheet(null)} /> : null}
        {sheet === 'ai' ? <SimpleEditorSheet title={t('editorSimple.aiTitle')} rows={aiRows} describe onDescribe={(id, prompt) => {
            if (id === 'make-clip' || id === 'make-audio') { showPanel('generate'); openGenerate(id === 'make-clip' ? 'video' : 'audio', prompt); }
            else aiRows.find(row => row.id === id)?.onPress();
        }} onClose={() => setSheet(null)} /> : null}
        {sheet === 'more' ? <SimpleEditorSheet title={t('editorSimple.moreTitle')} rows={moreRows} onClose={() => setSheet(null)} /> : null}
        {generate ? <MakePanel visible={generate.visible && ready} initialKind={generate.kind} initialPrompt={generate.prompt} onClose={() => setGenerate(value => value && { ...value, visible:
            false })} resultNote={t('editorAi.note', { time: timecode(generate.frame, timeline.fps) })} onJobStarted={(id, model) => {
            const kind = kindOf(model.modality); if (!kind || generate.owner !== getCacheUser()) return;
            void addPending(projectId, { jobId: id, kind, frame: generate.frame, name: model.name, createdAt: Date.now() }).then(() => { if (mounted.current && liveProject.current === projectId
                && generate.owner === getCacheUser() && currentDocument()?.project_id === projectId) void returns.refresh(); });
        }} /> : null}
        {stemChoice ? <EditorStemSheet api={api} {...stemChoice} ready={ready} beginImport={beginImport} onAdd={addMediaToTimeline} onClose={() => setStemChoice(null)} /> : null}
        {voiceoverAt !== null ? <VoiceoverSheet key={projectId} projectId={projectId} startFrame={voiceoverAt} fps={timeline.fps} ready={ready} beginImport={beginImport}
            preparePicked={preparePicked} insert={placeVoiceover} onAdded={onVoiceoverAdded} onClose={() => setVoiceoverAt(null)} /> : null}
        <AssetPackLibrarySheet key={`asset-pack-${projectId}`} visible={assetPackAt !== null && ready} playhead={timecode(assetPackAt ?? 0, timeline.fps)} onClose={() => setAssetPackAt(null)} onAdd={addPackAsset} />
        <EditorSaveSheets sync={sync} /><EditorVersionsSheet sync={sync} api={api} projectId={projectId} />
        {libraryKind ? <LibraryChooser api={api} kind={libraryKind} onClose={() => setLibraryKind(null)} onPick={(choice) => importLibrary(choice, libraryKind)} /> : null}
        {/* Required privacy acknowledgement: escape must not imply consent. */}
        <Modal visible={privacyNotice} transparent animationType="fade" onRequestClose={acknowledgePrivacy} accessibilityViewIsModal><View style={styles.noticeBackdrop}><View
            style={styles.noticeCard}><Text accessibilityRole="header" style={styles.noticeTitle}>{t('editor.privacyTitle')}</Text><Text
            style={styles.body}>{t('editor.privacySummary')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('editor.privacyConfirm')} style={[styles.primary, touchTarget]}
            onPress={acknowledgePrivacy}><Text style={styles.primaryText}>{t('editor.privacyConfirm')}</Text></Pressable></View></View></Modal>
    </View>;
}
