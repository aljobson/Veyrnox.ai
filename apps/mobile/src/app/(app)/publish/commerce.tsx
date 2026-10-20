import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { UnlockCard } from '../../../components/UnlockCard';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { ApiError, API_BASE } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { archiveProduct, commerceErrorKey, fetchProductPage, money, type ProductDetail } from '../../../lib/publishCommerce';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Commerce() {
    const api = usePublishApi();
    const router = useRouter();
    const [products, setProducts] = useState<ProductDetail[] | null>(null);
    const [canEdit, setCanEdit] = useState(false);
    const [locked, setLocked] = useState(false);
    const [reload, setReload] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            const page = await fetchProductPage(api);
            setProducts(page.products);
            setCanEdit(page.canEdit);
            setError(null);
            setLocked(false);
        } catch (err) {
            setProducts(null);
            if (err instanceof ApiError && err.status === 402) setLocked(true);
            else setError(t(commerceErrorKey(err)));
        }
    }, [api]);

    useFocusEffect(useCallback(() => { void load(); }, [load, reload]));

    function confirmArchive(p: ProductDetail) {
        Alert.alert(t('commerce.archiveTitle', { name: p.title }), t('commerce.archiveBody'), [
            { text: t('commerce.cancel'), style: 'cancel' },
            {
                text: t('commerce.archive'),
                style: 'destructive',
                onPress: () => archiveProduct(api, p.id)
                    .then(() => { setNotice(t('commerce.archived', { name: p.title })); void load(); })
                    .catch((err) => setNotice(t(commerceErrorKey(err)))),
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('commerce.title') }} />
            {locked ? (
                <UnlockCard feature="commerce" onUnlocked={() => setReload((n) => n + 1)} />
            ) : error && !products ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !products ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={products}
                    keyExtractor={(p) => p.id}
                    contentContainerStyle={{ paddingBottom: VEY_CLEARANCE }}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('commerce.intro2')}</Text>{notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('commerce.none')}</Text>}
                    ListFooterComponent={
                        <View>
                            {canEdit ? (
                                <Pressable accessibilityRole="button" style={[styles.add, touchTarget]} onPress={() => router.push('/publish/commerce-edit')}>
                                    <Text style={styles.addText}>{t('commerce.new')}</Text>
                                </Pressable>
                            ) : null}
                            <Text style={styles.muted}>{t('commerce.optionsWeb')}</Text>
                            <Pressable accessibilityRole="link" style={[styles.web, touchTarget]} onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}/app/publish`)}>
                                <Text style={styles.webText}>{t('commerce.continueWeb')}</Text>
                            </Pressable>
                        </View>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.card} accessible={!(canEdit && item.status !== 'archived')} accessibilityLabel={`${item.title}, ${money(item.priceCents, item.currency)}, ${t('commerce.stock', { count: item.inventory })}`}>
                            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.pic} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={styles.pic} />}
                            <View style={styles.text}>
                                <Text style={styles.name} numberOfLines={2}>{item.title}</Text>
                                <Text style={styles.price}>{money(item.priceCents, item.currency)}{item.compareAtCents && item.compareAtCents > item.priceCents ? `  ${t('commerce.was', { price: money(item.compareAtCents, item.currency) })}` : ''}</Text>
                                <Text style={styles.muted}>{t(`commerce.status.${item.status}`)} · {t('commerce.stock', { count: item.inventory })}{item.variants ? ` · ${t('commerce.variants', { count: item.variants })}` : ''}</Text>
                                {item.host ? <Text style={styles.muted}>{item.host}</Text> : null}
                                {item.syncError ? <Text style={styles.bad}>{item.syncError}</Text> : null}
                                {item.source !== 'manual' ? <Text style={styles.muted}>{t('commerce.fromShop')}</Text> : null}
                                {canEdit && item.status !== 'archived' ? (
                                    <View style={styles.actions}>
                                        {item.editable ? (
                                            <Pressable accessibilityRole="button" accessibilityLabel={t('commerce.editLabel', { name: item.title })} style={[styles.act, touchTarget]} onPress={() => router.push({ pathname: '/publish/commerce-edit', params: { id: item.id } })}>
                                                <Text style={styles.webText}>{t('commerce.edit')}</Text>
                                            </Pressable>
                                        ) : null}
                                        <Pressable accessibilityRole="button" accessibilityLabel={t('commerce.archiveLabel', { name: item.title })} style={[styles.act, touchTarget]} onPress={() => confirmArchive(item)}>
                                            <Text style={styles.delText}>{t('commerce.archive')}</Text>
                                        </Pressable>
                                    </View>
                                ) : null}
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
    notice: { color: colors.accent, paddingVertical: 4 },
    actions: { flexDirection: 'row', gap: 16, marginTop: 4 },
    act: { justifyContent: 'center' },
    delText: { color: colors.danger, fontWeight: '600' },
    add: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, marginTop: 16 },
    addText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
