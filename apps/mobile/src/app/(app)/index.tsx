import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { Logo } from '../../components/Logo';
import type { Balance } from '../../lib/api';
import { colors } from '../../theme';

export default function Home() {
    const { api } = useAuth();
    const { status: billing } = useBilling();
    const [balance, setBalance] = useState<Balance | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            setBalance(await api.getBalance());
        } catch {
            setFailed(true);
        }
    }, [api]);

    // On every return to Home, so a purchase or a creation made elsewhere shows at once.
    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerTitle: () => <Logo size={24} /> }} />
            <Text style={styles.label}>Credits</Text>
            {balance ? (
                <>
                    <Text style={styles.value}>{balance.balance}</Text>
                    {balance.free_credits > 0 ? (
                        <Text style={styles.muted}>{balance.free_credits} of them are free credits</Text>
                    ) : null}
                </>
            ) : failed ? (
                <Pressable accessibilityRole="button" onPress={load}>
                    <Text style={styles.error}>Could not load your balance. Tap to retry.</Text>
                </Pressable>
            ) : (
                <ActivityIndicator color={colors.accent} />
            )}
            <Link href="/create" asChild>
                <Pressable accessibilityRole="button" style={styles.primary}>
                    <Text style={styles.primaryText}>Create</Text>
                </Pressable>
            </Link>
            <Link href="/library" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>Library</Text>
                </Pressable>
            </Link>
            <Link href="/cinema" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>Cinema</Text>
                </Pressable>
            </Link>
            <Link href="/chat" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>Chat with Vey</Text>
                </Pressable>
            </Link>
            {billing !== 'off' ? (
                <>
            <Link href="/credits" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>Buy credits</Text>
                </Pressable>
            </Link>
            <Link href="/publish" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>Publish Plan</Text>
                </Pressable>
            </Link>
                </>
            ) : null}
            <Link href="/account" asChild>
                <Pressable accessibilityRole="button" style={styles.signOut}>
                    <Text style={styles.signOutText}>Account</Text>
                </Pressable>
            </Link>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 24, gap: 8 },
    label: { color: colors.muted, fontSize: 14 },
    value: { color: colors.money, fontSize: 48, fontWeight: '700' },
    muted: { color: colors.muted },
    error: { color: colors.danger },
    primary: { marginTop: 24, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    primaryText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    secondary: { marginTop: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    secondaryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    signOut: { marginTop: 'auto', paddingVertical: 14, alignItems: 'center' },
    signOutText: { color: colors.muted },
});
