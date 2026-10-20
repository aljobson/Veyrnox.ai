import * as WebBrowser from 'expo-web-browser';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { UnlockCard } from '../../../components/UnlockCard';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { ApiError, API_BASE } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { adsErrorKey, fetchCampaigns, money, type Campaign } from '../../../lib/publishAds';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Ads() {
    const api = usePublishApi();
    const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [locked, setLocked] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [reload, setReload] = useState(0);

    const load = useCallback(async () => {
        try {
            setCampaigns(await fetchCampaigns(api));
            setError(null);
            setLocked(false);
        } catch (err) {
            setCampaigns(null);
            if (err instanceof ApiError && err.status === 402) setLocked(true);
            else setError(t(adsErrorKey(err)));
        }
    }, [api]);

    useFocusEffect(useCallback(() => { void load(); }, [load, reload]));

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('ads.title') }} />
            {locked ? (
                <UnlockCard feature="ads" onUnlocked={() => setReload((n) => n + 1)} />
            ) : error && !campaigns ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !campaigns ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={campaigns}
                    keyExtractor={(c) => c.id}
                    contentContainerStyle={{ paddingBottom: VEY_CLEARANCE }}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<Text style={styles.muted}>{t('ads.intro')}</Text>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('ads.none')}</Text>}
                    ListFooterComponent={
                        <Pressable accessibilityRole="link" style={[styles.web, touchTarget]} onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/app/publish`)}>
                            <Text style={styles.webText}>{t('ads.continueWeb')}</Text>
                        </Pressable>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.card} accessible accessibilityLabel={`${item.name}, ${t(`ads.status.${item.status}`)}, ${money(item.dailyBudgetCents, item.currency)} ${t('ads.perDay')}`}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.status}>{t(`ads.status.${item.status}`)} · {item.network} · {t(`ads.mode.${item.mode}`)}</Text>
                            <Text style={styles.muted}>{t(`ads.objective.${item.objective}`)} · {money(item.dailyBudgetCents, item.currency)} {t('ads.perDay')}</Text>
                            {item.startsAt || item.endsAt ? <Text style={styles.muted}>{item.startsAt ? new Date(item.startsAt).toLocaleDateString() : '…'} – {item.endsAt ? new Date(item.endsAt).toLocaleDateString() : '…'}</Text> : null}
                            {item.destinationHost ? <Text style={styles.muted}>{t('ads.sendsTo', { host: item.destinationHost })}</Text> : null}
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 8 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 3, marginTop: 10 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    status: { color: colors.accent, fontSize: 13 },
    muted: { color: colors.muted, fontSize: 13, paddingVertical: 2 },
    web: { alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    webText: { color: colors.accent, textDecorationLine: 'underline' },
    error: { color: colors.danger },
});
