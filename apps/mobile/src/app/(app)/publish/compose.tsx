import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchCatalog, mediaApi, type CatalogModel, type Job } from '../../../lib/media';
import { fetchAccounts, publishErrorMessage, type PublishAccount } from '../../../lib/publish';
import { MAX_TEXT, captionWarning, composeErrorMessage, createBody, createPost, eligibleAccounts, mediaTypeOf, validateDraft, type Draft, type MediaType, type When } from '../../../lib/publishCompose';
import { WhenPicker, whenFrom } from '../../../components/WhenPicker';
import { appStorage, getCacheUser } from '../../../lib/appCache';
import { createDraftKeys, draftSignature, isDefiniteRefusal } from '../../../lib/draftKey';
import { colors } from '../../../theme';
import { usePublishApi } from '../../../lib/usePublishApi';

const draftKeys = createDraftKeys(appStorage);

interface Pick {
    readonly job: Job;
    readonly mediaType: MediaType;
    readonly name: string;
}

export default function Compose() {
    const api = usePublishApi();
    const router = useRouter();
    const { jobId: presetJob } = useLocalSearchParams<{ jobId?: string }>();
    const [picks, setPicks] = useState<Pick[] | null>(null);
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chosen, setChosen] = useState<Pick | null>(null);
    const [accountIds, setAccountIds] = useState<string[]>([]);
    const [text, setText] = useState('');
    const [schedule, setSchedule] = useState(false);
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

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
                if (presetJob) setChosen(list.find((p) => p.job.job_id === presetJob) ?? null);
            })
            .catch((err) => !cancelled && setError(publishErrorMessage(err)));
        return () => {
            cancelled = true;
        };
    }, [api, presetJob]);

    const eligible = useMemo(() => (chosen && accounts ? eligibleAccounts(accounts, chosen.mediaType) : []), [chosen, accounts]);
    const selected = eligible.filter((a) => accountIds.includes(a.id));
    const when: When | null = !schedule ? { kind: 'now' } : (() => { const d = whenFrom(date, time); return d ? { kind: 'at', at: d } : null; })();
    const warn = captionWarning(text, selected.map((a) => a.network));

    function toggle(id: string) {
        setAccountIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    }

    function submit() {
        if (!chosen || busy) return;
        if (!when) {
            setProblem('Enter the date as YYYY-MM-DD and the time as HH:MM.');
            return;
        }
        const draft: Draft = { jobId: chosen.job.job_id, mediaType: chosen.mediaType, accountIds: selected.map((a) => a.id), text, when };
        const now = new Date();
        const invalid = validateDraft(draft, accounts ?? [], now);
        if (invalid) {
            setProblem(invalid);
            return;
        }
        setProblem(null);
        const where = selected.map((a) => `${a.displayName} (${a.network})`).join(', ');
        const answer = when.kind === 'now' ? `This posts to ${where} now and is public. It cannot be undone from here.` : `This schedules a post to ${where} for ${when.at.toLocaleString()}. You can change or cancel it until it starts.`;
        Alert.alert(when.kind === 'now' ? 'Post now?' : 'Schedule this post?', answer, [
            { text: 'Cancel', style: 'cancel' },
            { text: when.kind === 'now' ? 'Post now' : 'Schedule', onPress: () => void send(draft, now) },
        ]);
    }

    async function send(draft: Draft, now: Date) {
        // The key is saved before the send and kept until the server answers, so a retry after a dropped connection,
        // or after the app was closed in the middle, is the same post and cannot be published twice (ADR-0122).
        const user = getCacheUser();
        const key = await draftKeys.keyFor(user, draftSignature(draft));
        setBusy(true);
        try {
            await createPost(api, createBody(draft, key, now));
            await draftKeys.drop(user);
            router.replace('/publish/posts');
        } catch (err) {
            if (isDefiniteRefusal(err)) await draftKeys.drop(user);
            setProblem(composeErrorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    if (error) return <View style={styles.screen}><Text style={styles.error}>{error}</Text></View>;
    if (!picks || !accounts) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: 'New post' }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.heading} accessibilityRole="header">1. Creation</Text>
                {picks.length === 0 ? <Text style={styles.muted}>No finished images or videos yet. Make one in Create first.</Text> : null}
                {picks.slice(0, 30).map((p) => (
                    <Pressable key={p.job.job_id} accessibilityRole="button" accessibilityState={{ selected: chosen?.job.job_id === p.job.job_id }} style={[styles.row, chosen?.job.job_id === p.job.job_id && styles.rowOn]} onPress={() => { setChosen(p); setAccountIds([]); }}>
                        <Text style={styles.rowText}>{p.name}</Text>
                        <Text style={styles.muted}>{p.mediaType} · {new Date(p.job.created_at).toLocaleDateString()}</Text>
                    </Pressable>
                ))}

                {chosen ? (
                    <>
                        <Text style={styles.heading} accessibilityRole="header">2. Accounts</Text>
                        {eligible.length === 0 ? <Text style={styles.muted}>No connected account can post a {chosen.mediaType} yet. Connect one on veyrnox.ai.</Text> : null}
                        <View style={styles.chips}>
                            {eligible.map((a) => (
                                <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ selected: accountIds.includes(a.id) }} style={[styles.chip, accountIds.includes(a.id) && styles.chipOn]} onPress={() => toggle(a.id)}>
                                    <Text style={[styles.chipText, accountIds.includes(a.id) && styles.chipTextOn]}>{a.displayName} · {a.network}</Text>
                                </Pressable>
                            ))}
                        </View>

                        <Text style={styles.heading} accessibilityRole="header">3. Text</Text>
                        <TextInput style={styles.input} multiline value={text} onChangeText={setText} placeholder="Write the caption" accessibilityLabel="Caption" placeholderTextColor={colors.muted} maxLength={MAX_TEXT} />
                        <Text style={styles.muted}>{text.length} / {MAX_TEXT}</Text>
                        {warn ? <Text style={styles.warn}>{warn}</Text> : null}

                        <Text style={styles.heading} accessibilityRole="header">4. When</Text>
                        <View style={styles.chips}>
                            <Pressable accessibilityRole="button" style={[styles.chip, !schedule && styles.chipOn]} onPress={() => setSchedule(false)}><Text style={[styles.chipText, !schedule && styles.chipTextOn]}>Post now</Text></Pressable>
                            <Pressable accessibilityRole="button" style={[styles.chip, schedule && styles.chipOn]} onPress={() => setSchedule(true)}><Text style={[styles.chipText, schedule && styles.chipTextOn]}>Schedule</Text></Pressable>
                        </View>
                        {schedule ? (
                            <WhenPicker date={date} time={time} onChange={(d, t) => { setDate(d); setTime(t); }} />
                        ) : null}

                        {problem ? <Text style={styles.error}>{problem}</Text> : null}
                        <Pressable accessibilityRole="button" disabled={busy || selected.length === 0} style={[styles.button, (busy || selected.length === 0) && styles.off]} onPress={submit}>
                            {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{schedule ? 'Schedule' : 'Post now'}</Text>}
                        </Pressable>
                    </>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 10 },
    heading: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 10 },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
    rowOn: { borderColor: colors.accent },
    rowText: { color: colors.text, fontSize: 15 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    muted: { color: colors.muted, fontSize: 13 },
    warn: { color: colors.money, fontSize: 13 },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});
