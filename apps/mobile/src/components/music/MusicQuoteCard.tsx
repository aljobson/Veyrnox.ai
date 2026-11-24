import { Card, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { MusicQuote } from '../../lib/music/types';
export function MusicQuoteCard({ quote }: { quote: MusicQuote }) {
    const covered = quote.daily_free_candidates ?? 0;
    const list = quote.list_credits ?? quote.total_credits;
    return <Card>
        <Text variant="title3">{t('music.create.price', { each: quote.credits_per_candidate, count: quote.output_count, total: list })}</Text>
        {covered > 0 ? <Text>{t(covered === 1
            ? 'music.create.dailyAllowance.one' : 'music.create.dailyAllowance.other', { count: covered })}</Text> : null}
        {covered > 0 ? <Text>{quote.total_credits === 0
            ? t('music.create.noAccountCredits')
            : t('music.create.payableCredits', { credits: quote.total_credits })}</Text> : null}
        <Text>{t('music.create.balance', { balance: quote.balance, after: quote.balance_after })}</Text>
        <Text>{t('music.create.expires', { time: new Date(quote.expires_at).toLocaleTimeString() })}</Text>
        {!quote.affordable ? <Text accessibilityRole="alert">{t('music.create.not_affordable')}</Text> : null}
    </Card>;
}
