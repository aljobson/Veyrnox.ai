import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { publishScope, usePublishRole } from '../../../lib/usePublishRole';
import { canPublish } from '../../../lib/publishDashboard';
import { Text as StatusText } from '../../../components/ui/Text';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { deleteQueue, fetchQueueList, queueAdminErrorKey, slotText, sortSlots, type Queue } from '../../../lib/publishQueueAdmin';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Queues() {
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
            setQueues(null); setError(null); setNotice(null); setRefreshing(false);
            setScopeTick(n => n + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; canWriteRef.current = false; userOff(); brandOff(); };
    }, []);

    const router = useRouter();
    const [queues, setQueues] = useState<Queue[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        const valid = guard();
        try {
            const next = await fetchQueueList(api);
            if (!valid()) return;
            setQueues(next);
            setError(null);
        } catch (err) {
            if (!valid()) return;
            setQueues(null);
            setError(t(queueAdminErrorKey(err)));
        }
    }, [api, scopeTick]);

    // Reload when coming back from the edit screen.
    useFocusEffect(useCallback(() => { void load(); }, [load]));

    function confirmDelete(q: Queue) {
        if (!canWriteRef.current) return;
        const valid = guard(); let used = false;
        Alert.alert(t('queues.deleteTitle', { name: q.name }), t('queues.deleteBody'), [
            { text: t('queues.cancel'), style: 'cancel' },
            {
                text: t('queues.delete'),
                style: 'destructive',
                onPress: async () => {
                    if (used || !valid() || !canWriteRef.current || running.current) return;
                    used = true; running.current = true;
                    try { await deleteQueue(api, q.id); if (valid()) { setNotice(t('queues.deleted', { name: q.name })); void load(); } }
                    catch (err) { if (valid()) setNotice(t(queueAdminErrorKey(err))); }
                    finally { if (valid()) running.current = false; }
                },
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('queues.title') }} />
            {!canWrite ? <Text style={styles.muted}>{t('publishOps.readOnly')}</Text> : null}
            {error && !queues ? (
                <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{error}</StatusText>
            ) : !queues ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={queues}
                    keyExtractor={(q) => q.id}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('queues.intro')}</Text>{notice ? <StatusText variant="inherit" style={styles.notice} accessibilityLiveRegion="polite">{notice}</StatusText> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('queues.none')}</Text>}
                    ListFooterComponent={canWrite ?
                        <Pressable accessibilityRole="button" style={[styles.add, touchTarget]} onPress={() => router.push('/publish/queue-edit')}>
                            <Text style={styles.addText}>{t('queues.new')}</Text>
                        </Pressable> : undefined
                    }
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}. ${item.enabled ? t('queues.on') : t('queues.off')}`} style={[styles.main, touchTarget]} onPress={() => router.push({ pathname: '/publish/queue-edit', params: { id: item.id } })}>
                                <Text style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted}>{item.enabled ? t('queues.on') : t('queues.off')} · {item.timezone}</Text>
                                <Text style={styles.muted} numberOfLines={2}>{sortSlots(item.slots).map(slotText).join(', ')}</Text>
                            </Pressable>
                            {canWrite ? <Pressable accessibilityRole="button" accessibilityLabel={t('queues.deleteLabel', { name: item.name })} style={[styles.del, touchTarget]} onPress={() => confirmDelete(item)}>
                                <Text style={styles.delText}>{t('queues.delete')}</Text>
                            </Pressable> : null}
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    main: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13, paddingVertical: 2 },
    notice: { color: colors.accent, paddingVertical: 4 },
    del: { paddingHorizontal: 10 },
    delText: { color: colors.danger, fontWeight: '600' },
    add: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, marginTop: 16 },
    addText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    error: { color: colors.danger, paddingTop: 16 },
});
