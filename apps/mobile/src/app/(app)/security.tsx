import { Stack } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { DevicesCard } from '../../components/account/DevicesCard';
import { GrantsCard } from '../../components/account/GrantsCard';
import { PasswordCard } from '../../components/account/PasswordCard';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Password, signed-in devices and connected assistants (parity P7; the web Account page).
// Two-factor and passkeys are separate slices.
export default function Security() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('acct.sec.title') }} />
            <PasswordCard />
            <DevicesCard />
            <GrantsCard />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 16 },
});
