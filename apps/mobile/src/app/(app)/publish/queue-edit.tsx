import { rawText } from '../../../lib/i18n/translate';
import { Chip, Text as UiText } from '../../../components/ui';
import { themedStyles, useThemedStyles } from '../../../components/ui/AppearanceContext';
import { NetworkLogo } from '../../../components/publish/NetworkLogo';
import { networkName } from '../../../lib/networkLogos';
import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { publishScope } from '../../../lib/usePublishRole';
import { canPublish } from '../../../lib/publishDashboard';
import { Text as StatusText } from '../../../components/ui/Text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { fetchAccounts, type PublishAccount, type PublishRole } from '../../../lib/publish';
import { DAYS, fetchQueueList, parseMinute, queueAdminErrorKey, saveQueue, slotKey, slotText, sortSlots, validateQueue, type QueueSlot } from '../../../lib/publishQueueAdmin';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function QueueEdit() {
    const api = usePublishApi();
    const [role, setRole] = useState<PublishRole | null>(null);
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
            setAccounts(null); setRole(null); setExcluded([]); setName(''); setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); setAccountIds([]); setSlots([]); setEnabled(true); setDay(1); setTime('09:00'); setReady(false); setBusy(false); setProblem(null);
            setScopeTick(n => n + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; canWriteRef.current = false; userOff(); brandOff(); };
    }, []);

    const router = useRouter();
    const themed = useThemedStyles(excludedSheets);
    const [excluded, setExcluded] = useState<(PublishAccount | null)[]>([]);
    const { id } = useLocalSearchParams<{ id?: string }>();
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [name, setName] = useState('');
    const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const [accountIds, setAccountIds] = useState<string[]>([]);
    const [slots, setSlots] = useState<QueueSlot[]>([]);
    const [enabled, setEnabled] = useState(true);
    const [day, setDay] = useState(1);
    const [time, setTime] = useState('09:00');
    const [ready, setReady] = useState(!id);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const valid = guard();
        Promise.all([fetchAccounts(api), id ? fetchQueueList(api) : Promise.resolve([])])
            .then(([acc, queues]) => {
                if (cancelled || !valid()) return;
                const allAccounts = acc.accounts.map(a => ({ ...a, displayName: a.displayName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) }));
                const eligible = allAccounts.filter(a => a.status === 'active' && a.publishingEnabled);
                setAccounts(eligible); setRole(acc.brandRole);
                const q = queues.find((x) => x.id === id);
                if (q) {
                    setName(q.name);
                    setTimezone(q.timezone);
                    setAccountIds(q.accountIds.filter(id => eligible.some(a => a.id === id)));
                    setExcluded(q.accountIds.filter(id => !eligible.some(a => a.id === id)).map(id => allAccounts.find(a => a.id === id) ?? null));
                    setSlots(q.slots);
                    setEnabled(q.enabled);
                }
                setReady(true);
            })
            .catch((err) => {
                if (cancelled || !valid()) return;
                setAccounts([]); setRole('viewer');
                setProblem(t(queueAdminErrorKey(err))); setReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [api, id, scopeTick]);

    function addSlot() {
        if (!canWriteRef.current || running.current) return;
        const minute = parseMinute(time);
        if (minute === null) {
            setProblem(t('queues.err.time'));
            return;
        }
        setProblem(null);
        setSlots((cur) => (cur.some((s) => slotKey(s) === `${day}:${minute}`) ? cur : [...cur, { weekday: day, minute }]));
    }

    async function save() {
        if (running.current || !canWriteRef.current) return;
        const valid = guard();
        const input = { id: id ?? null, name, timezone, accountIds: accountIds.filter(id => accounts?.some(a => a.id === id && a.status === 'active' && a.publishingEnabled)), slots, enabled };
        const invalid = validateQueue(input);
        if (invalid) {
            setProblem(t(invalid));
            return;
        }
        running.current = true; setBusy(true);
        setProblem(null);
        try {
            await saveQueue(api, input);
            if (valid()) router.back();
        } catch (err) {
            if (valid()) setProblem(t(queueAdminErrorKey(err)));
        } finally {
            if (valid()) { running.current = false; setBusy(false); }
        }
    }

    if (!ready || !accounts) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: id ? t('queues.edit') : t('queues.new') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!canWrite ? <Text style={styles.muted}>{t('publishOps.readOnly')}</Text> : null}

                <Text style={styles.label}>{t('queues.name')}</Text>
                <TextInput editable={canWrite && !busy} style={styles.input} value={name} onChangeText={setName} maxLength={80} accessibilityLabel={t('queues.name')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('queues.timezone')}</Text>
                <TextInput editable={canWrite && !busy} style={styles.input} value={timezone} onChangeText={setTimezone} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('queues.timezone')} placeholderTextColor={colors.muted} />
                <Text style={styles.label} accessibilityRole="header">{t('queues.accounts')}</Text>
                {accounts.length === 0 ? <Text style={styles.muted}>{t('queues.noAccounts')}</Text> : null}
                <View style={styles.chips}>
                    {accounts.map((a) => {
                        const on = accountIds.includes(a.id);
                        return (
                            <Chip key={a.id} disabled={!canWrite || busy} selected={on} label={t('publishOps.accountLabel', { network: networkName(a.network), name: a.displayName })} onPress={() => setAccountIds(cur => on ? cur.filter(x => x !== a.id) : [...cur, a.id])}>
                                <NetworkLogo network={a.network} /><UiText>{t('publishOps.accountLabel', { network: networkName(a.network), name: a.displayName })}</UiText>
                            </Chip>
                        );
                    })}
                </View>
                {excluded.length ? <View style={themed.group}>
                    <UiText accessibilityRole="header">{t('publishOps.queue.excludedTitle')}</UiText>
                    {excluded.filter((a): a is PublishAccount => a !== null).map(a => <View key={a.id} style={themed.row} accessibilityState={{ disabled: true }}>
                        <NetworkLogo network={a.network} /><UiText tone="secondary">{t('publishOps.queue.excludedAccount', { name: a.displayName, network: networkName(a.network), reason: t(`publishOps.queue.reason.${a.status === 'active' ? 'publishingOff' : 'disconnected'}`) })}</UiText>
                    </View>)}
                    {excluded.some(a => a === null) ? <UiText tone="secondary">{t('publishOps.queue.unknownAccounts', { count: excluded.filter(a => a === null).length })}</UiText> : null}
                    <UiText tone="secondary">{t('publishOps.queue.excludedNote')}</UiText>
                </View> : null}
                <Text style={styles.label} accessibilityRole="header">{t('queues.slots')}</Text>
                <View style={styles.chips}>
                    {sortSlots(slots).map((s) => (
                        <Pressable disabled={!canWrite || busy} key={slotKey(s)} accessibilityRole="button" accessibilityLabel={rawText(canWrite ? t('queues.removeSlot', { slot: slotText(s) }) : slotText(s))} style={[styles.chip, touchTarget]} onPress={() => setSlots((cur) => cur.filter((x) => slotKey(x) !== slotKey(s)))}>
                            <Text style={styles.chipText}>{canWrite ? t('publishOps.queue.removeSlot', { slot: slotText(s) }) : slotText(s)}</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={styles.chips}>
                    {DAYS.map((d, i) => (
                        <Pressable disabled={!canWrite || busy} key={d} accessibilityRole="button" accessibilityState={{ selected: day === i + 1 }} style={[styles.chip, touchTarget, day === i + 1 && styles.chipOn]} onPress={() => setDay(i + 1)}>
                            <Text style={[styles.chipText, day === i + 1 && styles.chipTextOn]}>{d}</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={styles.timeRow}>
                    <TextInput editable={canWrite && !busy} style={[styles.input, styles.time]} value={time} onChangeText={setTime} placeholder={t('publish.hHMM')} autoCapitalize="none" keyboardType="numbers-and-punctuation" accessibilityLabel={t('queues.time')} placeholderTextColor={colors.muted} />
                    {canWrite ? <Pressable disabled={busy} accessibilityRole="button" style={[styles.chip, touchTarget]} onPress={addSlot}><Text style={styles.chipText}>{t('queues.addSlot')}</Text></Pressable> : null}
                </View>
                <View style={styles.switchRow}>
                    <Text style={styles.label}>{t('queues.enabled')}</Text>
                    <Switch disabled={!canWrite || busy} value={enabled} onValueChange={setEnabled} accessibilityLabel={t('queues.enabled')} />
                </View>
                {problem ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{problem}</StatusText> : null}
                {canWrite ? <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('queues.save')}</Text>}
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
    muted: { color: colors.muted, fontSize: 13 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    timeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    time: { width: 110 },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});

const excludedSheets = themedStyles(() => ({ group: { gap: 8 }, row: { flexDirection: 'row', gap: 8, alignItems: 'center' } }));
