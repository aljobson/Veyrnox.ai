import { useSyncExternalStore } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from './ui';
import { t } from '../lib/i18n';
import { isOffline, subscribe } from '../lib/network';
import { ds } from '../theme';
export function useIsOffline(): boolean { return useSyncExternalStore(subscribe, isOffline, isOffline); }
export function OfflineBanner({ topInset = false }: { topInset?: boolean }) {
    const offline = useIsOffline();
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(sheets);
    if (!offline) return null;
    return <View style={[styles.bar, topInset && { paddingTop: insets.top + ds.space.sm }]}>
        <Text accessibilityRole="alert" variant="footnote" style={styles.text}>{t('net.offline')}</Text>
    </View>;
}
const sheets = themedStyles(p => ({
    bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: p.surface, borderBottomColor: p.borderStrong, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: ds.space.gutter, paddingVertical: ds.space.sm },
    text: { flex: 1 },
}));
