import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { appCache, getCacheUser } from '../lib/appCache';
import { POLICIES } from '../lib/cache';
import { observe } from '../lib/network';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { applyThemePreference, colors, isDark, toggledTheme, type Palette } from '../theme';

const SUN_RAYS = [0, 45, 90, 135] as const;

function SunIcon({ color }: { color: string }) {
    return (
        <View style={styles.sunIcon} accessibilityElementsHidden>
            {SUN_RAYS.map((rotation) => (
                <View key={rotation} style={[styles.sunRay, { backgroundColor: color, transform: [{ rotate: `${rotation}deg` }] }]} />
            ))}
            <View style={[styles.sunCore, { borderColor: color }]} />
        </View>
    );
}

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

// The website keeps this beside the account controls. The mobile app does the same so appearance is not buried in
// Account; System remains available on the full Account screen.
export function ThemeButton({ palette = colors }: { palette?: Palette }) {
    const label = isDark ? t('ui.themeToLight') : t('ui.themeToDark');
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('ui.themeHint')} style={[styles.themeHit, { backgroundColor: palette.surface, borderColor: palette.border }]} onPress={() => void applyThemePreference(toggledTheme(isDark ? 'dark' : 'light'))}>
            {isDark ? (
                <SunIcon color={palette.text} />
            ) : (
                <Text style={[styles.themeGlyph, { color: palette.text }]} maxFontSizeMultiplier={1} accessibilityElementsHidden>☾</Text>
            )}
        </Pressable>
    );
}

export function HeaderRight({ palette = colors }: { palette?: Palette }) {
    return (
        <View style={styles.row}>
            <CreditsChip palette={palette} />
            <ThemeButton palette={palette} />
            <AvatarButton palette={palette} />
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
    chip: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
    chipText: { fontSize: 15, fontWeight: '700' },
    themeHit: { width: MIN_TARGET, height: MIN_TARGET, borderRadius: 22, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
    sunIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
    sunRay: { position: 'absolute', width: 20, height: 1.6, borderRadius: 1 },
    sunCore: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.8, backgroundColor: colors.surface },
    themeGlyph: { fontSize: 19, lineHeight: 22, fontWeight: '600' },
    avatarHit: { width: MIN_TARGET, height: MIN_TARGET, justifyContent: 'center', alignItems: 'center' },
    avatar: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', alignItems: 'center', borderWidth: 1 },
    head: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
    shoulders: { width: 20, height: 12, borderRadius: 10, marginTop: 2 },
});
