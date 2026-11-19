import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Text } from '../ui';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import type { MusicActionQuote } from '../../lib/music/actionTypes';
export function MusicActionQuoteCard({ quote, ambiguous, busy, onConfirm, children }: {
    quote: MusicActionQuote; ambiguous: boolean; busy: boolean; onConfirm(): void; children?: ReactNode;
}) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (ambiguous) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, Date.parse(quote.expires_at) - Date.now()) + 1));
        return () => clearTimeout(timer);
    }, [quote, ambiguous]);
    const expired = Date.parse(quote.expires_at) <= now;
    const message = ambiguous ? t('musicActions.action.recovery') : !quote.affordable ? t('musicActions.action.notAffordable') : expired ? t('musicActions.action.expired') : null;
    useAnnouncement(message, { onMount: true, everywhere: true });
    return <Card>
        {children}
        <Text variant="title3" accessibilityRole="header">{t('musicActions.action.price', { credits: quote.total_credits })}</Text>
        <Text>{t('musicActions.action.balance', { balance: quote.balance, after: quote.balance_after })}</Text>
        <Text>{t('musicActions.action.expires', { time: new Date(quote.expires_at).toLocaleTimeString() })}</Text>
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
        <Button label={t(ambiguous ? 'musicActions.action.recover' : 'musicActions.action.confirm', { credits: quote.total_credits })}
            disabled={busy || (!ambiguous && (!quote.affordable || expired))} onPress={onConfirm} />
    </Card>;
}
