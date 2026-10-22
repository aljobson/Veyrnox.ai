import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { appCache, getCacheUser } from '../lib/appCache';
import { POLICIES } from '../lib/cache';
import { observe } from '../lib/network';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { colors, type Palette } from '../theme';

// The credits balance in the header of every tab. It opens Buy credits and Credit history, so purchases stay one tap away.
export function CreditsChip({ palette = colors }: { palette?: Palette }) {
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
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('tabs.creditsHint')} style={[styles.chip, { backgroundColor: palette.surface, borderColor: palette.border }]} onPress={() => router.push('/credits')}>
            <Text style={[styles.chipText, { color: palette.accent }]} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} numberOfLines={1}>
                {balance === null ? '—' : balance}
            </Text>
        </Pressable>
    );
}

// Account sits behind the avatar, as on the web.
export function AvatarButton({ palette = colors }: { palette?: Palette }) {
    const router = useRouter();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('tabs.account')} style={styles.avatarHit} onPress={() => router.push('/account')}>
            <View style={[styles.avatar, { backgroundColor: palette.surface, borderColor: palette.borderStrong }]}>
                <View style={[styles.head, { backgroundColor: palette.muted }]} />
                <View style={[styles.shoulders, { backgroundColor: palette.muted }]} />
            </View>
        </Pressable>
    );
}

export function HeaderRight({ palette = colors }: { palette?: Palette }) {
    return (
        <View style={styles.row}>
            <CreditsChip palette={palette} />
            <AvatarButton palette={palette} />
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
    chip: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
    chipText: { fontSize: 15, fontWeight: '700' },
    avatarHit: { width: MIN_TARGET, height: MIN_TARGET, justifyContent: 'center', alignItems: 'center' },
    avatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', borderWidth: 1 },
    head: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
    shoulders: { width: 20, height: 12, borderRadius: 10, marginTop: 2 },
});
