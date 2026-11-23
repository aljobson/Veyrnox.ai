import { Button, Card, Text } from '../ui';
import { CostTick } from '../create/CreateResult';
import { plural, t } from '../../lib/i18n';
import { shortfall } from '../../lib/lowBalance';

export function DialoguePricePanel({ price, payable, balance, busy, disabled, onGenerate, onCredits }: {
    price: number; payable: number; balance: number | null; busy: boolean; disabled: boolean;
    onGenerate: () => void; onCredits: () => void;
}) {
    const missing = shortfall(balance, payable);
    return <Card style={{ gap: 12 }}>
        <CostTick value={price}><Text variant="title2" accessibilityLiveRegion="polite">{plural('dialogue.price', price)}</Text></CostTick>
        <Text>{balance === null ? t('dialogue.balanceUnknown') : plural('dialogue.balance', balance)}</Text>
        {missing > 0 && <><Text accessibilityLiveRegion="polite">{plural('dialogue.shortfall', missing)}</Text>
            <Button variant="secondary" label={t('dialogue.addCredits')} onPress={onCredits} /></>}
        <Button label={busy ? t('dialogue.submitting') : plural('dialogue.generate', price)} loading={busy} disabled={disabled || busy || missing > 0} onPress={onGenerate} />
        <Text variant="caption" tone="secondary">{t('dialogue.refund')}</Text>
    </Card>;
}
