import type { DocumentApplyResult } from '../../lib/editorDocumentGate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { Button, Chip, Icon, Text } from '../ui';
import { brandText } from '../BrandText';
import { studioColors as colors } from '../../theme';
import { ApiError, type ApiClient } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { createConsentGate } from '../../lib/aiConsent';
import { secureStorage } from '../../lib/aiConsentStore';
import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { editorImportHasSpace } from '../../lib/editorImportSpace';
import { probeDuration } from '../../lib/editorMediaDuration';
import { libraryMedia } from '../../lib/editorLibraryLength';
import type { LibraryChoice } from '../../lib/librarySource';
import { LibraryChooser } from '../LibraryChooser';
import { JobThumb, useAssetLinks } from '../JobThumb';
import { fetchSpeechQuote, speechMessage, type SpeechQuote } from '../../lib/speechAnalysis';
import { BEST_CUT_MAX_SECONDS, createBestCutFlow, bestCutPrice, type BestCutClip, type BestCutProgress } from '../../lib/bestCutFlow';
import { bestCutProjectClips } from '../../lib/bestCutProjectClips';
import { bestCutWarningKey, buildBestCutPlanResult, type BestCutPlan, type BestCutPreset } from '../../lib/bestCutPlan';
import { bestCutOutputPlans, musicVideoPlan } from '../../lib/bestCutOutputs';
import { applyBestCut, bestCutBefore } from '../../lib/applyBestCut';
import type { Timeline } from '../../lib/nativeEditorModel';
import { createProject as createEditorProject, getDocument, putDocument } from '../../lib/editorProjects';
import { fetchProject } from '../../lib/projects';
import { validateAgentTimeline } from '../../lib/editorAgentOperations';
import { t, plural, rawText } from '../../lib/i18n';
import { BestCutSettings } from './BestCutSettings';
import type { BestCutSettings as Settings } from '../../lib/bestCutSettings';
import { KeyboardScreen } from '../KeyboardScreen';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
import { PlaybackPreview } from './EditorPlayback';
import { createFrameStore } from './editorFrameStore';
type Result = { timeline: Timeline; before: Timeline; plan: BestCutPlan | null; uris: Record<string, string>; captionsOmitted?: boolean; refunded?: number };
type Props = { api: ApiClient; projectId: string; quote: SpeechQuote | null; timeline?: Timeline; localMediaUris?: Record<string, string>; initialNotes?: string; onClose(): void; onOpenBatch?(): void; onApply(result: Result): DocumentApplyResult };
type LocalVideo = { uri: string; size?: number | null; durationSeconds?: number | null; mimeType?: string | null; name?: string | null; width?: number | null; height?: number | null };
const messageParameters = (parameters: Readonly<Record<string, unknown>>): Record<string, string | number> => {
    const values: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(parameters)) if (typeof value === 'string' || typeof value === 'number') values[key] = value;
    return values;
};
export function BestCutSheet({ api, projectId, quote: initialQuote, timeline, localMediaUris = {}, initialNotes = '', onClose, onOpenBatch, onApply }: Props) {
    const insets = useSafeAreaInsets();
    const links = useAssetLinks(api);
    const [account] = useState(() => getCacheUser() || '');
    const [flow] = useState(() => createBestCutFlow(api, account, randomUUID));
    const [consentGate] = useState(() => { const gate = createConsentGate(secureStorage, 'best-cut-2026-11-v1'); gate.setUser(account); return gate; });
    const [clips, setClips] = useState<BestCutClip[]>([]), [libraryOpen, setLibraryOpen] = useState(false);
    const [quote, setQuote] = useState(initialQuote), [balance, setBalance] = useState<number | null>(null);
    const [script, setScript] = useState(''), [notes, setNotes] = useState(initialNotes), [preset, setPreset] = useState<BestCutPreset>('balanced');
    const [shape, setShape] = useState<Timeline['aspect']>(timeline?.aspect || '9:16');
    const [musicVideo, setMusicVideo] = useState(false), [multipleReels, setMultipleReels] = useState(false), [outputCount, setOutputCount] = useState(2);
    const [notifyWhenReady, setNotifyWhenReady] = useState(false), [notificationMessage, setNotificationMessage] = useState('');
    const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [settings, setSettings] = useState<Settings>({ captions: true, language: 'auto' });
    const [progress, setProgress] = useState<BestCutProgress>({ phase: 'ready', index: 0, fraction: 0, refunded: 0 });
    const [interrupted, setInterrupted] = useState<'cancelled' | null>(null);
    const [result, setResult] = useState<Result | null>(null), [applyBlocked, setApplyBlocked] = useState(false);
    const [scriptOpen, setScriptOpen] = useState(false), [notesOpen, setNotesOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
    const [previewStore] = useState(createFrameStore);
    const abort = useRef(new AbortController()), mounted = useRef(true), working = useRef(false);
    const projectSeeded = useRef(false), clipsChanged = useRef(false);
    const [close] = useState(() => onClose);
    const live = useCallback(() => mounted.current && getCacheUser() === account, [account]);
    const onSettingsChange = useCallback((value: Settings) => { setSettings(value); if (!applyBlocked) setResult(null); }, [applyBlocked]);
    useEffect(() => {
        mounted.current = true;
        void consentGate.hasAgreed().then(value => { if (live()) setConsent(value); });
        void api.getBalance().then(value => { if (live()) setBalance(value.balance); }).catch(() => {});
        const off = subscribeCacheUser(() => { abort.current.abort(); void consentGate.forget(); close(); });
        return () => { mounted.current = false; abort.current.abort(); off(); };
    }, [api, consentGate, close, live]);
    useEffect(() => {
        if (!timeline?.video.length || projectSeeded.current) return;
        projectSeeded.current = true;
        let active = true;
        void editorDeviceMedia.files(projectId).then(files => {
            if (!active || !live() || clipsChanged.current) return;
            const seeded = bestCutProjectClips(timeline, files);
            if (seeded.length) setClips(seeded);
        }).catch(() => {});
        return () => { active = false; };
    }, [live, projectId, timeline]);
    const editClips = (next: BestCutClip[]) => { clipsChanged.current = true; setClips(next); setResult(null); setProgress({ phase: 'ready', index: 0, fraction: 0, refunded: 0 }); };
    async function importLocalVideos(assets: LocalVideo[]) {
        const pickedAssets = assets.slice(0, 10 - clips.length);
        const pickedBytes = pickedAssets.reduce((total, asset) => total + (typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size > 0 ? asset.size : 0), 0);
        if (!editorImportHasSpace(pickedBytes)) { setMessage(t('editorClips.spaceError')); return; }
        const next = [...clips];
        for (const asset of pickedAssets) {
            if (asset.size && asset.size > 100 * 1024 * 1024) throw new ApiError(400, 'source_too_large', { size_mb: Math.round(asset.size / 104857.6) / 10, max_mb: 100 });
            const duration = asset.durationSeconds || await probeDuration(asset.uri);
            if (!duration || duration < .5 || duration > BEST_CUT_MAX_SECONDS) throw new ApiError(400, 'source_too_long');
            const id = `l-${randomUUID()}`;
            const type = asset.mimeType || (/\.mov(?:\?|$)/i.test(asset.name || asset.uri) ? 'video/quicktime' : 'video/mp4');
            if (!['video/mp4', 'video/quicktime'].includes(type)) throw new ApiError(400, 'source_unreadable');
            // Copy only: never call preparePicked(), which automatically creates a project backup.
            const file = await editorDeviceMedia.copy(projectId, id, asset.uri, type, duration);
            if (!live()) return;
            if (!file) throw new ApiError(400, 'source_unreadable');
            if (file.size > 100 * 1024 * 1024) throw new ApiError(400, 'source_too_large', { size_mb: Math.round(file.size / 104857.6) / 10, max_mb: 100 });
            const media = { id, kind: 'video' as const, name: (asset.name || t('bestCut.camera')).slice(0, 60), frames: Math.floor(duration * 30), hasAudio: true, width: Math.max(0, Math.min(16384, Math.round(asset.width || 0))), height: Math.max(0, Math.min(16384, Math.round(asset.height || 0))) };
            if (validateAgentTimeline(bestCutBefore([...next.map(c => c.media), media]))) throw new ApiError(400, 'source_unsupported');
            next.push({ media, duration, file });
        }
        if (live()) editClips(next);
    }
    async function pick() {
        if (working.current || clips.length >= 10) return;
        working.current = true; setBusy(true); setMessage('');
        try {
            const picked = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['videos'], allowsMultipleSelection: true, selectionLimit: 10 - clips.length,
                // Preserve the camera-roll asset byte-for-byte. Best Cut copies it into the project store; it never
                // needs an ImagePicker compatibility transcode before analysis or editing.
                videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
            });
            if (picked.canceled || !live()) return;
            await importLocalVideos(picked.assets.map(asset => ({ uri: asset.uri, size: asset.fileSize, durationSeconds: asset.duration ? asset.duration / 1000 : null, mimeType: asset.mimeType, name: asset.fileName, width: asset.width, height: asset.height })));
        } catch (error) { if (live()) setMessage(speechMessage(error)); }
        finally { working.current = false; if (live()) setBusy(false); }
    }
    async function pickFiles() {
        if (working.current || clips.length >= 10) return;
        working.current = true; setBusy(true); setMessage('');
        try {
            const picked = await DocumentPicker.getDocumentAsync({ type: ['video/mp4', 'video/quicktime'], multiple: true, copyToCacheDirectory: true });
            if (picked.canceled || !live()) return;
            await importLocalVideos(picked.assets.map(asset => ({ uri: asset.uri, size: asset.size, mimeType: asset.mimeType, name: asset.name })));
        } catch (error) { if (live()) setMessage(speechMessage(error)); }
        finally { working.current = false; if (live()) setBusy(false); }
    }
    async function select(choice: LibraryChoice) {
        if (working.current || clips.length >= 10 || clips.some(c => c.media.id === `j-${choice.jobId}`)) return;
        working.current = true; setBusy(true);
        try {
            const media = await libraryMedia(api, choice, 'video'); if (!live()) return;
            if (!media || !media.frames || media.frames > BEST_CUT_MAX_SECONDS * 30) throw new ApiError(400, 'source_too_long');
            editClips([...clips, { media, duration: media.frames / 30, source: { type: 'job', jobId: choice.jobId } }]); setLibraryOpen(false);
        } catch (error) { if (live()) setMessage(speechMessage(error)); }
        finally { working.current = false; if (live()) setBusy(false); }
    }
    const before = () => bestCutBefore(clips.map(c => c.media));
    const uris = () => Object.fromEntries(clips.flatMap(c => c.file ? [[c.media.id, c.file.file]] : []));
    const effectivePreset = (): BestCutPreset => {
        const direction = notes.toLowerCase();
        if (/shorter|strongest|snappy/.test(direction)) return 'punchy';
        if (/longer|more context|calmer|less expressive|relaxed/.test(direction)) return 'educational';
        if (/more visual|visually strong|reaction/.test(direction)) return 'vlog';
        return preset;
    };
    const enableReadyNotification = async () => {
        try {
            const permission = await Notifications.requestPermissionsAsync();
            if (!live()) return;
            setNotifyWhenReady(permission.granted);
            setNotificationMessage(permission.granted ? 'We’ll let you know when this AI Edit is ready.' : 'Notifications are off. You can enable them later in Settings.');
        } catch { if (live()) setNotificationMessage('Notifications are unavailable on this device.'); }
    };
    const notifyReady = async () => {
        if (!notifyWhenReady) return;
        await Notifications.scheduleNotificationAsync({ content: { title: 'Your AI Edit is ready', body: 'Open Veyrnox to review your best cut.', data: { path: `/editor/${projectId}` } }, trigger: null }).catch(() => undefined);
    };
    const saveAdditionalReels = async (timelines: readonly Timeline[]) => {
        if (!timelines.length) return;
        const sourceProject = await fetchProject(api, projectId);
        if (!sourceProject?.workspaceId) throw new ApiError(404, 'unavailable');
        for (const [index, outputTimeline] of timelines.entries()) {
            const created = await createEditorProject(api, sourceProject.workspaceId, `Best Cut Reel ${index + 2}`, randomUUID());
            for (const clip of clips) {
                if (!clip.file) continue;
                const copied = await editorDeviceMedia.copy(created.id, clip.media.id, clip.file.file, clip.file.type, clip.duration);
                if (!copied) throw new ApiError(503, 'source_unreadable');
            }
            const head = await getDocument(api, created.id);
            await putDocument(api, created.id, head.revision, {
                ...head.document,
                schema_version: 3,
                project_id: created.id,
                timeline: outputTimeline,
                canvas: { aspect_ratio: shape === 'source' ? '16:9' : shape, frame_rate: outputTimeline.fps },
            }, randomUUID());
        }
    };
    async function run() {
        if (working.current || applyBlocked) return; working.current = true; setBusy(true); setMessage(''); setResult(null); setInterrupted(null); abort.current = new AbortController();
        try {
            if (!quote) { setMessage(t('editorSpeech.unavailable')); return; }
            consentGate.setPrompter(async () => consent); await consentGate.ensure('/api/v1/editor/speech-analyses', 'POST');
            // Fail before upload or charge if the source timeline would not be valid for the editor.
            if (validateAgentTimeline(before())) throw new ApiError(400, 'source_unsupported');
            const currentBalance = await api.getBalance(); if (!live()) return; setBalance(currentBalance.balance);
            const output = await flow.run(clips, quote, abort.current.signal, value => { if (live()) setProgress(value); }, settings.language);
            if (!live()) return;
            if (!output.inputs.length && !musicVideo) return;
            const inputs = musicVideo ? clips.map(clip => output.inputs.find(input => input.mediaId === clip.media.id) ?? ({ mediaId: clip.media.id, analysis: {
                version: 1 as const, assetId: clip.media.id, duration: clip.duration, provider: 'fal-scribe-v2' as const,
                transcript: '', language: 'und', chunks: [{ start: 0, end: Math.min(.1, clip.duration), text: 'music' }],
            } })) : output.inputs;
            const musicPlan = musicVideo ? musicVideoPlan(inputs) : null;
            const planned = musicPlan ? { ok: true as const, plan: musicPlan } : buildBestCutPlanResult(inputs, script, effectivePreset());
            if (!planned.ok) {
                setMessage(planned.code === 'unit_exceeds_budget'
                    ? t('app.smartCut.error.unitExceedsBudget', messageParameters(planned.parameters))
                    : t('bestCut.noChange'));
                return;
            }
            const plan = planned.plan;
            plan.droppedClips = output.silent.length;
            const original = before();
            const plans = bestCutOutputPlans(plan, inputs, multipleReels ? outputCount : 1);
            const compiled = plans.map(outputPlan => ({ plan: outputPlan, value: applyBestCut(original, outputPlan, inputs, musicVideo ? false : settings.captions) }))
                .filter((entry): entry is { plan: BestCutPlan; value: NonNullable<ReturnType<typeof applyBestCut>> } => !!entry.value);
            if (!compiled.length) { setMessage(t('bestCut.noChange')); return; }
            await saveAdditionalReels(compiled.slice(1).map(entry => ({ ...entry.value.timeline, aspect: shape })));
            const primary = compiled[0];
            const value = { before: original, timeline: { ...primary.value.timeline, aspect: shape }, plan: primary.plan, uris: uris(), captionsOmitted: primary.value.captionsOmitted, refunded: output.refunded };
            void notifyReady();
            if (primary.value.captionsOmitted) setMessage(t('bestCut.captionsOmitted'));
            if (primary.plan.warnings.includes('output_limit_reached')) setResult(value);
            else apply(value);
        } catch (error) {
            if (!live()) return;
            if (error instanceof ApiError && error.code === 'cancelled') { setInterrupted('cancelled'); return; } // Cancel is a choice, not a failure.
            setMessage(speechMessage(error));
            if (error instanceof ApiError && error.code === 'price_changed') {
                const next = await fetchSpeechQuote(api, abort.current.signal, true).catch(() => null);
                if (next && live()) { setQuote(next); setProgress(value => ({ ...value, prices: undefined })); } // A new button tap explicitly reconfirms.
            }
        } finally { working.current = false; if (live()) setBusy(false); }
    }
    const price = quote ? bestCutPrice(quote, clips.length, balance ?? 0, progress.prices) : { total: 0, remaining: balance ?? 0, maximum: false };
    const apply = (value: Result) => {
        const outcome = onApply(value);
        if (outcome.status === 'accepted') { onClose(); return; }
        setResult(value); setApplyBlocked(true);
        if (outcome.status === 'refused') setMessage(t(`editorEditGate.${outcome.reason}`));
        else if (outcome.status === 'stale') setMessage(t('bestCut.stale'));
    };
    const locked = busy || applyBlocked;
    const contentInsets = { paddingTop: 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16, paddingBottom: insets.bottom + 16 };
    const seconds = Math.round(clips.reduce((n, c) => n + c.duration, 0));
    const closeSheet = () => { abort.current.abort(); onClose(); };
    return <Modal visible animationType="slide" onRequestClose={() => { abort.current.abort(); onClose(); }}><View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}><KeyboardScreen><KeyboardFormScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ gap: 16 }, contentInsets]}>
        <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('bestCut.close'))} onPress={closeSheet} style={styles.headerButton}><Icon name="close" size={24} tint={colors.text} /></Pressable>
            <Text variant="title3">AI Edit</Text>
            {onOpenBatch ? <Pressable accessibilityRole="button" accessibilityLabel="Batch AI Edit" onPress={() => { abort.current.abort(); onOpenBatch(); }} style={styles.batchAction}><Text variant="bodyStrong" tone="accent">Batch AI Edit</Text></Pressable> : <View style={styles.headerButton} />}
        </View>
        <View style={styles.heroPreview}>
            {timeline?.video.length ? <PlaybackPreview frameStore={previewStore} timeline={timeline} api={api} playing={false} localMediaUris={localMediaUris} staticPreview compositionFrame={false} />
                : <View style={styles.emptyPreview}><Icon name="sparkle" size={40} tint={colors.accent} /><Text tone="secondary">{t('bestCut.intro')}</Text></View>}
        </View>
        <View style={styles.heroCopy}><Text variant="title1" style={styles.heroTitle}>Your <Text variant="title1" tone="accent">best cut</Text>, in one tap</Text><Text tone="secondary">Cuts mistakes, silences and retakes.</Text></View>

        <View style={styles.statusCard}>
            <View style={styles.balanceHero}><Text style={styles.balanceNumber}>{balance ?? '—'}</Text><Text variant="bodyStrong" tone="secondary">credits ready</Text></View>
            <View style={styles.statusRule} />
            <View style={styles.metrics}>
                <View style={styles.metric}><Text variant="bodyStrong">{clips.length}</Text><Text variant="caption" tone="secondary">source{clips.length === 1 ? '' : 's'}</Text></View>
                <View style={styles.metric}><Text variant="bodyStrong">{seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '0:00'}</Text><Text variant="caption" tone="secondary">length</Text></View>
                <View style={styles.metric}><Text variant="bodyStrong">~{Math.max(1, Math.ceil(seconds / 120))} min</Text><Text variant="caption" tone="secondary">ready in</Text></View>
            </View>
            {quote ? <Text variant="caption" tone="secondary">{price.maximum ? t('bestCut.priceMax', { n: clips.length, price: quote.credits, total: price.total }) : t('bestCut.priceExact', { total: price.total })}</Text> : null}
            {balance !== null && price.maximum && balance < price.total ? <Text accessibilityLiveRegion="polite" tone="warning">{t('editorAi.balance')}</Text> : null}
        </View>

        <View style={styles.sourceCard}>
            <View style={styles.sectionHeading}><View><Text variant="bodyStrong">Source videos</Text><Text variant="caption" tone="secondary">{plural('bestCut.clips', clips.length)} · {t('bestCut.seconds', { n: seconds })}</Text></View><Text variant="caption" tone="secondary">10 max</Text></View>
            {clips.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clipStrip}>{clips.map((c, i) => <View key={c.media.id} style={styles.clipPill}>{c.media.id.startsWith('j-') ? <JobThumb links={links} jobId={c.media.id.slice(2)} /> : <Icon name="video" size={20} tint={colors.accent} />}<View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} variant="caption">{c.media.name || `Video ${i + 1}`}</Text>{progress.prices?.[i]?.cached ? <Text variant="caption" tone="secondary">{t('bestCut.cached')}</Text> : null}</View><Button iconOnly size="sm" variant="tertiary" icon="close" label={t('bestCut.remove')} onPress={() => editClips(clips.filter(v => v !== c))} disabled={locked} /></View>)}</ScrollView> : <Text variant="caption" tone="secondary">Add the raw takes you want AI Edit to compare.</Text>}
            <View style={styles.iconActions}>
                <SourceAction icon="image" label={t('bestCut.camera')} disabled={locked || clips.length >= 10} onPress={() => void pick()} />
                <SourceAction icon="folder" label={t('bestCut.files')} disabled={locked || clips.length >= 10} onPress={() => void pickFiles()} />
                <SourceAction icon="film" label={t('bestCut.library')} disabled={locked || clips.length >= 10} onPress={() => setLibraryOpen(true)} />
            </View>
        </View>

        <View style={styles.quickActions}>
            <DisclosureAction icon="listChecks" label={t('bestCut.script')} active={scriptOpen || !!script} onPress={() => setScriptOpen(value => !value)} />
            <DisclosureAction icon="chatText" label={t('bestCut.notes')} active={notesOpen || !!notes} onPress={() => setNotesOpen(value => !value)} />
        </View>
        {scriptOpen ? <View style={styles.inputCard}><Text variant="bodyStrong">{t('bestCut.script')}</Text><TextInput multiline editable={!locked} accessibilityLabel={t('bestCut.script')} placeholder="Paste what you intended to say" placeholderTextColor={colors.muted} style={styles.input} value={script} onChangeText={value => { setScript(value); setResult(null); }} maxLength={20000} /></View> : null}
        {notesOpen ? <View style={styles.inputCard}><Text variant="bodyStrong">{t('bestCut.notes')}</Text><TextInput multiline editable={!locked} accessibilityLabel={t('bestCut.notes')} placeholder="Tell AI Edit what to keep or avoid" placeholderTextColor={colors.muted} style={styles.input} value={notes} onChangeText={setNotes} maxLength={2000} /><Text variant="caption" tone="secondary">{t('bestCut.localNotes')}</Text></View> : null}

        <Pressable accessibilityRole="button" accessibilityLabel="More AI Edit settings" onPress={() => setSettingsOpen(value => !value)} style={styles.settingsToggle}><Icon name="sliders" size={24} tint={colors.accent} /><Text variant="bodyStrong" tone="accent">More AI Edit settings</Text><Icon name={settingsOpen ? 'caretDown' : 'caretRight'} size={20} tint={colors.accent} /></Pressable>
        {settingsOpen ? <View style={styles.settingsCard}>
            <View style={styles.settingSwitch}><View style={styles.settingCopy}><Text variant="bodyStrong">Music Video</Text><Text variant="caption" tone="secondary">Keep each imported performance as a complete musical section. Speech edits and captions are off.</Text></View><Switch accessibilityLabel="Music Video" disabled={locked} value={musicVideo} onValueChange={value => { setMusicVideo(value); setResult(null); }} /></View>
            <View style={styles.settingSwitch}><View style={styles.settingCopy}><Text variant="bodyStrong">Multiple Reels</Text><Text variant="caption" tone="secondary">Turn the strongest moments into separate short-form projects.</Text></View><Switch accessibilityLabel="Multiple Reels" disabled={locked} value={multipleReels} onValueChange={value => { setMultipleReels(value); setResult(null); }} /></View>
            {multipleReels ? <><Text variant="bodyStrong">Videos from this recording</Text><View style={styles.optionRow}>{([2, 3, 4, 5] as const).map(value => <Chip disabled={locked} key={value} label={String(value)} selected={outputCount === value} onPress={() => { setOutputCount(value); setResult(null); }} />)}</View></> : null}
            <Text variant="bodyStrong">Editing style</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{(['balanced', 'vlog', 'educational', 'punchy', 'steps'] as const).map(p => <Chip disabled={locked} key={p} label={t(`bestCut.${p}`)} selected={p === preset} onPress={() => { if (!locked) { setPreset(p); setResult(null); } }} />)}</ScrollView>
            <Text variant="bodyStrong">Video shape</Text><View style={styles.optionRow}>{(['source', '9:16', '16:9', '1:1', '4:5'] as const).map(value => <Chip disabled={locked} key={value} label={value === 'source' ? 'Original' : value} selected={shape === value} onPress={() => { setShape(value); setResult(null); }} />)}</View>
            <Text variant="bodyStrong">Pauses between cuts</Text><View style={styles.optionRow}>
                <Chip disabled={locked} label="Snappy" selected={preset === 'punchy'} onPress={() => { setPreset('punchy'); setResult(null); }} />
                <Chip disabled={locked} label="Natural" selected={preset === 'balanced'} onPress={() => { setPreset('balanced'); setResult(null); }} />
                <Chip disabled={locked} label="Relaxed" selected={preset === 'educational'} onPress={() => { setPreset('educational'); setResult(null); }} />
            </View>
            {!musicVideo ? <BestCutSettings disabled={locked} showTitle={false} onChange={onSettingsChange} /> : null}
            <Text variant="caption" tone="secondary">The selected shape is applied to the editor canvas with the generated cut.</Text>
        </View> : null}

        <View style={styles.consentCard}><View style={{ flex: 1, gap: 4 }}><Text variant="bodyStrong">{t('bestCut.agree')}</Text><Text variant="caption" tone="secondary">{brandText(t('bestCut.consent'))}</Text></View><Switch accessibilityLabel={rawText(t('bestCut.agree'))} disabled={locked} value={consent} onValueChange={setConsent} /></View>
        {busy ? <View style={styles.progressCard}><View style={styles.progressRing}><ActivityIndicator color={colors.accent} size="large" /><Text style={styles.progressPercent}>{Math.round(progress.fraction * 100)}%</Text></View><Text variant="title3">Creating your best cut</Text><Text accessibilityLiveRegion="polite" tone="secondary">{t(`bestCut.${progress.phase}`, { n: progress.index + 1, percent: Math.round(progress.fraction * 100) })}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(8, Math.round(progress.fraction * 100))}%` }]} /></View>
            <Button variant="secondary" label={notifyWhenReady ? 'Notification enabled' : 'Know When It’s Ready'} disabled={notifyWhenReady} onPress={() => void enableReadyNotification()} />
            <Button variant="tertiary" label="Pause and add notes" onPress={() => { abort.current.abort(); setNotesOpen(true); }} />
            <Button variant="tertiary" label={t('bestCut.cancel')} onPress={() => abort.current.abort()} /></View> : null}
        {!busy && interrupted === 'cancelled' ? <View style={styles.interruptedCard}><Text variant="bodyStrong">AI Edit paused</Text><Text variant="caption" tone="secondary">Restart with the same settings, add notes first, or discard this attempt. You won’t be charged again for cached analysis.</Text><Button label="Restart AI Edit" onPress={() => void run()} /><Button variant="secondary" label="Add notes" onPress={() => setNotesOpen(true)} /><Button variant="tertiary" label="Discard attempt" onPress={() => { setInterrupted(null); setProgress({ phase: 'ready', index: 0, fraction: 0, refunded: 0 }); setMessage(''); }} /></View> : null}
        {notificationMessage ? <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">{notificationMessage}</Text> : null}
        {progress.refunded > 0 ? <Text>{t('bestCut.refunded', { n: progress.refunded })}</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
        {progress.phase === 'no-speech' && !result ? <><Text>{t('bestCut.noSpeech')}</Text><Button label={t('bestCut.chooseAnother')} onPress={() => editClips([])} /><Button label={t('bestCut.tryAnyway')} onPress={() => {
            const original = before(); if (clips.reduce((n, c) => n + c.duration, 0) > BEST_CUT_MAX_SECONDS || validateAgentTimeline(original)) { setMessage(t('bestCut.tryLimit')); return; }
            apply({ before: original, timeline: original, plan: null, uris: uris() });
        }} /></> : result ? <>{result.plan ? <><Text>{t('bestCut.summary', { pauses: result.plan.removedPauses, retakes: result.plan.removedRetakes, matched: result.plan.matchedLines })}</Text>
            {result.plan.warnings.map(w => <Text key={w}>{t(bestCutWarningKey(w))}</Text>)}
            {!!result.plan.missingLines.length && <Text>{t('bestCut.missing', { lines: result.plan.missingLines.join(', ') })}</Text>}
            </> : null}<Button label={t('bestCut.apply')} onPress={() => apply(result)} /></> : <><Button label={t('bestCut.title')} accessibilityHint={!consent && !busy ? t('bestCut.needsAgree') : undefined} onPress={() => void run()} disabled={busy || !clips.length || !consent} style={styles.createButton}><Icon name="sparkle" size={24} tint={colors.accentInk} /><Text variant="bodyStrong" tone="onAccent">Create Best Cut</Text></Button>{!consent && !busy ? <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t('bestCut.needsAgree')}</Text> : null}</>}
        <Button variant="tertiary" label={t('bestCut.notNow')} onPress={closeSheet} />
    </KeyboardFormScrollView></KeyboardScreen></View>{libraryOpen ? <LibraryChooser api={api} kind="video" onClose={() => setLibraryOpen(false)} onPick={choice => { setLibraryOpen(false); void select(choice); }} /> : null}</Modal>;
}

function SourceAction({ icon, label, disabled, onPress }: { icon: 'image' | 'folder' | 'film'; label: string; disabled: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.sourceAction, disabled && styles.disabled, pressed && styles.pressed]}><Icon name={icon} size={24} tint={colors.accent} /><Text numberOfLines={2} variant="caption" style={styles.actionLabel}>{label}</Text></Pressable>;
}

function DisclosureAction({ icon, label, active, onPress }: { icon: 'listChecks' | 'chatText'; label: string; active: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} accessibilityState={{ expanded: active }} onPress={onPress} style={({ pressed }) => [styles.disclosure, active && styles.disclosureActive, pressed && styles.pressed]}><Icon name={icon} size={20} tint={colors.accent} /><Text variant="bodyStrong" tone="accent">{label.replace(' (optional)', '')}</Text></Pressable>;
}

const styles = StyleSheet.create({
    header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    batchAction: { minHeight: 44, minWidth: 96, alignItems: 'flex-end', justifyContent: 'center' },
    heroPreview: { height: 190, overflow: 'hidden', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: '#050506' },
    emptyPreview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
    heroCopy: { alignItems: 'center', gap: 6 },
    heroTitle: { textAlign: 'center' },
    statusCard: { gap: 14, padding: 18, borderRadius: 24, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
    balanceHero: { alignItems: 'center', gap: 3 },
    balanceNumber: { color: colors.accent, fontSize: 54, lineHeight: 58, fontWeight: '900', fontVariant: ['tabular-nums'] },
    statusRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
    metrics: { flexDirection: 'row' },
    metric: { flex: 1, alignItems: 'center', gap: 2 },
    sourceCard: { gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    clipStrip: { gap: 8 },
    clipPill: { width: 220, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.background },
    iconActions: { flexDirection: 'row', gap: 8 },
    sourceAction: { flex: 1, minHeight: 74, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 5, borderRadius: 14, backgroundColor: colors.background },
    actionLabel: { textAlign: 'center' },
    quickActions: { flexDirection: 'row', gap: 10 },
    disclosure: { flex: 1, minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    disclosureActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    inputCard: { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    input: { minHeight: 112, color: colors.text, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top', backgroundColor: colors.background },
    settingsToggle: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
    settingsCard: { gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    settingSwitch: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 },
    settingCopy: { flex: 1, gap: 3 },
    optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    consentCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.surface },
    progressCard: { alignItems: 'center', gap: 12, padding: 22, borderRadius: 22, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface },
    progressRing: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', borderRadius: 44, borderWidth: 7, borderColor: colors.accentSoft },
    progressPercent: { position: 'absolute', color: colors.text, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
    interruptedCard: { gap: 10, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    progressTrack: { width: '100%', height: 7, overflow: 'hidden', borderRadius: 999, backgroundColor: colors.background },
    progressFill: { height: '100%', borderRadius: 999, backgroundColor: colors.accent },
    createButton: { minHeight: 62, borderRadius: 31 },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.7 },
});
