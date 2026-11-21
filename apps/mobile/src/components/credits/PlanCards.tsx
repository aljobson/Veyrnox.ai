import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { generationCatalogId, isRecommendedPlan, type DisplayPackage } from '../../lib/billing';
import { planName, subscriptionSavingPercent, yearlySaving } from '../../lib/creditOffers';
import { formatLocale, t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds } from '../../theme';
import { Card, Chip, Icon, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
export type Cadence = 'month' | 'year';
export const initialCadence = (plans: readonly DisplayPackage[]): Cadence => plans.some(p => p.interval === 'month') ? 'month' : 'year';
export function PlanCards({ plans, packs, credits, cadence, onCadence, chosenId, onChoose, readOnly = false, disabled = false }: {
    plans: readonly DisplayPackage[]; packs: readonly DisplayPackage[]; credits: ReadonlyMap<string, number>;
    cadence?: Cadence; onCadence?: (cadence: Cadence) => void; chosenId?: string | null; onChoose?: (id: string) => void; readOnly?: boolean; disabled?: boolean;
}) {
    const s = useThemedStyles(sheets);
    const [localCadence, setLocalCadence] = useState<Cadence | null>(null);
    const active = cadence ?? localCadence ?? initialCadence(plans);
    const both = plans.some(p => p.interval === 'month') && plans.some(p => p.interval === 'year');
    return <View style={s.list}>
        {both && !disabled ? <SegmentedControl options={[{ value: 'month', label: t('creditsPage.monthly') }, { value: 'year', label: t('creditsPage.yearly') }]} value={active} onChange={next => { if (next === active) return; setLocalCadence(next); onCadence?.(next); }} /> : both ? <View accessibilityRole="tablist" style={s.cadence}>
            {(['month', 'year'] as const).map(value => <Pressable key={value} accessibilityRole="tab" disabled
                accessibilityState={{ selected: active === value, disabled: true }} style={s.cadenceItem}>
                <Text>{t(value === 'month' ? 'creditsPage.monthly' : 'creditsPage.yearly')}</Text>
            </Pressable>)}
        </View> : null}
        {plans.filter(p => p.interval === active).map(plan => {
            const count = credits.get(generationCatalogId(plan.productId) ?? '');
            const saving = subscriptionSavingPercent(plan, count, packs), yearly = yearlySaving(plan, plans);
            const recommended = isRecommendedPlan(plan), selected = !readOnly && chosenId === plan.id;
            const allowance = count ? t('credits.plan.allowance', { count: count.toLocaleString(formatLocale()) }) : t('credits.plan.creationCredits');
            const price = t(plan.interval === 'year' ? 'creditsPage.perYear' : 'creditsPage.perMonth', { price: plan.priceString });
            const monthly = plan.interval === 'year' && plan.pricePerMonthString ? t('creditsPage.yearlyMonthly', { amount: plan.pricePerMonthString }) : null;
            const packSaving = saving != null && saving >= 1 ? t('creditsPage.vsPack', { pct: saving }) : null;
            const annualSaving = yearly != null && yearly >= 1 ? t('creditsPage.yearlySave', { pct: yearly }) : null;
            const expiry = t(plan.interval === 'year' ? 'creditsPage.yearlyExpiry' : 'creditsPage.monthlyExpiry');
            return <Card key={plan.id} style={[s.card, selected && s.selected]} accessibilityRole={readOnly ? undefined : 'radio'} selected={selected}
                accessibilityLabel={rawText([planName(plan.generationPlan ?? ''), recommended && t('creditsPage.recommended'), allowance, price, monthly, packSaving, annualSaving, expiry].filter(Boolean).join(', '))}
                disabled={disabled} accessibilityState={{ disabled, ...(!readOnly ? { selected: chosenId === plan.id } : {}) }} onPress={readOnly ? undefined : () => { if (!disabled) onChoose?.(plan.id); }}>
                <View style={s.header}>
                    <Text variant="title3" style={s.name}>{planName(plan.generationPlan ?? '')}</Text>
                    <View style={s.badges}>
                        {recommended ? <Chip icon="sparkle" label={t('creditsPage.recommended')} /> : null}
                        {selected ? <View testID="plan-selected-indicator" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.selectedMark}>
                            <Icon name="check" size={16} tint={s.selectedInk.color} />
                        </View> : null}
                    </View>
                </View>
                <View style={s.valueBand}><Icon name="sparkleFill" tint={s.value.color} /><Text variant="title2" tone="primary" style={s.value}>{allowance}</Text></View>
                <View style={s.priceRow}><Text variant="title3" tone="primary">{price}</Text>
                    {packSaving ? <Text variant="micro" tone="secondary">{packSaving}</Text> : null}
                </View>
                {monthly ? <Text variant="footnote" tone="secondary">{monthly}</Text> : null}
                {annualSaving ? <Text variant="footnote" tone="secondary">{annualSaving}</Text> : null}
                <Text variant="footnote" tone="tertiary">{expiry}</Text>
            </Card>;
        })}
    </View>;
}
const sheets = themedStyles(p => ({
    cadence: { flexDirection: 'row' }, cadenceItem: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, list: { gap: ds.space.md },
    card: { gap: ds.space.md }, selected: { borderWidth: 2, borderColor: p.accent, backgroundColor: p.bgElevated2 },
    header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm }, name: { flex: 1 },
    badges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: ds.space.xs, flexWrap: 'wrap' },
    selectedMark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent }, selectedInk: { color: p.onAccent },
    valueBand: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated2 }, value: { color: p.textPrimary, flex: 1 },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: ds.space.sm, flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.borderSubtle, paddingTop: ds.space.md },
}));
