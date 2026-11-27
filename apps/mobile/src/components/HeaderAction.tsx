import { rawText } from '../lib/i18n/translate';
import { Pressable, StyleSheet, Text } from 'react-native';
import { HEADER_MAX_FONT_SCALE, touchTarget } from '../lib/a11y';
import { colors } from '../theme';
import { Icon } from './ui';
import type { MenuIcon } from '../lib/menuIcons';

// A text or icon action in the navigation bar. The bar does not grow with the system text size, so text growth is
// capped; every variant keeps a 44 pt target and exposes the full label to assistive technology.
export function HeaderAction({ label, accessibilityLabel, icon, iconOnly = false, testID, onPress }: {
    label: string;
    accessibilityLabel?: string;
    icon?: MenuIcon;
    iconOnly?: boolean;
    testID?: string;
    onPress: () => void;
}) {
    return (
        <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rawText(accessibilityLabel ?? label)} style={[touchTarget, styles.action]} onPress={onPress}>
            {icon ? <Icon name={icon} size={24} tint={colors.accent} /> : null}
            {!iconOnly ? <Text style={styles.text} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} numberOfLines={1}>
                {label}
            </Text> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    action: { alignItems: 'center', justifyContent: 'center' },
    text: { color: colors.accent, fontSize: 16 },
});
