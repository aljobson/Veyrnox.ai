import { useMemo } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityRole, type StyleProp, type ViewStyle } from 'react-native';
import type { MenuIcon } from '../../lib/menuIcons';
import { rawText } from '../../lib/i18n/translate';
import { ds, vividHue, type VividHue } from '../../theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { useAppearance } from './AppearanceContext';
import { usePressStyle } from './usePressStyle';

export type VividCardLayout = 'tile' | 'wide' | 'row' | 'compact';

export function VividCard({
    hue,
    icon,
    title,
    detail,
    eyebrow,
    layout = 'tile',
    selected = false,
    showChevron = false,
    onPress,
    accessibilityLabel,
    accessibilityHint,
    accessibilityRole,
    style,
}: {
    readonly hue: VividHue;
    readonly icon: MenuIcon;
    readonly title: string;
    readonly detail?: string;
    readonly eyebrow?: string;
    readonly layout?: VividCardLayout;
    readonly selected?: boolean;
    readonly showChevron?: boolean;
    readonly onPress?: () => void;
    readonly accessibilityLabel?: string;
    readonly accessibilityHint?: string;
    readonly accessibilityRole?: AccessibilityRole;
    readonly style?: StyleProp<ViewStyle>;
}) {
    const { scheme } = useAppearance();
    const tone = vividHue(hue, scheme);
    const pressStyle = usePressStyle(layout === 'row' ? 'row' : 'card');
    const colour = useMemo(() => ({
        backgroundColor: tone.fill,
        borderColor: selected ? tone.foreground : tone.edge,
    }), [selected, tone.edge, tone.fill, tone.foreground]);
    const selectedSurface = useMemo(() => ({ backgroundColor: tone.foreground }), [tone.foreground]);
    const glow = useMemo(() => ({ backgroundColor: tone.glow }), [tone.glow]);
    const iconSurface = useMemo(() => ({ backgroundColor: tone.iconSurface }), [tone.iconSurface]);
    const label = rawText(accessibilityLabel ?? [eyebrow, title, detail].filter(Boolean).join('. '));
    const row = layout === 'row' || layout === 'compact';
    const compact = layout === 'compact';
    const role = accessibilityRole ?? 'button';
    const content = (
        <>
            <View pointerEvents="none" style={[styles.glow, row && styles.glowRow, glow]} />
            <View style={[styles.icon, row ? styles.iconRow : styles.iconTile, compact && styles.iconCompact, iconSurface]}>
                <Icon name={icon} size={compact ? 24 : row ? 28 : 40} tint={tone.foreground} />
            </View>
            <View style={[styles.copy, row && styles.copyRow]}>
                {eyebrow ? <Text variant="caption" style={[styles.eyebrow, { color: tone.foregroundMuted }]}>{eyebrow}</Text> : null}
                <Text variant={row ? 'bodyStrong' : 'title3'} style={{ color: tone.foreground }}>{title}</Text>
                {detail ? <Text variant="footnote" style={{ color: tone.foregroundMuted }} numberOfLines={row ? 2 : 4}>{detail}</Text> : null}
            </View>
            {showChevron ? <View style={styles.chevron}><Icon name="caretRight" size={20} tint={tone.foreground} /></View> : null}
            {selected ? <View style={[styles.selected, selectedSurface]}><Icon name="check" size={16} tint={tone.fill} /></View> : null}
        </>
    );
    const container = [styles.card, styles[layout], colour, style];
    if (onPress) return (
        <Pressable
            accessibilityRole={role}
            accessibilityLabel={label}
            accessibilityHint={rawText(accessibilityHint)}
            accessibilityState={{ selected, ...(role === 'radio' ? { checked: selected } : {}) }}
            onPress={onPress}
            style={({ pressed }) => [container, pressed && pressStyle]}
        >
            {content}
        </Pressable>
    );
    return <View accessible accessibilityRole={accessibilityRole} accessibilityLabel={label} style={container}>{content}</View>;
}

const styles = StyleSheet.create({
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: ds.radius.lg,
        overflow: 'hidden',
    },
    tile: {
        minHeight: 150,
        padding: ds.space.lg,
        justifyContent: 'flex-end',
    },
    wide: {
        minHeight: 126,
        padding: ds.space.lg,
        justifyContent: 'flex-end',
    },
    row: {
        minHeight: 86,
        paddingHorizontal: ds.space.lg,
        paddingVertical: ds.space.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.space.md,
    },
    compact: {
        minHeight: 64,
        paddingHorizontal: ds.space.md,
        paddingVertical: ds.space.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.space.md,
    },
    glow: {
        position: 'absolute',
        width: 126,
        height: 126,
        borderRadius: 63,
        right: -28,
        top: -36,
        opacity: 0.48,
    },
    glowRow: { right: -46, top: -52, opacity: 0.34 },
    icon: { alignItems: 'center', justifyContent: 'center' },
    iconTile: {
        position: 'absolute',
        right: ds.space.lg,
        top: ds.space.lg,
        width: 58,
        height: 58,
        borderRadius: ds.radius.lg,
    },
    iconRow: { width: 50, height: 50, borderRadius: ds.radius.md },
    iconCompact: { width: 40, height: 40, borderRadius: ds.radius.sm },
    copy: { gap: ds.space.xs, paddingTop: ds.space.xxxl },
    copyRow: { flex: 1, paddingTop: 0 },
    eyebrow: { fontWeight: '600' },
    chevron: { opacity: 0.82 },
    selected: {
        position: 'absolute',
        top: ds.space.sm,
        left: ds.space.sm,
        width: 24,
        height: 24,
        borderRadius: ds.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
