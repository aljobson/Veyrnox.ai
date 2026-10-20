import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { accountStatusLabel, fetchAccounts, publishErrorMessage, type PublishAccount } from '../../../lib/publish';
import { disconnectAccount, disconnectErrorKey } from '../../../lib/publishAccounts';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';
import { usePublishApi } from '../../../lib/usePublishApi';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);

export default function Accounts() {
    const api = usePublishApi();
    const router = useRouter();
    const [data, setData] = useState<{ accountLimit: number; accounts: PublishAccount[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

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

    function confirmDisconnect(a: PublishAccount) {
        const vars = { name: a.displayName, network: a.network };
        Alert.alert(t('accounts.disconnectTitle', vars), t('accounts.disconnectBody', vars), [
            { text: t('publish.cancel'), style: 'cancel' },
            {
                text: t('accounts.disconnectAction'),
                style: 'destructive',
                onPress: () => {
                    setNotice(null);
                    disconnectAccount(api, a.id)
                        .then(() => {
                            setData((d) => (d ? { ...d, accounts: d.accounts.filter((x) => x.id !== a.id) } : d));
                            setNotice(t('accounts.disconnected', vars));
                        })
                        .catch((err) => setNotice(t(disconnectErrorKey(err))));
                },
            },
        ]);
    }

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
                    ListHeaderComponent={<View><Text style={styles.muted}>{data.accounts.length} of {data.accountLimit} accounts</Text>{notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>No accounts are connected yet.</Text>}
                    ListFooterComponent={
                        <View>
                            <Pressable accessibilityRole="button" style={[styles.connect, touchTarget]} onPress={() => router.push('/publish/connect')}>
                                <Text style={styles.connectText}>{t('connect.title')}</Text>
                            </Pressable>
                        </View>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            {item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" /> : <View style={styles.avatar} />}
                            <View style={styles.text} accessible accessibilityLabel={`${item.displayName}, ${item.network}, ${accountStatusLabel(item.status)}`}>
                                <Text style={styles.name}>{item.displayName}</Text>
                                <Text style={styles.muted}>{item.network}</Text>
                                <Text style={[styles.status, item.status !== 'active' && styles.warn]}>{accountStatusLabel(item.status)}</Text>
                                {item.tokenExpiresAt && item.status === 'active' ? <Text style={styles.muted}>Access renews by {date(item.tokenExpiresAt)}</Text> : null}
                            </View>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('accounts.disconnect', { name: item.displayName })} style={[styles.disconnect, touchTarget]} onPress={() => confirmDisconnect(item)}>
                                <Text style={styles.disconnectText}>{t('accounts.disconnectAction')}</Text>
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
    row: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface },
    text: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    status: { color: colors.accent },
    warn: { color: colors.money },
    muted: { color: colors.muted, fontSize: 13, paddingTop: 2 },
    connect: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, marginTop: 16 },
    connectText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    notice: { color: colors.accent, paddingTop: 6 },
    disconnect: { paddingHorizontal: 12, alignSelf: 'center' },
    disconnectText: { color: colors.danger, fontWeight: '600' },
    error: { color: colors.danger, paddingTop: 16 },
});
