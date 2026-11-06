import { View } from 'react-native';
import { ds } from '../theme';
import { plural, t } from '../lib/i18n';
import { SIGNUP_FREE_CREDITS } from '../lib/signupOffer';
import { Icon, Text, themedStyles, useThemedStyles } from './ui';

// The new-account gift, shown above the sign-in options so the reason to sign up is on screen before the buttons.
export function SignupOffer() {
    const s = useThemedStyles(sheets);
    return (
        <View accessible accessibilityRole="summary" style={s.card}>
            <View style={s.coin}>
                <Icon name="coins" size={24} tint={s.coinInk.color} />
            </View>
            <View style={s.copy}>
                <Text variant="title3">{plural('signIn.offer.title', SIGNUP_FREE_CREDITS)}</Text>
                <Text variant="footnote" tone="secondary">
                    {t('signIn.offer.body')}
                </Text>
            </View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.space.lg,
        padding: ds.space.lg,
        borderRadius: ds.radius.lg,
        borderWidth: 1,
        borderColor: p.accent,
        backgroundColor: p.accentSubtle,
    },
    coin: {
        width: 48,
        height: 48,
        borderRadius: ds.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: p.bgElevated1,
    },
    coinInk: { color: p.accent },
    copy: { flex: 1, gap: ds.space.xs },
}));
