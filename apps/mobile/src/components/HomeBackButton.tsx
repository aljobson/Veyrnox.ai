import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { t } from '../lib/i18n';
import { ds } from '../theme';
import { Icon, themedStyles, useThemedStyles } from './ui';

// A screen opened from a link, a notification or a replaced screen has nothing behind it, so the bar has no back button.
// This one takes the person home (Explore) instead of leaving them stuck. Screens with history keep the native back.
export function HomeBackButton() {
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const goBack = () => router.canGoBack() ? router.back() : router.replace('/');
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('public.vey.back')} style={styles.button} onPress={goBack}>
            <Icon name="arrowLeft" tint={styles.ink.color} />
        </Pressable>
    );
}

const sheets = themedStyles((p, _, scheme) => ({
    button: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: ds.radius.pill, backgroundColor: scheme === 'dark' ? p.surface : p.bgElevated1,
        // The soft lift the native back chip has on every other screen, so this one reads as the same round button.
        shadowColor: '#000', shadowOpacity: scheme === 'dark' ? 0.4 : 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
    ink: { color: p.textPrimary },
}));
