import type { DocumentApplyResult } from '../../lib/editorDocumentGate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, TextInput, View, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Button, Chip, Text } from '../ui';
import { brandText } from '../BrandText';
import { colors } from '../../theme';
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
import { bestCutWarningKey, buildBestCutPlanResult, type BestCutPlan, type BestCutPreset } from '../../lib/bestCutPlan';
import { applyBestCut, bestCutBefore } from '../../lib/applyBestCut';
import type { Timeline } from '../../lib/nativeEditorModel';
import { validateAgentTimeline } from '../../lib/editorAgentOperations';
import { t, plural, rawText } from '../../lib/i18n';
import { BestCutSettings } from './BestCutSettings';
import type { BestCutSettings as Settings } from '../../lib/bestCutSettings';
import { KeyboardScreen } from '../KeyboardScreen';
import { KeyboardFormScrollView } from '../KeyboardFormScrollView';
type Result = { timeline: Timeline; before: Timeline; plan: BestCutPlan | null; uris: Record<string, string>; captionsOmitted?: boolean; refunded?: number };
type Props = { api: ApiClient; projectId: string; quote: SpeechQuote; onClose(): void; onApply(result: Result): DocumentApplyResult };
type LocalVideo = { uri: string; size?: number | null; durationSeconds?: number | null; mimeType?: string | null; name?: string | null; width?: number | null; height?: number | null };
const messageParameters = (parameters: Readonly<Record<string, unknown>>): Record<string, string | number> => {
    const values: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(parameters)) if (typeof value === 'string' || typeof value === 'number') values[key] = value;
    return values;
};
export function BestCutSheet({ api, projectId, quote: initialQuote, onClose, onApply }: Props) {
    const insets = useSafeAreaInsets();
    const links = useAssetLinks(api);
    const [account] = useState(() => getCacheUser() || '');
    const [flow] = useState(() => createBestCutFlow(api, account, randomUUID));
    const [consentGate] = useState(() => { const gate = createConsentGate(secureStorage, 'best-cut-2026-11-v1'); gate.setUser(account); return gate; });
    const [clips, setClips] = useState<BestCutClip[]>([]), [libraryOpen, setLibraryOpen] = useState(false);
    const [quote, setQuote] = useState(initialQuote), [balance, setBalance] = useState<number | null>(null);
    const [script, setScript] = useState(''), [notes, setNotes] = useState(''), [preset, setPreset] = useState<BestCutPreset>('balanced');
    const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [settings, setSettings] = useState<Settings>({ captions: true, language: 'auto' });
    const [progress, setProgress] = useState<BestCutProgress>({ phase: 'ready', index: 0, fraction: 0, refunded: 0 });
    const [result, setResult] = useState<Result | null>(null), [applyBlocked, setApplyBlocked] = useState(false);
    const abort = useRef(new AbortController()), mounted = useRef(true), working = useRef(false);
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
    const editClips = (next: BestCutClip[]) => { setClips(next); setResult(null); setProgress({ phase: 'ready', index: 0, fraction: 0, refunded: 0 }); };
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
    async function run() {
        if (working.current || applyBlocked) return; working.current = true; setBusy(true); setMessage(''); setResult(null); abort.current = new AbortController();
        try {
            consentGate.setPrompter(async () => consent); await consentGate.ensure('/api/v1/editor/speech-analyses', 'POST');
            // Fail before upload or charge if the source timeline would not be valid for the editor.
            if (validateAgentTimeline(before())) throw new ApiError(400, 'source_unsupported');
            const currentBalance = await api.getBalance(); if (!live()) return; setBalance(currentBalance.balance);
            const output = await flow.run(clips, quote, abort.current.signal, value => { if (live()) setProgress(value); }, settings.language);
            if (!live()) return;
            if (!output.inputs.length) return;
            const inputs = output.inputs;
            const planned = buildBestCutPlanResult(inputs, script, preset);
            if (!planned.ok) {
                setMessage(planned.code === 'unit_exceeds_budget'
                    ? t('app.smartCut.error.unitExceedsBudget', messageParameters(planned.parameters))
                    : t('bestCut.noChange'));
                return;
            }
            const plan = planned.plan;
            plan.droppedClips = output.silent.length;
            const original = before();
            const compiled = applyBestCut(original, plan, inputs, settings.captions);
            if (!compiled) { setMessage(t('bestCut.noChange')); return; }
            const value = { before: original, timeline: compiled.timeline, plan, uris: uris(), captionsOmitted: compiled.captionsOmitted, refunded: output.refunded };
            if (compiled.captionsOmitted) setMessage(t('bestCut.captionsOmitted'));
            if (plan.warnings.includes('output_limit_reached')) setResult(value);
            else apply(value);
        } catch (error) {
            if (!live()) return;
            if (error instanceof ApiError && error.code === 'cancelled') return; // Cancel is a choice, not a failure.
            setMessage(speechMessage(error));
            if (error instanceof ApiError && error.code === 'price_changed') {
                const next = await fetchSpeechQuote(api, abort.current.signal, true).catch(() => null);
                if (next && live()) { setQuote(next); setProgress(value => ({ ...value, prices: undefined })); } // A new button tap explicitly reconfirms.
            }
        } finally { working.current = false; if (live()) setBusy(false); }
    }
    const price = bestCutPrice(quote, clips.length, balance ?? 0, progress.prices);
    const apply = (value: Result) => {
        const outcome = onApply(value);
        if (outcome.status === 'accepted') { onClose(); return; }
        setResult(value); setApplyBlocked(true);
        if (outcome.status === 'refused') setMessage(t(`editorEditGate.${outcome.reason}`));
        else if (outcome.status === 'stale') setMessage(t('bestCut.stale'));
    };
    const locked = busy || applyBlocked;
    const inputStyle = { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 80 };
    const contentInsets = { paddingTop: 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16, paddingBottom: insets.bottom + 16 };
    return <Modal visible animationType="slide" onRequestClose={() => { abort.current.abort(); onClose(); }}><View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}><KeyboardScreen><KeyboardFormScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ gap: 16 }, contentInsets]}>
        <Text variant="title2">{t('bestCut.title')}</Text><Text>{t('bestCut.limits')}</Text><Text>{t('bestCut.uploadBudget')}</Text><Text>{t('bestCut.replace')}</Text>
        <Button label={t('bestCut.camera')} onPress={() => void pick()} disabled={locked || clips.length >= 10} />
        <Button label={t('bestCut.files')} onPress={() => void pickFiles()} disabled={locked || clips.length >= 10} />
        <Button label={t('bestCut.library')} onPress={() => setLibraryOpen(true)} disabled={locked || clips.length >= 10} />
        <Text>{plural('bestCut.clips', clips.length)} · {t('bestCut.seconds', { n: Math.round(clips.reduce((n, c) => n + c.duration, 0)) })}</Text>
        {clips.map((c, i) => <View key={c.media.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{c.media.id.startsWith('j-') ? <JobThumb links={links} jobId={c.media.id.slice(2)} /> : null}<Text>{c.media.name}</Text>{progress.prices?.[i]?.cached ? <Text>{t('bestCut.cached')}</Text> : null}{progress.prices?.[i]?.free ? <Text>{t('bestCut.firstFree')}</Text> : null}<Button variant="tertiary" label={t('bestCut.remove')} onPress={() => editClips(clips.filter(v => v !== c))} disabled={locked} /></View>)}
        <Text>{price.maximum ? t('bestCut.priceMax', { n: clips.length, price: quote.credits, total: price.total }) : t('bestCut.priceExact', { total: price.total })}</Text>
        {balance !== null && price.maximum && balance < price.total ? <Text accessibilityLiveRegion="polite">{t('editorAi.balance')}</Text> : null}
        {balance !== null ? <Text>{t('bestCut.balance', { n: balance })} · {t(price.maximum ? 'bestCut.afterMin' : 'bestCut.after', { n: price.remaining })}</Text> : null}
        <Text>{t('bestCut.script')}</Text><TextInput multiline editable={!locked} accessibilityLabel={t('bestCut.script')} style={inputStyle} value={script} onChangeText={value => { setScript(value); setResult(null); }} maxLength={20000} />
        <Text>{t('bestCut.notes')}</Text><TextInput multiline editable={!locked} accessibilityLabel={t('bestCut.notes')} style={inputStyle} value={notes} onChangeText={setNotes} maxLength={2000} /><Text>{t('bestCut.localNotes')}</Text>
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{(['balanced', 'vlog', 'educational', 'punchy', 'steps'] as const).map(p => <Chip disabled={locked} key={p} label={t(`bestCut.${p}`)} selected={p === preset} onPress={() => { if (!locked) { setPreset(p); setResult(null); } }} />)}</ScrollView>
        <BestCutSettings disabled={locked} onChange={onSettingsChange} />
        <Text>{brandText(t('bestCut.consent'))}</Text><Text>{t('bestCut.metadata')}</Text><Text>{t('bestCut.agree')}</Text><Switch accessibilityLabel={rawText(t('bestCut.agree'))} disabled={locked} value={consent} onValueChange={setConsent} />
        {busy ? <><Text accessibilityLiveRegion="polite">{t(`bestCut.${progress.phase}`, { n: progress.index + 1, percent: Math.round(progress.fraction * 100) })}</Text><Button label={t('bestCut.cancel')} onPress={() => abort.current.abort()} /></> : null}
        {progress.refunded > 0 ? <Text>{t('bestCut.refunded', { n: progress.refunded })}</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
        {progress.phase === 'no-speech' && !result ? <><Text>{t('bestCut.noSpeech')}</Text><Button label={t('bestCut.chooseAnother')} onPress={() => editClips([])} /><Button label={t('bestCut.tryAnyway')} onPress={() => {
            const original = before(); if (clips.reduce((n, c) => n + c.duration, 0) > BEST_CUT_MAX_SECONDS || validateAgentTimeline(original)) { setMessage(t('bestCut.tryLimit')); return; }
            apply({ before: original, timeline: original, plan: null, uris: uris() });
        }} /></> : result ? <>{result.plan ? <><Text>{t('bestCut.summary', { pauses: result.plan.removedPauses, retakes: result.plan.removedRetakes, matched: result.plan.matchedLines })}</Text>
            {result.plan.warnings.map(w => <Text key={w}>{t(bestCutWarningKey(w))}</Text>)}
            {!!result.plan.missingLines.length && <Text>{t('bestCut.missing', { lines: result.plan.missingLines.join(', ') })}</Text>}
            </> : null}<Button label={t('bestCut.apply')} onPress={() => apply(result)} /></> : <><Button label={t('bestCut.title')} accessibilityHint={!consent && !busy ? t('bestCut.needsAgree') : undefined} onPress={() => void run()} disabled={busy || !clips.length || !consent} />{!consent && !busy ? <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t('bestCut.needsAgree')}</Text> : null}</>}
        <Button variant="tertiary" label={t('bestCut.notNow')} onPress={() => { abort.current.abort(); onClose(); }} />
    </KeyboardFormScrollView></KeyboardScreen></View>{libraryOpen ? <LibraryChooser api={api} kind="video" onClose={() => setLibraryOpen(false)} onPick={choice => { setLibraryOpen(false); void select(choice); }} /> : null}</Modal>;
}
