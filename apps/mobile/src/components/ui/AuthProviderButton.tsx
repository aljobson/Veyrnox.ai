import { rawText } from '../../lib/i18n/translate';
import { View } from 'react-native';
import * as Apple from 'expo-apple-authentication';
import { brandColors, ds } from '../../theme';
import { t } from '../../lib/i18n';
import { Button } from './Button';
import { themedStyles, useThemedStyles, useAppearance } from './AppearanceContext';
export type AuthProviderButtonProps = { provider: 'apple' | 'google' | 'email'; consent: boolean; busy: boolean; nativeAvailable?: boolean; onPress: () => void; label?: string };
export function AuthProviderButton({ provider, consent, busy, nativeAvailable, onPress, label }: AuthProviderButtonProps) {
    const s = useThemedStyles(sheets);
    const { scheme } = useAppearance();
    const blocked = !consent || busy;
    const press = () => {
        if (!consent || busy) return;
        onPress();
    };
    const title = label ?? t(provider === 'apple' ? 'authGate.continueWithApple' : provider === 'google' ? 'authGate.continueWithGoogle' : 'signIn.email');
    if (provider === 'apple' && nativeAvailable)
        return (
            <View
                pointerEvents={blocked ? 'none' : 'auto'}
                style={blocked ? s.disabled : undefined}
                accessible={blocked}
                accessibilityLabel={rawText(title)}
                accessibilityRole="button"
                accessibilityState={{ disabled: blocked }}
            >
                <Apple.AppleAuthenticationButton
                    buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={scheme === 'light' ? Apple.AppleAuthenticationButtonStyle.BLACK : Apple.AppleAuthenticationButtonStyle.WHITE}
                    cornerRadius={ds.radius.md}
                    style={s.native}
                    onPress={press}
                    accessibilityElementsHidden={blocked}
                    importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}
                />
            </View>
        );
    return (
        <Button
            label={provider === 'apple' ? ` ${title}` : title}
            variant="secondary"
            icon={provider === 'google' ? 'googleG' : provider === 'email' ? 'envelope' : undefined}
            disabled={blocked}
            onPress={press}
            style={provider === 'email' ? undefined : s[provider]}
            textStyle={provider === 'email' ? undefined : s[`${provider}Text`]}
        />
    );
}
const sheets = themedStyles((_, __, scheme) => ({
    native: { height: 52, width: '100%' },
    disabled: { opacity: 0.4 },
    apple: { backgroundColor: brandColors.apple[scheme].fill },
    appleText: { color: brandColors.apple[scheme].text },
    google: { backgroundColor: brandColors.google[scheme].fill, borderColor: brandColors.google[scheme].border, borderWidth: 1 },
    googleText: { color: brandColors.google[scheme].text },
}));
