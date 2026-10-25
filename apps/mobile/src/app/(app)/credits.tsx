import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { toDisplayPackages, waitForBalanceChange } from '../../lib/billing';
import { colors } from '../../theme';
import { plural, t } from '../../lib/i18n';
import { VeyCardPeek, peekRoom } from '../../components/VeyCardPeek';
import { useVeyScroll } from '../../lib/useVeyScroll';

type Outcome = { kind: 'credited'; balance: number } | { kind: 'pending' } | { kind: 'error' } | null;

export default function Credits() {
    const { api } = useAuth();
    const { status, offerings, canPurchase, purchase } = useBilling();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<Outcome>(null);
    const [chosenId, setChosenId] = useState<string | null>(null);
    const onScroll = useVeyScroll();

    const packs = toDisplayPackages(offerings?.all.credits?.availablePackages ?? []).filter((p) => p.credits !== null);

    async function buy(id: string) {
        const pkg = offerings?.all.credits?.availablePackages.find((p) => p.identifier === id);
        if (!pkg || busyId) return;
        setBusyId(id);
        setOutcome(null);
        setChosenId(id);
        try {
            const before = (await api.getBalance()).balance;
            if ((await purchase(pkg)) === 'cancelled') return;
            const result = await waitForBalanceChange(async () => (await api.getBalance()).balance, before);
            setOutcome(result.changed ? { kind: 'credited', balance: result.balance } : { kind: 'pending' });
        } catch {
            setOutcome({ kind: 'error' });
        } finally {
            setBusyId(null);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('pricing.packs.buy') }} />
            {status === 'loading' ? (
                <ActivityIndicator color={colors.accent} />
            ) : status !== 'ready' || packs.length === 0 ? (
                <Text style={styles.muted}>{t('credits.unavailable')}</Text>
            ) : (
                <FlatList
                    data={packs}
                    onScroll={onScroll}
                    scrollEventThrottle={64}
                    keyExtractor={(p) => p.id}
                    ListHeaderComponent={canPurchase ? undefined : <Text style={styles.muted}>{t('credits.notOpen')}</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" disabled={!canPurchase || busyId !== null} style={[styles.row, !canPurchase && styles.off, chosenId === item.id && { marginTop: peekRoom() }]} onPress={() => buy(item.id)}>
                            {chosenId === item.id ? <VeyCardPeek /> : null}
                            <View style={styles.rowText}>
                                <Text style={styles.name}>{plural('credits.pack', item.credits ?? 0, { count: item.credits?.toLocaleString() ?? '0' })}</Text>
                            </View>
                            {busyId === item.id ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.price}>{item.priceString}</Text>}
                        </Pressable>
                    )}
                />
            )}
            <Link href="/history" asChild>
                <Pressable accessibilityRole="button" style={styles.history}>
                    <Text style={styles.historyText}>{t('credits.history')}</Text>
                </Pressable>
            </Link>
            {outcome?.kind === 'credited' ? <Text style={styles.ok}>{t('credits.added', { balance: outcome.balance })}</Text> : null}
            {outcome?.kind === 'pending' ? <Text style={styles.muted}>{t('credits.pending')}</Text> : null}
            {outcome?.kind === 'error' ? <Text style={styles.error}>{t('credits.error')}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10 },
    off: { opacity: 0.5 },
    rowText: { flex: 1 },
    name: { color: colors.text, fontSize: 17, fontWeight: '600' },
    price: { color: colors.money, fontSize: 17, fontWeight: '700' },
    history: { minHeight: 44, justifyContent: 'center' },
    historyText: { color: colors.accent, fontSize: 15 },
    muted: { color: colors.muted },
    ok: { color: colors.accent },
    error: { color: colors.danger },
});
