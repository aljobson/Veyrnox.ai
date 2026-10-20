import { Stack } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { DevicesCard } from '../../components/account/DevicesCard';
import { GrantsCard } from '../../components/account/GrantsCard';
import { MfaCard } from '../../components/account/MfaCard';
import { PasskeysCard } from '../../components/account/PasskeysCard';
import { PasswordCard } from '../../components/account/PasswordCard';
import { t } from '../../lib/i18n';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { colors } from '../../theme';

// Password, signed-in devices and connected assistants (parity P7; the web Account page).
// Passkeys are listed and removable; adding one waits for spike S2.
export default function Security() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('acct.sec.title') }} />
            <MfaCard />
            <PasskeysCard />
            <PasswordCard />
            <DevicesCard />
            <GrantsCard />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + VEY_CLEARANCE, gap: 16 },
});
