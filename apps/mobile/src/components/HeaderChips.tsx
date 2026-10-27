import { useBalance } from '../lib/useBalance';
import { Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { HEADER_MAX_FONT_SCALE } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { applyAppearance, ds, paletteForScheme, toggledTheme, type Palette } from '../theme';
import { Icon, Text, themedStyles, useThemedStyles, useAppearance } from './ui';
function usePalette(override?: Palette) {
    const { settings, scheme } = useAppearance();
    return override ?? paletteForScheme(scheme, settings);
}
export function CreditsChip({ palette: override }: { palette?: Palette }) {
    const palette = usePalette(override);
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const balance = useBalance();
    const label = balance === null ? t('tabs.creditsUnknown') : plural('home.credits', balance);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('tabs.creditsHint')} style={styles.chip} onPress={() => router.push('/credits')}>
            <Icon name="coins" size={16} tint={palette.money} />
            <Text variant="caption" style={styles.chipText} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} numberOfLines={1}>
                {balance === null ? '—' : balance}
            </Text>
        </Pressable>
    );
}
export function AvatarButton({ palette: override }: { palette?: Palette }) {
    const palette = usePalette(override);
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('tabs.account')} style={styles.hit} onPress={() => router.push('/account')}>
            <Icon name="user" tint={palette.text} />
        </Pressable>
    );
}
export function ThemeButton({ palette: override }: { palette?: Palette }) {
    const palette = usePalette(override);
    const styles = useThemedStyles(sheets);
    const pathname = usePathname();
    const { scheme } = useAppearance();
    const dark = scheme === 'dark';
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(dark ? 'ui.themeToLight' : 'ui.themeToDark')}
            accessibilityHint={t('ui.themeHint')}
            style={styles.hit}
            onPress={() => void applyAppearance({ theme: toggledTheme(scheme) }, pathname)}
        >
            <Icon name={dark ? 'sun' : 'moon'} tint={palette.text} />
        </Pressable>
    );
}
export function HeaderRight({ palette }: { palette?: Palette }) {
    const styles = useThemedStyles(sheets);
    return (
        <View style={styles.row}>
            <CreditsChip palette={palette} />
            <ThemeButton palette={palette} />
            <AvatarButton palette={palette} />
        </View>
    );
}
const sheets = themedStyles((p) => ({
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.xs, marginEnd: ds.space.sm },
    chip: {
        minHeight: 44,
        minWidth: 44,
        flexDirection: 'row',
        gap: ds.space.xs,
        paddingHorizontal: ds.space.md,
        borderRadius: ds.radius.pill,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: p.borderSubtle,
        backgroundColor: p.bgElevated1,
    },
    chipText: { color: p.warning, fontVariant: ['tabular-nums'] },
    hit: { width: 44, height: 44, borderRadius: ds.radius.pill, justifyContent: 'center', alignItems: 'center' },
}));
