import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { touchTarget } from '../../lib/a11y';
import { blocksErrorKey, fetchBlocks, unblockMember, type BlockedMember } from '../../lib/cinemaBlocks';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

export default function Blocked() {
    const { api } = useAuth();
    const [members, setMembers] = useState<BlockedMember[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setMembers(await fetchBlocks(api));
            setError(null);
        } catch (err) {
            setMembers(null);
            setError(t(blocksErrorKey(err)));
        }
    }, [api]);

    // Reload whenever the screen comes back into view, so a block made elsewhere shows at once.
    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    function unblock(m: BlockedMember) {
        Alert.alert(t('blocks.unblockTitle', { name: m.displayName }), t('blocks.unblockBody'), [
            { text: t('blocks.cancel'), style: 'cancel' },
            {
                text: t('blocks.unblock'),
                onPress: async () => {
                    setBusy(m.username);
                    setNote(null);
                    try {
                        await unblockMember(api, m.username);
                        setMembers((list) => (list ? list.filter((x) => x.username !== m.username) : list));
                        setNote(t('blocks.unblocked', { name: m.displayName }));
                    } catch (err) {
                        setNote(t(blocksErrorKey(err)));
                    } finally {
                        setBusy(null);
                    }
                },
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('blocks.title') }} />
            {error ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !members ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={members}
                    keyExtractor={(m) => m.username}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={
                        <View>
                            <Text style={styles.intro}>{t('blocks.intro')}</Text>
                            {note ? <Text style={styles.note} accessibilityLiveRegion="polite">{note}</Text> : null}
                        </View>
                    }
                    ListEmptyComponent={<Text style={styles.muted}>{t('blocks.none')}</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <View style={styles.text}>
                                <Text style={styles.name}>{item.displayName}</Text>
                                <Text style={styles.muted}>@{item.username}</Text>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t('blocks.unblockTitle', { name: item.displayName })}
                                accessibilityState={{ busy: busy === item.username, disabled: busy !== null }}
                                disabled={busy !== null}
                                style={[touchTarget, styles.action]}
                                onPress={() => unblock(item)}
                            >
                                {busy === item.username ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.actionText}>{t('blocks.unblock')}</Text>}
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
    intro: { color: colors.body, paddingVertical: 14 },
    note: { color: colors.accent, paddingBottom: 10 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    text: { flexGrow: 1, flexShrink: 1, minWidth: 160, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    action: { paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    actionText: { color: colors.accent, fontWeight: '600' },
    error: { color: colors.danger, paddingTop: 16 },
});
