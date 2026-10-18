import { Stack } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { brandStore, fetchBrands, reconcileBrand, roleLabel, type Brand } from '../../../lib/publishBrand';
import { colors } from '../../../theme';

export default function Brands() {
    const { api } = useAuth();
    const [brands, setBrands] = useState<Brand[] | null>(null);
    const [error, setError] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const selected = useSyncExternalStore(brandStore.subscribe, brandStore.get, () => null);

    const load = useCallback(async () => {
        try {
            const list = await fetchBrands(api);
            reconcileBrand(list);
            setBrands(list);
            setError(false);
        } catch {
            setError(true);
        }
    }, [api]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('brands.title') }} />
            {error && !brands ? (
                <Text style={styles.error} accessibilityRole="alert">{t('common.error')}</Text>
            ) : !brands ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={brands}
                    keyExtractor={(b) => b.id}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListHeaderComponent={
                        <View>
                            <Text style={styles.intro}>{t('brands.intro')}</Text>
                            <Pressable accessibilityRole="button" accessibilityState={{ selected: selected === null }} style={[styles.row, touchTarget]} onPress={() => brandStore.set(null)}>
                                <View style={styles.text}>
                                    <Text style={styles.name}>{t('brands.mine')}</Text>
                                    <Text style={styles.muted}>{t('brands.mineNote')}</Text>
                                </View>
                                {selected === null ? <Text style={styles.check} accessibilityElementsHidden>✓</Text> : null}
                            </Pressable>
                        </View>
                    }
                    ListEmptyComponent={<Text style={styles.muted}>{t('brands.none')}</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" accessibilityState={{ selected: selected === item.id }} style={[styles.row, touchTarget]} onPress={() => brandStore.set(item.id)}>
                            <View style={styles.text}>
                                <Text style={styles.name}>{item.label}</Text>
                                <Text style={styles.muted}>{roleLabel(item.role)}{item.timezone ? ` · ${item.timezone}` : ''}{item.paid ? '' : ` · ${t('brands.noPlan')}`}</Text>
                            </View>
                            {selected === item.id ? <Text style={styles.check} accessibilityElementsHidden>✓</Text> : null}
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    intro: { color: colors.body, paddingVertical: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    text: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    check: { color: colors.accent, fontSize: 20 },
    error: { color: colors.danger, paddingTop: 16 },
});
