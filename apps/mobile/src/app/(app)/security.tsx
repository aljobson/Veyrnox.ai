import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { DevicesCard } from '../../components/account/DevicesCard';
import { GrantsCard } from '../../components/account/GrantsCard';
import { MfaCard } from '../../components/account/MfaCard';
import { PasskeysCard } from '../../components/account/PasskeysCard';
import { PasswordCard } from '../../components/account/PasswordCard';
import { t } from '../../lib/i18n';
import { colors, LIST_END_PADDING } from '../../theme';
import { KeyboardScreen } from '../../components/KeyboardScreen';
import { KeyboardFormScrollView } from '../../components/KeyboardFormScrollView';

// Password, signed-in devices and connected assistants (parity P7; the web Account page).
// Passkeys are listed and removable; adding one waits for spike S2.
export default function Security() {
    return (
        <KeyboardScreen style={styles.screen}><KeyboardFormScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('acct.sec.title') }} />
            <MfaCard />
            <PasskeysCard />
            <PasswordCard />
            <DevicesCard />
            <GrantsCard />
        </KeyboardFormScrollView></KeyboardScreen>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 16 },
});
