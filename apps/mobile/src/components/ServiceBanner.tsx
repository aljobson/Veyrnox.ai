import { StyleSheet, View } from 'react-native';
import { t } from '../lib/i18n';
import { useServiceStatus } from '../lib/serviceStatus';
import { ds } from '../theme';
import { useIsOffline } from './OfflineBanner';
import { Text, themedStyles, useThemedStyles } from './ui';

// Shown under the header while our database provider is failing (ADR-0160). Hidden while the phone is offline: that
// strip already explains why nothing loads, and blaming the service for a dead connection would be wrong.
export function ServiceBanner() {
    const status = useServiceStatus();
    const offline = useIsOffline();
    const styles = useThemedStyles(sheets);
    if (status !== 'degraded' || offline) return null;
    return (
        <View style={styles.bar}>
            <Text variant="footnote" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.text}>{t('net.serviceDegraded')}</Text>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: p.surface, borderBottomColor: p.borderStrong, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: ds.space.gutter, paddingVertical: ds.space.sm },
    text: { flex: 1 },
}));
