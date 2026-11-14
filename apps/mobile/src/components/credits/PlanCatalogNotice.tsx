import { ActivityIndicator, View } from 'react-native';
import { t } from '../../lib/i18n';
import type { PlanCatalogStatus } from '../../lib/usePlanCatalog';
import { ds } from '../../theme';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';

interface PlanCatalogNoticeProps {
    status: PlanCatalogStatus;
    onRetry: () => void;
}

// Shown with the plan cards while the plans' credit amounts load, and when they could not be loaded (with a retry).
export function PlanCatalogNotice({ status, onRetry }: PlanCatalogNoticeProps) {
    const s = useThemedStyles(sheets);
    if (status === 'ready') return null;
    // The live region sits on the shared Text, which also announces on iOS (a native View's live region is Android-only).
    if (status === 'loading') return <View style={s.row}>
        <ActivityIndicator color={s.spinner.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t('credits.planDetails.loading')}</Text>
    </View>;
    return <View style={s.group}>
        <Text variant="footnote" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">{t('credits.planDetails.failed')}</Text>
        <Button variant="secondary" accessibilityRole="button" label={t('credits.planDetails.retry')} onPress={onRetry} />
    </View>;
}
const sheets = themedStyles(p => ({
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    group: { gap: ds.space.sm },
    spinner: { color: p.accent },
}));
