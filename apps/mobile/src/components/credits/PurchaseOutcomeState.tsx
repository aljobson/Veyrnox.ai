import type { PurchaseOutcome } from '../../billing/storePurchaseStore';
import { Platform, View } from 'react-native';
import { t } from '../../lib/i18n';
import type { MenuIcon } from '../../lib/menuIcons';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { ds } from '../../theme';
import { Icon, Text, themedStyles, useThemedStyles } from '../ui';

export function purchaseOutcomeText(outcome: PurchaseOutcome | null): string | null {
    if (!outcome) return null;
    if (outcome.kind === 'credited') return t('credits.added', { balance: outcome.balance });
    const keys = {
        subscribed: 'credits.subscriptions.started', restored: 'credits.restored', nothingToRestore: 'credits.nothingToRestore',
        cancelled: 'credits.cancelled', pending: 'credits.pending', error: 'credits.error', sales_closed: 'credits.notOpen',
    } as const;
    return t(keys[outcome.kind]);
}

export function PurchaseOutcomeState({ outcome }: { outcome: PurchaseOutcome | null }) {
    const s = useThemedStyles(sheets);
    const text = purchaseOutcomeText(outcome);
    useAnnouncement(text, { onMount: true });
    if (!outcome || !text) return null;
    const presentation = outcomePresentation(outcome.kind);
    const urgent = outcome.kind === 'error' || outcome.kind === 'sales_closed';
    const stateStyle = { success: s.success, warning: s.warning, notice: s.notice, danger: s.danger }[presentation.tone];
    const inkStyle = { success: s.successInk, warning: s.warningInk, notice: s.noticeInk, danger: s.dangerInk }[presentation.tone];
    return <View
        testID={`purchase-outcome-${outcome.kind}`}
        accessible
        role={Platform.OS === 'android' && urgent ? 'alert' : undefined}
        accessibilityLabel={text}
        style={[s.card, stateStyle]}
    >
        <Icon name={presentation.icon} size={20} tint={inkStyle.color} />
        <Text variant="bodyStrong" style={[s.copy, inkStyle]}>{text}</Text>
    </View>;
}

type OutcomeTone = 'success' | 'warning' | 'notice' | 'danger';
function outcomePresentation(kind: PurchaseOutcome['kind']): { tone: OutcomeTone; icon: MenuIcon } {
    if (kind === 'credited' || kind === 'subscribed' || kind === 'restored') return { tone: 'success', icon: 'check' };
    if (kind === 'pending') return { tone: 'warning', icon: 'hourglass' };
    if (kind === 'error') return { tone: 'danger', icon: 'close' };
    if (kind === 'sales_closed') return { tone: 'notice', icon: 'broadcastOff' };
    return { tone: 'notice', icon: 'close' };
}

const sheets = themedStyles(p => ({
    card: { alignSelf: 'stretch', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, borderRadius: ds.radius.md, borderWidth: 1, overflow: 'hidden' },
    copy: { flex: 1 },
    success: { backgroundColor: p.successSubtle, borderColor: p.success },
    warning: { backgroundColor: p.warningSubtle, borderColor: p.warning },
    notice: { backgroundColor: p.noticeSubtle, borderColor: p.notice },
    danger: { backgroundColor: p.dangerSubtle, borderColor: p.danger },
    successInk: { color: p.success }, warningInk: { color: p.warning }, noticeInk: { color: p.notice }, dangerInk: { color: p.danger },
}));
