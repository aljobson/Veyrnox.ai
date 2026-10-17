import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import type { Balance } from '../../lib/api';
import { colors } from '../../theme';

export default function Home() {
    const { api, signOut } = useAuth();
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

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Veyrnox.ai' }} />
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
            <Pressable accessibilityRole="button" style={styles.signOut} onPress={() => void signOut()}>
                <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 24, gap: 8 },
    label: { color: colors.muted, fontSize: 14 },
    value: { color: colors.text, fontSize: 48, fontWeight: '700' },
    muted: { color: colors.muted },
    error: { color: colors.danger },
    signOut: { marginTop: 'auto', paddingVertical: 14, alignItems: 'center' },
    signOutText: { color: colors.muted },
});
