import { rawText } from '../../../lib/i18n/translate';
import { Text as StatusText } from '../../../components/ui/Text';
import { Button, Card, Text as ThemedText, themedStyles, useThemedStyles } from '../../../components/ui';
import { NetworkLogo } from '../../../components/publish/NetworkLogo';
import { networkName } from '../../../lib/networkLogos';
import { publishScope } from '../../../lib/usePublishRole';
import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { accountStatusLabel, fetchAccounts, publishErrorMessage, type PublishAccount, type PublishAccountsState } from '../../../lib/publish';
import { disconnectAccount, disconnectErrorKey } from '../../../lib/publishAccounts';
import { touchTarget } from '../../../lib/a11y';
import { formatLocale, t } from '../../../lib/i18n';
import { colors } from '../../../theme';
import { usePublishApi } from '../../../lib/usePublishApi';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(formatLocale()) : null);

export default function Accounts() {
    const api = usePublishApi();
    const router = useRouter();
    const rowStyles = useThemedStyles(rowSheets);
    const generation = useRef(0), currentApi = useRef(api), pending = useRef<string | null>(null);
    currentApi.current = api;
    const [data, setData] = useState<PublishAccountsState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        pending.current = null;
        const version = ++generation.current, scope = publishScope();
        const valid = () => version === generation.current && scope === publishScope() && api === currentApi.current;
        try {
            const result = await fetchAccounts(api);
            if (!valid()) return;
            setData(result); setError(null);
        } catch (err) {
            if (valid()) setError(publishErrorMessage(err));
        } finally { if (valid()) setRefreshing(false); }
    }, [api]);

    useEffect(() => {
        const reset = () => {
            generation.current++; pending.current = null;
            setData(null); setNotice(null); setError(null); setRefreshing(false);
            void load();
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        reset();
        return () => { generation.current++; pending.current = null; userOff(); brandOff(); };
    }, [load]);

    function confirmDisconnect(a: PublishAccount) {
        if (data?.brandRole !== 'owner' || pending.current) return;
        const version = generation.current, scope = publishScope();
        const valid = () => version === generation.current && scope === publishScope() && api === currentApi.current;
        const vars = { name: a.displayName, network: networkName(a.network) };
        Alert.alert(t('accounts.disconnectTitle', vars), t('accounts.disconnectBody', vars), [
            { text: t('publish.cancel'), style: 'cancel' },
            {
                text: t('accounts.disconnectAction'), style: 'destructive',
                onPress: () => {
                    if (!valid() || pending.current) return;
                    pending.current = a.id; setNotice(null);
                    disconnectAccount(api, a.id).then(() => {
                        if (!valid()) return;
                        setData(d => d ? { ...d, accounts: d.accounts.filter(x => x.id !== a.id) } : d);
                        setNotice(t('accounts.disconnected', vars));
                    }).catch(err => { if (valid()) setNotice(t(disconnectErrorKey(err))); })
                        .finally(() => { if (valid()) pending.current = null; });
                },
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('publish.connectedaccounts') }} />
            {error && !data ? (
                <Text style={styles.error}>{error}</Text>
            ) : !data ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={data.accounts}
                    keyExtractor={(a) => a.id}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('publish.ofaccounts', { value1: data.accounts.length, value2: data.accountLimit })}</Text>{data.brandRole !== 'owner' ? <ThemedText tone="secondary">{t('publishParity.accounts.ownerOnly')}</ThemedText> : null}{notice ? <StatusText variant="inherit" style={styles.notice} accessibilityLiveRegion="polite">{notice}</StatusText> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('publish.noaccountsareconnectedyet')}</Text>}
                    ListFooterComponent={data.brandRole === 'owner' ?
                        <View>
                            <Pressable accessibilityRole="button" style={[styles.connect, touchTarget]} onPress={() => router.push('/publish/connect')}>
                                <Text style={styles.connectText}>{t('connect.title')}</Text>
                            </Pressable>
                        </View> : undefined
                    }
                    renderItem={({ item }) => (
                        <Card style={rowStyles.row}>
                            {item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} style={rowStyles.avatar} contentFit="cover" accessibilityElementsHidden importantForAccessibility="no" /> : <View style={rowStyles.avatar}><NetworkLogo network={item.network} size={24} /></View>}
                            <View style={rowStyles.text}>
                                <ThemedText variant="bodyStrong">{item.displayName}</ThemedText>
                                <View style={rowStyles.network}><NetworkLogo network={item.network} /><ThemedText tone="secondary">{networkName(item.network)}</ThemedText></View>
                                <ThemedText tone={item.status === 'active' ? 'accent' : 'warning'}>{accountStatusLabel(item.status)}</ThemedText>
                                {item.tokenExpiresAt && item.status === 'active' ? <ThemedText tone="secondary">{t('publish.accessrenewsby', { value1: date(item.tokenExpiresAt) ?? '' })}</ThemedText> : null}
                                {data.brandRole === 'owner' ? <Button variant="tertiary" tone="danger" label={t('accounts.disconnectAction')} accessibilityLabel={rawText(t('accounts.disconnect', { name: item.displayName }))} onPress={() => confirmDisconnect(item)} /> : null}
                            </View>
                        </Card>
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

const rowSheets = themedStyles(p => ({
    row: { flexDirection: 'row', gap: 12, marginTop: 8 },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: p.bgElevated1, justifyContent: 'center', alignItems: 'center' },
    text: { flex: 1, gap: 4 },
    network: { flexDirection: 'row', alignItems: 'center', gap: 6 },
}));
