import { useRouter } from 'expo-router';
import { Button, Text } from '../../ui';
import { t } from '../../../lib/i18n';
import type { QuoteSnapshot } from '../../../lib/beatAi/types';
export function QuoteCard({ quote, original = false }: { quote: QuoteSnapshot; original?: boolean }) {
    const router = useRouter();
    return <>
        {original ? <Text>{t('beatAi.original')}</Text> : null}
        <Text tone="warning" variant="title3">{t('beatAi.priceValue', { credits: quote.total_credits })}</Text>
        <Text>{t('beatAi.balance', { balance: quote.balance, after: quote.balance_after })}</Text>
        <Text>{t('beatAi.expires', { time: new Date(quote.expires_at).toLocaleTimeString() })}</Text>
        {!quote.affordable ? <><Text>{t('beatAi.notEnough')}</Text><Button label={t('beatAi.buy')} onPress={() => router.push('/credits')} /></> : null}
    </>;
}
