import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { accountStatusLabel, fetchAccounts, publishErrorMessage, type PublishAccount } from '../../../lib/publish';
import { colors } from '../../../theme';
import { usePublishApi } from '../../../lib/usePublishApi';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);

export default function Accounts() {
    const api = usePublishApi();
    const [data, setData] = useState<{ accountLimit: number; accounts: PublishAccount[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await fetchAccounts(api));
            setError(null);
        } catch (err) {
            setError(publishErrorMessage(err));
        }
    }, [api]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Connected accounts' }} />
            {error && !data ? (
                <Text style={styles.error}>{error}</Text>
            ) : !data ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={data.accounts}
                    keyExtractor={(a) => a.id}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<Text style={styles.muted}>{data.accounts.length} of {data.accountLimit} accounts</Text>}
                    ListEmptyComponent={<Text style={styles.muted}>No accounts are connected yet.</Text>}
                    ListFooterComponent={<Text style={styles.note}>To connect or remove an account, use Publish on veyrnox.ai for now.</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.row} accessible accessibilityLabel={`${item.displayName}, ${item.network}, ${accountStatusLabel(item.status)}`}>
                            {item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" /> : <View style={styles.avatar} />}
                            <View style={styles.text}>
                                <Text style={styles.name}>{item.displayName}</Text>
                                <Text style={styles.muted}>{item.network}</Text>
                                <Text style={[styles.status, item.status !== 'active' && styles.warn]}>{accountStatusLabel(item.status)}</Text>
                                {item.tokenExpiresAt && item.status === 'active' ? <Text style={styles.muted}>Access renews by {date(item.tokenExpiresAt)}</Text> : null}
                            </View>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    row: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface },
    text: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    status: { color: colors.accent },
    warn: { color: colors.money },
    muted: { color: colors.muted, fontSize: 13, paddingTop: 2 },
    note: { color: colors.muted, fontSize: 13, paddingVertical: 20 },
    error: { color: colors.danger, paddingTop: 16 },
});
