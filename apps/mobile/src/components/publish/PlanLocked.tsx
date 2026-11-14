import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '../ui';
import { Text as StatusText } from '../ui/Text';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { colors } from '../../theme';

// One look for every Publish screen that needs the Publish Plan: what is locked, and one way to the plan card on the
// Publish tab. There is no retry here, because trying again cannot change a plan error.
export function PlanLocked({ message }: { message: string }) {
    const router = useRouter();
    useAnnouncement(message, { onMount: true });
    return (
        <View style={styles.box}>
            <StatusText variant="inherit" style={styles.message} accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</StatusText>
            <Button label={t('publishParity.plan.see')} onPress={() => router.push('/publish')} />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 12, paddingVertical: 8 },
    message: { color: colors.body, fontSize: 15 },
});
