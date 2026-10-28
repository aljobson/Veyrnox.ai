import { Command, Action, Choice, Stepper, LabeledInput, PanelHeading, EmptyPanel, WorkflowPanel } from './EditorControls';
import { EditorTimeline } from './EditorTimeline';
import { EditorTransport } from './EditorTransport';
import { canTrim, fitPpf, formatTimecode as timecode, moveItems, trimItem, PPF_MIN, PPF_MAX, SEQUENCE_MAX } from '../../lib/editorTimeline';
import { libraryMedia } from '../../lib/editorLibraryLength';
import { getCacheUser } from '../../lib/appCache';
import { useEffect, useRef, useState } from 'react';
import { EDITOR_SERVER_EXPORT_ENABLED } from '../../lib/editorFlag';
import { requireOnline, OFFLINE_PAID_MESSAGE } from '../../lib/network';
import { exportUnavailable } from '../../lib/editorServerExport';
import { ServerExportSheet } from './ServerExportSheet';
import { styles } from './fullEditorStyles';

import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';

import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { touchTarget } from '../../lib/a11y';

import { plural, t } from '../../lib/i18n';
import { activeEditorMedia } from '../../lib/editorPreview';
import type { LibraryChoice } from '../../lib/librarySource';
import { DEFAULT_TEXT_STYLE, addMarker, addTrack, canvasOf, clipAt, copySelections, duplicateSelections, framesIn, groupSelections, pasteClipboard, removeSelections, splitClip, timelineOf, updateClip, type Canvas, type Clip, type EditorTrack, type Media, type Selection, type TextClip, type Timeline, type TrackKind } from '../../lib/nativeEditorModel';

import type { SlotKind } from '../../lib/sources';
import { colors } from '../../theme';
import { HeaderAction } from '../HeaderAction';
import { LibraryChooser } from '../LibraryChooser';
import { EditorMediaPreview } from './EditorMediaPreview';

type Tool = 'media' | 'audio' | 'generate' | 'text' | 'captions' | 'transcript' | 'effects' | 'transitions' | 'filters' | 'animation' | 'markers' | 'brand' | 'adjust';

const tools: readonly { id: Tool; icon: string; label: string }[] = [
    { id: 'media', icon: '▣', label: t('editor.media2') },
    { id: 'audio', icon: '♫', label: t('editor.audio') },
    { id: 'generate', icon: '✦', label: t('editor.generate') },
    { id: 'text', icon: 'T', label: t('editor.text2') },
    { id: 'captions', icon: 'CC', label: t('editor.captions') },
    { id: 'transcript', icon: '≡', label: t('editor.transcript') },
    { id: 'effects', icon: '✺', label: t('editor.effects') },
    { id: 'transitions', icon: '⇄', label: t('editor.transitions') },
    { id: 'filters', icon: '☼', label: t('editor.filters') },
    { id: 'animation', icon: '↝', label: t('editor.animation') },
    { id: 'markers', icon: '', label: t('editorCore.markersTool') },
    { id: 'brand', icon: '◆', label: t('editor.brandkit') },
    { id: 'adjust', icon: '☷', label: t('editor.adjust2') },
];
const seconds = (frames = 0, fps = 30) => `${Math.max(0, frames / fps).toFixed(1)}s`;

import { useFullEditorSession } from './useFullEditorSession';
export function FullEditorScreen({ projectId, jobId }: { projectId: string; jobId?: string }) {
    const mounted = useRef(true);
    const [libraryPending, setLibraryPending] = useState(false);
    const [viewport, setViewport] = useState(0);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const [exportVisible, setExportVisible] = useState(false);
    const { currentDocument, preparePicked, savedDocument, api, router, name, document, revision, dirty, saving, problem, setProblem, tool, setTool, selection, setSelection, selections, setSelections, multiSelect, setMultiSelect, clipboard, setClipboard, snap, setSnap, ripple, setRipple, zoom, setZoom, privacyNotice, history, frame, setFrame, playing, setPlaying, projectAssets, localMediaUris, libraryKind, setLibraryKind, markDocument, save, done, acknowledgePrivacy, travel } = useFullEditorSession({ projectId, jobId });
    if (!document) return <View style={styles.loading}><Stack.Screen options={{ title: t('editor.title') }} /><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{problem ?? t('editor.fullLoading')}</Text></View>;

    const canvas = canvasOf(document.canvas);
    const timeline = timelineOf(document.timeline);
    const total = framesIn(timeline);
    const selected = clipAt(timeline, selection);
    const selectedIndex = selection ? timeline[selection.track].findIndex((item) => item.id === selection.id) : -1;
    const selectedMedia = selected && 'mediaId' in selected && selected.mediaId ? timeline.media[selected.mediaId] : undefined;
    const previewText = timeline.text.find((item) => frame >= item.start && frame < item.start + item.len)?.text ?? timeline.text[0]?.text;
    const clipCount = timeline.video.length + timeline.audio.length + timeline.text.length;
    const selectedGroup = selected?.groupId;
    const selectedTrack = selection ? timeline.tracks.find((track) => track.id === selected?.trackId) : undefined;
    const availableMedia = [...Object.values(timeline.media), ...projectAssets.filter((asset) => !Object.values(timeline.media).some((item) => item.assetSource?.assetId === asset.assetSource?.assetId))];
    const activePreview = activeEditorMedia(timeline, frame);

    const applyTimeline = (next: Timeline) => markDocument({ ...(currentDocument() ?? document), schema_version: 3, timeline: next });
    const updateCanvas = (patch: Partial<Canvas>) => {
        const nextCanvas = { ...canvas, ...patch };
        const nextTimeline = { ...timeline, aspect: nextCanvas.aspect_ratio };
        markDocument({ ...document, canvas: nextCanvas, ...(nextTimeline ? { timeline: nextTimeline } : {}) });
    };
    const selectClip = (next: Selection) => {
        setSelection(next);
        setSelections((current) => {
            if (!multiSelect) return [next];
            return current.some((item) => item.track === next.track && item.id === next.id)
                ? current.filter((item) => item.track !== next.track || item.id !== next.id)
                : [...current, next];
        });
    };
    const moveSelection = (direction: -1 | 1) => {
        if (!selection || selectedIndex < 0) return;
        const list = [...timeline[selection.track]];
        const to = selectedIndex + direction;
        if (to < 0 || to >= list.length) return;
        [list[selectedIndex], list[to]] = [list[to], list[selectedIndex]];
        applyTimeline({ ...timeline, [selection.track]: list });
    };
    const removeSelection = () => {
        const targets = selections.length ? selections : selection ? [selection] : [];
        if (!targets.length) return;
        applyTimeline(removeSelections(timeline, targets, ripple));
        setSelection(null);
        setSelections([]);
    };
    const duplicateSelection = () => {
        const result = duplicateSelections(timeline, selections.length ? selections : selection ? [selection] : []);
        if (!result) return;
        applyTimeline(result.timeline);
        setSelections(result.selections);
        setSelection(result.selections.at(-1) ?? null);
    };
    const addText = () => {
        const seq = timeline.seq + 1;
        const trackId = timeline.tracks.find((track) => track.kind === 'text' && !track.locked)?.id;
        const item: TextClip = { id: `t${seq}`, text: t('editor.yourtitle'), start: Math.min(frame, Math.max(0, total)), len: 90, x: 0.5, y: 0.85, size: 6, trackId, style: DEFAULT_TEXT_STYLE };
        applyTimeline({ ...timeline, seq, text: [...timeline.text, item] });
        setSelection({ track: 'text', id: item.id });
        setSelections([{ track: 'text', id: item.id }]);
        setTool('text');
    };
    const updateSelectedText = (text: string) => {
        if (selection?.track !== 'text') return;
        applyTimeline(updateClip(timeline, selection, { text: text.slice(0, 1000) }));
    };
    const patchSelected = (patch: Partial<Clip & TextClip>) => {
        if (!selection) return;
        applyTimeline(updateClip(timeline, selection, patch));
    };
    const adjustStart = (delta: number) => { if (selection) { const next = moveItems(timeline, [selection], selection, delta, undefined, false, frame); if (next) applyTimeline(next); } };
    const adjustLength = (delta: number) => { if (selection) { const next = trimItem(timeline, selection, 'out', delta, false, frame); if (next) applyTimeline(next); } };
    const changeSpeed = (rate: number) => {
        if (!selection || selection.track === 'text' || !selected || !canTrim(selected)) return;
        const clip = selected as Clip;
        const sourceSpan = clip.len * (clip.rate ?? 1);
        const next = trimItem(updateClip(timeline, selection, { rate }), selection, 'out', Math.max(1, Math.floor(sourceSpan / rate)) - clip.len, false, frame);
        if (next) applyTimeline(next);
    };
    const toggleReverse = () => {
        if (!selection || selection.track === 'text' || !selected) return;
        const clip = selected as Clip;
        const distance = Math.max(0, clip.len - 1) * (clip.rate ?? 1);
        patchSelected({ reverse: !clip.reverse, in: Math.max(0, (clip.in ?? 0) + (clip.reverse ? -distance : distance)) });
    };
    const transformOf = (clip: Clip) => ({ x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false, ...clip.transform });
    const filterOf = (clip: Clip) => ({ brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, ...clip.filter });
    const splitSelection = () => {
        if (!selection) return;
        const next = splitClip(timeline, selection, frame);
        if (!next) { setProblem(t('editor.movetheplayheadinsidetheselectedclip')); return; }
        applyTimeline(next);
    };
    const paste = () => {
        const result = pasteClipboard(timeline, clipboard, frame);
        if (!result) return;
        applyTimeline(result.timeline);
        setSelections(result.selections);
        setSelection(result.selections.at(-1) ?? null);
    };
    const toggleMultiSelect = () => {
        setMultiSelect((value) => !value);
        if (multiSelect && selection) setSelections([selection]);
    };
    const setGrouped = (grouped: boolean) => {
        const targets = selections.length ? selections : selection ? [selection] : [];
        applyTimeline(groupSelections(timeline, targets, grouped));
    };
    const addTimelineTrack = (kind: TrackKind) => applyTimeline(addTrack(timeline, kind));
    const addTimelineMarker = () => applyTimeline(addMarker(timeline, frame));
    const updateTrack = (track: EditorTrack, patch: Partial<EditorTrack>) => applyTimeline({ ...timeline, tracks: timeline.tracks.map((item) => item.id === track.id ? { ...item, ...patch, id: item.id, kind: item.kind } : item) });
    const addMediaToTimeline = (media: Media, sourceTimeline = timeline) => {
        const kind: TrackKind = media.kind === 'audio' ? 'audio' : 'video';
        const trackId = sourceTimeline.tracks.find((track) => track.kind === kind && !track.locked)?.id;
        if (!trackId) { setProblem(t('editor.unlockoraddatrackfirst', { value1: kind })); return; }
        const seq = sourceTimeline.seq + 1;
        const item: Clip = { id: `${kind[0]}${seq}`, mediaId: media.id, start: frame, in: 0, len: Math.max(1, Math.min(media.frames || 90, 18_000 - frame)), trackId, volume: 1, transition: 0, rate: 1 };
        applyTimeline({ ...sourceTimeline, seq, media: { ...sourceTimeline.media, [media.id]: media }, [kind]: [...sourceTimeline[kind], item] } as Timeline);
        const nextSelection = { track: kind, id: item.id };
        setSelection(nextSelection);
        setSelections([nextSelection]);
    };
    const importLibrary = async (choice: LibraryChoice, kind: SlotKind) => {
        const owner = getCacheUser();
        setLibraryKind(null); setLibraryPending(true); setProblem(null);
        try {
            const media = await libraryMedia(api, choice, kind);
            if (!mounted.current || getCacheUser() !== owner) return;
            if (!media) { setProblem(t('editorCore.lengthUnknown')); return; }
            addMediaToTimeline(media, timelineOf(currentDocument()?.timeline));
        } finally { if (mounted.current) setLibraryPending(false); }
    };
    const importPicked = async (asset: { uri: string; fileName?: string | null; name?: string; mimeType?: string | null; duration?: number | null; width?: number; height?: number }) => {
        const mime = String(asset.mimeType || '').toLowerCase();
        const kind = mime.startsWith('audio/') ? 'audio' : mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null;
        if (!kind) { setProblem(t('editor.chooseavideoimageoraudiofile')); return; }
        const id = `l-${randomUUID()}`;
        const durationSeconds = await preparePicked(asset, id, kind);
        if (durationSeconds === null) return;
        const media: Media = {
            id,
            name: String(asset.fileName || asset.name || `Device ${kind}`).slice(0, 120),
            kind, frames: Math.max(1, Math.floor(durationSeconds * timeline.fps)), hasAudio: kind !== 'image',
            width: Math.max(0, Math.round(asset.width || 0)), height: Math.max(0, Math.round(asset.height || 0)),
        };
        addMediaToTimeline(media, timelineOf(currentDocument()?.timeline));
    };
    const choosePhotos = async () => {
        setProblem(null);
        try {
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: false, quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
            if (!result.canceled && result.assets[0]) await importPicked(result.assets[0]);
        } catch { setProblem(t('editor.couldnotopenPhotosCheckVeyrnoxaccess')); }
    };
    const chooseFiles = async () => {
        setProblem(null);
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['video/*', 'audio/*', 'image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true });
            if (!result.canceled && result.assets[0]) await importPicked(result.assets[0]);
        } catch { setProblem(t('editor.couldnotopenFilesTryagain')); }
    };
    const openWorkflow = async (path: string) => {
        const saved = await save();
        if (saved) router.push(path as never);
    };

    const openExport = async () => { if (!EDITOR_SERVER_EXPORT_ENABLED) { await openWorkflow('/publish/compose'); return; } try { requireOnline(); } catch { setProblem(OFFLINE_PAID_MESSAGE); return; } if (exportUnavailable()) { await openWorkflow('/publish/compose'); return; } if (await savedDocument()) setExportVisible(true); };

    return <View style={styles.screen}>
        {EDITOR_SERVER_EXPORT_ENABLED ? <ServerExportSheet api={api} router={router} now={Date.now} projectId={projectId} name={name} document={document} dirty={dirty} visible={exportVisible} onOpen={() => setExportVisible(true)} onClose={() => setExportVisible(false)} onFallback={() => void openWorkflow('/publish/compose')} /> : null}
        <Stack.Screen options={{ title: t('editor.cut'), headerRight: () => <HeaderAction label={t('editor.done')} onPress={done} /> }} />
        <View style={styles.projectBar}>
            <View style={styles.cutBadge}><Text style={styles.cutMark}>{t('editor.v')}</Text><Text style={styles.cutLabel}>{t('editor.cUT')}</Text></View>
            <View style={styles.titleGroup}>
                <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{name}</Text>
                <Text accessibilityLiveRegion="polite" style={styles.status}>{saving ? t('editor.saving') : dirty ? t('editor.unsavedchanges') : t('editor.v2', { value1: t('editor.saved'), value2: revision })}</Text>
            </View>
            <View style={styles.formatBadge}><Text style={styles.formatText}>{canvas.aspect_ratio}</Text><Text style={styles.formatMeta}>{t('editor.fPS', { value1: canvas.frame_rate })}</Text></View>
        </View>
        {problem ? <Text accessibilityRole="alert" style={styles.problem}>{problem}</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.commandStrip} contentContainerStyle={styles.commandContent}>
            <Command icon="↶" label={t('editor.undo')} disabled={!history.canUndo} onPress={() => travel('undo')} />
            <Command icon="↷" label={t('editor.redo')} disabled={!history.canRedo} onPress={() => travel('redo')} />
            <View style={styles.commandDivider} />
            <Command icon="◉" label={t('editor.selectmultiple')} selected={multiSelect} onPress={toggleMultiSelect} />
            <Command icon="⧉" label={t('editor.duplicate')} disabled={!selection} onPress={duplicateSelection} />
            <Command icon="✂" label={t('editor.split')} disabled={!selection} onPress={splitSelection} />
            <Command icon="□" label={t('editor.copy')} disabled={!selection} onPress={() => setClipboard(copySelections(timeline, selections.length ? selections : selection ? [selection] : []))} />
            <Command icon="▣" label={t('editor.pasteatplayhead')} disabled={!clipboard} onPress={paste} />
            <Command icon="⌫" label={t('editor.delete')} danger disabled={!selection} onPress={removeSelection} />
            <Command icon="⌘" label={t('editor.group')} disabled={selections.length < 2} onPress={() => setGrouped(true)} />
            <Command icon="⌁" label={t('editor.ungroup')} disabled={!selectedGroup} onPress={() => setGrouped(false)} />
            <View style={styles.commandDivider} />
            <Command icon="▣+" label={t('editor.addvideotrack')} onPress={() => addTimelineTrack('video')} />
            <Command icon="♫+" label={t('editor.addaudiotrack')} onPress={() => addTimelineTrack('audio')} />
            <Command icon="T+" label={t('editor.addtexttrack')} onPress={() => addTimelineTrack('text')} />
            <Command icon="◆" label={t('editor.addmarker')} onPress={addTimelineMarker} />
            <Command icon="＋" label={t('editor.addtext')} onPress={addText} />
            <View style={styles.commandDivider} />
            <Command icon="⇩" label={t('editor.export')} onPress={() => void openExport()} />
            <Command icon="◈" label={t('editor.credits')} onPress={() => void openWorkflow('/credits')} />
        </ScrollView>

        <View style={styles.optionStrip}>
            <Choice label={t('editor.snap')} selected={snap} onPress={() => setSnap((value) => !value)} compact />
            <Text style={styles.optionLabel}>{t('editor.ripple')}</Text>
            {(['none', 'lane', 'all'] as const).map((value) => <Choice key={value} label={value === 'none' ? t('editor.off') : value === 'lane' ? t('editor.selectedtrack') : t('editor.alltracks')} selected={ripple === value} onPress={() => setRipple(value)} compact />)}
            <View style={styles.optionSpacer} />
            <Text style={styles.optionLabel}>{t('editor.zoom')}</Text>
            <Action label={t('editorCore.zoomOut')} disabled={zoom <= PPF_MIN} onPress={() => setZoom(value => Math.max(PPF_MIN, value / 2))} compact />
            <Text style={styles.zoomValue}>{t('editorCore.zoomValue', { value1: zoom.toFixed(2) })}</Text>
            <Action label={t('editorCore.zoomIn')} disabled={zoom >= PPF_MAX} onPress={() => setZoom(value => Math.min(PPF_MAX, value * 2))} compact />
            <Action label={t('editorCore.fit')} onPress={() => setZoom(fitPpf(viewport, total))} compact />
        </View>

        <View style={styles.previewArea}>
            <View style={styles.previewHeading}>
                <Text style={styles.eyebrow}>{t('editor.pREVIEW')}</Text>
                <Text style={styles.previewMeta}>{clipCount ? t('editor.layers', { value1: clipCount }) : t('editor.emptysequence')}</Text>
            </View>
            <View style={styles.previewFrame}>
                <View style={[styles.canvas, { aspectRatio: canvas.aspect_ratio === '9:16' ? 9 / 16 : canvas.aspect_ratio === '1:1' ? 1 : 16 / 9 }]}>
                    {activePreview ? <EditorMediaPreview api={api} clip={activePreview.clip} media={activePreview.media} frame={frame} fps={timeline.fps} playing={playing} localUri={localMediaUris[activePreview.media.id]} /> : null}
                    <View style={styles.safeFrame} />
                    {!activePreview ? <><Text style={styles.previewMark}>{t('editor.v')}</Text><Text style={styles.previewLabel}>{timeline.video.length ? t('editor.movetheplayheadontoavisualclip') : t('editor.previewEmpty')}</Text></> : null}
                    {previewText ? <Text style={styles.previewCaption}>{previewText}</Text> : null}
                </View>
            </View>
            <EditorTransport frame={frame} total={total} fps={timeline.fps} playing={playing} onSeek={setFrame} onPlaying={setPlaying} />
        </View>

        <View style={styles.timelineSection}>
            <View style={styles.timelineHeading}>
                <Text style={styles.eyebrow}>{t('editor.tIMELINE')}</Text>
                <Text style={styles.timelineHelp}>{multiSelect ? t('editor.selectedtapclipstoadd', { value1: selections.length }) : selection ? t('editor.tapacommandtoeditselection') : t('editor.tapacliptoselect')}</Text>
            </View>
            <EditorTimeline timeline={timeline} selections={selections} ppf={zoom} total={total} frame={frame} playing={playing} snap={snap} onViewport={setViewport} onSeek={value => { setPlaying(false); setFrame(value); }} onSelect={selectClip} onApply={applyTimeline} />
        </View>

        <ScrollView testID="editor-tool-rail" horizontal showsHorizontalScrollIndicator={false} style={styles.toolRail} contentContainerStyle={styles.toolContent}>
            {tools.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: tool === item.id }} onPress={() => setTool(item.id)} style={({ pressed }) => [styles.tool, tool === item.id && styles.toolActive, pressed && styles.pressed]}>
                {item.id === 'markers' ? <View style={{ width: 12, height: 12, backgroundColor: colors.accent, transform: [{ rotate: '45deg' }] }} /> : <Text style={[styles.toolIcon, tool === item.id && styles.toolIconActive]}>{item.icon}</Text>}
                <Text style={[styles.toolLabel, tool === item.id && styles.toolLabelActive]}>{item.label}</Text>
            </Pressable>)}
        </ScrollView>

        <ScrollView style={styles.inspector} contentContainerStyle={styles.inspectorContent} keyboardShouldPersistTaps="handled">
            {tool === 'media' ? <>
                <PanelHeading title={t('editor.projectmedia')} detail={plural('editor.itemsCount', availableMedia.length)} />
                {availableMedia.length ? availableMedia.map((item) => <ProjectMediaRow key={item.id} item={item} fps={timeline.fps} onAdd={addMediaToTimeline} />) : <EmptyPanel title={t('editor.nomediayet')} body={t('editor.chooseanexistingVeyrnoxcreationaproject')} />}
                <View style={styles.quickActions}><Action label={t('editor.libraryvideo')} disabled={libraryPending} onPress={() => setLibraryKind('video')} /><Action label={t('editor.libraryimage')} disabled={libraryPending} onPress={() => setLibraryKind('image')} /><Action label={t('editor.libraryaudio')} disabled={libraryPending} onPress={() => setLibraryKind('audio')} /><Action label={t('editor.photosvideos')} onPress={() => void choosePhotos()} /><Action label={t('editor.files')} onPress={() => void chooseFiles()} /></View>
            </> : null}
            {tool === 'audio' ? <>
                <PanelHeading title={t('editor.audio')} detail={plural('editor.clips2Count', timeline.audio.length)} />
                {timeline.audio.length ? timeline.audio.map((item) => <InspectorClip key={item.id} track="audio" item={item} timeline={timeline} selected={selections.some((value) => value.track === 'audio' && value.id === item.id)} onPress={() => selectClip({ track: 'audio', id: item.id })} />) : <EmptyPanel title={t('editor.noaudioclips')} body={t('editor.audiolayersfromyourprojectappearhere')} />}
                <View style={styles.quickActions}><Action label={t('editor.generatevoiceormusic')} onPress={() => void openWorkflow('/create')} /><Action label={t('editor.addaudiotrack')} onPress={() => addTimelineTrack('audio')} /></View>
            </> : null}
            {tool === 'generate' ? <WorkflowPanel title={t('editor.generate')} body={t('editor.createvideoimagesmusicorspeechwith')} action={t('editor.openGenerate')} onPress={() => void openWorkflow('/create')} /> : null}

            {tool === 'text' ? <>
                <PanelHeading title={t('editor.text2')} detail={selection?.track === 'text' ? t('editor.layerselected') : t('editor.layers', { value1: timeline.text.length })} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('editor.addText')} style={({ pressed }) => [styles.primary, touchTarget, pressed && styles.pressed]} onPress={addText}><Text style={styles.primaryText}>＋ {t('editor.addText')}</Text></Pressable>
                {selection?.track === 'text' && selected && 'text' in selected ? <>
                    <LabeledInput label={t('editor.words')} value={selected.text} onChangeText={updateSelectedText} />
                    <Stepper label={t('editor.textsize')} value={selected.size} min={2} max={40} step={1} onChange={(size) => patchSelected({ size })} />
                    <Stepper label={t('editor.horizontalposition')} value={selected.x * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ x: value / 100 })} />
                    <Stepper label={t('editor.verticalposition')} value={selected.y * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ y: value / 100 })} />
                    <Text style={styles.fieldLabel}>{t('editor.weight')}</Text><View style={styles.choices}>{['normal', 'bold'].map((value) => <Choice key={value} label={value} selected={(selected.style?.weight ?? 'bold') === value} onPress={() => patchSelected({ style: { ...selected.style, weight: value } })} />)}</View>
                    <Text style={styles.fieldLabel}>{t('editor.alignment')}</Text><View style={styles.choices}>{['left', 'center', 'right'].map((value) => <Choice key={value} label={value} selected={(selected.style?.align ?? 'center') === value} onPress={() => patchSelected({ style: { ...selected.style, align: value } })} />)}</View>
                </> : <Text style={styles.body}>{t('editor.selectatextlayeronthetimeline')}</Text>}
            </> : null}
            {tool === 'captions' ? <>
                <PanelHeading title={t('editor.captions')} detail={timeline.text.length ? t('editor.textcues', { value1: timeline.text.length }) : t('editor.nocues')} />
                <Action label={t('editor.addcaptionatplayhead')} onPress={addText} />
                {timeline.text.map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps} selected={selection?.track === 'text' && selection.id === item.id} onPress={() => { selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />)}
            </> : null}
            {tool === 'transcript' ? <>
                <PanelHeading title={t('editor.transcript')} detail={t('editor.cues', { value1: timeline.text.length })} />
                {timeline.text.length ? [...timeline.text].sort((a, b) => a.start - b.start).map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps} selected={selection?.track === 'text' && selection.id === item.id} onPress={() => { selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />) : <EmptyPanel title={t('editor.notranscriptyet')} body={t('editor.captionandtextcuesbecomeatime')} />}
            </> : null}

            {tool === 'effects' ? <>
                <PanelHeading title={t('editor.effects')} detail={selection ? t('editor.selectedlayer') : t('editor.selectaclip')} />
                {selection && selected && selection.track !== 'text' ? <><View style={styles.choices}>{[{ id: 'none', label: t('editor.none') }, { id: 'soft-glow', label: t('editor.softglow') }, { id: 'grain', label: t('editor.filmgrain') }, { id: 'vignette', label: t('editor.vignette') }, { id: 'old-film', label: t('editor.oldfilm') }].map(({ id, label }) => <Choice key={id} label={label} selected={(selected as Clip).effect?.type === id || (id === 'none' && !(selected as Clip).effect)} onPress={() => patchSelected({ effect: id === 'none' ? undefined : { type: id, intensity: .5 } })} />)}</View>{(selected as Clip).effect ? <Stepper label={t('editor.effectintensity')} value={(selected as Clip).effect!.intensity * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ effect: { ...(selected as Clip).effect!, intensity: value / 100 } })} /> : null}</> : <EmptyPanel title={t('editor.choosevideooraudio')} body={t('editor.effectsarestoredontheselectedlayer')} />}
            </> : null}
            {tool === 'transitions' ? <>
                <PanelHeading title={t('editor.transitions')} detail={selection?.track === 'video' ? t('editor.videoclipselected') : t('editor.selectavideoclip')} />
                {selection?.track === 'video' && selected ? <><View style={styles.choices}>{[{ id: 'dissolve', label: t('editor.dissolve') }, { id: 'dip-black', label: t('editor.diptoblack') }, { id: 'wipe-left', label: t('editor.wipeleft') }, { id: 'slide-left', label: t('editor.slideleft') }].map(({ id, label }) => <Choice key={id} label={label} selected={((selected as Clip).transitionType ?? 'dissolve') === id} onPress={() => patchSelected({ transitionType: id })} />)}</View><Stepper label={t('editor.duration2')} value={(selected as Clip).transition ?? 0} min={0} max={60} step={5} suffix={t('editor.frames')} onChange={(transition) => patchSelected({ transition })} /></> : <EmptyPanel title={t('editor.chooseavideoclip')} body={t('editor.transitionsjoinadjacentclipsonthesame')} />}
            </> : null}
            {tool === 'filters' ? <>
                <PanelHeading title={t('editor.filters')} detail={selection?.track === 'video' ? t('editor.colourcontrols') : t('editor.selectavideoclip')} />
                {selection?.track === 'video' && selected ? <>{(['brightness', 'contrast', 'saturate'] as const).map((key) => <Stepper key={key} label={key} value={filterOf(selected as Clip)[key]} min={0} max={3} step={0.1} onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), [key]: value } })} />)}<Stepper label={t('editor.hue')} value={filterOf(selected as Clip).hue} min={-180} max={180} step={10} suffix="°" onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), hue: value } })} /><Stepper label={t('editor.blur')} value={filterOf(selected as Clip).blur} min={0} max={30} step={1} onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), blur: value } })} /></> : <EmptyPanel title={t('editor.chooseavideoclip')} body={t('editor.brightnesscontrastsaturationhueandblurmatch')} />}
            </> : null}
            {tool === 'animation' ? <>
                <PanelHeading title={t('editor.animation')} detail={selection ? t('editor.layermotion') : t('editor.selectalayer')} />
                {selection && selected ? <><Text style={styles.fieldLabel}>{t('editor.animatein')}</Text><View style={styles.choices}>{['none', 'fade', 'slide-left', 'zoom'].map((value) => <Choice key={value} label={value} selected={(selected.animation?.in ?? 'none') === value} onPress={() => patchSelected({ animation: { in: value, out: selected.animation?.out ?? 'none', duration: selected.animation?.duration ?? 15 } })} />)}</View><Text style={styles.fieldLabel}>{t('editor.animateout')}</Text><View style={styles.choices}>{['none', 'fade', 'slide-right', 'zoom'].map((value) => <Choice key={value} label={value} selected={(selected.animation?.out ?? 'none') === value} onPress={() => patchSelected({ animation: { in: selected.animation?.in ?? 'none', out: value, duration: selected.animation?.duration ?? 15 } })} />)}</View><Stepper label={t('editor.animationduration')} value={selected.animation?.duration ?? 15} min={1} max={90} step={1} suffix={t('editor.frames')} onChange={(duration) => patchSelected({ animation: { in: selected.animation?.in ?? 'none', out: selected.animation?.out ?? 'none', duration } })} /></> : <EmptyPanel title={t('editor.selectalayer')} body={t('editor.animationcontrolsworkonvideoaudioand')} />}
            </> : null}

            {tool === 'brand' ? <WorkflowPanel title={t('editor.brandkit')} body={t('editor.managelogosfontscoloursandapprovedassets')} action={t('editor.openBrandkit')} onPress={() => void openWorkflow('/brand-kit')} /> : null}
            {tool === 'markers' ? <>
                <PanelHeading title={t('editorCore.markersTool')} detail={t('editor.markers', { value1: timeline.markers.length })} />
                <Action label={t('editor.addmarker')} onPress={addTimelineMarker} />
                {timeline.markers.map(marker => <View key={marker.id} style={styles.markerRow}><Pressable accessibilityRole="button" accessibilityLabel={t('editor.goto', { value1: marker.label })} onPress={() => { setPlaying(false); setFrame(marker.frame); }} style={styles.markerJump}><Text style={styles.markerTime}>{timecode(marker.frame, timeline.fps)}</Text></Pressable><TextInput key={`${marker.id}-${marker.label}`} accessibilityLabel={t('editor.rename', { value1: marker.label })} defaultValue={marker.label} maxLength={80} style={[styles.input, styles.markerInput]} onEndEditing={event => { const label = event.nativeEvent.text; const current = timelineOf(currentDocument()?.timeline); if (label !== marker.label) applyTimeline({ ...current, markers: current.markers.map(item => item.id === marker.id ? { ...item, label } : item) }); }} /><Action label={t('editor.remove')} danger compact onPress={() => applyTimeline({ ...timeline, markers: timeline.markers.filter(item => item.id !== marker.id) })} /></View>)}
            </> : null}
            {tool === 'adjust' ? <>
                <PanelHeading title={selection ? selectedMedia?.name || t('editor.layer', { value1: selection.track[0].toUpperCase(), value2: selection.track.slice(1) }) : t('editor.projectSettings')} detail={selection ? seconds(selected?.len, timeline.fps) : t('editor.sequence')} />
                {selection ? <View style={styles.quickActions}><Action label={t('editor.moveLeft')} disabled={selectedIndex <= 0} onPress={() => moveSelection(-1)} /><Action label={t('editor.moveRight')} disabled={selectedIndex >= timeline[selection.track].length - 1} onPress={() => moveSelection(1)} /><Action label={t('editor.remove')} danger onPress={removeSelection} /></View> : null}
                {selection && selected ? <>
                    <Text style={styles.fieldLabel}>{t('editor.track')}</Text><View style={styles.choices}>{timeline.tracks.filter((track) => track.kind === selection.track).map((track) => <Choice key={track.id} label={track.name} selected={selected.trackId === track.id} onPress={() => patchSelected({ trackId: track.id })} />)}</View>
                    <Stepper label={t('editorCore.startSeconds', { value1: t('editorCore.seconds', { value1: (selected.start / timeline.fps).toFixed(1) }) })} value={selected.start} min={selectedTrack?.locked ? selected.start : 0} max={selectedTrack?.locked ? selected.start : (SEQUENCE_MAX - selected.len)} step={timeline.fps} suffix={t('editor.frames')} onChange={value => adjustStart(value - selected.start)} />
                    <View style={styles.quickActions}><Action label={t('editorCore.startEarlierFrame')} disabled={!!selectedTrack?.locked} onPress={() => adjustStart(-1)} /><Action label={t('editorCore.startLaterFrame')} disabled={!!selectedTrack?.locked} onPress={() => adjustStart(1)} /></View>
                    <Stepper label={t('editorCore.durationSeconds', { value1: t('editorCore.seconds', { value1: (selected.len / timeline.fps).toFixed(1) }) })} value={selected.len} min={!canTrim(selected) || selectedTrack?.locked ? selected.len : 1} max={!canTrim(selected) || selectedTrack?.locked ? selected.len : (SEQUENCE_MAX - selected.start)} step={timeline.fps} suffix={t('editor.frames')} onChange={value => adjustLength(value - selected.len)} />
                    <View style={styles.quickActions}><Action label={t('editorCore.shortenFrame')} disabled={!canTrim(selected) || !!selectedTrack?.locked} onPress={() => adjustLength(-1)} /><Action label={t('editorCore.lengthenFrame')} disabled={!canTrim(selected) || !!selectedTrack?.locked} onPress={() => adjustLength(1)} /></View>
                    {!canTrim(selected) ? <Text style={styles.body}>{t('editorCore.trimOnWeb')}</Text> : null}
                    {selection.track !== 'text' ? <><Stepper label={t('editor.speed')} value={(selected as Clip).rate ?? 1} min={0.1} max={8} step={0.1} suffix="×" onChange={changeSpeed} /><Choice label={t('editor.reverse')} selected={!!(selected as Clip).reverse} onPress={toggleReverse} /><Stepper label={t('editor.volume')} value={((selected as Clip).volume ?? 1) * 100} min={0} max={200} step={5} suffix="%" onChange={(volume) => patchSelected({ volume: volume / 100 })} /><Stepper label={t('editor.fadein')} value={(selected as Clip).fadeIn ?? 0} min={0} max={selected.len} step={1} suffix={t('editor.frames')} onChange={(fadeIn) => patchSelected({ fadeIn })} /><Stepper label={t('editor.fadeout')} value={(selected as Clip).fadeOut ?? 0} min={0} max={selected.len} step={1} suffix={t('editor.frames')} onChange={(fadeOut) => patchSelected({ fadeOut })} /><Stepper label={t('editor.pan')} value={(selected as Clip).pan ?? 0} min={-1} max={1} step={0.1} onChange={(pan) => patchSelected({ pan })} /></> : null}
                    {selection.track === 'video' ? <><Stepper label={t('editor.scale')} value={transformOf(selected as Clip).scale * 100} min={5} max={800} step={5} suffix="%" onChange={(value) => patchSelected({ transform: { ...transformOf(selected as Clip), scale: value / 100 } })} /><Stepper label={t('editor.rotation')} value={transformOf(selected as Clip).rotation} min={-360} max={360} step={5} suffix="°" onChange={(rotation) => patchSelected({ transform: { ...transformOf(selected as Clip), rotation } })} /><Stepper label={t('editor.opacity')} value={transformOf(selected as Clip).opacity * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ transform: { ...transformOf(selected as Clip), opacity: value / 100 } })} /><View style={styles.choices}><Choice label={t('editor.contain')} selected={((selected as Clip).fit ?? 'contain') === 'contain'} onPress={() => patchSelected({ fit: 'contain' })} /><Choice label={t('editor.cover')} selected={(selected as Clip).fit === 'cover'} onPress={() => patchSelected({ fit: 'cover' })} /></View></> : null}
                </> : null}
                <LabeledInput label={t('editor.brief')} value={document.brief || ''} multiline onChangeText={(brief) => markDocument({ ...document, brief: brief.slice(0, 6000) })} />
                <Text style={styles.fieldLabel}>{t('editor.shape')}</Text><View style={styles.choices}>{(['16:9', '9:16', '1:1'] as const).map((value) => <Choice key={value} label={value} selected={canvas.aspect_ratio === value} onPress={() => updateCanvas({ aspect_ratio: value })} />)}</View>
                <Text style={styles.fieldLabel}>{t('editor.rate')}</Text><View style={styles.choices}>{([24, 25, 30, 60] as const).map((value) => <Choice key={value} label={`${value}`} selected={canvas.frame_rate === value} onPress={() => updateCanvas({ frame_rate: value })} />)}</View>
                <Text style={styles.fieldLabel}>{t('editor.canvascolour')}</Text><View style={styles.choices}>{['#000000', '#ffffff', '#15211f', '#301c36', '#17233f'].map((value) => <Choice key={value} label={value} selected={timeline.background === value} onPress={() => applyTimeline({ ...timeline, background: value })} />)}</View>
                <PanelHeading title={t('editor.tracks')} detail={t('editor.total', { value1: timeline.tracks.length })} />
                {timeline.tracks.map((track) => <View key={track.id} style={styles.trackControl}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{track.name}</Text><Text style={styles.muted}>{track.kind}</Text></View><Choice label={t('editor.lock')} selected={track.locked} onPress={() => updateTrack(track, { locked: !track.locked })} compact /><Choice label={t('editor.mute')} selected={track.muted} onPress={() => updateTrack(track, { muted: !track.muted })} compact /><Choice label={t('editor.hide')} selected={track.hidden} onPress={() => updateTrack(track, { hidden: !track.hidden })} compact /></View>)}
            </> : null}
        </ScrollView>
        {libraryKind ? <LibraryChooser api={api} kind={libraryKind} onClose={() => setLibraryKind(null)} onPick={(choice) => importLibrary(choice, libraryKind)} /> : null}
        <Modal visible={privacyNotice} transparent animationType="fade" onRequestClose={acknowledgePrivacy} accessibilityViewIsModal><View style={styles.noticeBackdrop}><View style={styles.noticeCard}><Text accessibilityRole="header" style={styles.noticeTitle}>{t('editor.privacyTitle')}</Text><Text style={styles.body}>{t('editor.privacySummary')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('editor.privacyConfirm')} style={[styles.primary, touchTarget]} onPress={acknowledgePrivacy}><Text style={styles.primaryText}>{t('editor.privacyConfirm')}</Text></Pressable></View></View></Modal>
    </View>;
}

function ProjectMediaRow({ item, fps, onAdd }: { item: Media; fps: number; onAdd(item: Media): void }) {
    const name = item.name || t('editor.untitledMedia');
    const label = t('editor.addtotimeline', { value1: name });
    const source = item.assetSource ? t('editor.project') : item.id.startsWith('j-') ? t('editor.library') : item.id.startsWith('l-') ? t('editor.thisdevice') : t('editor.project');
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onAdd(item)} style={({ pressed }) => [styles.mediaRow, pressed && styles.pressed]}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>{item.kind === 'audio' ? '♫' : item.kind === 'image' ? '▧' : '▶'}</Text></View><View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{name}</Text><Text style={styles.muted}>{source} · {item.kind || t('editor.media')} · {seconds(item.frames, fps)}</Text></View><View style={[styles.action, styles.compactControl]}><Text style={styles.actionText}>{t('editor.add')}</Text></View></Pressable>;
}
function InspectorClip({ track, item, timeline, selected, onPress }: { track: TrackKind; item: Clip; timeline: Timeline; selected: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={timeline.media[item.mediaId || '']?.name || item.id} accessibilityState={{ selected }} onPress={onPress} style={[styles.mediaRow, selected && styles.mediaRowSelected]}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>♫</Text></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{timeline.media[item.mediaId || '']?.name || t('editor.clip', { value1: track })}</Text><Text style={styles.muted}>{seconds(item.len, timeline.fps)}</Text></View></Pressable>;
}

function TranscriptRow({ item, fps, selected, onPress }: { item: TextClip; fps: number; selected: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`${timecode(item.start, fps)} ${item.text}`} accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.transcriptRow, selected && styles.mediaRowSelected, pressed && styles.pressed]}><Text style={styles.transcriptTime}>{timecode(item.start, fps)}</Text><Text style={styles.transcriptText} numberOfLines={2}>{item.text}</Text></Pressable>;
}
