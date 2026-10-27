import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, themedStyles, useThemedStyles } from './ui';
import { t } from '../lib/i18n';
import { isOffline, subscribe } from '../lib/network';
export function useIsOffline(): boolean { return useSyncExternalStore(subscribe, isOffline, isOffline); }
export function OfflineBanner({ topInset = false }: { topInset?: boolean }) {
    const offline = useIsOffline();
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(sheets);
    if (!offline) return null;
    return <View style={[styles.bar, topInset && { paddingTop: insets.top + 8 }]} accessibilityRole="alert">
        <Text variant="footnote" tone="warning">{t('net.offline')}</Text>
    </View>;
}
const sheets = themedStyles(p => ({
    bar: { backgroundColor: p.surface, borderBottomColor: p.borderStrong, borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
}));
