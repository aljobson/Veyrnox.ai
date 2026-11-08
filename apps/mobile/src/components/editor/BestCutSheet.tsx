import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, TextInput, View, Switch } from 'react-native';
import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Button, Chip, Text } from '../ui';
import { colors } from '../../theme';
import { ApiError, type ApiClient } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { createConsentGate } from '../../lib/aiConsent';
import { secureStorage } from '../../lib/aiConsentStore';
import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { probeDuration } from '../../lib/editorMediaDuration';
import { libraryMedia } from '../../lib/editorLibraryLength';
import type { LibraryChoice } from '../../lib/librarySource';
import { LibraryChooser } from '../LibraryChooser';
import { fetchSpeechQuote, speechMessage, type SpeechQuote } from '../../lib/speechAnalysis';
import { createBestCutFlow, bestCutPrice, type BestCutClip, type BestCutProgress } from '../../lib/bestCutFlow';
import { buildBestCutPlan, type BestCutPlan, type BestCutPreset } from '../../lib/bestCutPlan';
import { applyBestCut, bestCutBefore } from '../../lib/applyBestCut';
import type { Timeline } from '../../lib/nativeEditorModel';
import { validateAgentTimeline } from '../../lib/editorAgentOperations';
import { t, plural, rawText } from '../../lib/i18n';
import { BestCutSettings } from './BestCutSettings';
import type { BestCutSettings as Settings } from '../../lib/bestCutSettings';
type Result = { timeline: Timeline; before: Timeline; plan: BestCutPlan | null; uris: Record<string, string>; captionsOmitted?: boolean; refunded?: number };
type Props = { api: ApiClient; projectId: string; quote: SpeechQuote; onClose(): void; onApply(result: Result): boolean };
export function BestCutSheet({ api, projectId, quote: initialQuote, onClose, onApply }: Props) {
    const [account] = useState(() => getCacheUser() || '');
    const [flow] = useState(() => createBestCutFlow(api, account, randomUUID));
    const [consentGate] = useState(() => { const gate = createConsentGate(secureStorage, 'best-cut-2026-11-v1'); gate.setUser(account); return gate; });
    const [clips, setClips] = useState<BestCutClip[]>([]), [libraryOpen, setLibraryOpen] = useState(false);
    const [quote, setQuote] = useState(initialQuote), [balance, setBalance] = useState<number | null>(null);
    const [script, setScript] = useState(''), [notes, setNotes] = useState(''), [preset, setPreset] = useState<BestCutPreset>('balanced');
    const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [settings, setSettings] = useState<Settings>({ captions: true, language: 'auto' });
    const [progress, setProgress] = useState<BestCutProgress>({ phase: 'ready', index: 0, fraction: 0, refunded: 0 });
    const [result, setResult] = useState<Result | null>(null);
    const abort = useRef(new AbortController()), mounted = useRef(true), working = useRef(false);
    const [close] = useState(() => onClose);
    const live = useCallback(() => mounted.current && getCacheUser() === account, [account]);
    const onSettingsChange = useCallback((value: Settings) => { setSettings(value); setResult(null); }, []);
    useEffect(() => {
        mounted.current = true;
        void consentGate.hasAgreed().then(value => { if (live()) setConsent(value); });
        void api.getBalance().then(value => { if (live()) setBalance(value.balance); }).catch(() => {});
        const off = subscribeCacheUser(() => { abort.current.abort(); void consentGate.forget(); close(); });
        return () => { mounted.current = false; abort.current.abort(); off(); };
    }, [api, consentGate, close, live]);
    const editClips = (next: BestCutClip[]) => { setClips(next); setResult(null); setProgress({ phase: 'ready', index: 0, fraction: 0, refunded: 0 }); };
    async function pick() {
        if (working.current || clips.length >= 10) return;
        working.current = true; setBusy(true); setMessage('');
        try {
            const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: true, selectionLimit: 10 - clips.length });
            if (picked.canceled || !live()) return;
            const next = [...clips];
            for (const asset of picked.assets.slice(0, 10 - clips.length)) {
                if (asset.fileSize && asset.fileSize > 100 * 1024 * 1024) throw new ApiError(400, 'source_unsupported');
                const duration = asset.duration ? asset.duration / 1000 : await probeDuration(asset.uri);
                if (!duration || duration < .5 || duration > 60) throw new ApiError(400, 'source_too_long');
                const id = `l-${randomUUID()}`;
                const type = asset.mimeType || (/\.mov(?:\?|$)/i.test(asset.uri) ? 'video/quicktime' : 'video/mp4');
                if (!['video/mp4', 'video/quicktime'].includes(type)) throw new ApiError(400, 'source_unsupported');
                // Copy only: never call preparePicked(), which automatically creates a project backup.
                const file = await editorDeviceMedia.copy(projectId, id, asset.uri, type, duration);
                if (!live()) return;
                if (!file || file.size > 100 * 1024 * 1024) throw new ApiError(400, 'source_unsupported');
                // The editor's sequence validator requires exact, bounded media fields; a camera-roll clip must satisfy it before any charge.
                const media = { id, kind: 'video' as const, name: (asset.fileName || t('bestCut.camera')).slice(0, 60), frames: Math.floor(duration * 30), hasAudio: true, width: Math.max(0, Math.min(16384, Math.round(asset.width || 0))), height: Math.max(0, Math.min(16384, Math.round(asset.height || 0))) };
                if (validateAgentTimeline(bestCutBefore([...next.map(c => c.media), media]))) throw new ApiError(400, 'source_unsupported');
                next.push({ media, duration, file });
            }
            if (live()) editClips(next);
        } catch (error) { if (live()) setMessage(speechMessage(error)); }
        finally { working.current = false; if (live()) setBusy(false); }
    }
    async function select(choice: LibraryChoice) {
        if (working.current || clips.length >= 10 || clips.some(c => c.media.id === `j-${choice.jobId}`)) return;
        working.current = true; setBusy(true);
        try {
            const media = await libraryMedia(api, choice, 'video'); if (!live()) return;
            if (!media || !media.frames || media.frames > 60 * 30) throw new ApiError(400, 'source_too_long');
            editClips([...clips, { media, duration: media.frames / 30, source: { type: 'job', jobId: choice.jobId } }]); setLibraryOpen(false);
        } catch (error) { if (live()) setMessage(speechMessage(error)); }
        finally { working.current = false; if (live()) setBusy(false); }
    }
    const before = () => bestCutBefore(clips.map(c => c.media));
    const uris = () => Object.fromEntries(clips.flatMap(c => c.file ? [[c.media.id, c.file.file]] : []));
    async function run() {
        if (working.current) return; working.current = true; setBusy(true); setMessage(''); setResult(null); abort.current = new AbortController();
        try {
            consentGate.setPrompter(async () => consent); await consentGate.ensure('/api/v1/editor/speech-analyses', 'POST');
            // Fail before upload or charge if the source timeline would not be valid for the editor.
            if (validateAgentTimeline(before())) throw new ApiError(400, 'source_unsupported');
            const currentBalance = await api.getBalance(); if (!live()) return; setBalance(currentBalance.balance);
            const output = await flow.run(clips, quote, abort.current.signal, value => { if (live()) setProgress(value); });
            if (!live()) return;
            if (!output.inputs.length) return;
            const inputs = output.inputs.map(c => ({ ...c, analysis: { ...c.analysis, language: settings.language === 'auto' || c.analysis.language === 'und' ? c.analysis.language : settings.language } }));
            const plan = buildBestCutPlan(inputs, script, preset);
            if (!plan) { setMessage(t('bestCut.noChange')); return; }
            plan.droppedClips = output.silent.length;
            const original = before();
            const compiled = applyBestCut(original, plan, inputs, settings.captions);
            if (!compiled) { setMessage(t('bestCut.noChange')); return; }
            const value = { before: original, timeline: compiled.timeline, plan, uris: uris(), captionsOmitted: compiled.captionsOmitted, refunded: output.refunded };
            if (compiled.captionsOmitted) setMessage(t('bestCut.captionsOmitted'));
            if (plan.warnings.includes('tail')) setResult(value);
            else if (onApply(value)) onClose();
            else setMessage(t('bestCut.stale'));
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
    const apply = (value: Result) => { if (onApply(value)) onClose(); else setMessage(t('bestCut.stale')); };
    const inputStyle = { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 80 };
    return <Modal visible animationType="slide" onRequestClose={() => { abort.current.abort(); onClose(); }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: 60, gap: 16, backgroundColor: colors.background }}>
        <Text variant="title2">{t('bestCut.title')}</Text><Text>{t('bestCut.limits')}</Text><Text>{t('bestCut.uploadBudget')}</Text><Text>{t('bestCut.replace')}</Text>
        <Button label={t('bestCut.camera')} onPress={() => void pick()} disabled={busy || clips.length >= 10} />
        <Button label={t('bestCut.library')} onPress={() => setLibraryOpen(true)} disabled={busy || clips.length >= 10} />
        <Text>{plural('bestCut.clips', clips.length)} · {t('bestCut.seconds', { n: Math.round(clips.reduce((n, c) => n + c.duration, 0)) })}</Text>
        {clips.map((c, i) => <View key={c.media.id}><Text>{c.media.name}</Text>{progress.prices?.[i]?.cached ? <Text>{t('bestCut.cached')}</Text> : null}<Button variant="tertiary" label={t('bestCut.remove')} onPress={() => editClips(clips.filter(v => v !== c))} disabled={busy} /></View>)}
        <Text>{price.maximum ? t('bestCut.priceMax', { n: clips.length, price: quote.credits, total: price.total }) : t('bestCut.priceExact', { total: price.total })}</Text>
        {balance !== null && price.maximum && balance < price.total ? <Text accessibilityLiveRegion="polite">{t('editorAi.balance')}</Text> : null}
        {balance !== null ? <Text>{t('bestCut.balance', { n: balance })} · {t(price.maximum ? 'bestCut.afterMin' : 'bestCut.after', { n: price.remaining })}</Text> : null}
        <Text>{t('bestCut.script')}</Text><TextInput multiline editable={!busy} accessibilityLabel={t('bestCut.script')} style={inputStyle} value={script} onChangeText={value => { setScript(value); setResult(null); }} maxLength={20000} />
        <Text>{t('bestCut.notes')}</Text><TextInput multiline editable={!busy} accessibilityLabel={t('bestCut.notes')} style={inputStyle} value={notes} onChangeText={setNotes} maxLength={2000} /><Text>{t('bestCut.localNotes')}</Text>
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{(['balanced', 'vlog', 'educational', 'punchy', 'steps'] as const).map(p => <Chip key={p} label={t(`bestCut.${p}`)} selected={p === preset} onPress={() => { if (!busy) { setPreset(p); setResult(null); } }} />)}</ScrollView>
        <BestCutSettings disabled={busy} onChange={onSettingsChange} />
        <Text>{t('bestCut.consent')}</Text><Text>{t('bestCut.metadata')}</Text><Text>{t('bestCut.agree')}</Text><Switch accessibilityLabel={rawText(t('bestCut.agree'))} disabled={busy} value={consent} onValueChange={setConsent} />
        {busy ? <><Text accessibilityLiveRegion="polite">{t(`bestCut.${progress.phase}`, { n: progress.index + 1, percent: Math.round(progress.fraction * 100) })}</Text><Button label={t('bestCut.cancel')} onPress={() => abort.current.abort()} /></> : null}
        {progress.refunded > 0 ? <Text>{t('bestCut.refunded', { n: progress.refunded })}</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
        {progress.phase === 'no-speech' ? <><Text>{t('bestCut.noSpeech')}</Text><Button label={t('bestCut.chooseAnother')} onPress={() => editClips([])} /><Button label={t('bestCut.tryAnyway')} onPress={() => {
            const original = before(); if (clips.reduce((n, c) => n + c.duration, 0) > 60 || validateAgentTimeline(original)) { setMessage(t('bestCut.tryLimit')); return; }
            apply({ before: original, timeline: original, plan: null, uris: uris() });
        }} /></> : result ? <><Text>{t('bestCut.summary', { pauses: result.plan!.removedPauses, retakes: result.plan!.removedRetakes, matched: result.plan!.matchedLines })}</Text>
            {result.plan!.warnings.map(w => <Text key={w}>{t(`bestCut.warning.${w}`)}</Text>)}
            {!!result.plan!.missingLines.length && <Text>{t('bestCut.missing', { lines: result.plan!.missingLines.join(', ') })}</Text>}
            <Button label={t('bestCut.apply')} onPress={() => apply(result)} /></> : <Button label={t('bestCut.title')} onPress={() => void run()} disabled={busy || !clips.length || !consent} />}
        <Button variant="tertiary" label={t('bestCut.notNow')} onPress={() => { abort.current.abort(); onClose(); }} />
    </ScrollView>{libraryOpen ? <LibraryChooser api={api} kind="video" onClose={() => setLibraryOpen(false)} onPick={choice => { setLibraryOpen(false); void select(choice); }} /> : null}</Modal>;
}
