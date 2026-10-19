import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { isOffline, subscribe } from '../lib/network';
import { colors } from '../theme';

export function useIsOffline(): boolean {
    return useSyncExternalStore(subscribe, isOffline, isOffline);
}

// A thin strip under the header. A live region so a screen reader announces the change without moving focus.
export function OfflineBanner() {
    if (!useIsOffline()) return null;
    return (
        <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={styles.text}>{t('net.offline')}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    bar: { backgroundColor: colors.surface, borderBottomColor: colors.borderStrong, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 8 },
    text: { color: colors.money, fontSize: 13, fontWeight: '600' },
});
