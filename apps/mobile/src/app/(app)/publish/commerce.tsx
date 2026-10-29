import { rawText } from '../../../lib/i18n/translate';
import { usePublishScope } from '../../../lib/usePublishScope';
import { Text as StatusText } from '../../../components/ui/Text';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { UnlockCard } from '../../../components/UnlockCard';
import { touchTarget } from '../../../lib/a11y';
import { ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { archiveProduct, commerceErrorKey, fetchProductPage, money, type ProductDetail } from '../../../lib/publishCommerce';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors, LIST_END_PADDING } from '../../../theme';

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

    const canEditRef = useRef(false), running = useRef(false);
    const { guard, nextRead, scopeTick } = usePublishScope(api, () => {
        canEditRef.current = false; running.current = false;
        setProducts(null); setCanEdit(false); setNotice(null); setError(null); setLocked(false); setRefreshing(false);
    });

    const load = useCallback(async () => {
        const valid = nextRead('list');
        try {
            const page = await fetchProductPage(api);
            if (!valid()) return;
            canEditRef.current = page.canEdit;
            setProducts(page.products);
            setCanEdit(page.canEdit);
            setError(null);
            setLocked(false);
        } catch (err) {
            if (!valid()) return;
            canEditRef.current = false; setCanEdit(false);
            setProducts(null);
            if (err instanceof ApiError && err.status === 402) setLocked(true);
            else setError(t(commerceErrorKey(err)));
        } finally {
            if (valid()) setRefreshing(false);
        }
    }, [api, nextRead, scopeTick]);

    useFocusEffect(useCallback(() => { void load(); }, [load, reload]));

    function confirmArchive(p: ProductDetail) {
        if (!canEditRef.current) return;
        const valid = guard(); let used = false;
        Alert.alert(t('commerce.archiveTitle', { name: p.title }), t('commerce.archiveBody'), [
            { text: t('commerce.cancel'), style: 'cancel' },
            {
                text: t('commerce.archive'),
                style: 'destructive',
                onPress: async () => {
                    if (used || !valid() || !canEditRef.current || running.current) return;
                    used = true; running.current = true;
                    try { await archiveProduct(api, p.id); if (valid()) { setNotice(t('commerce.archived', { name: p.title })); void load(); } }
                    catch (err) { if (valid()) setNotice(t(commerceErrorKey(err))); }
                    finally { if (valid()) running.current = false; }
                },
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('commerce.title') }} />
            {locked ? (
                <UnlockCard feature="commerce" onUnlocked={() => setReload((n) => n + 1)} />
            ) : error && !products ? (
                <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{error}</StatusText>
            ) : !products ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={products}
                    keyExtractor={(p) => p.id}
                    contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); }} />}
                    ListHeaderComponent={<View><Text style={styles.muted}>{t('commerce.intro2')}</Text>{notice ? <StatusText variant="inherit" style={styles.notice} accessibilityLiveRegion="polite">{notice}</StatusText> : null}</View>}
                    ListEmptyComponent={<Text style={styles.muted}>{t('commerce.none')}</Text>}
                    ListFooterComponent={
                        <View>
                            {canEdit ? (
                                <Pressable accessibilityRole="button" style={[styles.add, touchTarget]} onPress={() => router.push('/publish/commerce-edit')}>
                                    <Text style={styles.addText}>{t('commerce.new')}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    }
                    renderItem={({ item }) => (
                        <View style={styles.card} accessible={false}>
                            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.pic} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={styles.pic} />}
                            <View style={styles.text}>
                                <View accessible testID={`commerce-summary-${item.id}`} accessibilityLabel={rawText(`${item.title}, ${money(item.priceCents, item.currency)}, ${t('commerce.stock', { count: item.inventory })}`)}>
                                    <Text style={styles.name} numberOfLines={2}>{item.title}</Text>
                                    <Text style={styles.price}>{money(item.priceCents, item.currency)}{item.compareAtCents && item.compareAtCents > item.priceCents ? `  ${t('commerce.was', { price: money(item.compareAtCents, item.currency) })}` : ''}</Text>
                                    <Text style={styles.muted}>{t(`commerce.status.${item.status}`)} · {t('commerce.stock', { count: item.inventory })}{item.variants ? ` · ${t('commerce.variants', { count: item.variants })}` : ''}</Text>
                                    {item.host ? <Text style={styles.muted}>{item.host}</Text> : null}
                                    {item.syncError ? <Text style={styles.bad}>{item.syncError}</Text> : null}
                                    {item.source !== 'manual' ? <Text style={styles.muted}>{t('commerce.fromShop')}</Text> : null}
                                </View>
                                <View style={styles.actions}>
                                    {canEdit && item.editable ? (
                                        <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('commerce.editLabel', { name: item.title }))} style={[styles.act, touchTarget]} onPress={() => router.push({ pathname: '/publish/commerce-edit', params: { id: item.id } })}>
                                            <Text style={styles.webText}>{t('commerce.edit')}</Text>
                                        </Pressable>
                                    ) : (
                                        <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('commerce.viewLabel', { name: item.title }))} style={[styles.act, touchTarget]} onPress={() => router.push({ pathname: '/publish/commerce-edit', params: { id: item.id } })}>
                                            <Text style={styles.webText}>{t('commerce.view')}</Text>
                                        </Pressable>
                                    )}
                                    {canEdit && item.status !== 'archived' ? <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('commerce.archiveLabel', { name: item.title }))} style={[styles.act, touchTarget]} onPress={() => confirmArchive(item)}>
                                        <Text style={styles.delText}>{t('commerce.archive')}</Text>
                                    </Pressable> : null}
                                </View>
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
