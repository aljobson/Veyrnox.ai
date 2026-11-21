import type { PurchaseOutcome } from '../../billing/storePurchaseStore';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { Text } from '../ui';

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
    const text = purchaseOutcomeText(outcome);
    useAnnouncement(text, { onMount: true });
    if (!outcome || !text) return null;
    const tone = outcome.kind === 'error' ? 'danger'
        : outcome.kind === 'credited' || outcome.kind === 'subscribed' || outcome.kind === 'restored' ? 'accent'
        : outcome.kind === 'cancelled' || outcome.kind === 'pending' ? 'tertiary' : 'secondary';
    return <Text variant="body" tone={tone} accessibilityLiveRegion="polite">{text}</Text>;
}
