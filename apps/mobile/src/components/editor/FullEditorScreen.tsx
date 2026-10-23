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

type Tab = 'media' | 'preview' | 'timeline' | 'adjust';
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

const tabs: readonly Tab[] = ['media', 'preview', 'timeline', 'adjust'];
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
const seconds = (frames = 0, fps = 30) => `${Math.max(0, frames / fps).toFixed(1)}s`;

export function FullEditorScreen({ projectId }: { projectId: string }) {
    const { api } = useAuth();
    const router = useRouter();
    const mounted = useRef(true);
    const documentRef = useRef<ProjectDocument | null>(null);
    const revisionRef = useRef(0);
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);
    const queuedRef = useRef(false);
    const [name, setName] = useState(t('editor.title'));
    const [document, setDocument] = useState<ProjectDocument | null>(null);
    const [revision, setRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('preview');
    const [selection, setSelection] = useState<Selection>(null);
    const [privacyNotice, setPrivacyNotice] = useState(false);

    const markDocument = useCallback((next: ProjectDocument) => {
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

    const done = useCallback(async () => {
        const saved = await save();
        if (saved && !dirtyRef.current) router.back();
    }, [router, save]);
    const acknowledgePrivacy = useCallback(() => {
        setPrivacyNotice(false);
        SecureStore.setItemAsync('veyrnox.editorPrivacyNotice.v1', 'seen').catch(() => {});
    }, []);

    if (!document) return <View style={styles.loading}><Stack.Screen options={{ title: t('editor.title') }} /><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{problem ?? t('editor.fullLoading')}</Text></View>;

    const canvas = canvasOf(document.canvas);
    const timeline = timelineOf(document.timeline);
    const allTracks: readonly [Track, readonly (Clip | TextClip)[]][] = [['video', timeline.video], ['audio', timeline.audio], ['text', timeline.text]];
    const selected = selection ? timeline[selection.track].find((item) => item.id === selection.id) : undefined;
    const selectedIndex = selection ? timeline[selection.track].findIndex((item) => item.id === selection.id) : -1;
    const selectedMedia = selected && 'mediaId' in selected && selected.mediaId ? timeline.media[selected.mediaId] : undefined;
    const previewText = timeline.text.find((item) => item.start === 0)?.text;

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
    const addText = () => {
        const seq = timeline.seq + 1;
        const item: TextClip = { id: `t${seq}`, text: 'Your title', start: 0, len: 90, x: 0.5, y: 0.85, size: 6 };
        applyTimeline({ ...timeline, schemaVersion: 2, seq, text: [...timeline.text, item] });
        setSelection({ track: 'text', id: item.id });
        setTab('adjust');
    };
    const updateSelectedText = (text: string) => {
        if (selection?.track !== 'text') return;
        applyTimeline({ ...timeline, text: timeline.text.map((item) => item.id === selection.id ? { ...item, text: text.slice(0, 120) } : item) });
    };

    return <View style={styles.screen}>
        <Stack.Screen options={{ title: t('editor.title'), headerRight: () => <HeaderAction label={t('editor.done')} onPress={done} /> }} />
        <View style={styles.topbar}>
            <View style={styles.titleGroup}><Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{name}</Text><Text accessibilityLiveRegion="polite" style={styles.status}>{saving ? t('editor.saving') : dirty ? t('editor.retry') : `${t('editor.saved')} · v${revision}`}</Text></View>
            {document.timeline ? <Pressable accessibilityRole="button" accessibilityLabel={t('editor.addText')} style={[styles.primary, touchTarget]} onPress={addText}><Text style={styles.primaryText}>+ {t('editor.text')}</Text></Pressable> : null}
        </View>
        {problem ? <Text accessibilityRole="alert" style={styles.problem}>{problem}</Text> : null}
        <View style={styles.previewFrame}>
            <View style={[styles.canvas, { aspectRatio: canvas.aspect_ratio === '9:16' ? 9 / 16 : canvas.aspect_ratio === '1:1' ? 1 : 16 / 9 }]}>
                <Text style={styles.previewMark}>V</Text>
                <Text style={styles.previewLabel}>{timeline.video.length ? `${timeline.video.length} ${t('editor.videoClips')}` : t('editor.previewEmpty')}</Text>
                {previewText ? <Text style={styles.previewCaption}>{previewText}</Text> : null}
            </View>
        </View>
        <View accessibilityRole="tablist" style={styles.tabs}>{tabs.map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} accessibilityLabel={t(`editor.tab.${item}`)} style={[styles.tab, tab === item && styles.tabActive, touchTarget]} onPress={() => setTab(item)}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{t(`editor.tab.${item}`)}</Text></Pressable>)}</View>
        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
            {tab === 'media' ? <>
                <Text style={styles.sectionTitle}>{t('editor.media')}</Text>
                {Object.values(timeline.media).length ? Object.values(timeline.media).map((item) => <View key={item.id} style={styles.mediaRow}><View><Text style={styles.rowTitle}>{item.name || t('editor.untitledMedia')}</Text><Text style={styles.muted}>{item.kind || t('editor.media')} · {seconds(item.frames, timeline.fps)}</Text></View></View>) : <Text style={styles.empty}>{t('editor.mediaEmpty')}</Text>}
            </> : null}
            {tab === 'preview' ? <>
                <Text style={styles.sectionTitle}>{t('editor.preview')}</Text>
                <Text style={styles.body}>{t('editor.nativeSummary')}</Text>
                <View style={styles.metrics}><Metric label={t('editor.duration')} value={seconds(Math.max(0, ...timeline.video.map((clip) => (clip.start ?? 0) + (clip.len ?? 0))), timeline.fps)} /><Metric label={t('editor.shape')} value={canvas.aspect_ratio} /><Metric label={t('editor.rate')} value={`${canvas.frame_rate} fps`} /></View>
            </> : null}
            {tab === 'timeline' ? <>
                <Text style={styles.sectionTitle}>{t('editor.timeline')}</Text>
                {allTracks.map(([track, items]) => <View key={track} style={styles.track}><Text style={styles.trackLabel}>{t(`editor.track.${track}`)}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clips}>{items.length ? items.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${t(`editor.track.${track}`)} ${item.id}`} style={[styles.clip, selection?.track === track && selection.id === item.id && styles.clipSelected, touchTarget]} onPress={() => setSelection({ track, id: item.id })}><Text style={styles.clipTitle} numberOfLines={1}>{track === 'text' ? (item as TextClip).text : timeline.media[(item as Clip).mediaId || '']?.name || item.id}</Text><Text style={styles.clipMeta}>{seconds(item.len, timeline.fps)}</Text></Pressable>) : <Text style={styles.trackEmpty}>{t('editor.trackEmpty')}</Text>}</ScrollView></View>)}
                {selection ? <View style={styles.actions}><Action label={t('editor.moveLeft')} disabled={selectedIndex <= 0} onPress={() => moveSelection(-1)} /><Action label={t('editor.moveRight')} disabled={selectedIndex >= timeline[selection.track].length - 1} onPress={() => moveSelection(1)} /><Action label={t('editor.remove')} danger onPress={removeSelection} /></View> : null}
            </> : null}
            {tab === 'adjust' ? <>
                <Text style={styles.sectionTitle}>{selection ? selectedMedia?.name || t(`editor.track.${selection.track}`) : t('editor.projectSettings')}</Text>
                {selection?.track === 'text' && selected && 'text' in selected ? <LabeledInput label={t('editor.text')} value={selected.text} onChangeText={updateSelectedText} /> : null}
                <LabeledInput label={t('editor.brief')} value={document.brief || ''} multiline onChangeText={(brief) => markDocument({ ...document, brief: brief.slice(0, 6000) })} />
                <Text style={styles.fieldLabel}>{t('editor.shape')}</Text><View style={styles.choices}>{(['16:9', '9:16', '1:1'] as const).map((value) => <Choice key={value} label={value} selected={canvas.aspect_ratio === value} onPress={() => updateCanvas({ aspect_ratio: value })} />)}</View>
                <Text style={styles.fieldLabel}>{t('editor.rate')}</Text><View style={styles.choices}>{([24, 25, 30, 60] as const).map((value) => <Choice key={value} label={`${value}`} selected={canvas.frame_rate === value} onPress={() => updateCanvas({ frame_rate: value })} />)}</View>
            </> : null}
        </ScrollView>
        <Modal visible={privacyNotice} transparent animationType="fade" onRequestClose={acknowledgePrivacy} accessibilityViewIsModal><View style={styles.noticeBackdrop}><View style={styles.noticeCard}><Text accessibilityRole="header" style={styles.noticeTitle}>{t('editor.privacyTitle')}</Text><Text style={styles.body}>{t('editor.privacySummary')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('editor.privacyConfirm')} style={[styles.primary, touchTarget]} onPress={acknowledgePrivacy}><Text style={styles.primaryText}>{t('editor.privacyConfirm')}</Text></Pressable></View></View></Modal>
    </View>;
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.muted}>{label}</Text></View>; }
function Action({ label, onPress, disabled = false, danger = false }: { label: string; onPress(): void; disabled?: boolean; danger?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} style={[styles.action, touchTarget, disabled && styles.disabled]} onPress={onPress}><Text style={[styles.actionText, danger && styles.danger]}>{label}</Text></Pressable>; }
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={[styles.choice, touchTarget, selected && styles.choiceSelected]} onPress={onPress}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>; }
function LabeledInput({ label, value, multiline = false, onChangeText }: { label: string; value: string; multiline?: boolean; onChangeText(value: string): void }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} multiline={multiline} maxLength={multiline ? 6000 : 120} style={[styles.input, multiline && styles.inputMultiline]} placeholderTextColor={colors.muted} onChangeText={onChangeText} /></View>; }

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
    topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, titleGroup: { flex: 1 }, title: { color: colors.text, fontFamily: fonts.display, fontSize: 20 }, status: { color: colors.muted, fontSize: 12, marginTop: 2 },
    primary: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accent, paddingHorizontal: 14 }, primaryText: { color: colors.accentInk, fontWeight: '800' }, problem: { color: colors.danger, paddingHorizontal: 16, paddingVertical: 8 },
    previewFrame: { padding: 12, alignItems: 'center', backgroundColor: colors.surface }, canvas: { width: '100%', maxHeight: 250, minHeight: 178, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: '#050506' }, previewMark: { color: '#3ee6c4', fontFamily: fonts.displayHeavy, fontSize: 64, opacity: 0.28 }, previewLabel: { color: '#f2f2f3', fontSize: 14 }, previewCaption: { position: 'absolute', bottom: 18, maxWidth: '84%', color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 5 },
    tabs: { flexDirection: 'row', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background }, tab: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' }, tabActive: { borderBottomColor: colors.accent }, tabText: { color: colors.muted, fontSize: 13, fontWeight: '700' }, tabTextActive: { color: colors.accent },
    panel: { flex: 1 }, panelContent: { padding: 16, paddingBottom: 40, gap: 14 }, sectionTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 22 }, body: { color: colors.body, fontSize: 15, lineHeight: 22 }, muted: { color: colors.muted, fontSize: 13 }, empty: { color: colors.muted, padding: 22, textAlign: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 14 },
    metrics: { flexDirection: 'row', gap: 10 }, metric: { flex: 1, gap: 3, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, metricValue: { color: colors.text, fontSize: 16, fontWeight: '800' },
    mediaRow: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, track: { gap: 7 }, trackLabel: { color: colors.body, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }, clips: { gap: 8, minHeight: 56, alignItems: 'center' }, clip: { width: 138, minHeight: 54, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, clipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, clipTitle: { color: colors.text, fontSize: 13, fontWeight: '700' }, clipMeta: { color: colors.muted, fontSize: 11, marginTop: 3 }, trackEmpty: { color: colors.muted, paddingVertical: 16 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, action: { justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong }, actionText: { color: colors.text, fontSize: 13, fontWeight: '700' }, danger: { color: colors.danger }, disabled: { opacity: 0.4 },
    field: { gap: 7 }, fieldLabel: { color: colors.body, fontSize: 13, fontWeight: '700' }, input: { minHeight: 48, color: colors.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface }, inputMultiline: { minHeight: 110, textAlignVertical: 'top' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minWidth: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 12 }, choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, choiceText: { color: colors.body, fontWeight: '700' }, choiceTextSelected: { color: colors.accent },
    noticeBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.72)' }, noticeCard: { gap: 14, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, noticeTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
