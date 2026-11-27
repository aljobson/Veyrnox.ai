import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { ApiError } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { EDITOR_SPEECH_CUT_ENABLED } from '../../lib/editorFlag';
import { t } from '../../lib/i18n';
import {
    fetchSpeechQuote,
    forgetSpeechKey,
    pollSpeech,
    recoverSpeech,
    speechKeyFor,
    speechMessage,
    startSpeech,
    type SpeechOutcome,
    type SpeechQuote,
} from '../../lib/speechAnalysis';
import { parseSmartCutAnalysis, type SpeechAnalysis } from '../../lib/speechCut';
import { smartCutNetCredits } from '../../lib/smartCutBilling';
import { createSmartCutProgressNotifier, smartCutProgressStageKey, type SmartCutProgressNotifier, type SmartCutProgressStage } from '../../lib/smartCutProgressNotification';
import { validSmartCutAnalysis } from '../../lib/smartCut';
import { usePush } from '../../push/pushContext';
import { ds } from '../../theme';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';

export type SmartCutAnalysisClip = { readonly jobId: string; readonly label: string; readonly duration: number };
type Recovery = { readonly clip: SmartCutAnalysisClip; readonly key: string };

/** Quote, confirm, recover and report optional speech analysis for the selected Smart Cut clips. */
export function SmartCutAnalysisCard({ clips, analyses, onAnalysed, onBusyChange, disabled = false }: {
    readonly disabled?: boolean;
    readonly clips: readonly SmartCutAnalysisClip[];
    readonly analyses: ReadonlyMap<string, SpeechAnalysis>;
    readonly onAnalysed: (jobId: string, analysis: SpeechAnalysis) => void;
    readonly onBusyChange?: (busy: boolean) => void;
}) {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const { enabled: progressNotificationsEnabled } = usePush();
    const account = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser) || '';
    const [quote, setQuote] = useState<SpeechQuote | null | undefined>(() => EDITOR_SPEECH_CUT_ENABLED && account ? undefined : null);
    const [quoteError, setQuoteError] = useState(false);
    const [quoteAttempt, setQuoteAttempt] = useState(0);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [progressStage, setProgressStage] = useState<SmartCutProgressStage>('queued');
    const [messages, setMessages] = useState<readonly string[]>([]);
    const [recovery, setRecovery] = useState<Recovery | null>(null);
    const [terminalMessages, setTerminalMessages] = useState<ReadonlyMap<string, string>>(() => new Map());
    const controller = useRef<AbortController | null>(null);
    const progressNotification = useRef<SmartCutProgressNotifier | null>(null);
    const creditsByKey = useRef(new Map<string, number>());
    const conflictingCredits = useRef(new Set<string>());
    const live = useRef(true);
    const signature = useMemo(() => JSON.stringify([account, clips.map((clip) => [clip.jobId, clip.duration])]), [account, clips]);
    const signatureRef = useRef(signature);
    const accountRef = useRef(account);
    const selectedIdsRef = useRef(new Set<string>());
    selectedIdsRef.current = new Set(clips.map((clip) => clip.jobId));

    useEffect(() => {
        onBusyChange?.(running);
        return () => onBusyChange?.(false);
    }, [onBusyChange, running]);

    useEffect(() => {
        live.current = true;
        if (!EDITOR_SPEECH_CUT_ENABLED || !account) return () => { live.current = false; };
        const abort = new AbortController();
        setQuoteError(false);
        void fetchSpeechQuote(api, abort.signal).then((value) => {
            if (live.current && !abort.signal.aborted) { setQuote(value); setQuoteError(false); }
        }).catch(() => {
            if (live.current && !abort.signal.aborted) { setQuote(undefined); setQuoteError(true); }
        });
        const off = subscribeCacheUser(() => { abort.abort(); controller.current?.abort(); setQuote(null); setQuoteError(false); });
        return () => { live.current = false; abort.abort(); controller.current?.abort(); off(); };
    }, [account, api, quoteAttempt]);

    useEffect(() => {
        const accountChanged = accountRef.current !== account;
        accountRef.current = account;
        const selectedIds = selectedIdsRef.current;
        signatureRef.current = signature;
        controller.current?.abort();
        queueMicrotask(() => {
            if (!live.current || signatureRef.current !== signature) return;
            setRunning(false);
            setProgress({ done: 0, total: 0 });
            setProgressStage('queued');
            if (accountChanged) {
                progressNotification.current?.dismiss();
                progressNotification.current = null;
                setMessages([]);
                setRecovery(null);
                setTerminalMessages(new Map());
                creditsByKey.current.clear();
                conflictingCredits.current.clear();
                return;
            }
            setRecovery((current) => current && selectedIds.has(current.clip.jobId) ? current : null);
            setTerminalMessages((current) => new Map([...current].filter(([jobId]) => selectedIds.has(jobId))));
        });
    }, [account, signature]);

    if (!EDITOR_SPEECH_CUT_ENABLED || !clips.length || !account) return null;
    if (quoteError) return <Card style={styles.card}>
        <Text variant="bodyStrong">{t('app.smartCut.native.analyse.quoteFailed')}</Text>
        <Button label={t('app.smartCut.native.analyse.quoteRetry')} variant="secondary" onPress={() => { setQuoteError(false); setQuote(undefined); setQuoteAttempt((value) => value + 1); }} />
    </Card>;
    if (!quote) return null;

    const activeQuote = quote;
    const ineligible = clips.filter((clip) => !Number.isFinite(clip.duration) || clip.duration < 0.5 || clip.duration > activeQuote.max_seconds);
    const analysed = (clip: SmartCutAnalysisClip) => validSmartCutAnalysis(analyses.get(clip.jobId), clip.jobId, clip.duration);
    const pending = clips.filter((clip) => !analysed(clip) && !ineligible.includes(clip));
    const actionable = pending.filter((clip) => !terminalMessages.has(clip.jobId));
    const terminal = pending.filter((clip) => terminalMessages.has(clip.jobId));
    const maximum = actionable.length * activeQuote.credits;

    function settle(clip: SmartCutAnalysisClip, outcome: SpeechOutcome, key: string, confirmed = false): boolean {
        if (typeof outcome.credits === 'number' && outcome.credits >= 0) {
            const previous = creditsByKey.current.get(key);
            if (previous === undefined) creditsByKey.current.set(key, outcome.credits);
            else if (outcome.credits !== previous) conflictingCredits.current.add(key);
        }
        const firstCredits = creditsByKey.current.get(key);
        const settled: SpeechOutcome = firstCredits === undefined ? outcome : { ...outcome, credits: firstCredits };
        const creditConflict = conflictingCredits.current.has(key);
        const net = creditConflict ? null : smartCutNetCredits(settled);
        if (settled.status === 'failed') {
            if (settled.refunded) {
                forgetSpeechKey(account, clip.jobId);
                creditsByKey.current.delete(key);
                conflictingCredits.current.delete(key);
                setMessages((current) => [...current, t('app.smartCut.native.analyse.refunded', { name: clip.label })]);
                setRecovery(null);
            } else {
                const message = confirmed
                    ? t('app.smartCut.native.analyse.failedConfirmed', { name: clip.label })
                    : net === 0
                    ? t('app.smartCut.native.analyse.failedNoCharge', { name: clip.label })
                    : net !== null
                        ? t('app.smartCut.native.analyse.failedCharged', { name: clip.label, credits: net })
                        : t('app.smartCut.native.analyse.failedPending', { name: clip.label });
                if (confirmed) {
                    setTerminalMessages((current) => new Map(current).set(clip.jobId, message));
                    setRecovery(null);
                } else setMessages((current) => [...current, message]);
            }
            return false;
        }
        if (settled.speech === false || !settled.analysis) {
            const message = net === 0
                ? t('app.smartCut.native.analyse.noSpeech', { name: clip.label })
                : net !== null
                    ? t('app.smartCut.native.analyse.noSpeechCharged', { name: clip.label, credits: net })
                    : t('app.smartCut.native.analyse.noSpeechMaximum', { name: clip.label, credits: activeQuote.credits });
            setTerminalMessages((current) => new Map(current).set(clip.jobId, message));
            setRecovery(null);
            return false;
        }
        const parsed = parseSmartCutAnalysis(settled.analysis, { assetId: clip.jobId, duration: clip.duration });
        if (!parsed.ok) {
            const message = net === 0
                ? t('app.smartCut.native.analyse.mismatchNoCharge', { name: clip.label, reason: parsed.error })
                : net !== null
                    ? t('app.smartCut.native.analyse.mismatchCharged', { name: clip.label, reason: parsed.error, credits: net })
                    : t('app.smartCut.native.analyse.mismatchPending', { name: clip.label, reason: parsed.error });
            setTerminalMessages((current) => new Map(current).set(clip.jobId, message));
            setRecovery(null);
            return false;
        }
        onAnalysed(clip.jobId, parsed.analysis);
        setTerminalMessages((current) => {
            if (!current.has(clip.jobId)) return current;
            const next = new Map(current); next.delete(clip.jobId); return next;
        });
        setMessages((current) => [...current, creditConflict
            ? t('app.smartCut.native.analyse.clipMaximum', { name: clip.label, credits: activeQuote.credits })
            : net === 0
            ? t('app.smartCut.native.analyse.reused', { name: clip.label })
            : net !== null ? t('app.smartCut.native.analyse.charged', { name: clip.label, credits: net }) : t('app.smartCut.native.analyse.clipMaximum', { name: clip.label, credits: activeQuote.credits })]);
        forgetSpeechKey(account, clip.jobId);
        creditsByKey.current.delete(key);
        conflictingCredits.current.delete(key);
        setRecovery(null);
        return true;
    }

    function settleBadResponse(current: Recovery, reason = 'bad_response') {
        const credits = creditsByKey.current.get(current.key);
        const message = conflictingCredits.current.has(current.key)
            ? t('app.smartCut.native.analyse.clipMaximum', { name: current.clip.label, credits: activeQuote.credits })
            : credits === 0
            ? t('app.smartCut.native.analyse.mismatchNoCharge', { name: current.clip.label, reason })
            : credits !== undefined
                ? t('app.smartCut.native.analyse.mismatchCharged', { name: current.clip.label, reason, credits })
                : t('app.smartCut.native.analyse.mismatchMaximum', { name: current.clip.label, reason, credits: activeQuote.credits });
        setTerminalMessages((messages) => new Map(messages).set(current.clip.jobId, message));
        setRecovery(null);
    }

    async function analyse() {
        if (disabled || running || !actionable.length || ineligible.length) return;
        const startedFor = signature;
        const abort = new AbortController();
        controller.current = abort;
        setRunning(true);
        setMessages([]);
        setProgress({ done: 0, total: actionable.length });
        setProgressStage('queued');
        progressNotification.current = createSmartCutProgressNotifier(progressNotificationsEnabled);
        progressNotification.current.update('queued', 0, actionable.length);
        let attempted: Recovery | null = null;
        try {
            for (const [index, clip] of actionable.entries()) {
                if (abort.signal.aborted || signatureRef.current !== startedFor || getCacheUser() !== account) throw new ApiError(0, 'cancelled');
                const key = speechKeyFor(account, clip.jobId, clip.duration, randomUUID);
                attempted = { clip, key };
                setRecovery(attempted);
                setProgressStage('queued');
                progressNotification.current?.update('queued', index, actionable.length);
                let first = await startSpeech(api, { account, jobId: clip.jobId, duration: clip.duration, key, credits: activeQuote.credits }, abort.signal);
                if (!creditsByKey.current.has(key) && typeof first.credits === 'number' && first.credits >= 0) creditsByKey.current.set(key, first.credits);
                attempted = { clip, key };
                setRecovery(attempted);
                if (first.status === 'queued') first = await pollSpeech(api, key, account, abort.signal, (stage) => {
                    setProgressStage(stage);
                    progressNotification.current?.update(stage, index, actionable.length);
                });
                if (signatureRef.current !== startedFor || getCacheUser() !== account) throw new ApiError(0, 'cancelled');
                setProgressStage('checking');
                progressNotification.current?.update('checking', index, actionable.length);
                if (!settle(clip, first, key)) { progressNotification.current?.dismiss(); progressNotification.current = null; break; }
                attempted = null;
                setProgress({ done: index + 1, total: actionable.length });
            }
            if (!attempted && live.current && signatureRef.current === startedFor) {
                progressNotification.current?.complete();
                progressNotification.current = null;
            }
        } catch (error) {
            const cancelled = abort.signal.aborted || (error instanceof ApiError && error.code === 'cancelled') || (error instanceof Error && error.name === 'AbortError');
            if (live.current && signatureRef.current === startedFor) {
                if (cancelled) {
                    if (attempted) setRecovery(attempted);
                    setMessages((current) => [...current, t('app.smartCut.native.analyse.cancelled')]);
                }
                else {
                    if (error instanceof ApiError && error.body.refunded === true && attempted) {
                        forgetSpeechKey(account, attempted.clip.jobId);
                        creditsByKey.current.delete(attempted.key);
                        conflictingCredits.current.delete(attempted.key);
                        setRecovery(null);
                        progressNotification.current?.dismiss();
                        progressNotification.current = null;
                        setMessages((current) => [...current, t('app.smartCut.native.analyse.refunded', { name: attempted!.clip.label })]);
                    } else if (error instanceof ApiError && error.code === 'price_changed' && Number.isSafeInteger(error.body.credits) && Number(error.body.credits) > 0) {
                        setQuote((current) => current ? { ...current, credits: Number(error.body.credits) } : current);
                        setRecovery(null);
                        progressNotification.current?.dismiss();
                        progressNotification.current = null;
                        setMessages((current) => [...current, speechMessage(error)]);
                    } else if (error instanceof ApiError && ['bad_response', 'analysis_invalid'].includes(error.code) && attempted) {
                        settleBadResponse(attempted, error.code);
                        progressNotification.current?.dismiss();
                        progressNotification.current = null;
                    } else {
                        const canRecover = error instanceof ApiError && (['outcome_pending', 'poll_timeout'].includes(error.code) || error.status === 0 || error.status >= 500);
                        if (!canRecover) {
                            setRecovery(null);
                            progressNotification.current?.dismiss();
                            progressNotification.current = null;
                        }
                        if (error instanceof ApiError && error.code === 'result_expired' && attempted) {
                            forgetSpeechKey(account, attempted.clip.jobId);
                            creditsByKey.current.delete(attempted.key);
                            conflictingCredits.current.delete(attempted.key);
                            setRecovery(null);
                        }
                        setMessages((current) => [...current, speechMessage(error)]);
                    }
                }
            }
        } finally {
            if (live.current && signatureRef.current === startedFor) setRunning(false);
            if (controller.current === abort) controller.current = null;
        }
    }

    async function checkStatus() {
        if (!recovery || running || getCacheUser() !== account) return;
        const startedFor = signature;
        const abort = new AbortController();
        controller.current = abort;
        setRunning(true);
        progressNotification.current = createSmartCutProgressNotifier(progressNotificationsEnabled);
        setProgressStage('queued');
        progressNotification.current.update('queued', progress.done, Math.max(progress.total, 1));
        try {
            let outcome = await recoverSpeech(api, recovery.key, account, abort.signal);
            if (outcome.status === 'queued') outcome = await pollSpeech(api, recovery.key, account, abort.signal, (stage) => {
                setProgressStage(stage);
                progressNotification.current?.update(stage, progress.done, Math.max(progress.total, 1));
            });
            if (signatureRef.current !== startedFor || getCacheUser() !== account) throw new ApiError(0, 'cancelled');
            setProgressStage('checking');
            progressNotification.current?.update('checking', progress.done, Math.max(progress.total, 1));
            if (settle(recovery.clip, outcome, recovery.key, true)) {
                setProgress((current) => ({ done: Math.min(current.done + 1, current.total), total: current.total }));
                progressNotification.current?.complete();
            } else progressNotification.current?.dismiss();
            progressNotification.current = null;
        } catch (error) {
            const cancelled = abort.signal.aborted || (error instanceof ApiError && error.code === 'cancelled') || (error instanceof Error && error.name === 'AbortError');
            if (!cancelled && live.current && signatureRef.current === startedFor) {
                if (error instanceof ApiError && error.body.refunded === true) {
                    forgetSpeechKey(account, recovery.clip.jobId);
                    creditsByKey.current.delete(recovery.key);
                    conflictingCredits.current.delete(recovery.key);
                    setRecovery(null);
                    progressNotification.current?.dismiss();
                    progressNotification.current = null;
                    setMessages((current) => [...current, t('app.smartCut.native.analyse.refunded', { name: recovery.clip.label })]);
                } else {
                    if (error instanceof ApiError && error.code === 'request_not_found') {
                        forgetSpeechKey(account, recovery.clip.jobId);
                        creditsByKey.current.delete(recovery.key);
                        conflictingCredits.current.delete(recovery.key);
                        setRecovery(null);
                        progressNotification.current?.dismiss();
                        progressNotification.current = null;
                        setMessages((current) => [...current, t('app.smartCut.native.analyse.notAccepted', { name: recovery.clip.label })]);
                    } else if (error instanceof ApiError && error.code === 'result_expired') {
                        forgetSpeechKey(account, recovery.clip.jobId);
                        creditsByKey.current.delete(recovery.key);
                        conflictingCredits.current.delete(recovery.key);
                        setRecovery(null);
                        progressNotification.current?.dismiss();
                        progressNotification.current = null;
                        setMessages((current) => [...current, speechMessage(error)]);
                    } else if (error instanceof ApiError && ['bad_response', 'analysis_invalid'].includes(error.code)) {
                        settleBadResponse(recovery, error.code);
                        progressNotification.current?.dismiss();
                        progressNotification.current = null;
                    } else {
                        setMessages((current) => [...current, speechMessage(error)]);
                    }
                }
            }
        } finally {
            if (live.current && signatureRef.current === startedFor) setRunning(false);
            if (controller.current === abort) controller.current = null;
        }
    }

    const ready = clips.every(analysed);
    return <Card style={styles.card}>
        <Text variant="title2" accessibilityRole="header">{t('app.smartCut.native.analyse.title')}</Text>
        <Text tone="secondary">{t('app.smartCut.native.analyse.body')}</Text>
        <Text variant="footnote" tone="secondary">{t('app.smartCut.native.analyse.limits', { max: activeQuote.max_seconds })}</Text>
        {clips.map((clip) => ineligible.includes(clip)
            ? <Text key={clip.jobId} tone="danger" accessibilityRole="alert">{t('app.smartCut.native.analyse.tooLong', { name: clip.label, max: activeQuote.max_seconds })}</Text>
            : <Text key={clip.jobId} variant="footnote" tone="secondary">{t('app.smartCut.native.analyse.eligible', { name: clip.label, duration: Math.round(clip.duration * 10) / 10 })}</Text>)}
        {[...terminalMessages].map(([jobId, message]) => <Text key={jobId} variant="footnote" tone="danger" accessibilityRole="alert">{message}</Text>)}
        {ready ? <Text accessibilityLiveRegion="polite">{t('app.smartCut.native.analyse.done')}</Text> : ineligible.length > 0 || !actionable.length ? null : running ? <>
            <Button label={t('app.smartCut.native.analyse.running', { done: Math.min(progress.done + 1, progress.total), total: progress.total })} loading onPress={() => undefined} />
            <Text testID="smart-cut-analysis-stage" accessibilityLiveRegion="polite" variant="footnote" tone="secondary">
                {t(smartCutProgressStageKey(progressStage))}
            </Text>
            <Button label={t('app.smartCut.native.analyse.cancel')} variant="tertiary" onPress={() => controller.current?.abort()} />
        </> : recovery ? <Button label={t('app.smartCut.native.analyse.checkStatus')} variant="secondary" onPress={() => void checkStatus()} /> : <>
            <Text tone="secondary">{t('app.smartCut.native.analyse.privacy')}</Text>
            <Text variant="bodyStrong" tone="accent">{t('app.smartCut.native.analyse.maximum', { total: maximum, credits: activeQuote.credits })}</Text>
            <Button label={t('app.smartCut.native.analyse.start')} disabled={disabled} onPress={() => void analyse()} />
        </>}
        <View style={styles.messages}>{messages.map((message, index) => <Text key={`${message}:${index}`} variant="footnote" accessibilityLiveRegion="polite">{message}</Text>)}</View>
        {!ready && ineligible.length > 0 ? <Text variant="footnote" tone="secondary">{t('app.smartCut.native.analyse.ineligibleBlocked', { names: ineligible.map((clip) => clip.label).join(', '), max: activeQuote.max_seconds })}</Text> : null}
        {!ready && actionable.length > 0 ? <Text variant="footnote" tone="secondary">{t('app.smartCut.native.analyse.blocked', { names: actionable.map((clip) => clip.label).join(', ') })}</Text> : null}
        {!ready && terminal.length > 0 ? <Text variant="footnote" tone="secondary">{t('app.smartCut.native.analyse.terminalBlocked', { names: terminal.map((clip) => clip.label).join(', ') })}</Text> : null}
    </Card>;
}

const sheets = themedStyles((p) => ({
    card: { padding: ds.space.md, gap: ds.space.sm, borderColor: p.accent, backgroundColor: p.accentSubtle },
    messages: { gap: ds.space.xs },
}));
