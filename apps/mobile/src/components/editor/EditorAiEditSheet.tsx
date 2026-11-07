import { EDITOR_AI_EDIT_ENABLED } from '../../lib/editorFlag';
import { subscribeCacheUser } from '../../lib/appCache';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { ApiError, type ApiClient } from '../../lib/api';
import { touchTarget } from '../../lib/a11y';
import { t, rawText } from '../../lib/i18n';
import { checkPlan, planSummary, sameRevision, type Freshness, type PlanResult } from '../../lib/editorAgentPlan';
import { aiEditKeyFor, aiEditMessage, fetchAiEditQuote, recoverAiEdit, runAiEdit, type AiEditOutcome, type AiEditQuote } from '../../lib/editorAiEdit';
import type { PendingSend } from '../../lib/chat';
import type { Timeline } from '../../lib/nativeEditorModel';
import { useReducedMotion } from '../ui/useReducedMotion';
import { colors, ds, text, tokensForScheme, getAppearance, resolveScheme } from '../../theme';
import { Text } from '../ui/Text';
import { useAnnouncement } from '../../lib/useAnnouncement';

type Snapshot = { timeline: Timeline; freshness: Freshness };
type Props = { api: ApiClient; quote: AiEditQuote; snapshot(): Snapshot; apply(next: Timeline, expected: Freshness): boolean; onClose(): void; onUnavailable(): void };
export function EditorAiEditSheet({ api, quote: initialQuote, snapshot, apply, onClose, onUnavailable }: Props) {
    const reduced = useReducedMotion();
    const [quote, setQuote] = useState(initialQuote);
    const [instruction, setInstruction] = useState('');
    const [state, setState] = useState<'quoting' | 'idle' | 'sending' | 'pending' | 'error' | 'preview'>('quoting');
    const [message, setMessage] = useState('');
    const [refunded, setRefunded] = useState(false);
    const [preview, setPreview] = useState<PlanResult | null>(null);
    const [skipped, setSkipped] = useState(0);
    const key = useRef<PendingSend | null>(null), captured = useRef<Snapshot | null>(null), busy = useRef(false), live = useRef(true);
    const unresolved = state === 'sending' || state === 'pending';
    useAnnouncement(state === 'preview' ? t('editorAi.preview') : state === 'idle' ? t('editorAi.instruction') : null);
    useEffect(() => {
        live.current = true;
        void fetchAiEditQuote(api).then(value => {
            if (!live.current) return;
            if (!value) { onUnavailable(); return; }
            setQuote(value); setState('idle');
        }).catch(error => { if (live.current) { setMessage(aiEditMessage(error)); setState('error'); } });
        return () => { live.current = false; };
    }, [api]); // An open sheet retains its request snapshot; parent owns account/project lifetime.
    const receive = (result: AiEditOutcome) => {
        if (!live.current) return;
        if (result.status === 'pending') { setMessage(t('editorAi.pending')); setState('pending'); return; }
        if (result.status === 'failed') {
            setRefunded(result.refunded === true);
            if (result.refunded) key.current = null;
            setMessage(t('editorAi.failed')); setState(result.refunded ? 'error' : 'pending'); return;
        }
        const expected = captured.current;
        if (!expected) return;
        const checked = checkPlan(expected.timeline, result.plan, expected.freshness, snapshot().freshness);
        if (!checked.ok) { setMessage(checked.error!); setState('error'); return; }
        setPreview(checked); setSkipped(result.skipped?.length ?? 0); setState('preview');
    };
    const failed = (error: unknown) => {
        if (!live.current) return;
        const refund = error instanceof ApiError && error.body.refunded === true;
        setRefunded(refund);
        if (refund) key.current = null;
        if (error instanceof ApiError && error.code === 'price_changed' && Number.isSafeInteger(error.body.credits) && Number(error.body.credits) > 0) {
            setQuote(q => ({ ...q, credits: Number(error.body.credits) }));
        }
        setMessage(aiEditMessage(error));
        setState(error instanceof ApiError && ['outcome_pending', 'refund_pending'].includes(error.code) ? 'pending' : 'error');
    };
    const send = async () => {
        if (busy.current || unresolved || !instruction.trim()) return;
        busy.current = true; setState('sending'); setMessage(''); setRefunded(false); setPreview(null);
        captured.current = snapshot();
        key.current = aiEditKeyFor(key.current, instruction, captured.current.timeline, randomUUID);
        try { receive(await runAiEdit(api, { instruction, timeline: captured.current.timeline, key: key.current.key, expectedCredits: quote.credits, accountId: captured.current.freshness.accountId })); }
        catch (error) { failed(error); }
        finally { busy.current = false; }
    };
    const recover = async () => {
        if (busy.current || !key.current || !captured.current) return;
        busy.current = true;
        try { receive(await recoverAiEdit(api, key.current.key, captured.current.freshness.accountId)); }
        catch (error) {
            if (error instanceof ApiError && error.status === 410) failed(error);
            else if (live.current) { setState('pending'); setMessage(t('editorAi.pending')); }
        } finally { busy.current = false; }
    };
    const retryPending = async () => {
        if (busy.current || !key.current || !captured.current) return;
        // A POST that never arrived has no status to poll. Retry its exact identity;
        // keep the captured document locked until an outcome is confirmed.
        busy.current = true; setState('sending');
        try { receive(await runAiEdit(api, { instruction, timeline: captured.current.timeline, key: key.current.key, expectedCredits: quote.credits, accountId: captured.current.freshness.accountId })); }
        catch (error) {
            failed(error);
            if (live.current && !(error instanceof ApiError && error.body.refunded === true)) setState('pending');
        } finally { busy.current = false; }
    };
    useEffect(() => {
        if (state !== 'pending') return;
        const timer = setInterval(() => void recover(), 5000);
        return () => clearInterval(timer);
    }, [state]);
    const commit = () => {
        const expected = captured.current;
        // Recheck immediately before the editor's one history entry, including account and project.
        if (!expected || !preview?.next || !sameRevision(expected.freshness, snapshot().freshness) || !apply(preview.next, expected.freshness)) {
            setMessage(t('editorAi.stale')); setPreview(null); setState('error'); return;
        }
        onClose();
    };
    const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={[styles.button, touchTarget, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
    const price = t('editorAi.price', { n: quote.credits });
    return <Modal visible transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={() => { if (!unresolved) onClose(); }} accessibilityViewIsModal>
        <View style={styles.backdrop}><View style={styles.sheet}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text variant="title2" accessibilityRole="header" style={styles.heading}>{t('editorAi.describe')}</Text>
            {state !== 'preview' ? <>
                <TextInput accessibilityLabel={rawText(t('editorAi.instruction'))} multiline maxLength={500} editable={!unresolved && state !== 'quoting'} value={instruction} onChangeText={setInstruction} style={styles.input} placeholder={rawText(t('editorAi.instruction'))} placeholderTextColor={colors.muted} />
                <Text style={styles.muted}>{t('editorAi.counter', { n: instruction.length })}</Text>
                <Text style={[styles.text, { color: colors.money }]}>{price}</Text>
                <Text style={styles.muted}>{t('editorAi.privacy')}</Text>
                {state === 'quoting' || state === 'sending' ? <><ActivityIndicator color={colors.accent} /><Text accessibilityLiveRegion="polite" style={styles.text}>{t(state === 'quoting' ? 'editorAi.quoting' : 'editorAi.sending')}</Text></> : null}
                {state === 'pending' ? <>{button(t('editorAi.checkStatus'), () => void recover())}{button(`${t('recovery.retry')} · ${price}`, () => void retryPending())}</> : button(t('editorAi.send', { price }), () => void send(), state === 'quoting' || unresolved || !instruction.trim())}
            </> : <>
                <Text variant="title2" accessibilityRole="header" style={styles.heading}>{t('editorAi.preview')}</Text>
                <Text style={styles.text}>{planSummary(preview!)}</Text>
                {preview!.steps.map(step => <Text key={step.index} style={styles.text}>{step.destructive ? `${t('editorAi.destructive')} · ` : ''}{step.text}</Text>)}
                <Text style={styles.muted}>{t('editorAi.skipped', { n: skipped })}</Text>
                {button(t('editorAi.apply'), commit)}
                {button(t('editorAi.discard'), onClose)}
            </>}
            {!!message && <Text accessibilityRole="alert" style={styles.text}>{message}</Text>}
            {refunded && <Text accessibilityLiveRegion="polite" style={styles.text}>{t('editorAi.notCharged')}</Text>}
            {state !== 'preview' && button(t('editorSimple.close'), onClose, unresolved)}
        </ScrollView></View></View>
    </Modal>;
}
const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: tokensForScheme(resolveScheme(getAppearance().theme, 'dark')).scrim },
    sheet: { maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: ds.radius.lg, borderTopRightRadius: ds.radius.lg },
    content: { padding: ds.space.gutter, paddingBottom: ds.space.xxxl, gap: ds.space.md },
    heading: { color: colors.text, ...text.title2 }, text: { color: colors.text, ...text.body }, muted: { color: colors.muted, ...text.footnote },
    input: { minHeight: 110, color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: ds.radius.sm, padding: ds.space.md, ...text.body, textAlignVertical: 'top' },
    button: { minHeight: 52, borderRadius: ds.radius.sm, padding: ds.space.md, alignItems: 'center', backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 },
    buttonText: { color: colors.accent, ...text.bodyStrong }, disabled: { opacity: .45 },
});

// Availability is scoped to this editor session; no quoted price or result is persisted.
export function useAiEditAvailability(api: ApiClient, projectId: string) {
    const [aiQuote, setAiQuote] = useState<AiEditQuote | null>(null);
    const [aiEditOpen, setAiEditOpen] = useState(false);
    useEffect(() => {
        let live = true;
        setAiQuote(null); setAiEditOpen(false);
        if (EDITOR_AI_EDIT_ENABLED) void fetchAiEditQuote(api).then(value => { if (live) setAiQuote(value); }).catch(() => {});
        const unsubscribe = subscribeCacheUser(() => { live = false; setAiQuote(null); setAiEditOpen(false); });
        return () => { live = false; unsubscribe(); };
    }, [api, projectId]);
    return { aiQuote, setAiQuote, aiEditOpen, setAiEditOpen };
}
