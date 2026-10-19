import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { fetchAccounts, type PublishAccount } from '../../../lib/publish';
import { DAYS, fetchQueueList, parseMinute, queueAdminErrorKey, saveQueue, slotKey, slotText, sortSlots, validateQueue, type QueueSlot } from '../../../lib/publishQueueAdmin';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function QueueEdit() {
    const api = usePublishApi();
    const router = useRouter();
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
        Promise.all([fetchAccounts(api), id ? fetchQueueList(api) : Promise.resolve([])])
            .then(([acc, queues]) => {
                if (cancelled) return;
                setAccounts(acc.accounts.filter((a) => a.status === 'active'));
                const q = queues.find((x) => x.id === id);
                if (q) {
                    setName(q.name);
                    setTimezone(q.timezone);
                    setAccountIds(q.accountIds);
                    setSlots(q.slots);
                    setEnabled(q.enabled);
                }
                setReady(true);
            })
            .catch((err) => {
                if (cancelled) return;
                setProblem(t(queueAdminErrorKey(err)));
                setReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [api, id]);

    function addSlot() {
        const minute = parseMinute(time);
        if (minute === null) {
            setProblem(t('queues.err.time'));
            return;
        }
        setProblem(null);
        setSlots((cur) => (cur.some((s) => slotKey(s) === `${day}:${minute}`) ? cur : [...cur, { weekday: day, minute }]));
    }

    async function save() {
        if (busy) return;
        const input = { id: id ?? null, name, timezone, accountIds, slots, enabled };
        const invalid = validateQueue(input);
        if (invalid) {
            setProblem(t(invalid));
            return;
        }
        setBusy(true);
        setProblem(null);
        try {
            await saveQueue(api, input);
            router.back();
        } catch (err) {
            setProblem(t(queueAdminErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    if (!ready || !accounts) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: id ? t('queues.edit') : t('queues.new') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>{t('queues.name')}</Text>
                <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={80} accessibilityLabel={t('queues.name')} placeholderTextColor={colors.muted} />
                <Text style={styles.label}>{t('queues.timezone')}</Text>
                <TextInput style={styles.input} value={timezone} onChangeText={setTimezone} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('queues.timezone')} placeholderTextColor={colors.muted} />
                <Text style={styles.label} accessibilityRole="header">{t('queues.accounts')}</Text>
                {accounts.length === 0 ? <Text style={styles.muted}>{t('queues.noAccounts')}</Text> : null}
                <View style={styles.chips}>
                    {accounts.map((a) => {
                        const on = accountIds.includes(a.id);
                        return (
                            <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, touchTarget, on && styles.chipOn]} onPress={() => setAccountIds((cur) => (on ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}>
                                <Text style={[styles.chipText, on && styles.chipTextOn]}>{a.displayName} · {a.network}</Text>
                            </Pressable>
                        );
                    })}
                </View>
                <Text style={styles.label} accessibilityRole="header">{t('queues.slots')}</Text>
                <View style={styles.chips}>
                    {sortSlots(slots).map((s) => (
                        <Pressable key={slotKey(s)} accessibilityRole="button" accessibilityLabel={t('queues.removeSlot', { slot: slotText(s) })} style={[styles.chip, touchTarget]} onPress={() => setSlots((cur) => cur.filter((x) => slotKey(x) !== slotKey(s)))}>
                            <Text style={styles.chipText}>{slotText(s)}  ✕</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={styles.chips}>
                    {DAYS.map((d, i) => (
                        <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: day === i + 1 }} style={[styles.chip, touchTarget, day === i + 1 && styles.chipOn]} onPress={() => setDay(i + 1)}>
                            <Text style={[styles.chipText, day === i + 1 && styles.chipTextOn]}>{d}</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={styles.timeRow}>
                    <TextInput style={[styles.input, styles.time]} value={time} onChangeText={setTime} placeholder="HH:MM" autoCapitalize="none" keyboardType="numbers-and-punctuation" accessibilityLabel={t('queues.time')} placeholderTextColor={colors.muted} />
                    <Pressable accessibilityRole="button" style={[styles.chip, touchTarget]} onPress={addSlot}><Text style={styles.chipText}>{t('queues.addSlot')}</Text></Pressable>
                </View>
                <View style={styles.switchRow}>
                    <Text style={styles.label}>{t('queues.enabled')}</Text>
                    <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel={t('queues.enabled')} />
                </View>
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('queues.save')}</Text>}
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 8 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
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
