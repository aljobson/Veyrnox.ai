import { useState } from 'react';
import { View } from 'react-native';
import { generationCatalogId, type DisplayPackage } from '../../lib/billing';
import { planName, subscriptionSavingPercent, yearlySaving } from '../../lib/creditOffers';
import { formatLocale, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Card, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
export type Cadence = 'month' | 'year';
export const initialCadence = (plans: readonly DisplayPackage[]): Cadence => plans.some(p => p.interval === 'month') ? 'month' : 'year';
export function PlanCards({ plans, packs, credits, cadence, onCadence, chosenId, onChoose, readOnly = false }: {
    plans: readonly DisplayPackage[]; packs: readonly DisplayPackage[]; credits: ReadonlyMap<string, number>;
    cadence?: Cadence; onCadence?: (cadence: Cadence) => void; chosenId?: string | null; onChoose?: (id: string) => void; readOnly?: boolean;
}) {
    const s = useThemedStyles(sheets);
    const [localCadence, setLocalCadence] = useState<Cadence | null>(null);
    const active = cadence ?? localCadence ?? initialCadence(plans);
    const both = plans.some(p => p.interval === 'month') && plans.some(p => p.interval === 'year');
    return <View style={s.list}>
        {both ? <SegmentedControl options={[{ value: 'month', label: t('creditsPage.monthly') }, { value: 'year', label: t('creditsPage.yearly') }]} value={active} onChange={next => { if (next === active) return; setLocalCadence(next); onCadence?.(next); }} /> : null}
        {plans.filter(p => p.interval === active).map(plan => {
            const count = credits.get(generationCatalogId(plan.productId) ?? '');
            const saving = subscriptionSavingPercent(plan, count, packs), yearly = yearlySaving(plan, plans);
            return <Card key={plan.id} style={s.card} accessibilityRole={readOnly ? undefined : 'radio'} selected={!readOnly && chosenId === plan.id}
                accessibilityState={readOnly ? undefined : { selected: chosenId === plan.id }} onPress={readOnly ? undefined : () => onChoose?.(plan.id)}>
                {saving != null && saving >= 1 ? <Text variant="micro" tone="accent">{t('creditsPage.vsPack', { pct: saving })}</Text> : null}
                <Text variant="title3">{planName(plan.generationPlan ?? '')}</Text>
                <Text variant="title2" tone="warning">{t(plan.interval === 'year' ? 'creditsPage.perYear' : 'creditsPage.perMonth', { price: plan.priceString })}</Text>
                {plan.interval === 'year' && plan.pricePerMonthString ? <Text variant="footnote" tone="secondary">{t('creditsPage.yearlyMonthly', { amount: plan.pricePerMonthString })}</Text> : null}
                {yearly != null && yearly >= 1 ? <Text variant="footnote" tone="accent">{t('creditsPage.yearlySave', { pct: yearly })}</Text> : null}
                <Text variant="footnote" tone="warning">{count ? t('credits.plan.allowance', { count: count.toLocaleString(formatLocale()) }) : t('credits.plan.creationCredits')}</Text>
                <Text variant="footnote" tone="tertiary">{t(plan.interval === 'year' ? 'creditsPage.yearlyExpiry' : 'creditsPage.monthlyExpiry')}</Text>
            </Card>;
        })}
    </View>;
}
const sheets = themedStyles(() => ({ list: { gap: ds.space.md }, card: { gap: ds.space.sm } }));
