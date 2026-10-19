import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { autolistErrorKey, deleteAutolist, fetchAutolists, type Autolist } from '../../../lib/publishAutolists';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Autolists() {
    const api = usePublishApi();
    const router = useRouter();
    const [lists, setLists] = useState<Autolist[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setLists(await fetchAutolists(api));
            setError(null);
        } catch (err) {
            setLists(null);
            setError(t(autolistErrorKey(err)));
        }
    }, [api]);

    useFocusEffect(useCallback(() => { void load(); }, [load]));

    function confirmDelete(a: Autolist) {
        Alert.alert(t('autolists.deleteTitle', { name: a.name }), t('autolists.deleteBody'), [
            { text: t('autolists.cancel'), style: 'cancel' },
            {
                text: t('autolists.delete'),
                style: 'destructive',
                onPress: () => deleteAutolist(api, a.id)
                    .then(() => { setNotice(t('autolists.deleted', { name: a.name })); void load(); })
                    .catch((err) => setNotice(t(autolistErrorKey(err)))),
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('autolists.title') }} />
            {error && !lists ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !lists ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={lists}
                    keyExtractor={(a) => a.id}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('autolists.intro')}</Text>{notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('autolists.none')}</Text>}
                    ListFooterComponent={
                        <Pressable accessibilityRole="button" style={[styles.add, touchTarget]} onPress={() => router.push('/publish/autolist-edit')}>
                            <Text style={styles.addText}>{t('autolists.new')}</Text>
                        </Pressable>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}. ${item.enabled ? t('autolists.on') : t('autolists.off')}`} style={[styles.main, touchTarget]} onPress={() => router.push({ pathname: '/publish/autolist-edit', params: { id: item.id } })}>
                                <Text style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted} numberOfLines={1}>{item.enabled ? t('autolists.on') : t('autolists.off')} · {item.queueName}</Text>
                                <Text style={styles.muted} numberOfLines={1}>{item.feedUrl}</Text>
                                {item.lastError ? <Text style={styles.bad} numberOfLines={2}>{item.lastError}</Text> : item.lastRefreshedAt ? <Text style={styles.muted}>{t('autolists.refreshed', { when: new Date(item.lastRefreshedAt).toLocaleString() })}</Text> : null}
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('autolists.deleteLabel', { name: item.name })} style={[styles.del, touchTarget]} onPress={() => confirmDelete(item)}>
                                <Text style={styles.delText}>{t('autolists.delete')}</Text>
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
    bad: { color: colors.danger, fontSize: 13 },
    notice: { color: colors.accent, paddingVertical: 4 },
    del: { paddingHorizontal: 10 },
    delText: { color: colors.danger, fontWeight: '600' },
    add: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, marginTop: 16 },
    addText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    error: { color: colors.danger, paddingTop: 16 },
});
