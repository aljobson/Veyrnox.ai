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
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={t('public.vey.back')} style={styles.button} onPress={() => router.replace('/')}>
            <Icon name="arrowLeft" tint={styles.ink.color} />
        </Pressable>
    );
}

const sheets = themedStyles((p, _, scheme) => ({
    button: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: ds.radius.pill, backgroundColor: scheme === 'dark' ? p.surface : p.bgElevated1 },
    ink: { color: p.textPrimary },
}));
