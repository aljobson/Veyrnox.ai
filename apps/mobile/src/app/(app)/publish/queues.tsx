import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { deleteQueue, fetchQueueList, queueAdminErrorKey, slotText, sortSlots, type Queue } from '../../../lib/publishQueueAdmin';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Queues() {
    const api = usePublishApi();
    const router = useRouter();
    const [queues, setQueues] = useState<Queue[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setQueues(await fetchQueueList(api));
            setError(null);
        } catch (err) {
            setQueues(null);
            setError(t(queueAdminErrorKey(err)));
        }
    }, [api]);

    // Reload when coming back from the edit screen.
    useFocusEffect(useCallback(() => { void load(); }, [load]));

    function confirmDelete(q: Queue) {
        Alert.alert(t('queues.deleteTitle', { name: q.name }), t('queues.deleteBody'), [
            { text: t('queues.cancel'), style: 'cancel' },
            {
                text: t('queues.delete'),
                style: 'destructive',
                onPress: () => deleteQueue(api, q.id)
                    .then(() => { setNotice(t('queues.deleted', { name: q.name })); void load(); })
                    .catch((err) => setNotice(t(queueAdminErrorKey(err)))),
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('queues.title') }} />
            {error && !queues ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !queues ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={queues}
                    keyExtractor={(q) => q.id}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('queues.intro')}</Text>{notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('queues.none')}</Text>}
                    ListFooterComponent={
                        <Pressable accessibilityRole="button" style={[styles.add, touchTarget]} onPress={() => router.push('/publish/queue-edit')}>
                            <Text style={styles.addText}>{t('queues.new')}</Text>
                        </Pressable>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}. ${item.enabled ? t('queues.on') : t('queues.off')}`} style={[styles.main, touchTarget]} onPress={() => router.push({ pathname: '/publish/queue-edit', params: { id: item.id } })}>
                                <Text style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted}>{item.enabled ? t('queues.on') : t('queues.off')} · {item.timezone}</Text>
                                <Text style={styles.muted} numberOfLines={2}>{sortSlots(item.slots).map(slotText).join(', ')}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('queues.deleteLabel', { name: item.name })} style={[styles.del, touchTarget]} onPress={() => confirmDelete(item)}>
                                <Text style={styles.delText}>{t('queues.delete')}</Text>
                            </Pressable>
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
