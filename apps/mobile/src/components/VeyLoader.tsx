import { View } from 'react-native';

import { t } from '../lib/i18n';
import { ds } from '../theme';
import { Text, themedStyles, useThemedStyles } from './ui';
import { VeyCharacter } from './VeyCharacter';

// The loading status precedes a separate Vey button in screen-reader order.
export function VeyLoader({ label, showLabel = false, width = 56 }: { label?: string; showLabel?: boolean; width?: number }) {
    const styles = useThemedStyles(sheets);
    const name = label ?? t('common.loading');
    return (
        <View style={styles.box}>
            <View style={styles.status} accessible accessibilityRole="progressbar" accessibilityLabel={name} accessibilityState={{ busy: true }}>
                {showLabel ? <Text variant="footnote" tone="secondary" style={styles.label}>{name}</Text> : null}
            </View>
            <VeyCharacter width={width} mood="working" interactive />
        </View>
    );
}

const sheets = themedStyles((p) => ({
    box: { alignItems: 'center', justifyContent: 'center', gap: ds.space.sm, paddingVertical: ds.space.lg },
    status: { minWidth: 1, minHeight: 1 },
    label: { color: p.textSecondary, textAlign: 'center' },
}));
