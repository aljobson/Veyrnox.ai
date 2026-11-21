import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { ds } from '../../theme';
import { Text, themedStyles, useThemedStyles } from '../ui';

export type PurchaseStateKind = 'loading' | 'restoring' | 'unavailable';

export function PurchaseState({ kind, text, children }: { kind: PurchaseStateKind; text: string; children?: ReactNode }) {
    const s = useThemedStyles(sheets);
    const waiting = kind !== 'unavailable';
    useAnnouncement(waiting ? text : null, { onMount: true });
    return <View testID={`purchase-state-${kind}`} accessibilityState={{ busy: waiting }} style={[s.card, kind === 'unavailable' && s.unavailable]}>
        <View style={s.row}>
            {waiting ? <ActivityIndicator testID="purchase-state-spinner" color={s.spinner.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /> : null}
            <Text variant="body" tone="secondary" style={s.copy} accessibilityRole={kind === 'unavailable' ? 'alert' : undefined} accessibilityLiveRegion="polite">{text}</Text>
        </View>
        {children}
    </View>;
}

const sheets = themedStyles(p => ({
    card: { alignSelf: 'stretch', gap: ds.space.md, padding: ds.space.md, borderRadius: ds.radius.md, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    unavailable: { borderColor: p.borderStrong },
    row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
    copy: { flex: 1 },
    spinner: { color: p.accent },
}));
