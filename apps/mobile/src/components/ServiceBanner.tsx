import { StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { useServiceStatus } from '../lib/serviceStatus';
import { colors } from '../theme';
import { useIsOffline } from './OfflineBanner';

// Shown under the header while our database provider is failing (ADR-0160). Hidden while the phone is offline: that
// strip already explains why nothing loads, and blaming the service for a dead connection would be wrong.
export function ServiceBanner() {
    const status = useServiceStatus();
    const offline = useIsOffline();
    if (status !== 'degraded' || offline) return null;
    return (
        <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={styles.text}>{t('net.serviceDegraded')}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    bar: { backgroundColor: colors.surface, borderBottomColor: colors.borderStrong, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 8 },
    text: { color: colors.money, fontSize: 13, fontWeight: '600' },
});
