import { StyleSheet, View } from 'react-native';
import { ds, vividHue } from '../theme';
import { plural, t } from '../lib/i18n';
import { HARD_PAYWALL_STARTER_CREDITS, hardPaywallEnabled } from '../lib/hardPaywall';
import { signupOfferCopy } from '../lib/signupOffer';
import { Icon, Text } from './ui';
import { useAppearance } from './ui/AppearanceContext';

// The new-account gift, shown above the sign-in options so the reason to sign up is on screen before the buttons.
export function SignupOffer() {
    const { scheme } = useAppearance();
    const tone = vividHue('purple', scheme);
    const copy = signupOfferCopy(hardPaywallEnabled() ? HARD_PAYWALL_STARTER_CREDITS : null);
    return (
        <View accessible accessibilityRole="summary" style={[styles.card, { backgroundColor: tone.fill, borderColor: tone.edge }]}>
            <View style={[styles.coin, { backgroundColor: tone.iconSurface }]}>
                <Icon name="coins" size={24} tint={tone.foreground} />
            </View>
            <View style={styles.copy}>
                <Text variant="title3" style={{ color: tone.foreground }}>{plural('signIn.offer.title', copy.count)}</Text>
                <Text variant="footnote" style={{ color: tone.foregroundMuted }}>
                    {t(copy.body, copy.params)}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.space.lg,
        padding: ds.space.lg,
        borderRadius: ds.radius.lg,
        borderWidth: 1,
    },
    coin: {
        width: 48,
        height: 48,
        borderRadius: ds.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    copy: { flex: 1, gap: ds.space.xs },
});
