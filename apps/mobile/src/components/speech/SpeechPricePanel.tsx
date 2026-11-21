import { Card, Text, Button } from '../ui';
import { CostTick } from '../create/CreateResult';
import { plural, t } from '../../lib/i18n';
import { shortfall } from '../../lib/lowBalance';
export function SpeechPricePanel({ price, payable, balance, disabled, busy, onGenerate, onCredits, audition }: {
    price: number; payable: number; balance: number | null; disabled: boolean; busy: boolean; onGenerate: () => void; onCredits: () => void;
    audition?: { count: number; unit: number; remaining: number | null };
}) {
    const missing = shortfall(balance, payable);
    return <Card style={{ gap: 12 }}>
        <CostTick value={price}><Text variant="title2" accessibilityLiveRegion="polite">{plural('speech.price', price)}</Text></CostTick>
        {audition && <>
            <Text>{plural('speech.audition.price', audition.count, { unit: audition.unit, total: price })}</Text>
            {audition.remaining !== null && <Text accessibilityLiveRegion="polite">{plural('speech.audition.remaining', audition.remaining)}</Text>}
        </>}
        <Text>{balance === null ? t('speech.balanceUnknown') : plural('speech.balance', balance)}</Text>
        {missing > 0 && <><Text accessibilityLiveRegion="polite">{plural('speech.shortfall', missing)}</Text><Button variant="secondary" label={t('speech.addCredits')} onPress={onCredits} /></>}
        <Button label={busy ? t('speech.submitting') : audition ? audition.count < 2 ? t('speech.audition.addOne') : plural('speech.audition.generate', audition.count) : plural('speech.generate', price)} loading={busy}
            disabled={disabled || busy || missing > 0} accessibilityState={{ busy, disabled: disabled || busy || missing > 0 }} onPress={onGenerate} />
        <Text variant="caption" tone="secondary">{t(audition ? 'speech.audition.jobsNote' : 'speech.refund')}</Text>
    </Card>;
}
