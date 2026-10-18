import * as Crypto from 'expo-crypto';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { LengthProbe } from '../../../components/LengthProbe';
import { touchTarget } from '../../../lib/a11y';
import { aiConsent } from '../../../lib/aiConsentStore';
import {
    CAPTION_PRESETS,
    DEFAULT_CAPTION_PRESET,
    MAX_CLIPS,
    MAX_OUTPUT_S,
    STEP_S,
    clipSeconds,
    editErrorKey,
    moveClip,
    newClip,
    priceChanged,
    quoteEdit,
    stepEnd,
    stepStart,
    submitEdit,
    totalSeconds,
    validateEdit,
    type Clip,
} from '../../../lib/clipEdit';
import { plural, t } from '../../../lib/i18n';
import { fetchCatalog, kindOf, mediaApi, type CatalogModel, type Job } from '../../../lib/media';
import { colors } from '../../../theme';

interface Pending {
    readonly job: Job;
    readonly url: string;
}

const seconds = (n: number) => (Math.round(n * 10) / 10).toString();

export default function QuickEdit() {
    const { api } = useAuth();
    const router = useRouter();
    const [videos, setVideos] = useState<Job[] | null>(null);
    const [clips, setClips] = useState<Clip[]>([]);
    const [pending, setPending] = useState<Pending[]>([]);
    const [adding, setAdding] = useState(false);
    const [captionsOn, setCaptionsOn] = useState(false);
    const [preset, setPreset] = useState<string>(DEFAULT_CAPTION_PRESET);
    const [stage, setStage] = useState<'edit' | 'review'>('edit');
    const [credits, setCredits] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    // The same edit keeps its key, so the quote and the send are one request and a retry is charged once.
    const keyRef = useRef<{ signature: string; key: string } | null>(null);

    const captions = captionsOn ? preset : null;
    const names = useRef(new Map<string, string>());

    useEffect(() => {
        let cancelled = false;
        Promise.all([mediaApi(api).listJobs(), fetchCatalog()])
            .then(([page, catalog]) => {
                if (cancelled) return;
                const byId = new Map<string, CatalogModel>(catalog.map((m) => [m.id, m]));
                const list = page.jobs.filter((j) => j.state === 'succeeded' && j.has_asset && kindOf(byId.get(j.model_id)?.modality ?? '') === 'video');
                for (const j of list) names.current.set(j.job_id, j.label || byId.get(j.model_id)?.name || t('edit.untitled'));
                setVideos(list);
            })
            .catch(() => !cancelled && setProblem(t('common.error')));
        return () => {
            cancelled = true;
        };
    }, [api]);

    const onLength = useCallback((job: Job, length: number) => {
        setPending((p) => p.filter((x) => x.job.job_id !== job.job_id));
        setClips((c) => [...c, newClip({ jobId: job.job_id, label: names.current.get(job.job_id) ?? t('edit.untitled') }, length)]);
    }, []);
    const onFail = useCallback((job: Job) => {
        setPending((p) => p.filter((x) => x.job.job_id !== job.job_id));
        setProblem(t('edit.unreadable'));
    }, []);

    async function add(job: Job) {
        if (clips.length + pending.length >= MAX_CLIPS) return setProblem(t('edit.problem.too_many'));
        setProblem(null);
        try {
            const a = await mediaApi(api).getAsset(job.job_id);
            setPending((p) => [...p, { job, url: a.url }]);
        } catch (err) {
            setProblem(t(editErrorKey(err)));
        }
    }

    const check = validateEdit(clips, captions);
    const total = totalSeconds(clips);

    async function review() {
        if (check) return setProblem(t(`edit.problem.${check}`));
        setBusy(true);
        setProblem(null);
        try {
            await aiConsent.ensure('/api/v1/generations', 'POST');
            const signature = JSON.stringify([clips.map((c) => [c.jobId, c.start, c.end]), captions]);
            const key = keyRef.current?.signature === signature ? keyRef.current.key : Crypto.randomUUID();
            keyRef.current = { signature, key };
            const q = await quoteEdit(api, clips, captions, key);
            if (q.kind === 'created') return router.replace({ pathname: '/job/[id]', params: { id: q.jobId } });
            setCredits(q.credits);
            setStage('review');
        } catch (err) {
            setProblem(t(editErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    async function confirm() {
        if (credits === null || !keyRef.current) return;
        setBusy(true);
        setProblem(null);
        try {
            const r = await submitEdit(api, clips, captions, credits, keyRef.current.key);
            keyRef.current = null;
            router.replace({ pathname: '/job/[id]', params: { id: r.jobId } });
        } catch (err) {
            const now = priceChanged(err);
            if (now !== null) {
                setCredits(now);
                setProblem(t('edit.priceChanged', { credits: now }));
            } else {
                setProblem(t(editErrorKey(err)));
            }
        } finally {
            setBusy(false);
        }
    }

    const library = useMemo(() => videos ?? [], [videos]);

    if (stage === 'review' && credits !== null) {
        return (
            <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
                <Stack.Screen options={{ title: t('edit.reviewTitle') }} />
                {clips.map((c, i) => (
                    <Text key={`${c.jobId}-${i}`} style={styles.line}>
                        {i + 1}. {c.label}: {seconds(c.start)} s to {seconds(c.end)} s
                    </Text>
                ))}
                <Text style={styles.line}>{t('edit.total', { seconds: seconds(total), max: MAX_OUTPUT_S })}</Text>
                {captions ? <Text style={styles.line}>{t('edit.captionsWith', { preset: captions })}</Text> : null}
                <Text style={styles.price}>{plural('edit.costs', credits)}</Text>
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ busy }} style={[styles.button, busy && styles.off]} onPress={confirm}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('edit.confirm')}</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={() => { setStage('edit'); setCredits(null); setProblem(null); }}>
                    <Text style={styles.link}>{t('edit.backToEditing')}</Text>
                </Pressable>
            </ScrollView>
        );
    }

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ title: t('edit.title') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {pending.map((p) => (
                    <LengthProbe key={p.job.job_id} url={p.url} onLength={(s) => onLength(p.job, s)} onFail={() => onFail(p.job)} />
                ))}
                <Text style={styles.intro}>{t('edit.intro')}</Text>

                {clips.map((c, i) => (
                    <View key={`${c.jobId}-${i}`} style={styles.card}>
                        <Text style={styles.name} accessibilityRole="header">{c.label}</Text>
                        <Text style={styles.muted}>{t('edit.length', { seconds: seconds(c.length ?? 0) })} · {t('edit.uses', { seconds: seconds(clipSeconds(c)) })}</Text>
                        <Stepper label={t('edit.start')} value={c.start} onLess={() => setClips((x) => x.map((y, k) => (k === i ? stepStart(y, -STEP_S) : y)))} onMore={() => setClips((x) => x.map((y, k) => (k === i ? stepStart(y, STEP_S) : y)))} lessLabel={t('edit.startEarlier')} moreLabel={t('edit.startLater')} />
                        <Stepper label={t('edit.end')} value={c.end} onLess={() => setClips((x) => x.map((y, k) => (k === i ? stepEnd(y, -STEP_S) : y)))} onMore={() => setClips((x) => x.map((y, k) => (k === i ? stepEnd(y, STEP_S) : y)))} lessLabel={t('edit.endEarlier')} moreLabel={t('edit.endLater')} />
                        <View style={styles.actions}>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('edit.up')} disabled={i === 0} style={[styles.small, i === 0 && styles.off]} onPress={() => setClips((x) => moveClip(x, i, -1))}><Text style={styles.smallText}>↑</Text></Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('edit.down')} disabled={i === clips.length - 1} style={[styles.small, i === clips.length - 1 && styles.off]} onPress={() => setClips((x) => moveClip(x, i, 1))}><Text style={styles.smallText}>↓</Text></Pressable>
                            <Pressable accessibilityRole="button" style={styles.small} onPress={() => setClips((x) => x.filter((_, k) => k !== i))}><Text style={styles.removeText}>{t('edit.remove')}</Text></Pressable>
                        </View>
                    </View>
                ))}
                {pending.length > 0 ? <Text style={styles.muted}>{t('edit.reading')}</Text> : null}

                <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setAdding((a) => !a)}>
                    <Text style={styles.secondaryText}>{t('edit.add')}</Text>
                </Pressable>
                {adding ? (
                    videos === null ? (
                        <ActivityIndicator color={colors.accent} />
                    ) : library.length === 0 ? (
                        <Text style={styles.muted}>{t('edit.none')}</Text>
                    ) : (
                        library.slice(0, 30).map((j) => (
                            <Pressable key={j.job_id} accessibilityRole="button" style={styles.row} onPress={() => add(j)}>
                                <Text style={styles.name}>{names.current.get(j.job_id)}</Text>
                                <Text style={styles.muted}>{new Date(j.created_at).toLocaleDateString()}</Text>
                            </Pressable>
                        ))
                    )
                ) : null}

                <View style={styles.switchRow}>
                    <Text style={styles.name}>{t('edit.captionsOn')}</Text>
                    <Switch accessibilityLabel={t('edit.captionsOn')} value={captionsOn} onValueChange={setCaptionsOn} trackColor={{ true: colors.accent, false: colors.border }} />
                </View>
                {captionsOn ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                        {CAPTION_PRESETS.map((p) => (
                            <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: preset === p }} style={[styles.chip, preset === p && styles.chipOn]} onPress={() => setPreset(p)}>
                                <Text style={[styles.chipText, preset === p && styles.chipTextOn]}>{p}</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                ) : null}

                <Text style={[styles.muted, total > MAX_OUTPUT_S && styles.warn]}>{t('edit.total', { seconds: seconds(total), max: MAX_OUTPUT_S })}</Text>
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy || pending.length > 0} accessibilityState={{ busy }} style={[styles.button, (busy || pending.length > 0 || !!check) && styles.off]} onPress={review}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('edit.review')}</Text>}
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function Stepper({ label, value, onLess, onMore, lessLabel, moreLabel }: { label: string; value: number; onLess: () => void; onMore: () => void; lessLabel: string; moreLabel: string }) {
    return (
        <View style={styles.stepper}>
            <Text style={styles.stepLabel}>{label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={lessLabel} style={styles.stepButton} onPress={onLess}><Text style={styles.smallText}>−</Text></Pressable>
            <Text style={styles.stepValue} accessibilityLabel={`${label} ${seconds(value)}`}>{seconds(value)} s</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={moreLabel} style={styles.stepButton} onPress={onMore}><Text style={styles.smallText}>+</Text></Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 12 },
    intro: { color: colors.body },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    line: { color: colors.body, fontSize: 15 },
    warn: { color: colors.money },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepLabel: { color: colors.body, width: 56 },
    stepValue: { color: colors.text, minWidth: 72, textAlign: 'center', fontSize: 16 },
    stepButton: { minWidth: 44, minHeight: 44, borderRadius: 10, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    small: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    smallText: { color: colors.text, fontSize: 18 },
    removeText: { color: colors.danger },
    row: { minHeight: 52, justifyContent: 'center', paddingVertical: 8, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
    chips: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    secondary: { minHeight: 48, borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.text, fontSize: 16 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    price: { color: colors.money, fontSize: 18, fontWeight: '700' },
    link: { color: colors.accent, fontSize: 16, textAlign: 'center' },
    error: { color: colors.danger },
});
