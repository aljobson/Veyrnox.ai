import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { API_BASE } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { commerceErrorKey, fetchProducts, money, type Product } from '../../../lib/publishCommerce';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Commerce() {
    const api = usePublishApi();
    const [products, setProducts] = useState<Product[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setProducts(await fetchProducts(api));
            setError(null);
        } catch (err) {
            setProducts(null);
            setError(t(commerceErrorKey(err)));
        }
    }, [api]);

    useFocusEffect(useCallback(() => { void load(); }, [load]));

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('commerce.title') }} />
            {error && !products ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !products ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={products}
                    keyExtractor={(p) => p.id}
                    contentContainerStyle={{ paddingBottom: VEY_CLEARANCE }}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<Text style={styles.muted}>{t('commerce.intro')}</Text>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('commerce.none')}</Text>}
                    ListFooterComponent={
                        <Pressable accessibilityRole="link" style={[styles.web, touchTarget]} onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/app/publish`)}>
                            <Text style={styles.webText}>{t('commerce.continueWeb')}</Text>
                        </Pressable>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.card} accessible accessibilityLabel={`${item.title}, ${money(item.priceCents, item.currency)}, ${t('commerce.stock', { count: item.inventory })}`}>
                            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.pic} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={styles.pic} />}
                            <View style={styles.text}>
                                <Text style={styles.name} numberOfLines={2}>{item.title}</Text>
                                <Text style={styles.price}>{money(item.priceCents, item.currency)}{item.compareAtCents && item.compareAtCents > item.priceCents ? `  ${t('commerce.was', { price: money(item.compareAtCents, item.currency) })}` : ''}</Text>
                                <Text style={styles.muted}>{t(`commerce.status.${item.status}`)} · {t('commerce.stock', { count: item.inventory })}{item.variants ? ` · ${t('commerce.variants', { count: item.variants })}` : ''}</Text>
                                {item.host ? <Text style={styles.muted}>{item.host}</Text> : null}
                                {item.syncError ? <Text style={styles.bad}>{item.syncError}</Text> : null}
                            </View>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 8 },
    card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
    pic: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.background },
    text: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    price: { color: colors.money, fontSize: 15, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    bad: { color: colors.danger, fontSize: 13 },
    web: { alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    webText: { color: colors.accent, textDecorationLine: 'underline' },
    error: { color: colors.danger },
});
