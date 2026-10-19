import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { appCache, getCacheUser } from '../lib/appCache';
import { POLICIES } from '../lib/cache';
import { observe } from '../lib/network';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { colors } from '../theme';

// The credits balance in the header of every tab. It opens Buy credits and Credit history, so purchases stay one tap away.
export function CreditsChip() {
    const { api } = useAuth();
    const router = useRouter();
    const [balance, setBalance] = useState<number | null>(null);

    useFocusEffect(
        useCallback(() => {
            void appCache
                .swr({
                    policy: POLICIES.balance,
                    userId: getCacheUser(),
                    fetcher: () => observe(api.getBalance()),
                    onData: (value) => setBalance(value.balance),
                })
                .catch(() => {});
        }, [api]),
    );

    const label = balance === null ? t('tabs.creditsUnknown') : plural('home.credits', balance);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('tabs.creditsHint')} style={styles.chip} onPress={() => router.push('/credits')}>
            <Text style={styles.chipText} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} numberOfLines={1}>
                {balance === null ? '—' : balance}
            </Text>
        </Pressable>
    );
}

// Account sits behind the avatar, as on the web.
export function AvatarButton() {
    const router = useRouter();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('tabs.account')} style={styles.avatarHit} onPress={() => router.push('/account')}>
            <View style={styles.avatar}>
                <View style={styles.head} />
                <View style={styles.shoulders} />
            </View>
        </Pressable>
    );
}

export function HeaderRight() {
    return (
        <View style={styles.row}>
            <CreditsChip />
            <AvatarButton />
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
    chip: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    avatarHit: { width: MIN_TARGET, height: MIN_TARGET, justifyContent: 'center', alignItems: 'center' },
    avatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 },
    head: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.muted, marginTop: 6 },
    shoulders: { width: 20, height: 12, borderRadius: 10, backgroundColor: colors.muted, marginTop: 2 },
});
