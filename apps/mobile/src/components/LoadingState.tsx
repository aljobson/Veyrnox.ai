import { ActivityIndicator, View } from 'react-native';

import { t } from '../lib/i18n';
import { colors, ds } from '../theme';
import { Text, themedStyles, useThemedStyles } from './ui';

export interface LoadingStateProps {
    label?: string;
    showLabel?: boolean;
    size?: 'small' | 'large';
}

/**
 * The routine waiting state for the app. Keep it quiet and native; branded
 * characters belong to onboarding, empty states, recovery and celebrations.
 */
export function LoadingState({ label, showLabel = false, size = 'large' }: LoadingStateProps) {
    const styles = useThemedStyles(sheets);
    const name = label ?? t('common.loading');
    return <View
        style={[styles.box, size === 'small' && styles.compact]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={name}
        accessibilityState={{ busy: true }}
    >
        <ActivityIndicator
            size={size}
            color={colors.accent}
            accessible={false}
            importantForAccessibility="no"
        />
        {showLabel ? <Text variant="footnote" tone="secondary" style={styles.label}>{name}</Text> : null}
    </View>;
}

const sheets = themedStyles((p) => ({
    box: { alignItems: 'center', justifyContent: 'center', gap: ds.space.sm, paddingVertical: ds.space.lg },
    compact: { paddingVertical: ds.space.sm },
    label: { color: p.textSecondary, textAlign: 'center' },
}));
