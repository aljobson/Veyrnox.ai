import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../../lib/api';
import { t, rawText } from '../../lib/i18n';
import { touchTarget } from '../../lib/a11y';
import { sameRevision, type Freshness } from '../../lib/editorAgentPlan';
import { subscribeCacheUser } from '../../lib/appCache';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { type Timeline, type Selection } from '../../lib/nativeEditorModel';
import { applySpeechRanges, keptAfterRemovals, retakeRanges, silenceRanges, speechClip, parseSmartCutAnalysis, type SpeechMode, type SpeechRange } from '../../lib/speechCut';
import { fetchSpeechQuote, forgetSpeechKey, pollSpeech, recoverSpeech, speechKeyFor, speechMessage, startSpeech, type SpeechOutcome, type SpeechQuote } from '../../lib/speechAnalysis';
import { useReducedMotion } from '../ui/useReducedMotion';
import { Text } from '../ui/Text';
import { colors, ds, text, tokensForScheme, getAppearance, resolveScheme } from '../../theme';
type Snapshot = { timeline: Timeline; freshness: Freshness; selection: Selection | null };
type Props = { api: ApiClient; quote: SpeechQuote; mode: SpeechMode; snapshot(): Snapshot; apply(next: Timeline, expected: Freshness): boolean; onClose(): void; onUnavailable(): void };
type Phase = 'quoting' | 'idle' | 'queued' | 'transcribing' | 'planning' | 'preview' | 'error' | 'pending';
export function EditorSpeechCutSheet({ api, quote: initialQuote, mode, snapshot, apply, onClose, onUnavailable }: Props) {
    const [opening] = useState(snapshot), [selected, setSelected] = useState(opening.selection), [quote, setQuote] = useState(initialQuote);
    const [phase, setPhase] = useState<Phase>('quoting'), [message, setMessage] = useState(''), [refunded, setRefunded] = useState(false);
    const [removals, setRemovals] = useState<SpeechRange[]>([]), [checked, setChecked] = useState<boolean[]>([]);
    const captured = useRef<Snapshot | null>(null), key = useRef<string | null>(null), busy = useRef(false), controller = useRef(new AbortController());
    const reduced = useReducedMotion(), target = speechClip(opening.timeline, selected), media = target?.clip.mediaId ? opening.timeline.media[target.clip.mediaId] : undefined;
    const jobId = !media?.assetSource && /^j-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(media?.id || '') ? media!.id.slice(2) : null;
    const duration = Number(media?.frames) / opening.timeline.fps;
    const supported = !!jobId && ['audio', 'video'].includes(media?.kind || '') && Number.isFinite(duration) && duration >= .5 && duration <= 60;
    const unresolved = ['queued', 'transcribing', 'planning', 'pending'].includes(phase);
    const heading = t(mode === 'silences' ? 'editorSpeech.silences' : 'editorSpeech.retakes');
    const progressText = ['quoting', 'queued', 'transcribing', 'planning'].includes(phase) ? t(`editorSpeech.${phase}`) : null;
    useAnnouncement(progressText || (phase === 'preview' ? t('editorSpeech.preview') : message || null));
    useEffect(() => {
        const abort = controller.current;
        void fetchSpeechQuote(api, abort.signal).then(value => {
            if (abort.signal.aborted) return; if (!value) { onUnavailable(); return; }
            setQuote(value); setPhase('idle');
        }).catch(error => { if (!abort.signal.aborted) { setMessage(speechMessage(error)); setPhase('error'); } });
        const unsubscribe = subscribeCacheUser(() => { abort.abort(); onClose(); });
        return () => { abort.abort(); unsubscribe(); };
    }, [api]);
    const receive = (result: SpeechOutcome) => {
        if (controller.current.signal.aborted) return;
        if (result.status === 'failed') {
            setRefundedSafe(result.refunded === true); setMessage(t('editorSpeech.failed')); setPhase(result.refunded ? 'error' : 'pending'); return;
        }
        const current = captured.current;
        if (!current || !target || !jobId || !sameRevision(current.freshness, snapshot().freshness)) { setMessage(t('editorAi.stale')); setPhase('error'); return; }
        const parsed = parseSmartCutAnalysis(result.analysis, { assetId: jobId, duration });
        if (!parsed.ok) { setMessage(t('editorSpeech.failed')); setPhase('error'); return; }
        setPhase('planning');
        const start = (target.clip.in || 0) / current.timeline.fps, end = Math.min(duration, start + target.clip.len * (target.clip.rate || 1) / current.timeline.fps);
        const proposals = mode === 'silences' ? keptAfterRemovals(silenceRanges(parsed.analysis, start, end), start, end)
            : retakeRanges(parsed.analysis).filter(r => r.end > start && r.start < end);
        setRemovals(proposals); setChecked(proposals.map(() => true)); setPhase('preview');
        setMessage(proposals.length ? '' : t('editorSpeech.noChanges'));
    };
    function setRefundedSafe(value: boolean) {
        setRefunded(value); if (value && jobId) { forgetSpeechKey(opening.freshness.accountId, jobId); key.current = null; }
    }
    const failed = (error: unknown) => {
        if (controller.current.signal.aborted) return;
        setRefundedSafe(error instanceof ApiError && error.body.refunded === true);
        if (error instanceof ApiError && error.code === 'price_changed' && Number.isSafeInteger(error.body.credits) && Number(error.body.credits) > 0) setQuote(q => ({ ...q, credits: Number(error.body.credits) }));
        if (error instanceof ApiError && error.code === 'result_expired' && jobId) { forgetSpeechKey(opening.freshness.accountId, jobId); key.current = null; }
        setMessage(speechMessage(error));
        setPhase(error instanceof ApiError && ['poll_timeout', 'outcome_pending'].includes(error.code) ? 'pending' : 'error');
    };
    const wait = async (result: SpeechOutcome) => result.status === 'queued' ? pollSpeech(api, key.current!, opening.freshness.accountId, controller.current.signal, setPhase) : result;
    const send = async () => {
        if (busy.current || unresolved || !supported || !jobId) return;
        if (!sameRevision(opening.freshness, snapshot().freshness)) { setMessage(t('editorAi.stale')); return; }
        busy.current = true; setMessage(''); setRefunded(false); setPhase('queued'); captured.current = { ...opening, selection: selected };
        key.current = speechKeyFor(opening.freshness.accountId, jobId, duration, randomUUID);
        try { receive(await wait(await startSpeech(api, { account: opening.freshness.accountId, jobId, duration, key: key.current, credits: quote.credits }, controller.current.signal))); }
        catch (error) { failed(error); } finally { busy.current = false; }
    };
    const recover = async () => {
        if (busy.current || !key.current) return;
        busy.current = true;
        try { receive(await wait(await recoverSpeech(api, key.current, opening.freshness.accountId, controller.current.signal))); }
        catch (error) { failed(error); } finally { busy.current = false; }
    };
    const start = target ? (target.clip.in || 0) / opening.timeline.fps : 0;
    const end = target ? Math.min(duration, start + target.clip.len * (target.clip.rate || 1) / opening.timeline.fps) : 0;
    const kept = keptAfterRemovals(removals.filter((_, i) => checked[i]), start, end);
    const next = target && phase === 'preview' ? applySpeechRanges(opening.timeline, target, kept) : null;
    const commit = () => {
        if (!next || !captured.current || !sameRevision(captured.current.freshness, snapshot().freshness) || !apply(next, captured.current.freshness)) {
            setMessage(t('editorAi.stale')); setPhase('error'); return;
        } onClose();
    };
    const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={[styles.button, touchTarget, disabled && styles.disabled]}><Text style={styles.action}>{label}</Text></Pressable>;
    const stamp = (r: SpeechRange) => `${r.start.toFixed(2)}–${r.end.toFixed(2)} s`;
    return <Modal visible transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={onClose} accessibilityViewIsModal>
        <View style={styles.backdrop}><View style={styles.sheet}><ScrollView contentContainerStyle={styles.content}>
            <Text variant="title2" accessibilityRole="header" style={styles.heading}>{heading}</Text>
            {phase !== 'preview' ? <>
                <Text style={styles.body}>{t('editorSpeech.clip')}</Text>
                {(['video', 'audio'] as const).flatMap(track => opening.timeline[track].map(clip => <Pressable key={`${track}:${clip.id}`} disabled={unresolved} style={[styles.button, touchTarget]} accessibilityRole="radio"
                    accessibilityState={{ checked: target?.clip.id === clip.id && target.track === track, disabled: unresolved }} accessibilityLabel={rawText(opening.timeline.media[clip.mediaId || '']?.name || clip.id)}
                    onPress={() => { setSelected({ track, id: clip.id }); setMessage(''); setRefunded(false); }}><Text style={styles.body}>{opening.timeline.media[clip.mediaId || '']?.name || clip.id}</Text></Pressable>))}
                {!supported && <Text style={styles.body}>{t(jobId && duration > 60 ? 'editorSpeech.tooLong' : /^([fe])-/.test(media?.id || '') ? 'editorSpeech.uploadFirst' : 'editorSpeech.unsupported')}</Text>}
                {supported && <><Text style={styles.price}>{t('editorSpeech.price', { n: quote.credits })}</Text><Text style={styles.muted}>{t('editorSpeech.privacy')}</Text></>}
                {progressText && <Text accessibilityLiveRegion="polite" style={styles.body}>{progressText}</Text>}
                {phase === 'pending' ? button(t('editorSpeech.checkStatus'), () => void recover()) : button(t('editorSpeech.start'), () => void send(), !supported || unresolved || phase === 'quoting')}
            </> : <>
                <Text accessibilityRole="header" variant="title2" style={styles.heading}>{t('editorSpeech.preview')}</Text>
                <Text style={styles.muted}>{t('editorSpeech.review')}</Text>
                {removals.map((range, i) => <Pressable key={i} accessibilityRole="checkbox" accessibilityState={{ checked: checked[i] }} accessibilityLabel={rawText(t('editorSpeech.remove', { time: stamp(range) }))}
                    style={[styles.button, touchTarget]} onPress={() => setChecked(values => values.map((v, index) => index === i ? !v : v))}>
                    <Text style={styles.body}>{checked[i] ? '☑ ' : '☐ '}{t('editorSpeech.remove', { time: stamp(range) })}</Text>{!!range.label && <Text style={styles.muted}>{range.label}</Text>}
                </Pressable>)}
                {kept.map((range, i) => <Text key={i} style={styles.body}>{t('editorSpeech.keep', { time: stamp(range) })}</Text>)}
                {!next && <Text style={styles.body}>{t('editorSpeech.limits')}</Text>}
                {button(t('editorAi.apply'), commit, !next || !checked.some(Boolean))}
            </>}
            {!!message && <Text accessibilityRole="alert" style={styles.body}>{message}</Text>}
            {refunded && <Text accessibilityLiveRegion="polite" style={styles.body}>{t('editorSpeech.notCharged')}</Text>}
            {button(t(phase === 'preview' ? 'editorAi.discard' : 'editorSimple.close'), onClose)}
        </ScrollView></View></View>
    </Modal>;
}
const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: tokensForScheme(resolveScheme(getAppearance().theme, 'dark')).scrim },
    sheet: { maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: ds.radius.lg, borderTopRightRadius: ds.radius.lg },
    content: { padding: ds.space.gutter, paddingBottom: ds.space.xxxl, gap: ds.space.md },
    heading: { color: colors.text, ...text.title2 }, body: { color: colors.text, ...text.body }, muted: { color: colors.muted, ...text.footnote },
    price: { color: colors.money, ...text.bodyStrong }, action: { color: colors.accent, ...text.bodyStrong },
    button: { minHeight: 52, padding: ds.space.md, borderRadius: ds.radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }, disabled: { opacity: .45 },
});
