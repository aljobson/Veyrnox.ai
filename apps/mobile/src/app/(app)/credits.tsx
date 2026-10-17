import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { toDisplayPackages, waitForBalanceChange } from '../../lib/billing';
import { colors } from '../../theme';

type Outcome = { kind: 'credited'; balance: number } | { kind: 'pending' } | { kind: 'error' } | null;

export default function Credits() {
    const { api } = useAuth();
    const { status, offerings, canPurchase, purchase } = useBilling();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<Outcome>(null);

    const packs = toDisplayPackages(offerings?.all.credits?.availablePackages ?? []).filter((p) => p.credits !== null);

    async function buy(id: string) {
        const pkg = offerings?.all.credits?.availablePackages.find((p) => p.identifier === id);
        if (!pkg || busyId) return;
        setBusyId(id);
        setOutcome(null);
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
            <Stack.Screen options={{ title: 'Buy credits' }} />
            {status === 'loading' ? (
                <ActivityIndicator color={colors.accent} />
            ) : status !== 'ready' || packs.length === 0 ? (
                <Text style={styles.muted}>Credit packs are not available right now.</Text>
            ) : (
                <FlatList
                    data={packs}
                    keyExtractor={(p) => p.id}
                    ListHeaderComponent={canPurchase ? undefined : <Text style={styles.muted}>Purchases are not open yet.</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" disabled={!canPurchase || busyId !== null} style={[styles.row, !canPurchase && styles.off]} onPress={() => buy(item.id)}>
                            <View style={styles.rowText}>
                                <Text style={styles.name}>{item.credits?.toLocaleString()} credits</Text>
                            </View>
                            {busyId === item.id ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.price}>{item.priceString}</Text>}
                        </Pressable>
                    )}
                />
            )}
            {outcome?.kind === 'credited' ? <Text style={styles.ok}>Credits added. Your balance is {outcome.balance}.</Text> : null}
            {outcome?.kind === 'pending' ? <Text style={styles.muted}>Your purchase went through. The credits can take a minute to appear; check your balance on the home screen.</Text> : null}
            {outcome?.kind === 'error' ? <Text style={styles.error}>That did not complete. If you were charged, the credits will arrive; contact support if they do not.</Text> : null}
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
    muted: { color: colors.muted },
    ok: { color: colors.accent },
    error: { color: colors.danger },
});
