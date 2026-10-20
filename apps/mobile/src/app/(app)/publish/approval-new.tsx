import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { WhenPicker, whenFrom } from '../../../components/WhenPicker';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { appStorage, getCacheUser } from '../../../lib/appCache';
import { createDraftKeys, isDefiniteRefusal } from '../../../lib/draftKey';
import { t } from '../../../lib/i18n';
import { fetchCatalog, mediaApi, type CatalogModel, type Job } from '../../../lib/media';
import { fetchAccounts, publishErrorMessage, type PublishAccount } from '../../../lib/publish';
import { MAX_REVIEWERS, approvalCreateErrorKey, createApproval, parseReviewers, signatureOf, validateApproval, type ApprovalDraft, type Created, type Policy } from '../../../lib/publishApprovalCreate';
import { MAX_TEXT, eligibleAccounts, mediaTypeOf, type MediaType } from '../../../lib/publishCompose';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const draftKeys = createDraftKeys(appStorage);

interface Pick {
    readonly job: Job;
    readonly mediaType: MediaType;
    readonly name: string;
}

export default function ApprovalNew() {
    const api = usePublishApi();
    const router = useRouter();
    const [picks, setPicks] = useState<Pick[] | null>(null);
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chosen, setChosen] = useState<Pick | null>(null);
    const [accountIds, setAccountIds] = useState<string[]>([]);
    const [text, setText] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [reviewerText, setReviewerText] = useState('');
    const [policy, setPolicy] = useState<Policy>('any');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [created, setCreated] = useState<Created | null>(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([mediaApi(api).listJobs(), fetchCatalog(), fetchAccounts(api)])
            .then(([page, catalog, acc]) => {
                if (cancelled) return;
                const byId = new Map<string, CatalogModel>(catalog.map((m) => [m.id, m]));
                const list: Pick[] = [];
                for (const job of page.jobs) {
                    const model = byId.get(job.model_id);
                    const mediaType = model ? mediaTypeOf(model.modality) : null;
                    if (job.state === 'succeeded' && job.has_asset && model && mediaType) list.push({ job, mediaType, name: job.label || model.name });
                }
                setPicks(list);
                setAccounts(acc.accounts);
            })
            .catch((err) => !cancelled && setError(publishErrorMessage(err)));
        return () => {
            cancelled = true;
        };
    }, [api]);

    const eligible = useMemo(() => (chosen && accounts ? eligibleAccounts(accounts, chosen.mediaType) : []), [chosen, accounts]);
    const reviewers = parseReviewers(reviewerText);

    function submit() {
        if (!chosen || busy) return;
        const at = whenFrom(date, time);
        if (!at) {
            setProblem(t('approvals.err.timeFormat'));
            return;
        }
        if (reviewers.rejected.length > 0) {
            setProblem(t('approvals.err.badReviewer', { value: reviewers.rejected[0] }));
            return;
        }
        const draft: ApprovalDraft = { jobId: chosen.job.job_id, mediaType: chosen.mediaType, accountIds, text, scheduledAt: at, reviewers: reviewers.emails, policy };
        const invalid = validateApproval(draft, new Date());
        if (invalid) {
            setProblem(t(invalid));
            return;
        }
        setProblem(null);
        const where = eligible.filter((a) => accountIds.includes(a.id)).map((a) => `${a.displayName} (${a.network})`).join(', ');
        Alert.alert(t('approvals.confirmTitle'), t('approvals.confirmBody', { reviewers: reviewers.emails.join(', '), where, when: at.toLocaleString(), policy: t(`approvals.policy.${policy}`) }), [
            { text: t('approvals.cancel'), style: 'cancel' },
            { text: t('approvals.send'), onPress: () => void send(draft) },
        ]);
    }

    async function send(draft: ApprovalDraft) {
        const user = getCacheUser();
        const key = await draftKeys.keyFor(user, signatureOf(draft));
        setBusy(true);
        try {
            setCreated(await createApproval(api, draft, key));
            await draftKeys.drop(user);
        } catch (err) {
            if (isDefiniteRefusal(err)) await draftKeys.drop(user);
            setProblem(t(approvalCreateErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    // The link goes only to the share sheet, on a tap, and nowhere else.
    async function shareLink(url: string) {
        try {
            await Share.share({ message: url });
        } catch {
            setProblem(t('approvals.err.share'));
        }
    }

    if (error) return <View style={styles.pad}><Text style={styles.error}>{error}</Text></View>;
    if (!picks || !accounts) return <View style={styles.pad}><ActivityIndicator color={colors.accent} /></View>;

    if (created) {
        return (
            <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
                <Stack.Screen options={{ title: t('approvals.sentTitle') }} />
                <Text style={styles.heading} accessibilityRole="header">{t('approvals.sentHeading')}</Text>
                <Text style={styles.muted}>{t('approvals.sentNote')}</Text>
                {created.links.length === 0 ? <Text style={styles.muted}>{t('approvals.noLinks')}</Text> : null}
                {created.links.map((l) => (
                    <View key={l.email} style={styles.card}>
                        <Text style={styles.name}>{l.email}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('approvals.shareFor', { email: l.email })} style={[styles.button, touchTarget]} onPress={() => shareLink(l.url)}>
                            <Text style={styles.buttonText}>{t('approvals.shareLink')}</Text>
                        </Pressable>
                    </View>
                ))}
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                <Pressable accessibilityRole="button" style={[styles.plain, touchTarget]} onPress={() => router.replace('/publish/approvals')}>
                    <Text style={styles.plainText}>{t('approvals.done')}</Text>
                </Pressable>
            </ScrollView>
        );
    }

    return (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: t('approvals.newTitle') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.muted}>{t('approvals.newIntro')}</Text>
                <Text style={styles.heading} accessibilityRole="header">{t('approvals.step.creation')}</Text>
                {picks.length === 0 ? <Text style={styles.muted}>{t('approvals.noCreations')}</Text> : null}
                {picks.slice(0, 30).map((p) => (
                    <Pressable key={p.job.job_id} accessibilityRole="button" accessibilityState={{ selected: chosen?.job.job_id === p.job.job_id }} style={[styles.row, touchTarget, chosen?.job.job_id === p.job.job_id && styles.rowOn]} onPress={() => { setChosen(p); setAccountIds([]); }}>
                        <Text style={styles.name}>{p.name}</Text>
                        <Text style={styles.muted}>{p.mediaType} · {new Date(p.job.created_at).toLocaleDateString()}</Text>
                    </Pressable>
                ))}
                {chosen ? (
                    <>
                        <Text style={styles.heading} accessibilityRole="header">{t('approvals.step.accounts')}</Text>
                        {eligible.length === 0 ? <Text style={styles.muted}>{t('approvals.noAccounts', { type: chosen.mediaType })}</Text> : null}
                        <View style={styles.chips}>
                            {eligible.map((a) => {
                                const on = accountIds.includes(a.id);
                                return (
                                    <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, touchTarget, on && styles.chipOn]} onPress={() => setAccountIds((ids) => (on ? ids.filter((x) => x !== a.id) : [...ids, a.id]))}>
                                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{a.displayName} · {a.network}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                        <Text style={styles.heading} accessibilityRole="header">{t('approvals.step.text')}</Text>
                        <TextInput style={styles.input} multiline value={text} onChangeText={setText} maxLength={MAX_TEXT} placeholder={t('approvals.textPlaceholder')} accessibilityLabel={t('approvals.step.text')} placeholderTextColor={colors.muted} />
                        <Text style={styles.heading} accessibilityRole="header">{t('approvals.step.when')}</Text>
                        <Text style={styles.muted}>{t('approvals.whenNote')}</Text>
                        <WhenPicker date={date} time={time} onChange={(d, tm) => { setDate(d); setTime(tm); }} />
                        <Text style={styles.heading} accessibilityRole="header">{t('approvals.step.reviewers')}</Text>
                        <TextInput style={styles.input} multiline value={reviewerText} onChangeText={setReviewerText} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder={t('approvals.reviewersPlaceholder', { max: MAX_REVIEWERS })} accessibilityLabel={t('approvals.step.reviewers')} placeholderTextColor={colors.muted} />
                        <Text style={styles.muted}>{t('approvals.reviewerCount', { count: reviewers.emails.length, max: MAX_REVIEWERS })}</Text>
                        <View style={styles.chips}>
                            {(['any', 'all'] as const).map((p) => (
                                <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: policy === p }} style={[styles.chip, touchTarget, policy === p && styles.chipOn]} onPress={() => setPolicy(p)}>
                                    <Text style={[styles.chipText, policy === p && styles.chipTextOn]}>{t(`approvals.policy.${p}`)}</Text>
                                </Pressable>
                            ))}
                        </View>
                        {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                        <Pressable accessibilityRole="button" disabled={busy || accountIds.length === 0} accessibilityState={{ disabled: busy || accountIds.length === 0 }} style={[styles.button, touchTarget, (busy || accountIds.length === 0) && styles.off]} onPress={submit}>
                            {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('approvals.send')}</Text>}
                        </Pressable>
                    </>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    pad: { flex: 1, backgroundColor: colors.background, padding: 16 },
    body: { padding: 16, paddingBottom: VEY_CLEARANCE, gap: 10 },
    heading: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 10 },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
    rowOn: { borderColor: colors.accent },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
    name: { color: colors.text, fontSize: 15 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    plain: { alignItems: 'center', justifyContent: 'center' },
    plainText: { color: colors.accent, fontWeight: '600' },
    off: { opacity: 0.4 },
});
