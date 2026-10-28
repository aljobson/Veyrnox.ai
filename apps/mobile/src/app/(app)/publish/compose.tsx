import { Text as StatusText } from '../../../components/ui/Text';
import { Button, Text as ThemedText } from '../../../components/ui';
import { NetworkLogo } from '../../../components/publish/NetworkLogo';
import { MediaLibraryGrid } from '../../../components/publish/MediaLibraryGrid';
import { ChosenMediaPreview } from '../../../components/publish/ChosenMediaPreview';
import { NetworkPreviews } from '../../../components/publish/NetworkPreviews';
import { networkName } from '../../../lib/networkLogos';
import { usePublishRole } from '../../../lib/usePublishRole';
import { canPublish } from '../../../lib/publishDashboard';
import { composeGates, toggleAccount } from '../../../lib/publishComposeGates';
import { ComposePresets } from '../../../components/publish/ComposePresets';
import { brandStore } from '../../../lib/publishBrand';
import { presetScopeToken } from '../../../lib/publishPresets';
import { PublishMediaSelection } from '../../../components/PublishMediaSelection';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchCatalog, mediaApi, type CatalogModel } from '../../../lib/media';
import { fetchAccounts, publishErrorMessage, type PublishAccount } from '../../../lib/publish';
import { MAX_TEXT, mediaBlocker, networkLabel, captionWarning, cleanNetworkText, composeErrorMessage, createBody, createPost, mediaTypeOf, validateDraft, type Draft, type When, type YoutubeVisibility } from '../../../lib/publishCompose';
import { confirmSlot, fetchQueues, queueErrorKey, reserveSlot, type PublishQueue } from '../../../lib/publishQueues';
import { NetworkTextFields, QueuePicker, YoutubeVisibilityChips } from '../../../components/ComposeExtras';
import { formatLocale, t } from '../../../lib/i18n';
import { WhenPicker, whenFrom } from '../../../components/WhenPicker';
import { appStorage, getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { createDraftKeys, draftSignature, isDefiniteRefusal } from '../../../lib/draftKey';
import { PublishUploadPanel } from '../../../components/PublishUploadPanel';
import { choiceMedia, toggleChoice, type CreationPick, type MediaChoice } from '../../../lib/publishMediaChoice';
import { colors } from '../../../theme';
import { usePublishApi } from '../../../lib/usePublishApi';

const draftKeys = createDraftKeys(appStorage);

export default function Compose() {
    const api = usePublishApi();
    const router = useRouter();
    const role = usePublishRole(api);
    const { jobId: presetJob } = useLocalSearchParams<{ jobId?: string }>();
    const [picks, setPicks] = useState<CreationPick[] | null>(null);
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [choices, setChoices] = useState<MediaChoice[]>([]);
    const chosen = choices[0] || null;
    const [carouselEnabled, setCarouselEnabled] = useState(false);
    const [accountIds, setAccountIds] = useState<string[]>([]);

    const [gates, setGates] = useState<ReturnType<typeof composeGates> | null>(null);
    const [freePlan, setFreePlan] = useState(false);
    const presetScope = useRef<string | null>(null);
    const prefillAllowed = useRef(true);
    const [scopeVersion, setScopeVersion] = useState(0);
    const scopeGeneration = useRef(0), currentApi = useRef(api);
    currentApi.current = api;
    const [scopeNote, setScopeNote] = useState(false);
    const [text, setText] = useState('');
    const [mode, setMode] = useState<'now' | 'schedule' | 'queue'>('schedule');
    const [networkText, setNetworkText] = useState<Record<string, string>>({});
    const [ytVisibility, setYtVisibility] = useState<YoutubeVisibility>('private');
    const [queues, setQueues] = useState<PublishQueue[]>([]);
    const [queueId, setQueueId] = useState<string | null>(null);
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [uploadsEnabled, setUploadsEnabled] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const preparingRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        const reset = () => {
            scopeGeneration.current++; prefillAllowed.current = false;
            setAccountIds([]); setChoices([]); setQueueId(null); setAccounts(null); setQueues([]); setGates(null); setFreePlan(false); setMode('schedule'); setPicks(null); setError(null); setProblem(null);
            if (presetScope.current) { setText(''); setNetworkText({}); presetScope.current = null; setScopeNote(true); }
            setScopeVersion(v => v + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { scopeGeneration.current++; userOff(); brandOff(); };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const scope = presetScopeToken(), version = scopeGeneration.current;
        const valid = () => !cancelled && scope === presetScopeToken() && version === scopeGeneration.current && api === currentApi.current;
        setAccounts(null); setError(null);
        Promise.all([mediaApi(api).listJobs(), fetchCatalog(), fetchAccounts(api)])
            .then(async ([page, catalog, acc]) => {
                if (!valid()) return;
                const nextGates = composeGates(acc);
                setGates(nextGates); setFreePlan(acc.plansEnabled && acc.planTier === 'free');
                if (!nextGates.schedule) setMode('now');
                const byId = new Map<string, CatalogModel>(catalog.map((m) => [m.id, m]));
                const list: CreationPick[] = [];
                for (const job of page.jobs) {
                    const model = byId.get(job.model_id);
                    const mediaType = model ? mediaTypeOf(model.modality) : null;
                    if (job.state === 'succeeded' && job.has_asset && model && mediaType) list.push({ kind: 'job', job, mediaType, name: job.label || model.name });
                }
                setPicks(list.slice(0, 24));
                setAccounts(acc.accounts);
                setUploadsEnabled(acc.uploadsEnabled);

                setCarouselEnabled(acc.carouselEnabled === true);
                if (presetJob && prefillAllowed.current) { setChoices(list.filter(p => p.job.job_id === presetJob)); prefillAllowed.current = false; }
                if (nextGates.queues) { const queueList = await fetchQueues(api).catch(() => [] as PublishQueue[]); if (valid()) setQueues(queueList.filter(q => q.enabled)); }
            })
            .catch((err) => valid() && setError(publishErrorMessage(err)));
        return () => {
            cancelled = true;
        };
    }, [api, presetJob, scopeVersion]);

    const eligible = (accounts || []).filter(a => a.status === 'active' && a.publishingEnabled && a.supportedMedia.length > 0);
    const queue = gates?.queues && mode === 'queue' ? queues.find((q) => q.id === queueId) ?? null : null;
    const queueAccounts = queue && accounts ? accounts.filter((a) => queue.accountIds.includes(a.id)) : [];
    const queueUsable = !!queue && queueAccounts.length === queue.accountIds.length && queueAccounts.every((a) => eligible.some((e) => e.id === a.id));
    const selected = queue ? queueAccounts : eligible.filter((a) => accountIds.includes(a.id));
    const chosenAccounts = selected;
    const maxMedia = carouselEnabled ? Math.min(10, ...chosenAccounts.map(a => a.carousel?.max || 1)) : 1;
    const blockedNetwork = mediaBlocker(choiceMedia(choices), chosenAccounts);
    const blocker = choices.length > 1 && !carouselEnabled ? t('app.publish.carousel.closed') : blockedNetwork ? t('app.publish.carousel.blocked', { network: networkLabel(blockedNetwork) }) : null;
    const when: When | null = !gates?.schedule || mode !== 'schedule' ? { kind: 'now' } : (() => { const d = whenFrom(date, time); return d ? { kind: 'at', at: d } : null; })();
    const networks = [...new Set(selected.map((a) => a.network))];
    const warn = captionWarning(text, networks);
    const showYoutube = networks.includes('youtube');

    function toggle(id: string) {
        setAccountIds(ids => toggleAccount(ids, id, gates?.multiAccount === true));
    }

    function submit() {
        if (role === null || !canPublish(role) || !chosen || !accounts || busy || preparingRef.current) return;
        const capturedScope = presetScopeToken(), capturedVersion = scopeGeneration.current;
        const stillCurrent = () => capturedScope === presetScopeToken() && capturedVersion === scopeGeneration.current && api === currentApi.current;
        if (blocker) { setProblem(blocker); return; }
        if (!when) {
            setProblem(t('publish.enterthedateasYYYYMMDD'));
            return;
        }
        if (mode === 'queue' && (!queue || !queueUsable)) {
            setProblem(queue ? t('compose.queueNoMatch') : t('compose.queuePick'));
            return;
        }
        const draft: Draft = { jobId: chosen.kind === 'job' ? chosen.job.job_id : '', ...(chosen.kind === 'upload' ? { uploadId: chosen.uploadId } : {}), mediaType: chosen.mediaType, media: choiceMedia(choices), accountIds: selected.map((a) => a.id), text, when, networkText: gates?.variants ? cleanNetworkText(networkText, networks) : {}, ...(showYoutube && gates?.youtubeVisibility ? { youtubeVisibility: ytVisibility } : {}), ...(queue ? { queue: { id: queue.id, name: queue.name } } : {}) };
        const now = new Date();
        const invalid = validateDraft(draft, accounts ?? [], now);
        if (invalid) {
            setProblem(invalid);
            return;
        }
        setProblem(null);
        const where = selected.map((a) => `${a.displayName} (${a.network})`).join(', ');
        if (queue) {
            Alert.alert(t('compose.queueTitle'), t('compose.queueConfirm', { queue: queue.name, where }), [
                { text: t('publish.cancel'), style: 'cancel' },
                { text: t('compose.queueAction'), onPress: () => { if (!preparingRef.current && stillCurrent()) void send(draft, now, stillCurrent); } },
            ]);
            return;
        }
        const answer = when.kind === 'now' ? t('publish.thispoststonowandispublic', { value1: where }) : t('publish.thisschedulesaposttoforYou', { value1: where, value2: when.at.toLocaleString(formatLocale(undefined), { dateStyle: 'medium', timeStyle: 'short' }) });
        Alert.alert(when.kind === 'now' ? t('publish.postnow') : t('publish.schedulethispost'), answer, [
            { text: t('publish.cancel2'), style: 'cancel' },
            { text: when.kind === 'now' ? t('publish.postnow2') : t('publish.schedule'), onPress: () => { if (!preparingRef.current && stillCurrent()) void send(draft, now, stillCurrent); } },
        ]);
    }

    async function send(draft: Draft, now: Date, stillCurrent: () => boolean) {
        // The key is saved before the send and kept until the server answers, so a retry after a dropped connection,
        // or after the app was closed in the middle, is the same post and cannot be published twice (ADR-0122).
        if (preparingRef.current || !stillCurrent()) return;
        const user = getCacheUser();
        const key = await draftKeys.keyFor(user, draftSignature(draft));
        if (preparingRef.current || !stillCurrent()) return;
        setBusy(true);
        let stage: 'reserve' | 'post' | 'confirm' = 'post';
        try {
            if (draft.queue) {
                stage = 'reserve';
                // Reserve the slot, post at its time, then confirm it. A retry repeats all three safely with the same key.
                const slot = await reserveSlot(api, draft.queue.id, key);
                if (!stillCurrent()) return;
                const reserved = slot.accountIds.map(id => accounts?.find(account => account.id === id));
                if (reserved.some(account => !account)) { setProblem(t('compose.queueNoMatch')); return; }
                const blocked = mediaBlocker(draft.media || [], reserved as PublishAccount[]);
                if (blocked) { setProblem(t('app.publish.carousel.blocked', { network: networkLabel(blocked) })); return; }
                stage = 'post';
                const made = await createPost(api, createBody({ ...draft, accountIds: slot.accountIds, when: { kind: 'at', at: slot.scheduledAt } }, key, now));
                if (!stillCurrent()) return;
                stage = 'confirm';
                await confirmSlot(api, slot.assignmentId, made.postId);
            } else {
                await createPost(api, createBody(draft, key, now));
            }
            if (!stillCurrent()) return;
            await draftKeys.drop(user);
            if (!stillCurrent()) return;
            router.replace({ pathname: '/publish/posts', params: { done: draft.queue ? 'queued' : draft.when.kind === 'at' ? 'scheduled' : 'posted' } });
        } catch (err) {
            if (!stillCurrent()) return;
            if (stage !== 'confirm' && isDefiniteRefusal(err)) await draftKeys.drop(user);
            setProblem(stage === 'post' ? composeErrorMessage(err, !!draft.uploadId) : t(queueErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    if (role !== null && !canPublish(role)) return <View style={styles.screen}><ThemedText>{t('publishParity.compose.readOnly')}</ThemedText></View>;
    if (error) return <View style={styles.screen}><Text style={styles.error}>{error}</Text></View>;
    if (role === null || !gates || !picks || !accounts) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: t('publish.newpost') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {scopeNote ? <StatusText variant="inherit" style={styles.muted} accessibilityLiveRegion="polite">{t('publishDepth.presets.scopeCleared')}</StatusText> : null}
                <Text style={styles.heading} accessibilityRole="header">{t('publish.1Creation')}</Text>
                {picks.length === 0 ? <Text style={styles.muted}>{t('publish.nofinishedimagesorvideosyetMake')}</Text> : null}
                <MediaLibraryGrid api={api} picks={picks} choices={choices} max={maxMedia} disabled={preparing || busy} onToggle={p => { if (preparingRef.current) return; setChoices(old => toggleChoice(old, p, maxMedia)); if (maxMedia === 1) setAccountIds([]); }} />
                <ChosenMediaPreview api={api} choice={chosen} />
                <PublishMediaSelection items={choices} max={maxMedia} onChange={setChoices} disabled={preparing || busy} />
                {blocker ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{blocker}</StatusText> : null}
                <PublishUploadPanel api={api} enabled={uploadsEnabled} max={maxMedia} nonUploadCount={choices.filter(item => item.kind === 'job').length}
                    selectedUploads={choices.flatMap(item => item.kind === 'upload' ? [{ uploadId: item.uploadId, mediaType: item.mediaType }] : [])}
                    onSelect={uploads => {
                        const before = choices.filter(item => item.kind === 'upload');
                        setChoices(old => {
                        if (maxMedia === 1 && uploads.length) return uploads.map(item => ({ kind: 'upload', ...item }));
                        const removed = new Set(before.flatMap(item => item.kind === 'upload' && !uploads.some(upload => upload.uploadId === item.uploadId) ? [item.uploadId] : []));
                        const kept = old.filter(item => item.kind === 'job' || !removed.has(item.uploadId));
                        return [...kept, ...uploads.filter(upload => !kept.some(item => item.kind === 'upload' && item.uploadId === upload.uploadId)).map(item => ({ kind: 'upload' as const, ...item }))];
                    }); if (maxMedia === 1 && uploads.length) setAccountIds([]); }}
                    onBusyChange={value => { preparingRef.current = value; setPreparing(value); }} />
                {chosen ? (
                    <>
                        <Text style={styles.heading} accessibilityRole="header">{t('publish.2Accounts')}</Text>
                        {eligible.length === 0 ? <Text style={styles.muted}>{t('publish.noconnectedaccountcanpostayet', { value1: chosen.mediaType })}</Text> : null}
                        {queue ? <Text style={styles.muted}>{queueUsable ? t('compose.queueAccounts', { names: queueAccounts.map((a) => a.displayName).join(', ') }) : t('compose.queueNoMatch')}</Text> : null}
                        <View style={styles.chips}>
                            {(queue ? [] : eligible).map((a) => (
                                <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ selected: accountIds.includes(a.id) }} style={[styles.chip, accountIds.includes(a.id) && styles.chipOn]} onPress={() => toggle(a.id)}>
                                    <Text style={[styles.chipText, accountIds.includes(a.id) && styles.chipTextOn]}>{a.displayName}</Text><NetworkLogo network={a.network} /><ThemedText>{networkName(a.network)}</ThemedText>
                                </Pressable>
                            ))}
                        </View>

                        {!gates.multiAccount && eligible.length > 1 ? <ThemedText tone="secondary">{t('publishCompose.postingtomorethanoneaccountneeds')}</ThemedText> : null}
                        <Text style={styles.heading} accessibilityRole="header">{t('publish.3Text')}</Text>
                        {gates.presets ? <ComposePresets api={api} text={text} networkText={networkText} mode={mode} selected={selected} eligible={eligible} disabled={busy || preparing || !accounts}
                            onApply={(value, scope) => {
                                if (scope !== presetScopeToken() || api !== currentApi.current) return;
                                setText(value.text); setAccountIds(gates.multiAccount ? value.accountIds : value.accountIds.slice(0, 1)); setNetworkText({}); presetScope.current = scope; setScopeNote(false);
                            }} /> : null}
                        <TextInput style={styles.input} multiline value={text} onChangeText={setText} placeholder={t('publish.writethecaption')} accessibilityLabel={t('publish.caption')} placeholderTextColor={colors.muted} maxLength={MAX_TEXT} />
                        <Text style={styles.muted}>{text.length} / {MAX_TEXT}</Text>
                        {warn ? <Text style={styles.warn}>{warn}</Text> : null}
                        {gates.variants ? <NetworkTextFields networks={networks} values={networkText} onChange={(n, v) => setNetworkText((m) => ({ ...m, [n]: v }))} /> : <ThemedText tone="secondary">{t(freePlan ? 'publishCompose.differenttextforeachnetworkneedsthe' : 'publishLinks.variantsOffNote')}</ThemedText>}
                        <NetworkPreviews api={api} accounts={selected} choice={chosen} text={text} networkText={networkText} variants={gates.variants} />
                        {showYoutube ? gates.youtubeVisibility ? <><YoutubeVisibilityChips value={ytVisibility} onChange={setYtVisibility} /><ThemedText tone="secondary">{t(`publishParity.youtube.${ytVisibility}`)}</ThemedText><ThemedText tone="secondary">{t('publishParity.youtube.only')}</ThemedText></> : <ThemedText tone="secondary">{t('publishParity.youtube.publicDefault')}</ThemedText> : null}

                        <Text style={styles.heading} accessibilityRole="header">{t('publish.4When')}</Text>
                        <View style={styles.chips}>
                            <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'now' }} style={[styles.chip, mode === 'now' && styles.chipOn]} onPress={() => setMode('now')}><Text style={[styles.chipText, mode === 'now' && styles.chipTextOn]}>{t('publish.postnow2')}</Text></Pressable>
                            {gates.schedule ? <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'schedule' }} style={[styles.chip, mode === 'schedule' && styles.chipOn]} onPress={() => setMode('schedule')}><Text style={[styles.chipText, mode === 'schedule' && styles.chipTextOn]}>{t('publish.schedule')}</Text></Pressable> : null}
                            {gates.queues && queues.length > 0 ? <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'queue' }} style={[styles.chip, mode === 'queue' && styles.chipOn]} onPress={() => setMode('queue')}><Text style={[styles.chipText, mode === 'queue' && styles.chipTextOn]}>{t('compose.queue')}</Text></Pressable> : null}
                        </View>
                        {!gates.schedule ? <><ThemedText tone="secondary">{t('publishCompose.schedulingneedsthePublishPlanYoucan')}</ThemedText><Button variant="secondary" label={t('publishParity.plan.see')} onPress={() => router.push('/publish')} /></> : null}
                        {gates.queues && mode === 'queue' ? <QueuePicker queues={queues} value={queueId} onChange={setQueueId} /> : null}
                        {gates.schedule && mode === 'schedule' ? (
                            <WhenPicker date={date} time={time} onChange={(d, t) => { setDate(d); setTime(t); }} />
                        ) : null}

                        {problem ? <Text style={styles.error}>{problem}</Text> : null}
                        {selected.length === 0 ? <Text style={styles.muted}>{t('compose.pickAccount')}</Text> : null}
                        <Pressable accessibilityRole="button" disabled={busy || preparing || selected.length === 0} accessibilityState={{ disabled: busy || preparing || selected.length === 0 }} style={[styles.button, (busy || preparing || selected.length === 0) && styles.off]} onPress={submit}>
                            {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{mode === 'queue' ? t('compose.queueAction') : mode === 'schedule' ? t('publish.schedule') : t('publish.postnow2')}</Text>}
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
    chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    muted: { color: colors.muted, fontSize: 13 },
    warn: { color: colors.money, fontSize: 13 },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});
