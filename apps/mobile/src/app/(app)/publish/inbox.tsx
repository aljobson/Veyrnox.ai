import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { UnlockCard } from '../../../components/UnlockCard';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { KINDS, STATES, fetchInbox, inboxErrorKey, type Counts, type InboxKind, type InboxState, type Thread } from '../../../lib/publishInbox';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Inbox() {
    const api = usePublishApi();
    const router = useRouter();
    const [state, setState] = useState<InboxState>('unresolved');
    const [kind, setKind] = useState<InboxKind | null>(null);
    const [threads, setThreads] = useState<Thread[] | null>(null);
    const [counts, setCounts] = useState<Counts | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [locked, setLocked] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [reload, setReload] = useState(0);

    const load = useCallback(async () => {
        try {
            const r = await fetchInbox(api, state, kind);
            setThreads(r.threads);
            setCounts(r.counts);
            setError(null);
            setLocked(false);
        } catch (err) {
            setThreads(null);
            if (err instanceof ApiError && err.status === 402) setLocked(true);
            else setError(t(inboxErrorKey(err)));
        }
    }, [api, state, kind]);

    useFocusEffect(useCallback(() => { void load(); }, [load, reload]));

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('inbox.title') }} />
            {locked ? <UnlockCard feature="inbox" onUnlocked={() => setReload((n) => n + 1)} /> : (
                <>
                    <View style={styles.chips}>
                        {STATES.map((s) => (
                            <Pressable key={s} accessibilityRole="button" accessibilityState={{ selected: state === s }} style={[styles.chip, touchTarget, state === s && styles.chipOn]} onPress={() => setState(s)}>
                                <Text style={[styles.chipText, state === s && styles.chipTextOn]}>{t(`inbox.state.${s}`)}{counts && s !== 'resolved' ? ` ${counts[s]}` : ''}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <View style={styles.chips}>
                        {([null, ...KINDS] as (InboxKind | null)[]).map((k) => (
                            <Pressable key={k ?? 'any'} accessibilityRole="button" accessibilityState={{ selected: kind === k }} style={[styles.chip, touchTarget, kind === k && styles.chipOn]} onPress={() => setKind(k)}>
                                <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{t(k ? `inbox.kind.${k}` : 'inbox.kind.any')}</Text>
                            </Pressable>
                        ))}
                    </View>
                    {error && !threads ? (
                        <Text style={styles.error} accessibilityRole="alert">{error}</Text>
                    ) : !threads ? (
                        <ActivityIndicator color={colors.accent} />
                    ) : (
                        <FlatList
                            data={threads}
                            keyExtractor={(x) => x.id}
                            contentContainerStyle={{ paddingBottom: VEY_CLEARANCE }}
                            refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                            ListHeaderComponent={<Text style={styles.muted}>{t('inbox.readOnly')}</Text>}
                            ListEmptyComponent={<Text style={styles.muted}>{t('inbox.none')}</Text>}
                            renderItem={({ item }) => (
                                <Pressable accessibilityRole="button" accessibilityLabel={`${item.name || item.network}, ${t(`inbox.kind.${item.kind}`)}${item.unread ? `, ${t('inbox.unread', { count: item.unread })}` : ''}`} style={[styles.row, touchTarget]} onPress={() => router.push({ pathname: '/publish/inbox-thread', params: { id: item.id } })}>
                                    <Text style={[styles.name, item.unread > 0 && styles.bold]} numberOfLines={1}>{item.name || item.network}</Text>
                                    <Text style={styles.muted} numberOfLines={1}>{item.subject || t(`inbox.kind.${item.kind}`)}</Text>
                                    <Text style={styles.meta}>{item.network} · {item.accountName}{item.unread ? ` · ${t('inbox.unread', { count: item.unread })}` : ''}{item.latestAt ? ` · ${new Date(item.latestAt).toLocaleDateString()}` : ''}</Text>
                                </Pressable>
                            )}
                        />
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, gap: 8, paddingTop: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    row: { paddingVertical: 10, gap: 2, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    name: { color: colors.text, fontSize: 16 },
    bold: { fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13, paddingVertical: 2 },
    meta: { color: colors.muted, fontSize: 12 },
    error: { color: colors.danger },
});
