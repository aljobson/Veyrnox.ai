import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../auth/AuthProvider';
import { useBilling } from '../../../billing/BillingProvider';
import { Logo } from '../../../components/Logo';
import { StaleNote } from '../../../components/StaleNote';
import { appCache, getCacheUser } from '../../../lib/appCache';
import { POLICIES, type CacheMeta } from '../../../lib/cache';
import { observe } from '../../../lib/network';
import type { Balance } from '../../../lib/api';
import { colors } from '../../../theme';
import { plural, t } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';

export default function Home() {
    const { api } = useAuth();
    const { status: billing } = useBilling();
    const [balance, setBalance] = useState<Balance | null>(null);
    const [failed, setFailed] = useState(false);
    const [saved, setSaved] = useState<CacheMeta | null>(null);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            // A saved balance only fills the screen while the real one loads or when offline. Create still asks the server.
            const out = await appCache.swr({
                policy: POLICIES.balance,
                userId: getCacheUser(),
                fetcher: () => observe(api.getBalance()),
                onData: (value) => setBalance(value),
            });
            setSaved(out.meta);
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
        <ScrollView style={styles.scroll} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ headerTitle: () => <Logo size={24} /> }} />
            <Text style={styles.label}>{t('label.Credits')}</Text>
            {balance ? (
                <>
                    <Text style={styles.value} accessibilityLabel={plural('home.credits', balance.balance)}>{balance.balance}</Text>
                    {balance.free_credits > 0 ? (
                        <Text style={styles.muted}>{balance.free_credits} of them are free credits</Text>
                    ) : null}
                    <StaleNote meta={saved} />
                </>
            ) : failed ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={load}>
                    <Text style={styles.error}>{t('home.balanceError')}</Text>
                </Pressable>
            ) : (
                <ActivityIndicator color={colors.accent} />
            )}
            <Link href="/create" asChild>
                <Pressable accessibilityRole="button" style={styles.primary}>
                    <Text style={styles.primaryText}>{t('label.Create')}</Text>
                </Pressable>
            </Link>
            <Link href="/library" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('label.Library')}</Text>
                </Pressable>
            </Link>
            <Link href="/cinema" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('home.cinema')}</Text>
                </Pressable>
            </Link>
            <Link href="/edit" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('edit.title')}</Text>
                </Pressable>
            </Link>
            <Link href="/projects" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('label.Projects')}</Text>
                </Pressable>
            </Link>
            <Link href="/chat" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('home.chat')}</Text>
                </Pressable>
            </Link>
            {billing !== 'off' ? (
                <>
            <Link href="/credits" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('pricing.packs.buy')}</Text>
                </Pressable>
            </Link>
            <Link href="/publish" asChild>
                <Pressable accessibilityRole="button" style={styles.secondary}>
                    <Text style={styles.secondaryText}>{t('publish.plan.colPlan')}</Text>
                </Pressable>
            </Link>
                </>
            ) : null}
            <Link href="/account" asChild>
                <Pressable accessibilityRole="button" style={styles.signOut}>
                    <Text style={styles.signOutText}>{t('home.account')}</Text>
                </Pressable>
            </Link>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.background },
    screen: { flexGrow: 1, backgroundColor: colors.background, padding: 24, gap: 8 },
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
