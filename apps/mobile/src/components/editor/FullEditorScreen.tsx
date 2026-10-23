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
import { fetchProject } from '../../lib/projects';
import { colors, fonts } from '../../theme';
import { HeaderAction } from '../HeaderAction';

type Tool = 'media' | 'audio' | 'text' | 'captions' | 'adjust';
type Track = 'video' | 'audio' | 'text';
type Selection = { track: Track; id: string } | null;
type Canvas = { aspect_ratio: '16:9' | '9:16' | '1:1'; frame_rate: 24 | 25 | 30 | 60 };
type Media = { id: string; name?: string; kind?: string; frames?: number };
type Clip = { id: string; mediaId?: string; start?: number; in?: number; len?: number; volume?: number; transition?: number };
type TextClip = { id: string; text: string; start: number; len: number; x: number; y: number; size: number };
type Timeline = {
    schemaVersion: 2 | 3; fps: number; seq: number; aspect: 'source' | Canvas['aspect_ratio'];
    media: Record<string, Media>; video: Clip[]; audio: Clip[]; text: TextClip[];
};

const tools: readonly { id: Tool; icon: string; label: string }[] = [
    { id: 'media', icon: '▣', label: 'Media' },
    { id: 'audio', icon: '♫', label: 'Audio' },
    { id: 'text', icon: 'T', label: 'Text' },
    { id: 'captions', icon: 'CC', label: 'Captions' },
    { id: 'adjust', icon: '☷', label: 'Adjust' },
];
const canvasOf = (value: unknown): Canvas => {
    const canvas = value && typeof value === 'object' ? value as Partial<Canvas> : {};
    return {
        aspect_ratio: canvas.aspect_ratio === '9:16' || canvas.aspect_ratio === '1:1' ? canvas.aspect_ratio : '16:9',
        frame_rate: canvas.frame_rate === 24 || canvas.frame_rate === 25 || canvas.frame_rate === 60 ? canvas.frame_rate : 30,
    };
};
const emptyTimeline = (): Timeline => ({ schemaVersion: 2, fps: 30, seq: 0, aspect: 'source', media: {}, video: [], audio: [], text: [] });
const timelineOf = (value: unknown): Timeline => {
    if (!value || typeof value !== 'object') return emptyTimeline();
    const raw = value as Partial<Timeline>;
    if (!Array.isArray(raw.video) || !Array.isArray(raw.audio) || !Array.isArray(raw.text) || !raw.media || typeof raw.media !== 'object') return emptyTimeline();
    return { ...emptyTimeline(), ...raw, schemaVersion: raw.schemaVersion === 3 ? 3 : 2 } as Timeline;
};
const framesIn = (timeline: Timeline) => Math.max(0, ...[...timeline.video, ...timeline.audio, ...timeline.text].map((clip) => (clip.start ?? 0) + (clip.len ?? 0)));
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
    const [selection, setSelection] = useState<Selection>(null);
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
        setHistory({ canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0 });
    }, [markDocument]);

    if (!document) return <View style={styles.loading}><Stack.Screen options={{ title: t('editor.title') }} /><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{problem ?? t('editor.fullLoading')}</Text></View>;

    const canvas = canvasOf(document.canvas);
    const timeline = timelineOf(document.timeline);
    const total = framesIn(timeline);
    const allTracks: readonly [Track, readonly (Clip | TextClip)[]][] = [['video', timeline.video], ['audio', timeline.audio], ['text', timeline.text]];
    const selected = selection ? timeline[selection.track].find((item) => item.id === selection.id) : undefined;
    const selectedIndex = selection ? timeline[selection.track].findIndex((item) => item.id === selection.id) : -1;
    const selectedMedia = selected && 'mediaId' in selected && selected.mediaId ? timeline.media[selected.mediaId] : undefined;
    const previewText = timeline.text.find((item) => frame >= item.start && frame < item.start + item.len)?.text ?? timeline.text[0]?.text;
    const clipCount = timeline.video.length + timeline.audio.length + timeline.text.length;

    const applyTimeline = (next: Timeline) => markDocument({ ...document, schema_version: next.schemaVersion, timeline: next });
    const updateCanvas = (patch: Partial<Canvas>) => {
        const nextCanvas = { ...canvas, ...patch };
        const nextTimeline = document.timeline ? { ...timeline, aspect: nextCanvas.aspect_ratio } : document.timeline;
        markDocument({ ...document, canvas: nextCanvas, ...(nextTimeline ? { timeline: nextTimeline } : {}) });
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
        if (!selection) return;
        applyTimeline({ ...timeline, [selection.track]: timeline[selection.track].filter((item) => item.id !== selection.id) });
        setSelection(null);
    };
    const duplicateSelection = () => {
        if (!selection || !selected) return;
        const seq = timeline.seq + 1;
        const copy = { ...selected, id: `${selection.track[0]}${seq}`, start: (selected.start ?? 0) + (selected.len ?? 0) };
        applyTimeline({ ...timeline, seq, [selection.track]: [...timeline[selection.track], copy] });
        setSelection({ track: selection.track, id: copy.id });
    };
    const addText = () => {
        const seq = timeline.seq + 1;
        const item: TextClip = { id: `t${seq}`, text: 'Your title', start: Math.min(frame, Math.max(0, total)), len: 90, x: 0.5, y: 0.85, size: 6 };
        applyTimeline({ ...timeline, schemaVersion: 2, seq, text: [...timeline.text, item] });
        setSelection({ track: 'text', id: item.id });
        setTool('text');
    };
    const updateSelectedText = (text: string) => {
        if (selection?.track !== 'text') return;
        applyTimeline({ ...timeline, text: timeline.text.map((item) => item.id === selection.id ? { ...item, text: text.slice(0, 120) } : item) });
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
            <Command icon="⧉" label="Duplicate" disabled={!selection} onPress={duplicateSelection} />
            <Command icon="＋" label="Add text" onPress={addText} />
            <Command icon="⌫" label="Delete" danger disabled={!selection} onPress={removeSelection} />
        </ScrollView>

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
                <Text style={styles.timelineHelp}>{selection ? 'Tap a command to edit selection' : 'Tap a clip to select'}</Text>
            </View>
            <View style={styles.ruler}><Text style={styles.rulerText}>0s</Text><View style={styles.rulerTicks} /><Text style={styles.rulerText}>{seconds(total, timeline.fps)}</Text></View>
            <View style={styles.lanes}>
                {allTracks.map(([track, items]) => <TimelineTrack key={track} track={track} items={items} timeline={timeline} selection={selection} onSelect={setSelection} />)}
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
                {Object.values(timeline.media).length ? Object.values(timeline.media).map((item) => <View key={item.id} style={styles.mediaRow}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>{item.kind === 'audio' ? '♫' : '▶'}</Text></View><View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{item.name || t('editor.untitledMedia')}</Text><Text style={styles.muted}>{item.kind || t('editor.media')} · {seconds(item.frames, timeline.fps)}</Text></View></View>) : <EmptyPanel title="No media yet" body="Add a photo or video from Create, then open it in Cut." />}
            </> : null}
            {tool === 'audio' ? <>
                <PanelHeading title="Audio" detail={`${timeline.audio.length} clips`} />
                {timeline.audio.length ? timeline.audio.map((item) => <InspectorClip key={item.id} track="audio" item={item} timeline={timeline} selected={selection?.track === 'audio' && selection.id === item.id} onPress={() => setSelection({ track: 'audio', id: item.id })} />) : <EmptyPanel title="No audio track" body="Audio layers from your project appear here and on the timeline." />}
            </> : null}
            {tool === 'text' ? <>
                <PanelHeading title="Text" detail={selection?.track === 'text' ? 'Layer selected' : `${timeline.text.length} layers`} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('editor.addText')} style={({ pressed }) => [styles.primary, touchTarget, pressed && styles.pressed]} onPress={addText}><Text style={styles.primaryText}>＋ {t('editor.addText')}</Text></Pressable>
                {selection?.track === 'text' && selected && 'text' in selected ? <LabeledInput label="Words" value={selected.text} onChangeText={updateSelectedText} /> : <Text style={styles.body}>Select a text layer on the timeline to edit its words.</Text>}
            </> : null}
            {tool === 'captions' ? <>
                <PanelHeading title="Captions" detail={timeline.text.length ? `${timeline.text.length} text cues` : 'No cues'} />
                <EmptyPanel title={timeline.text.length ? 'Text layers are ready' : 'Add captions'} body={timeline.text.length ? 'Select a text cue on the timeline to change its wording and timing.' : 'Create a text layer, then position it on the timeline as a caption.'} />
            </> : null}
            {tool === 'adjust' ? <>
                <PanelHeading title={selection ? selectedMedia?.name || `${selection.track[0].toUpperCase()}${selection.track.slice(1)} layer` : t('editor.projectSettings')} detail={selection ? seconds(selected?.len, timeline.fps) : 'Sequence'} />
                {selection ? <View style={styles.quickActions}><Action label={t('editor.moveLeft')} disabled={selectedIndex <= 0} onPress={() => moveSelection(-1)} /><Action label={t('editor.moveRight')} disabled={selectedIndex >= timeline[selection.track].length - 1} onPress={() => moveSelection(1)} /><Action label={t('editor.remove')} danger onPress={removeSelection} /></View> : null}
                <LabeledInput label={t('editor.brief')} value={document.brief || ''} multiline onChangeText={(brief) => markDocument({ ...document, brief: brief.slice(0, 6000) })} />
                <Text style={styles.fieldLabel}>{t('editor.shape')}</Text><View style={styles.choices}>{(['16:9', '9:16', '1:1'] as const).map((value) => <Choice key={value} label={value} selected={canvas.aspect_ratio === value} onPress={() => updateCanvas({ aspect_ratio: value })} />)}</View>
                <Text style={styles.fieldLabel}>{t('editor.rate')}</Text><View style={styles.choices}>{([24, 25, 30, 60] as const).map((value) => <Choice key={value} label={`${value}`} selected={canvas.frame_rate === value} onPress={() => updateCanvas({ frame_rate: value })} />)}</View>
            </> : null}
        </ScrollView>
        <Modal visible={privacyNotice} transparent animationType="fade" onRequestClose={acknowledgePrivacy} accessibilityViewIsModal><View style={styles.noticeBackdrop}><View style={styles.noticeCard}><Text accessibilityRole="header" style={styles.noticeTitle}>{t('editor.privacyTitle')}</Text><Text style={styles.body}>{t('editor.privacySummary')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('editor.privacyConfirm')} style={[styles.primary, touchTarget]} onPress={acknowledgePrivacy}><Text style={styles.primaryText}>{t('editor.privacyConfirm')}</Text></Pressable></View></View></Modal>
    </View>;
}

function Command({ icon, label, onPress, disabled = false, danger = false }: { icon: string; label: string; onPress(): void; disabled?: boolean; danger?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.command, pressed && styles.pressed, disabled && styles.disabled]}><Text style={[styles.commandIcon, danger && styles.danger]}>{icon}</Text><Text style={[styles.commandLabel, danger && styles.danger]}>{label}</Text></Pressable>;
}
function TimelineTrack({ track, items, timeline, selection, onSelect }: { track: Track; items: readonly (Clip | TextClip)[]; timeline: Timeline; selection: Selection; onSelect(value: Selection): void }) {
    return <View style={styles.track}>
        <View style={styles.trackName}><Text style={styles.trackGlyph}>{track === 'video' ? '▣' : track === 'audio' ? '♫' : 'T'}</Text><Text style={styles.trackLabel}>{track.toUpperCase()}</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clips}>
            {items.length ? items.map((item) => {
                const active = selection?.track === track && selection.id === item.id;
                const label = track === 'text' ? (item as TextClip).text : timeline.media[(item as Clip).mediaId || '']?.name || item.id;
                return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${track} ${label}`} accessibilityState={{ selected: active }} onPress={() => onSelect({ track, id: item.id })} style={({ pressed }) => [styles.clip, styles[`${track}Clip`], active && styles.clipSelected, pressed && styles.pressed]}>
                    <Text style={styles.clipTitle} numberOfLines={1}>{label}</Text><Text style={styles.clipMeta}>{seconds(item.len, timeline.fps)}</Text>
                </Pressable>;
            }) : <View style={styles.emptyTrack}><View style={styles.emptyTrackLine} /><Text style={styles.trackEmpty}>Empty</Text></View>}
        </ScrollView>
    </View>;
}
function PanelHeading({ title, detail }: { title: string; detail: string }) { return <View style={styles.panelHeading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.panelDetail}>{detail}</Text></View>; }
function EmptyPanel({ title, body }: { title: string; body: string }) { return <View style={styles.emptyPanel}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>; }
function InspectorClip({ track, item, timeline, selected, onPress }: { track: Track; item: Clip; timeline: Timeline; selected: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={timeline.media[item.mediaId || '']?.name || item.id} accessibilityState={{ selected }} onPress={onPress} style={[styles.mediaRow, selected && styles.mediaRowSelected]}><View style={styles.mediaThumb}><Text style={styles.mediaThumbText}>♫</Text></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{timeline.media[item.mediaId || '']?.name || `${track} clip`}</Text><Text style={styles.muted}>{seconds(item.len, timeline.fps)}</Text></View></Pressable>;
}
function Action({ label, onPress, disabled = false, danger = false }: { label: string; onPress(): void; disabled?: boolean; danger?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} style={({ pressed }) => [styles.action, touchTarget, disabled && styles.disabled, pressed && styles.pressed]} onPress={onPress}><Text style={[styles.actionText, danger && styles.danger]}>{label}</Text></Pressable>; }
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={({ pressed }) => [styles.choice, touchTarget, selected && styles.choiceSelected, pressed && styles.pressed]} onPress={onPress}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>; }
function LabeledInput({ label, value, multiline = false, onChangeText }: { label: string; value: string; multiline?: boolean; onChangeText(value: string): void }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} multiline={multiline} maxLength={multiline ? 6000 : 120} style={[styles.input, multiline && styles.inputMultiline]} placeholderTextColor={colors.muted} onChangeText={onChangeText} /></View>; }

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
    command: { minWidth: 52, minHeight: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 6 }, commandIcon: { color: colors.body, fontSize: 18, lineHeight: 20, fontWeight: '500' }, commandLabel: { color: colors.muted, fontSize: 9, marginTop: 1, fontWeight: '700' }, commandDivider: { width: 1, height: 29, marginHorizontal: 4, backgroundColor: colors.border },
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
    rulerText: { color: colors.muted, fontSize: 8, fontVariant: ['tabular-nums'] }, rulerTicks: { flex: 1, height: 6, marginHorizontal: 7, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.borderStrong },
    lanes: { position: 'relative' }, track: { minHeight: 38, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    trackName: { width: 70, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    trackGlyph: { width: 13, color: colors.body, fontSize: 12, fontWeight: '800', textAlign: 'center' }, trackLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
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
    quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, action: { justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, actionText: { color: colors.text, fontSize: 12, fontWeight: '700' },
    primary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent, paddingHorizontal: 13 }, primaryText: { color: colors.accentInk, fontWeight: '800' },
    field: { gap: 6 }, fieldLabel: { color: colors.body, fontSize: 12, fontWeight: '700' }, input: { minHeight: 44, color: colors.text, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, inputMultiline: { minHeight: 84, textAlignVertical: 'top' },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { minWidth: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 11 }, choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, choiceText: { color: colors.body, fontWeight: '700' }, choiceTextSelected: { color: colors.accent },
    danger: { color: colors.danger }, disabled: { opacity: 0.35 }, pressed: { opacity: 0.62, transform: [{ scale: 0.97 }] },
    noticeBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.72)' }, noticeCard: { gap: 14, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, noticeTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
