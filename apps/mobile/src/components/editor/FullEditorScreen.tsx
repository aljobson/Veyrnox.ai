import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { touchTarget } from '../../lib/a11y';
import { ApiError } from '../../lib/api';
import { documentIdentity, type ProjectDocument } from '../../lib/editorBridge';
import { getDocument, putDocument } from '../../lib/editorProjects';
import { t } from '../../lib/i18n';
import {
    addMarker, addTrack, canvasOf, clipAt, copySelections, duplicateSelections, emptyTimeline, framesIn, groupSelections,
    pasteClipboard, removeSelections, selectionItems, splitClip, timelineOf, updateClip,
    type Canvas, type Clip, type Clipboard, type EditorTrack, type Media, type Selection, type TextClip, type Timeline, type TrackKind,
} from '../../lib/nativeEditorModel';
import { fetchProject } from '../../lib/projects';
import { colors, fonts } from '../../theme';
import { HeaderAction } from '../HeaderAction';

type Tool = 'media' | 'audio' | 'generate' | 'templates' | 'elements' | 'text' | 'captions' | 'transcript' | 'scenes' | 'clips' | 'assistant' | 'effects' | 'transitions' | 'filters' | 'animation' | 'plugins' | 'brand' | 'review' | 'adjust';
type Ripple = 'none' | 'lane' | 'all';

const tools: readonly { id: Tool; icon: string; label: string }[] = [
    { id: 'media', icon: '▣', label: 'Media' },
    { id: 'audio', icon: '♫', label: 'Audio' },
    { id: 'generate', icon: '✦', label: 'Generate' },
    { id: 'templates', icon: '▦', label: 'Templates' },
    { id: 'elements', icon: '◇', label: 'Elements' },
    { id: 'text', icon: 'T', label: 'Text' },
    { id: 'captions', icon: 'CC', label: 'Captions' },
    { id: 'transcript', icon: '≡', label: 'Transcript' },
    { id: 'scenes', icon: '▥', label: 'Scenes' },
    { id: 'clips', icon: '▶', label: 'Clips' },
    { id: 'assistant', icon: '✧', label: 'Assistant' },
    { id: 'effects', icon: '✺', label: 'Effects' },
    { id: 'transitions', icon: '⇄', label: 'Transitions' },
    { id: 'filters', icon: '☼', label: 'Filters' },
    { id: 'animation', icon: '↝', label: 'Animation' },
    { id: 'plugins', icon: '⌘', label: 'Plugins' },
    { id: 'brand', icon: '◆', label: 'Brand kit' },
    { id: 'review', icon: '◉', label: 'Review' },
    { id: 'adjust', icon: '☷', label: 'Adjust' },
];
const seconds = (frames = 0, fps = 30) => `${Math.max(0, frames / fps).toFixed(1)}s`;
const timecode = (frames = 0, fps = 30) => {
    const whole = Math.max(0, Math.floor(frames / fps));
    return `00:${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}:${String(Math.max(0, frames % fps)).padStart(2, '0')}`;
};

export function FullEditorScreen({ projectId }: { projectId: string }) {
    const { api } = useAuth();
    const router = useRouter();
    const mounted = useRef(true);
    const documentRef = useRef<ProjectDocument | null>(null);
    const revisionRef = useRef(0);
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);
    const queuedRef = useRef(false);
    const pastRef = useRef<ProjectDocument[]>([]);
    const futureRef = useRef<ProjectDocument[]>([]);
    const [name, setName] = useState(t('editor.title'));
    const [document, setDocument] = useState<ProjectDocument | null>(null);
    const [revision, setRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [tool, setTool] = useState<Tool>('media');
    const [selection, setSelection] = useState<Selection | null>(null);
    const [selections, setSelections] = useState<Selection[]>([]);
    const [multiSelect, setMultiSelect] = useState(false);
    const [clipboard, setClipboard] = useState<Clipboard>(null);
    const [snap, setSnap] = useState(true);
    const [ripple, setRipple] = useState<Ripple>('none');
    const [zoom, setZoom] = useState(1);
    const [privacyNotice, setPrivacyNotice] = useState(false);
    const [history, setHistory] = useState({ canUndo: false, canRedo: false });
    const [frame, setFrame] = useState(0);
    const [playing, setPlaying] = useState(false);

    const playbackTimeline = timelineOf(document?.timeline);
    const playbackTotal = framesIn(playbackTimeline);

    const markDocument = useCallback((next: ProjectDocument, record = true) => {
        if (record && documentRef.current) {
            pastRef.current.push(documentRef.current);
            if (pastRef.current.length > 30) pastRef.current.shift();
            futureRef.current = [];
            setHistory({ canUndo: true, canRedo: false });
        }
        documentRef.current = next;
        dirtyRef.current = true;
        setDocument(next);
        setDirty(true);
        setProblem(null);
    }, []);

    const save = useCallback(async (): Promise<boolean> => {
        if (!dirtyRef.current || !documentRef.current) return true;
        if (savingRef.current) { queuedRef.current = true; return false; }
        savingRef.current = true;
        if (mounted.current) setSaving(true);
        try {
            do {
                queuedRef.current = false;
                const snapshot = documentRef.current;
                if (!snapshot) break;
                const result = await putDocument(api, projectId, revisionRef.current, snapshot, randomUUID());
                revisionRef.current = result.revision;
                if (mounted.current) setRevision(result.revision);
                if (documentIdentity(documentRef.current) === documentIdentity(snapshot)) {
                    dirtyRef.current = false;
                    if (mounted.current) setDirty(false);
                }
            } while (queuedRef.current || dirtyRef.current);
            return true;
        } catch (error) {
            if (mounted.current) {
                const status = (error as ApiError).status;
                setProblem(status === 409 ? t('editor.conflict') : status === 0 ? t('editor.offline') : t('editor.retry'));
            }
            return false;
        } finally {
            savingRef.current = false;
            if (mounted.current) setSaving(false);
        }
    }, [api, projectId]);

    useEffect(() => {
        mounted.current = true;
        void Promise.all([fetchProject(api, projectId), getDocument(api, projectId)])
            .then(([project, head]) => {
                if (!mounted.current) return;
                if (project) setName(project.name);
                documentRef.current = head.document;
                revisionRef.current = head.revision;
                pastRef.current = [];
                futureRef.current = [];
                setSelection(null);
                setSelections([]);
                setClipboard(null);
                setHistory({ canUndo: false, canRedo: false });
                setDocument(head.document);
                setRevision(head.revision);
            })
            .catch(() => { if (mounted.current) setProblem(t('editor.fullFailed')); });
        SecureStore.getItemAsync('veyrnox.editorPrivacyNotice.v1')
            .then((value) => { if (mounted.current && value !== 'seen') setPrivacyNotice(true); })
            .catch(() => { if (mounted.current) setPrivacyNotice(true); });
        return () => { mounted.current = false; };
    }, [api, projectId]);

    useEffect(() => {
        if (!dirty) return;
        const timer = setTimeout(() => { void save(); }, 900);
        return () => clearTimeout(timer);
    }, [dirty, document, save]);

    useEffect(() => {
        if (!playing || playbackTotal <= 0) return;
        const timer = setInterval(() => {
            setFrame((current) => {
                if (current >= playbackTotal - 1) {
                    setPlaying(false);
                    return 0;
                }
                return current + 1;
            });
        }, Math.max(16, Math.round(1000 / playbackTimeline.fps)));
        return () => clearInterval(timer);
    }, [playing, playbackTimeline.fps, playbackTotal]);

    const done = useCallback(async () => {
        const saved = await save();
        if (saved && !dirtyRef.current) router.back();
    }, [router, save]);
    const acknowledgePrivacy = useCallback(() => {
        setPrivacyNotice(false);
        SecureStore.setItemAsync('veyrnox.editorPrivacyNotice.v1', 'seen').catch(() => {});
    }, []);
    const travel = useCallback((direction: 'undo' | 'redo') => {
        const source = direction === 'undo' ? pastRef.current : futureRef.current;
        const destination = direction === 'undo' ? futureRef.current : pastRef.current;
        const next = source.pop();
        if (!next || !documentRef.current) return;
        destination.push(documentRef.current);
        markDocument(next, false);
        setSelection(null);
        setSelections([]);
        setHistory({ canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0 });
    }, [markDocument]);

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

    const applyTimeline = (next: Timeline) => markDocument({ ...document, schema_version: 3, timeline: next });
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
        const item: TextClip = { id: `t${seq}`, text: 'Your title', start: Math.min(frame, Math.max(0, total)), len: 90, x: 0.5, y: 0.85, size: 6, trackId, style: { font: 'sans-serif', weight: 'bold', align: 'center', color: '#ffffff', stroke: '#000000', strokeWidth: 0, background: '#000000', backgroundOpacity: 0 } };
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
    const changeSpeed = (rate: number) => {
        if (!selection || selection.track === 'text' || !selected) return;
        const clip = selected as Clip;
        const sourceSpan = clip.len * (clip.rate ?? 1);
        patchSelected({ rate, len: Math.max(1, Math.floor(sourceSpan / rate)) });
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
        if (!next) { setProblem('Move the playhead inside the selected clip to split it.'); return; }
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
    const addMediaToTimeline = (media: Media) => {
        const kind: TrackKind = media.kind === 'audio' ? 'audio' : 'video';
        const trackId = timeline.tracks.find((track) => track.kind === kind && !track.locked)?.id;
        if (!trackId) { setProblem(`Unlock or add a ${kind} track first.`); return; }
        const seq = timeline.seq + 1;
        const item: Clip = { id: `${kind[0]}${seq}`, mediaId: media.id, start: snap ? Math.round(frame) : frame, in: 0, len: Math.max(1, Math.min(media.frames || 90, 18_000 - frame)), trackId, volume: 1, transition: 0, rate: 1 };
        applyTimeline({ ...timeline, seq, [kind]: [...timeline[kind], item] } as Timeline);
        const nextSelection = { track: kind, id: item.id };
        setSelection(nextSelection);
        setSelections([nextSelection]);
    };
    const openWorkflow = async (path: string) => {
        const saved = await save();
        if (saved) router.push(path as never);
    };

    return <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Cut', headerRight: () => <HeaderAction label={t('editor.done')} onPress={done} /> }} />
        <View style={styles.projectBar}>
            <View style={styles.cutBadge}><Text style={styles.cutMark}>V</Text><Text style={styles.cutLabel}>CUT</Text></View>
            <View style={styles.titleGroup}>
                <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{name}</Text>
                <Text accessibilityLiveRegion="polite" style={styles.status}>{saving ? t('editor.saving') : dirty ? 'Unsaved changes' : `${t('editor.saved')} · v${revision}`}</Text>
            </View>
            <View style={styles.formatBadge}><Text style={styles.formatText}>{canvas.aspect_ratio}</Text><Text style={styles.formatMeta}>{canvas.frame_rate} FPS</Text></View>
        </View>
        {problem ? <Text accessibilityRole="alert" style={styles.problem}>{problem}</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.commandStrip} contentContainerStyle={styles.commandContent}>
            <Command icon="↶" label="Undo" disabled={!history.canUndo} onPress={() => travel('undo')} />
            <Command icon="↷" label="Redo" disabled={!history.canRedo} onPress={() => travel('redo')} />
            <View style={styles.commandDivider} />
            <Command icon="◉" label="Select multiple" selected={multiSelect} onPress={toggleMultiSelect} />
            <Command icon="⧉" label="Duplicate" disabled={!selection} onPress={duplicateSelection} />
            <Command icon="✂" label="Split" disabled={!selection} onPress={splitSelection} />
            <Command icon="□" label="Copy" disabled={!selection} onPress={() => setClipboard(copySelections(timeline, selections.length ? selections : selection ? [selection] : []))} />
            <Command icon="▣" label="Paste at playhead" disabled={!clipboard} onPress={paste} />
            <Command icon="⌫" label="Delete" danger disabled={!selection} onPress={removeSelection} />
            <Command icon="⌘" label="Group" disabled={selections.length < 2} onPress={() => setGrouped(true)} />
            <Command icon="⌁" label="Ungroup" disabled={!selectedGroup} onPress={() => setGrouped(false)} />
            <View style={styles.commandDivider} />
            <Command icon="▣+" label="Add video track" onPress={() => addTimelineTrack('video')} />
            <Command icon="♫+" label="Add audio track" onPress={() => addTimelineTrack('audio')} />
            <Command icon="T+" label="Add text track" onPress={() => addTimelineTrack('text')} />
            <Command icon="◆" label="Add marker" onPress={addTimelineMarker} />
            <Command icon="＋" label="Add text" onPress={addText} />
            <View style={styles.commandDivider} />
            <Command icon="⇩" label="Export" onPress={() => void openWorkflow('/publish/compose')} />
            <Command icon="◈" label="Credits" onPress={() => void openWorkflow('/credits')} />
        </ScrollView>

        <View style={styles.optionStrip}>
            <Choice label="Snap" selected={snap} onPress={() => setSnap((value) => !value)} compact />
            <Text style={styles.optionLabel}>Ripple</Text>
            {(['none', 'lane', 'all'] as const).map((value) => <Choice key={value} label={value === 'none' ? 'Off' : value === 'lane' ? 'Selected track' : 'All tracks'} selected={ripple === value} onPress={() => setRipple(value)} compact />)}
            <View style={styles.optionSpacer} />
            <Text style={styles.optionLabel}>Zoom</Text>
            <Action label="−" disabled={zoom <= 0.5} onPress={() => setZoom((value) => Math.max(0.5, value - 0.25))} compact />
            <Text style={styles.zoomValue}>{zoom.toFixed(2)}×</Text>
            <Action label="+" disabled={zoom >= 2} onPress={() => setZoom((value) => Math.min(2, value + 0.25))} compact />
        </View>

        <View style={styles.previewArea}>
            <View style={styles.previewHeading}>
                <Text style={styles.eyebrow}>PREVIEW</Text>
                <Text style={styles.previewMeta}>{clipCount ? `${clipCount} layers` : 'Empty sequence'}</Text>
            </View>
            <View style={styles.previewFrame}>
                <View style={[styles.canvas, { aspectRatio: canvas.aspect_ratio === '9:16' ? 9 / 16 : canvas.aspect_ratio === '1:1' ? 1 : 16 / 9 }]}>
                    <View style={styles.safeFrame} />
                    <Text style={styles.previewMark}>V</Text>
                    <Text style={styles.previewLabel}>{timeline.video.length ? `${timeline.video.length} ${t('editor.videoClips')}` : t('editor.previewEmpty')}</Text>
                    {previewText ? <Text style={styles.previewCaption}>{previewText}</Text> : null}
                </View>
            </View>
            <View style={styles.transport}>
                <Pressable accessibilityRole="button" accessibilityLabel="Go to start" disabled={!total} onPress={() => setFrame(0)} style={({ pressed }) => [styles.transportButton, pressed && styles.pressed, !total && styles.disabled]}><Text style={styles.transportIcon}>|‹</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} disabled={!total} onPress={() => setPlaying((value) => !value)} style={({ pressed }) => [styles.playButton, pressed && styles.pressed, !total && styles.disabled]}><Text style={styles.playIcon}>{playing ? 'Ⅱ' : '▶'}</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Next frame" disabled={!total || frame >= total - 1} onPress={() => setFrame((value) => Math.min(total - 1, value + 1))} style={({ pressed }) => [styles.transportButton, pressed && styles.pressed, (!total || frame >= total - 1) && styles.disabled]}><Text style={styles.transportIcon}>›</Text></Pressable>
                <Text accessibilityLabel="Playhead timecode" style={styles.timecode}>{timecode(frame, timeline.fps)}</Text>
                <Text style={styles.totalTime}>/ {seconds(total, timeline.fps)}</Text>
            </View>
        </View>

        <View style={styles.timelineSection}>
            <View style={styles.timelineHeading}>
                <Text style={styles.eyebrow}>TIMELINE</Text>
                <Text style={styles.timelineHelp}>{multiSelect ? `${selections.length} selected · tap clips to add` : selection ? 'Tap a command to edit selection' : 'Tap a clip to select'}</Text>
            </View>
            <View style={styles.ruler}><Text style={styles.rulerText}>0s</Text><View style={styles.rulerTicks} />{timeline.markers.map((marker) => <Pressable key={marker.id} accessibilityRole="button" accessibilityLabel={`Go to ${marker.label}`} onPress={() => setFrame(marker.frame)} style={styles.marker}><Text style={styles.markerGlyph}>◆</Text></Pressable>)}<Text style={styles.rulerText}>{seconds(total, timeline.fps)}</Text></View>
            <View style={styles.lanes}>
                {timeline.tracks.map((track) => <TimelineTrack key={track.id} track={track} items={timeline[track.kind].filter((item) => item.trackId === track.id)} timeline={timeline} selections={selections} zoom={zoom} onSelect={selectClip} />)}
                <View pointerEvents="none" style={[styles.playhead, { left: total ? `${18 + (frame / Math.max(1, total)) * 76}%` : '18%' }]}><View style={styles.playheadHead} /></View>
            </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolRail} contentContainerStyle={styles.toolContent}>
            {tools.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: tool === item.id }} onPress={() => setTool(item.id)} style={({ pressed }) => [styles.tool, tool === item.id && styles.toolActive, pressed && styles.pressed]}>
                <Text style={[styles.toolIcon, tool === item.id && styles.toolIconActive]}>{item.icon}</Text>
                <Text style={[styles.toolLabel, tool === item.id && styles.toolLabelActive]}>{item.label}</Text>
            </Pressable>)}
        </ScrollView>

        <ScrollView style={styles.inspector} contentContainerStyle={styles.inspectorContent} keyboardShouldPersistTaps="handled">
            {tool === 'media' ? <>
                <PanelHeading title="Project media" detail={`${Object.values(timeline.media).length} items`} />
                {Object.values(timeline.media).length ? Object.values(timeline.media).map((item) => <ProjectMediaRow key={item.id} item={item} fps={timeline.fps} onAdd={addMediaToTimeline} />) : <EmptyPanel title="No media yet" body="Generate or choose a creation, then return to add it to this Cut project." />}
                <Action label="Open Library" onPress={() => void openWorkflow('/library')} />
            </> : null}
            {tool === 'audio' ? <>
                <PanelHeading title="Audio" detail={`${timeline.audio.length} clips`} />
                {timeline.audio.length ? timeline.audio.map((item) => <InspectorClip key={item.id} track="audio" item={item} timeline={timeline} selected={selections.some((value) => value.track === 'audio' && value.id === item.id)} onPress={() => selectClip({ track: 'audio', id: item.id })} />) : <EmptyPanel title="No audio clips" body="Audio layers from your project appear here and on the timeline." />}
                <View style={styles.quickActions}><Action label="Generate voice or music" onPress={() => void openWorkflow('/create')} /><Action label="Add audio track" onPress={() => addTimelineTrack('audio')} /></View>
            </> : null}
            {tool === 'generate' ? <WorkflowPanel title="Generate" body="Create video, images, music or speech with the same native generation workflow, then add the result from Project media." action="Open Generate" onPress={() => void openWorkflow('/create')} /> : null}
            {tool === 'templates' ? <WorkflowPanel title="Templates" body="Start with a production-ready Veyrnox template, generate its media, then assemble it on this timeline." action="Browse templates" onPress={() => void openWorkflow('/create/presets')} /> : null}
            {tool === 'elements' ? <WorkflowPanel title="Elements" body="Create graphics, face effects and reusable visual elements in the native tools directory." action="Browse elements" onPress={() => void openWorkflow('/create/tools')} /> : null}
            {tool === 'text' ? <>
                <PanelHeading title="Text" detail={selection?.track === 'text' ? 'Layer selected' : `${timeline.text.length} layers`} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('editor.addText')} style={({ pressed }) => [styles.primary, touchTarget, pressed && styles.pressed]} onPress={addText}><Text style={styles.primaryText}>＋ {t('editor.addText')}</Text></Pressable>
                {selection?.track === 'text' && selected && 'text' in selected ? <>
                    <LabeledInput label="Words" value={selected.text} onChangeText={updateSelectedText} />
                    <Stepper label="Text size" value={selected.size} min={2} max={40} step={1} onChange={(size) => patchSelected({ size })} />
                    <Stepper label="Horizontal position" value={selected.x * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ x: value / 100 })} />
                    <Stepper label="Vertical position" value={selected.y * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ y: value / 100 })} />
                    <Text style={styles.fieldLabel}>Weight</Text><View style={styles.choices}>{['normal', 'bold'].map((value) => <Choice key={value} label={value} selected={(selected.style?.weight ?? 'bold') === value} onPress={() => patchSelected({ style: { ...selected.style, weight: value } })} />)}</View>
                    <Text style={styles.fieldLabel}>Alignment</Text><View style={styles.choices}>{['left', 'center', 'right'].map((value) => <Choice key={value} label={value} selected={(selected.style?.align ?? 'center') === value} onPress={() => patchSelected({ style: { ...selected.style, align: value } })} />)}</View>
                </> : <Text style={styles.body}>Select a text layer on the timeline to edit its words, position and styling.</Text>}
            </> : null}
            {tool === 'captions' ? <>
                <PanelHeading title="Captions" detail={timeline.text.length ? `${timeline.text.length} text cues` : 'No cues'} />
                <Action label="Add caption at playhead" onPress={addText} />
                {timeline.text.map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps} selected={selection?.track === 'text' && selection.id === item.id} onPress={() => { selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />)}
            </> : null}
            {tool === 'transcript' ? <>
                <PanelHeading title="Transcript" detail={`${timeline.text.length} cues`} />
                {timeline.text.length ? [...timeline.text].sort((a, b) => a.start - b.start).map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps} selected={selection?.track === 'text' && selection.id === item.id} onPress={() => { selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />) : <EmptyPanel title="No transcript yet" body="Caption and text cues become a time-coded transcript here." />}
            </> : null}
            {tool === 'scenes' ? <>
                <PanelHeading title="Scenes" detail={`${timeline.video.length} detected cuts`} />
                <Action label="Split selected clip at playhead" disabled={selection?.track !== 'video'} onPress={splitSelection} />
                <ClipBrowser kinds={['video']} timeline={timeline} selections={selections} onSelect={(value) => { selectClip(value); const item = clipAt(timeline, value); if (item) setFrame(item.start); }} />
            </> : null}
            {tool === 'clips' ? <>
                <PanelHeading title="Clips" detail={`${clipCount} layers`} />
                <ClipBrowser kinds={['video', 'audio', 'text']} timeline={timeline} selections={selections} onSelect={selectClip} />
            </> : null}
            {tool === 'assistant' ? <WorkflowPanel title="Assistant" body="Ask the Veyrnox assistant to plan shots, rewrite captions or prepare prompts, then return to the same saved project." action="Open Assistant" onPress={() => void openWorkflow('/chat/new')} /> : null}
            {tool === 'effects' ? <>
                <PanelHeading title="Effects" detail={selection ? 'Selected layer' : 'Select a clip'} />
                {selection && selected && selection.track !== 'text' ? <><View style={styles.choices}>{[{ id: 'none', label: 'None' }, { id: 'soft-glow', label: 'Soft glow' }, { id: 'grain', label: 'Film grain' }, { id: 'vignette', label: 'Vignette' }, { id: 'old-film', label: 'Old film' }].map(({ id, label }) => <Choice key={id} label={label} selected={(selected as Clip).effect?.type === id || (id === 'none' && !(selected as Clip).effect)} onPress={() => patchSelected({ effect: id === 'none' ? undefined : { type: id, intensity: .5 } })} />)}</View>{(selected as Clip).effect ? <Stepper label="Effect intensity" value={(selected as Clip).effect!.intensity * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ effect: { ...(selected as Clip).effect!, intensity: value / 100 } })} /> : null}</> : <EmptyPanel title="Choose video or audio" body="Effects are stored on the selected layer and remain editable on web." />}
            </> : null}
            {tool === 'transitions' ? <>
                <PanelHeading title="Transitions" detail={selection?.track === 'video' ? 'Video clip selected' : 'Select a video clip'} />
                {selection?.track === 'video' && selected ? <><View style={styles.choices}>{[{ id: 'dissolve', label: 'Dissolve' }, { id: 'dip-black', label: 'Dip to black' }, { id: 'wipe-left', label: 'Wipe left' }, { id: 'slide-left', label: 'Slide left' }].map(({ id, label }) => <Choice key={id} label={label} selected={((selected as Clip).transitionType ?? 'dissolve') === id} onPress={() => patchSelected({ transitionType: id })} />)}</View><Stepper label="Duration" value={(selected as Clip).transition ?? 0} min={0} max={60} step={5} suffix=" frames" onChange={(transition) => patchSelected({ transition })} /></> : <EmptyPanel title="Choose a video clip" body="Transitions join adjacent clips on the same video track." />}
            </> : null}
            {tool === 'filters' ? <>
                <PanelHeading title="Filters" detail={selection?.track === 'video' ? 'Colour controls' : 'Select a video clip'} />
                {selection?.track === 'video' && selected ? <>{(['brightness', 'contrast', 'saturate'] as const).map((key) => <Stepper key={key} label={key} value={filterOf(selected as Clip)[key]} min={0} max={3} step={0.1} onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), [key]: value } })} />)}<Stepper label="Hue" value={filterOf(selected as Clip).hue} min={-180} max={180} step={10} suffix="°" onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), hue: value } })} /><Stepper label="Blur" value={filterOf(selected as Clip).blur} min={0} max={30} step={1} onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), blur: value } })} /></> : <EmptyPanel title="Choose a video clip" body="Brightness, contrast, saturation, hue and blur match the web inspector." />}
            </> : null}
            {tool === 'animation' ? <>
                <PanelHeading title="Animation" detail={selection ? 'Layer motion' : 'Select a layer'} />
                {selection && selected ? <><Text style={styles.fieldLabel}>Animate in</Text><View style={styles.choices}>{['none', 'fade', 'slide-left', 'zoom'].map((value) => <Choice key={value} label={value} selected={(selected.animation?.in ?? 'none') === value} onPress={() => patchSelected({ animation: { in: value, out: selected.animation?.out ?? 'none', duration: selected.animation?.duration ?? 15 } })} />)}</View><Text style={styles.fieldLabel}>Animate out</Text><View style={styles.choices}>{['none', 'fade', 'slide-right', 'zoom'].map((value) => <Choice key={value} label={value} selected={(selected.animation?.out ?? 'none') === value} onPress={() => patchSelected({ animation: { in: selected.animation?.in ?? 'none', out: value, duration: selected.animation?.duration ?? 15 } })} />)}</View><Stepper label="Animation duration" value={selected.animation?.duration ?? 15} min={1} max={90} step={1} suffix=" frames" onChange={(duration) => patchSelected({ animation: { in: selected.animation?.in ?? 'none', out: selected.animation?.out ?? 'none', duration } })} /></> : <EmptyPanel title="Select a layer" body="Animation controls work on video, audio and text layers." />}
            </> : null}
            {tool === 'plugins' ? <WorkflowPanel title="Plugins" body="Use Veyrnox native creative tools and installed generation skills without dropping into the website editor." action="Open tools" onPress={() => void openWorkflow('/create/tools')} /> : null}
            {tool === 'brand' ? <WorkflowPanel title="Brand kit" body="Manage logos, fonts, colours and approved assets, then return to apply them in Cut." action="Open Brand kit" onPress={() => void openWorkflow('/brand-kit')} /> : null}
            {tool === 'review' ? <>
                <PanelHeading title="Review" detail={`${timeline.markers.length} markers`} />
                <Action label="Add review marker at playhead" onPress={addTimelineMarker} />
                {timeline.markers.map((marker) => <View key={marker.id} style={styles.markerRow}><Pressable accessibilityRole="button" accessibilityLabel={`Go to ${marker.label}`} onPress={() => setFrame(marker.frame)} style={styles.markerJump}><Text style={styles.markerGlyph}>◆</Text><Text style={styles.markerTime}>{timecode(marker.frame, timeline.fps)}</Text></Pressable><TextInput accessibilityLabel={`Rename ${marker.label}`} value={marker.label} maxLength={80} style={[styles.input, styles.markerInput]} onChangeText={(label) => applyTimeline({ ...timeline, markers: timeline.markers.map((item) => item.id === marker.id ? { ...item, label } : item) })} /><Action label="×" danger compact onPress={() => applyTimeline({ ...timeline, markers: timeline.markers.filter((item) => item.id !== marker.id) })} /></View>)}
            </> : null}
            {tool === 'adjust' ? <>
                <PanelHeading title={selection ? selectedMedia?.name || `${selection.track[0].toUpperCase()}${selection.track.slice(1)} layer` : t('editor.projectSettings')} detail={selection ? seconds(selected?.len, timeline.fps) : 'Sequence'} />
                {selection ? <View style={styles.quickActions}><Action label={t('editor.moveLeft')} disabled={selectedIndex <= 0} onPress={() => moveSelection(-1)} /><Action label={t('editor.moveRight')} disabled={selectedIndex >= timeline[selection.track].length - 1} onPress={() => moveSelection(1)} /><Action label={t('editor.remove')} danger onPress={removeSelection} /></View> : null}
                {selection && selected ? <>
                    <Text style={styles.fieldLabel}>Track</Text><View style={styles.choices}>{timeline.tracks.filter((track) => track.kind === selection.track).map((track) => <Choice key={track.id} label={track.name} selected={selected.trackId === track.id} onPress={() => patchSelected({ trackId: track.id })} />)}</View>
                    <Stepper label="Clip start" value={selected.start} min={0} max={18_000 - selected.len} step={1} suffix=" frames" onChange={(start) => patchSelected({ start })} />
                    <Stepper label="Clip duration" value={selected.len} min={1} max={18_000 - selected.start} step={1} suffix=" frames" onChange={(len) => patchSelected({ len })} />
                    {selection.track !== 'text' ? <><Stepper label="Speed" value={(selected as Clip).rate ?? 1} min={0.1} max={8} step={0.1} suffix="×" onChange={changeSpeed} /><Choice label="Reverse" selected={!!(selected as Clip).reverse} onPress={toggleReverse} /><Stepper label="Volume" value={((selected as Clip).volume ?? 1) * 100} min={0} max={200} step={5} suffix="%" onChange={(volume) => patchSelected({ volume: volume / 100 })} /><Stepper label="Fade in" value={(selected as Clip).fadeIn ?? 0} min={0} max={selected.len} step={1} suffix=" frames" onChange={(fadeIn) => patchSelected({ fadeIn })} /><Stepper label="Fade out" value={(selected as Clip).fadeOut ?? 0} min={0} max={selected.len} step={1} suffix=" frames" onChange={(fadeOut) => patchSelected({ fadeOut })} /><Stepper label="Pan" value={(selected as Clip).pan ?? 0} min={-1} max={1} step={0.1} onChange={(pan) => patchSelected({ pan })} /></> : null}
                    {selection.track === 'video' ? <><Stepper label="Scale" value={transformOf(selected as Clip).scale * 100} min={5} max={800} step={5} suffix="%" onChange={(value) => patchSelected({ transform: { ...transformOf(selected as Clip), scale: value / 100 } })} /><Stepper label="Rotation" value={transformOf(selected as Clip).rotation} min={-360} max={360} step={5} suffix="°" onChange={(rotation) => patchSelected({ transform: { ...transformOf(selected as Clip), rotation } })} /><Stepper label="Opacity" value={transformOf(selected as Clip).opacity * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ transform: { ...transformOf(selected as Clip), opacity: value / 100 } })} /><View style={styles.choices}><Choice label="Contain" selected={((selected as Clip).fit ?? 'contain') === 'contain'} onPress={() => patchSelected({ fit: 'contain' })} /><Choice label="Cover" selected={(selected as Clip).fit === 'cover'} onPress={() => patchSelected({ fit: 'cover' })} /></View></> : null}
                </> : null}
                <LabeledInput label={t('editor.brief')} value={document.brief || ''} multiline onChangeText={(brief) => markDocument({ ...document, brief: brief.slice(0, 6000) })} />
                <Text style={styles.fieldLabel}>{t('editor.shape')}</Text><View style={styles.choices}>{(['16:9', '9:16', '1:1'] as const).map((value) => <Choice key={value} label={value} selected={canvas.aspect_ratio === value} onPress={() => updateCanvas({ aspect_ratio: value })} />)}</View>
                <Text style={styles.fieldLabel}>{t('editor.rate')}</Text><View style={styles.choices}>{([24, 25, 30, 60] as const).map((value) => <Choice key={value} label={`${value}`} selected={canvas.frame_rate === value} onPress={() => updateCanvas({ frame_rate: value })} />)}</View>
                <Text style={styles.fieldLabel}>Canvas colour</Text><View style={styles.choices}>{['#000000', '#ffffff', '#15211f', '#301c36', '#17233f'].map((value) => <Choice key={value} label={value} selected={timeline.background === value} onPress={() => applyTimeline({ ...timeline, background: value })} />)}</View>
                <PanelHeading title="Tracks" detail={`${timeline.tracks.length} total`} />
                {timeline.tracks.map((track) => <View key={track.id} style={styles.trackControl}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{track.name}</Text><Text style={styles.muted}>{track.kind}</Text></View><Choice label="Lock" selected={track.locked} onPress={() => updateTrack(track, { locked: !track.locked })} compact /><Choice label="Mute" selected={track.muted} onPress={() => updateTrack(track, { muted: !track.muted })} compact /><Choice label="Hide" selected={track.hidden} onPress={() => updateTrack(track, { hidden: !track.hidden })} compact /></View>)}
            </> : null}
        </ScrollView>
        <Modal visible={privacyNotice} transparent animationType="fade" onRequestClose={acknowledgePrivacy} accessibilityViewIsModal><View style={styles.noticeBackdrop}><View style={styles.noticeCard}><Text accessibilityRole="header" style={styles.noticeTitle}>{t('editor.privacyTitle')}</Text><Text style={styles.body}>{t('editor.privacySummary')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('editor.privacyConfirm')} style={[styles.primary, touchTarget]} onPress={acknowledgePrivacy}><Text style={styles.primaryText}>{t('editor.privacyConfirm')}</Text></Pressable></View></View></Modal>
    </View>;
}

function Command({ icon, label, onPress, disabled = false, danger = false, selected = false }: { icon: string; label: string; onPress(): void; disabled?: boolean; danger?: boolean; selected?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.command, selected && styles.commandSelected, pressed && styles.pressed, disabled && styles.disabled]}><Text style={[styles.commandIcon, selected && styles.toolIconActive, danger && styles.danger]}>{icon}</Text><Text style={[styles.commandLabel, selected && styles.toolLabelActive, danger && styles.danger]}>{label}</Text></Pressable>;
}
function TimelineTrack({ track, items, timeline, selections, zoom, onSelect }: { track: EditorTrack; items: readonly (Clip | TextClip)[]; timeline: Timeline; selections: readonly Selection[]; zoom: number; onSelect(value: Selection): void }) {
    return <View style={styles.track}>
        <View style={styles.trackName}><Text style={styles.trackGlyph}>{track.kind === 'video' ? '▣' : track.kind === 'audio' ? '♫' : 'T'}</Text><View style={styles.trackCopy}><Text style={styles.trackLabel} numberOfLines={1}>{track.name.toUpperCase()}</Text><Text style={styles.trackState}>{track.locked ? 'LOCK ' : ''}{track.muted ? 'MUTE ' : ''}{track.hidden ? 'HIDE' : ''}</Text></View></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clips}>
            {items.length ? items.map((item) => {
                const active = selections.some((selection) => selection.track === track.kind && selection.id === item.id);
                const label = track.kind === 'text' ? (item as TextClip).text : timeline.media[(item as Clip).mediaId || '']?.name || item.id;
                return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${track.kind} ${label}`} accessibilityState={{ selected: active }} onPress={() => onSelect({ track: track.kind, id: item.id })} style={({ pressed }) => [styles.clip, styles[`${track.kind}Clip`], { width: Math.max(78, Math.min(240, item.len / Math.max(1, timeline.fps) * 34 * zoom)) }, active && styles.clipSelected, pressed && styles.pressed]}>
                    <Text style={styles.clipTitle} numberOfLines={1}>{label}</Text><Text style={styles.clipMeta}>{seconds(item.len, timeline.fps)}</Text>
                </Pressable>;
            }) : <View style={styles.emptyTrack}><View style={styles.emptyTrackLine} /><Text style={styles.trackEmpty}>Empty</Text></View>}
        </ScrollView>
    </View>;
}
function PanelHeading({ title, detail }: { title: string; detail: string }) { return <View style={styles.panelHeading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.panelDetail}>{detail}</Text></View>; }
function EmptyPanel({ title, body }: { title: string; body: string }) { return <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>; }
function ProjectMediaRow({ item, fps, onAdd }: { item: Media; fps: number; onAdd(item: Media): void }) {
    const label = `Add ${item.kind === 'audio' ? 'audio' : 'video'}`;
    return <View style={styles.mediaRow}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>{item.kind === 'audio' ? '♫' : '▶'}</Text></View><View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{item.name || t('editor.untitledMedia')}</Text><Text style={styles.muted}>{item.kind || t('editor.media')} · {seconds(item.frames, fps)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onAdd(item)} style={({ pressed }) => [styles.action, styles.compactControl, touchTarget, pressed && styles.pressed]}><Text style={styles.actionText}>Add</Text></Pressable></View>;
}
function InspectorClip({ track, item, timeline, selected, onPress }: { track: TrackKind; item: Clip; timeline: Timeline; selected: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={timeline.media[item.mediaId || '']?.name || item.id} accessibilityState={{ selected }} onPress={onPress} style={[styles.mediaRow, selected && styles.mediaRowSelected]}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>♫</Text></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{timeline.media[item.mediaId || '']?.name || `${track} clip`}</Text><Text style={styles.muted}>{seconds(item.len, timeline.fps)}</Text></View></Pressable>;
}
function Action({ label, onPress, disabled = false, danger = false, compact = false }: { label: string; onPress(): void; disabled?: boolean; danger?: boolean; compact?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} style={({ pressed }) => [styles.action, touchTarget, compact && styles.compactControl, disabled && styles.disabled, pressed && styles.pressed]} onPress={onPress}><Text style={[styles.actionText, danger && styles.danger]}>{label}</Text></Pressable>; }
function Choice({ label, selected, onPress, compact = false }: { label: string; selected: boolean; onPress(): void; compact?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={({ pressed }) => [styles.choice, touchTarget, compact && styles.compactControl, selected && styles.choiceSelected, pressed && styles.pressed]} onPress={onPress}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>; }
function LabeledInput({ label, value, multiline = false, onChangeText }: { label: string; value: string; multiline?: boolean; onChangeText(value: string): void }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} multiline={multiline} maxLength={multiline ? 6000 : 120} style={[styles.input, multiline && styles.inputMultiline]} placeholderTextColor={colors.muted} onChangeText={onChangeText} /></View>; }
function Stepper({ label, value, min, max, step, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange(value: number): void }) {
    const digits = step < 1 ? 1 : 0;
    const set = (next: number) => onChange(Math.max(min, Math.min(max, Number(next.toFixed(digits)))));
    return <View style={styles.stepper}><View style={styles.stepperCopy}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.stepperValue}>{value.toFixed(digits)}{suffix}</Text></View><View style={styles.stepperActions}><Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} accessibilityState={{ disabled: value <= min }} disabled={value <= min} onPress={() => set(value - step)} style={({ pressed }) => [styles.stepperButton, value <= min && styles.disabled, pressed && styles.pressed]}><Text style={styles.stepperButtonText}>−</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} accessibilityState={{ disabled: value >= max }} disabled={value >= max} onPress={() => set(value + step)} style={({ pressed }) => [styles.stepperButton, value >= max && styles.disabled, pressed && styles.pressed]}><Text style={styles.stepperButtonText}>+</Text></Pressable></View></View>;
}
function WorkflowPanel({ title, body, action, onPress }: { title: string; body: string; action: string; onPress(): void }) {
    return <><PanelHeading title={title} detail="Native workflow" /><View style={styles.workflowCard}><Text style={styles.body}>{body}</Text><Pressable accessibilityRole="button" accessibilityLabel={action} style={({ pressed }) => [styles.primary, touchTarget, pressed && styles.pressed]} onPress={onPress}><Text style={styles.primaryText}>{action}</Text></Pressable></View></>;
}
function TranscriptRow({ item, fps, selected, onPress }: { item: TextClip; fps: number; selected: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`${timecode(item.start, fps)} ${item.text}`} accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.transcriptRow, selected && styles.mediaRowSelected, pressed && styles.pressed]}><Text style={styles.transcriptTime}>{timecode(item.start, fps)}</Text><Text style={styles.transcriptText} numberOfLines={2}>{item.text}</Text></Pressable>;
}
function ClipBrowser({ kinds, timeline, selections, onSelect }: { kinds: readonly TrackKind[]; timeline: Timeline; selections: readonly Selection[]; onSelect(value: Selection): void }) {
    const items = kinds.flatMap((track) => timeline[track].map((item) => ({ track, item })));
    return <>{items.length ? items.sort((a, b) => a.item.start - b.item.start).map(({ track, item }) => {
        const label = track === 'text' ? (item as TextClip).text : timeline.media[(item as Clip).mediaId || '']?.name || item.id;
        const active = selections.some((selection) => selection.track === track && selection.id === item.id);
        return <Pressable key={`${track}:${item.id}`} accessibilityRole="button" accessibilityLabel={`${track} ${label}`} accessibilityState={{ selected: active }} onPress={() => onSelect({ track, id: item.id })} style={({ pressed }) => [styles.clipBrowserRow, active && styles.mediaRowSelected, pressed && styles.pressed]}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>{track === 'audio' ? '♫' : track === 'text' ? 'T' : '▶'}</Text></View><View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{label}</Text><Text style={styles.muted}>{timecode(item.start, timeline.fps)} · {seconds(item.len, timeline.fps)}</Text></View></Pressable>;
    }) : <EmptyPanel title="No clips" body="Add media or text to the timeline first." />}</>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
    projectBar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    cutBadge: { height: 38, minWidth: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background },
    cutMark: { color: colors.accent, fontFamily: fonts.displayHeavy, fontSize: 19 }, cutLabel: { color: colors.text, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
    titleGroup: { flex: 1, minWidth: 0 }, title: { color: colors.text, fontFamily: fonts.display, fontSize: 17 }, status: { color: colors.muted, fontSize: 11, marginTop: 1 },
    formatBadge: { alignItems: 'flex-end' }, formatText: { color: colors.text, fontSize: 12, fontWeight: '800' }, formatMeta: { color: colors.muted, fontSize: 9, marginTop: 2 },
    problem: { color: colors.danger, paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    commandStrip: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background }, commandContent: { minHeight: 51, alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 4 },
    command: { minWidth: 52, minHeight: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 6 }, commandSelected: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent }, commandIcon: { color: colors.body, fontSize: 18, lineHeight: 20, fontWeight: '500' }, commandLabel: { color: colors.muted, fontSize: 9, marginTop: 1, fontWeight: '700' }, commandDivider: { width: 1, height: 29, marginHorizontal: 4, backgroundColor: colors.border },
    optionStrip: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface }, optionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800' }, optionSpacer: { flex: 1 }, zoomValue: { minWidth: 36, color: colors.body, fontSize: 10, textAlign: 'center', fontVariant: ['tabular-nums'] },
    previewArea: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    previewHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }, eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, previewMeta: { color: colors.muted, fontSize: 10 },
    previewFrame: { height: 178, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 12, backgroundColor: '#050506' },
    canvas: { height: '100%', maxWidth: '100%', minWidth: 100, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#242428', backgroundColor: '#08080a' },
    safeFrame: { position: 'absolute', inset: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
    previewMark: { color: '#3ee6c4', fontFamily: fonts.displayHeavy, fontSize: 52, opacity: 0.18 }, previewLabel: { color: '#b9b9c0', fontSize: 12, fontWeight: '600' },
    previewCaption: { position: 'absolute', bottom: 17, maxWidth: '84%', color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 5 },
    transport: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 7 },
    transportButton: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background },
    transportIcon: { color: colors.text, fontSize: 17, fontWeight: '700' }, playButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.accent }, playIcon: { color: colors.accentInk, fontSize: 14, fontWeight: '900' },
    timecode: { marginLeft: 7, color: colors.text, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }, totalTime: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
    timelineSection: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background },
    timelineHeading: { height: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }, timelineHelp: { color: colors.muted, fontSize: 9 },
    ruler: { height: 20, flexDirection: 'row', alignItems: 'center', paddingLeft: 72, paddingRight: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    rulerText: { color: colors.muted, fontSize: 8, fontVariant: ['tabular-nums'] }, rulerTicks: { flex: 1, height: 6, marginHorizontal: 7, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.borderStrong }, marker: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' }, markerGlyph: { color: colors.accent, fontSize: 10 },
    lanes: { position: 'relative' }, track: { minHeight: 38, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    trackName: { width: 70, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    trackGlyph: { width: 13, color: colors.body, fontSize: 12, fontWeight: '800', textAlign: 'center' }, trackCopy: { flex: 1, minWidth: 0 }, trackLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 }, trackState: { color: colors.accent, fontSize: 6, fontWeight: '800', marginTop: 1 },
    clips: { minWidth: 305, alignItems: 'center', gap: 4, paddingHorizontal: 5, paddingVertical: 4 }, clip: { width: 112, minHeight: 29, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
    videoClip: { borderColor: '#287f86', backgroundColor: 'rgba(36, 142, 151, 0.24)' }, audioClip: { borderColor: '#9563c9', backgroundColor: 'rgba(149, 99, 201, 0.22)' }, textClip: { borderColor: '#a07d36', backgroundColor: 'rgba(202, 157, 65, 0.20)' },
    clipSelected: { borderColor: colors.accent, borderWidth: 2 }, clipTitle: { color: colors.text, fontSize: 10, fontWeight: '700' }, clipMeta: { color: colors.muted, fontSize: 8, marginTop: 1 },
    emptyTrack: { width: 276, minHeight: 29, flexDirection: 'row', alignItems: 'center', gap: 7 }, emptyTrackLine: { flex: 1, height: 1, backgroundColor: colors.border }, trackEmpty: { color: colors.muted, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
    playhead: { position: 'absolute', top: -20, bottom: 0, width: 1, backgroundColor: colors.accent }, playheadHead: { position: 'absolute', top: 0, left: -3, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
    toolRail: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface }, toolContent: { minWidth: '100%', paddingHorizontal: 5, paddingVertical: 5, gap: 2 },
    tool: { flex: 1, minWidth: 67, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 9, borderWidth: 1, borderColor: 'transparent' },
    toolActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, toolIcon: { color: colors.body, fontSize: 16, fontWeight: '800' }, toolIconActive: { color: colors.accent }, toolLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' }, toolLabelActive: { color: colors.accent },
    inspector: { flex: 1, minHeight: 96 }, inspectorContent: { padding: 12, paddingBottom: 34, gap: 11 }, panelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 17 }, panelDetail: { color: colors.muted, fontSize: 10, fontWeight: '600' },
    body: { color: colors.body, fontSize: 14, lineHeight: 20 }, muted: { color: colors.muted, fontSize: 11 },
    mediaRow: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, mediaRowSelected: { borderColor: colors.accent },
    mediaThumb: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.background }, mediaThumbText: { color: colors.accent, fontSize: 15, fontWeight: '800' }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
    emptyPanel: { gap: 4, padding: 13, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: colors.surface }, emptyTitle: { color: colors.text, fontSize: 13, fontWeight: '800' }, emptyBody: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, action: { justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, compactControl: { minWidth: 44, minHeight: 36, paddingHorizontal: 8 }, actionText: { color: colors.text, fontSize: 12, fontWeight: '700' },
    primary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent, paddingHorizontal: 13 }, primaryText: { color: colors.accentInk, fontWeight: '800' },
    field: { gap: 6 }, fieldLabel: { color: colors.body, fontSize: 12, fontWeight: '700' }, input: { minHeight: 44, color: colors.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, inputMultiline: { minHeight: 84, textAlignVertical: 'top' },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { minWidth: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 11 }, choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, choiceText: { color: colors.body, fontWeight: '700' }, choiceTextSelected: { color: colors.accent },
    workflowCard: { gap: 13, padding: 15, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    stepper: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, stepperCopy: { flex: 1 }, stepperValue: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] }, stepperActions: { flexDirection: 'row', gap: 6 }, stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background }, stepperButtonText: { color: colors.text, fontSize: 20, fontWeight: '700' },
    transcriptRow: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, transcriptTime: { color: colors.accent, fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] }, transcriptText: { flex: 1, color: colors.body, fontSize: 13, lineHeight: 17 },
    clipBrowserRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    markerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 7 }, markerJump: { minWidth: 70, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 }, markerTime: { color: colors.body, fontSize: 9, fontVariant: ['tabular-nums'] }, markerInput: { flex: 1 },
    trackControl: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    danger: { color: colors.danger }, disabled: { opacity: 0.35 }, pressed: { opacity: 0.62, transform: [{ scale: 0.97 }] },
    noticeBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.72)' }, noticeCard: { gap: 14, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, noticeTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
