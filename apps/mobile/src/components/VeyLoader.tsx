import { View } from 'react-native';

import { t } from '../lib/i18n';
import { ds } from '../theme';
import { Text, themedStyles, useThemedStyles } from './ui';
import { VeyCharacter } from './VeyCharacter';

// A screen's first load: Vey keeps cheering instead of a grey spinner. With Reduce Motion on, Vey stands still and the
// label still says what is happening. The box carries the name, so a screen reader hears one "Loading" and not the art.
export function VeyLoader({ label, showLabel = false, width = 56 }: { label?: string; showLabel?: boolean; width?: number }) {
    const styles = useThemedStyles(sheets);
    const name = label ?? t('common.loading');
    return (
        <View style={styles.box} accessible accessibilityRole="progressbar" accessibilityLabel={name} accessibilityState={{ busy: true }}>
            <VeyCharacter width={width} mood="cheer" />
            {showLabel ? <Text variant="footnote" tone="secondary" style={styles.label}>{name}</Text> : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    box: { alignItems: 'center', justifyContent: 'center', gap: ds.space.sm, paddingVertical: ds.space.lg },
    label: { color: p.textSecondary, textAlign: 'center' },
}));
