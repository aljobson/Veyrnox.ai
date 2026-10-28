import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { publishScope, usePublishRole } from '../../../lib/usePublishRole';
import { canPublish } from '../../../lib/publishDashboard';
import { Text as StatusText } from '../../../components/ui/Text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { DEFAULT_TEMPLATE, INTERVALS, autolistErrorKey, fetchAutolists, saveAutolist, validateAutolist } from '../../../lib/publishAutolists';
import { fetchQueueList, type Queue } from '../../../lib/publishQueueAdmin';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const intervalText = (m: number) => (m < 60 ? t('autolists.everyMinutes', { count: m }) : t('autolists.everyHours', { count: m / 60 }));

export default function AutolistEdit() {
    const api = usePublishApi();
    const role = usePublishRole(api);
    const canWrite = role !== null && canPublish(role);
    const canWriteRef = useRef(canWrite); canWriteRef.current = canWrite;
    const generation = useRef(0), currentApi = useRef(api), running = useRef(false);
    currentApi.current = api;
    const [scopeTick, setScopeTick] = useState(0);
    function guard() {
        const version = generation.current, scope = publishScope();
        return () => version === generation.current && scope === publishScope() && currentApi.current === api;
    }
    useEffect(() => {
        const reset = () => {
            generation.current++; canWriteRef.current = false; running.current = false;
            setQueues(null); setName(''); setFeedUrl('https://'); setQueueId(''); setTemplate(DEFAULT_TEMPLATE); setInterval(360); setEnabled(true); setAutoSchedule(false); setReady(false); setBusy(false); setProblem(null);
            setScopeTick(n => n + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; canWriteRef.current = false; userOff(); brandOff(); };
    }, []);

    const router = useRouter();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const [queues, setQueues] = useState<Queue[] | null>(null);
    const [name, setName] = useState('');
    const [feedUrl, setFeedUrl] = useState('https://');
    const [queueId, setQueueId] = useState('');
    const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
    const [interval, setInterval] = useState<number>(360);
    const [enabled, setEnabled] = useState(true);
    const [autoSchedule, setAutoSchedule] = useState(false);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const valid = guard();
        Promise.all([fetchQueueList(api), id ? fetchAutolists(api) : Promise.resolve([])])
            .then(([q, lists]) => {
                if (cancelled || !valid()) return;
                setQueues(q);
                const a = lists.find((x) => x.id === id);
                if (a) {
                    setName(a.name);
                    setFeedUrl(a.feedUrl);
                    setQueueId(a.queueId);
                    setTemplate(a.captionTemplate);
                    setInterval(a.refreshIntervalMinutes);
                    setEnabled(a.enabled);
                    setAutoSchedule(a.autoSchedule);
                } else if (q[0]) {
                    setQueueId(q[0].id);
                }
                setReady(true);
            })
            .catch((err) => {
                if (cancelled || !valid()) return;
                if (valid()) setProblem(t(autolistErrorKey(err)));
                setReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [api, id, scopeTick]);

    async function save() {
        if (running.current || !canWriteRef.current) return;
        const valid = guard();
        const input = { id: id ?? null, queueId, name, feedUrl, captionTemplate: template, refreshIntervalMinutes: interval, enabled, autoSchedule };
        const invalid = validateAutolist(input);
        if (invalid) {
            setProblem(t(invalid));
            return;
        }
        running.current = true; setBusy(true);
        setProblem(null);
        try {
            await saveAutolist(api, input);
            if (valid()) router.back();
        } catch (err) {
            if (valid()) setProblem(t(autolistErrorKey(err)));
        } finally {
            if (valid()) { running.current = false; setBusy(false); }
        }
    }

    if (!ready) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: id ? t('autolists.edit') : t('autolists.new') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!canWrite ? <Text style={styles.muted}>{t('publishOps.readOnly')}</Text> : null}

                <Text style={styles.label}>{t('autolists.name')}</Text>
                <TextInput editable={canWrite && !busy} style={styles.input} value={name} onChangeText={setName} maxLength={80} accessibilityLabel={t('autolists.name')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('autolists.feed')}</Text>
                <TextInput editable={canWrite && !busy} style={styles.input} value={feedUrl} onChangeText={setFeedUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={t('autolists.feed')} placeholderTextColor={colors.muted} />
                <Text style={styles.label} accessibilityRole="header">{t('autolists.queue')}</Text>
                {queues && queues.length === 0 ? <Text style={styles.muted}>{t('autolists.noQueues')}</Text> : null}
                <View style={styles.chips}>
                    {(queues ?? []).map((q) => (
                        <Pressable disabled={!canWrite || busy} key={q.id} accessibilityRole="button" accessibilityState={{ selected: queueId === q.id }} style={[styles.chip, touchTarget, queueId === q.id && styles.chipOn]} onPress={() => setQueueId(q.id)}>
                            <Text style={[styles.chipText, queueId === q.id && styles.chipTextOn]}>{q.name}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={styles.label}>{t('autolists.template')}</Text>
                <TextInput editable={canWrite && !busy} style={[styles.input, styles.multi]} multiline value={template} onChangeText={setTemplate} maxLength={4000} accessibilityLabel={t('autolists.template')} placeholderTextColor={colors.muted} />
                <Text style={styles.muted}>{t('autolists.templateHint')}</Text>
                <Text style={styles.label} accessibilityRole="header">{t('autolists.interval')}</Text>
                <View style={styles.chips}>
                    {INTERVALS.map((m) => (
                        <Pressable disabled={!canWrite || busy} key={m} accessibilityRole="button" accessibilityState={{ selected: interval === m }} style={[styles.chip, touchTarget, interval === m && styles.chipOn]} onPress={() => setInterval(m)}>
                            <Text style={[styles.chipText, interval === m && styles.chipTextOn]}>{intervalText(m)}</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={styles.switchRow}>
                    <Text style={styles.label}>{t('autolists.enabled')}</Text>
                    <Switch disabled={!canWrite || busy} value={enabled} onValueChange={setEnabled} accessibilityLabel={t('autolists.enabled')} />
                </View>
                <View style={styles.switchRow}>
                    <Text style={styles.label}>{t('autolists.autoSchedule')}</Text>
                    <Switch disabled={!canWrite || busy} value={autoSchedule} onValueChange={setAutoSchedule} accessibilityLabel={t('autolists.autoSchedule')} />
                </View>
                <Text style={styles.muted}>{t('autolists.autoScheduleHint')}</Text>
                {problem ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{problem}</StatusText> : null}
                {canWrite ? <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('autolists.save')}</Text>}
                </Pressable> : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 8 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    multi: { minHeight: 90 },
    muted: { color: colors.muted, fontSize: 13 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});
