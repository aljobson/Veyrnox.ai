import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { HEADER_MAX_FONT_SCALE, touchTarget } from '../lib/a11y';
import { t } from '../lib/i18n';
import { colors } from '../theme';

// A screen opened from a link, a notification or a replaced screen has nothing behind it, so the bar has no back button.
// This one takes the person home (Explore) instead of leaving them stuck. Screens with history keep the native back.
export function HomeBackButton() {
    const router = useRouter();
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('public.vey.back')} style={[styles.button, touchTarget]} onPress={() => router.replace('/')}>
            <Text style={styles.glyph} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>{'‹'}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: { alignItems: 'center', justifyContent: 'center', minWidth: 44 },
    glyph: { color: colors.text, fontSize: 32, lineHeight: 34 },
});
