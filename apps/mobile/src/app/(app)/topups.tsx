import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action } from '../../components/account/shared';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { entryDate } from '../../lib/creditHistory';
import { plural, t } from '../../lib/i18n';
import { dollars, fetchTopUps, merge, statusKey, type TopUp, type TopUpCursor } from '../../lib/topUps';
import { colors } from '../../theme';

// Past credit purchases, newest first. Read-only.
export default function TopUps() {
    const { api } = useAuth();
    const [items, setItems] = useState<TopUp[] | null>(null);
    const [next, setNext] = useState<TopUpCursor | null>(null);
    const [failed, setFailed] = useState(false);
    const [moreFailed, setMoreFailed] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const busy = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const page = await fetchTopUps(api);
            setItems([...page.items]);
            setNext(page.next);
        } catch {
            setFailed(true);
        }
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);

    async function more() {
        if (!next || busy.current || !items) return;
        busy.current = true;
        setLoadingMore(true);
        setMoreFailed(false);
        try {
            const page = await fetchTopUps(api, next);
            setItems((cur) => merge(cur ?? [], page.items));
            setNext(page.next);
        } catch {
            setMoreFailed(true);
        } finally {
            busy.current = false;
            setLoadingMore(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('topup.title') }} />
            {failed ? (
                <View style={{ gap: 12, padding: 16 }}>
                    <Text style={styles.note} accessibilityRole="alert">{t('topup.failed')}</Text>
                    <Action label={t('acct.mfa.retry')} onPress={() => void load()} />
                </View>
            ) : !items ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} accessibilityLabel={t('topup.loading')} />
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(i) => i.id}
                    contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 16 + VEY_CLEARANCE }}
                    ListEmptyComponent={<Text style={styles.note}>{t('topup.empty')}</Text>}
                    onEndReached={() => void more()}
                    onEndReachedThreshold={0.4}
                    renderItem={({ item }) => (
                        <View style={styles.row} accessible accessibilityLabel={`${plural('topup.credits', item.credits)}, ${t(statusKey(item.status))}, ${entryDate(item.createdAt)}`}>
                            <View style={{ flexShrink: 1, gap: 2 }}>
                                <Text style={styles.name}>{plural('topup.credits', item.credits)}</Text>
                                <Text style={styles.note}>{entryDate(item.createdAt)}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 2 }}>
                                {item.priceCents !== null ? <Text style={styles.name}>{dollars(item.priceCents)}</Text> : null}
                                <Text style={styles.note}>{t(statusKey(item.status))}</Text>
                            </View>
                        </View>
                    )}
                    ListFooterComponent={
                        loadingMore ? <ActivityIndicator color={colors.accent} /> : moreFailed ? <Action label={t('topup.moreRetry')} onPress={() => void more()} /> : undefined
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    row: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    name: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
});
