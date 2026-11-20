import { Card, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { MusicQuote } from '../../lib/music/types';
export function MusicQuoteCard({ quote }: { quote: MusicQuote }) {
    return <Card>
        <Text variant="title3">{t('music.create.price', { each: quote.credits_per_candidate, count: quote.output_count, total: quote.total_credits })}</Text>
        <Text>{t('music.create.balance', { balance: quote.balance, after: quote.balance_after })}</Text>
        <Text>{t('music.create.expires', { time: new Date(quote.expires_at).toLocaleTimeString() })}</Text>
        {!quote.affordable ? <Text accessibilityRole="alert">{t('music.create.not_affordable')}</Text> : null}
    </Card>;
}
