import { Pressable, StyleSheet, Text } from 'react-native';
import { HEADER_MAX_FONT_SCALE, touchTarget } from '../lib/a11y';
import { colors } from '../theme';

// A text button in the navigation bar. The bar does not grow with the system text size, so the label's growth is
// capped; the button keeps a 44 pt target and reads as a button with the full label.
export function HeaderAction({ label, accessibilityLabel, onPress }: { label: string; accessibilityLabel?: string; onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} style={touchTarget} onPress={onPress}>
            <Text style={styles.text} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} numberOfLines={1}>
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    text: { color: colors.accent, fontSize: 16 },
});
