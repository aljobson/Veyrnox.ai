import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { CatalogList, kindTitleKey } from '../../components/CatalogList';
import { PlanCards } from '../../components/credits/PlanCards';
import { PackCard, PackTaxNote } from '../../components/credits/PackCard';
import { Chip, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { isWebParityPack, parseGenerationCatalog, toDisplayPackages, type GenerationCatalogPlan } from '../../lib/billing';
import { bestPackId, packSavingPercent } from '../../lib/creditOffers';
import { priceLines } from '../../lib/catalogPages';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

// What each model costs, in credits, from the public catalogue (read-only). It shows prices only: credits are
// bought in the store, and nothing on this screen links anywhere to buy them.
export default function Pricing() {
    const styles = useThemedStyles(sheets), billing = useBilling(), { api } = useAuth();
    const [catalog, setCatalog] = useState<GenerationCatalogPlan[]>([]);
    const plans = useMemo(() => toDisplayPackages(billing.offerings?.all.generation?.availablePackages ?? []).filter(p => p.generationPlan), [billing.offerings]);
    const packs = useMemo(() => toDisplayPackages(billing.offerings?.all.credits?.availablePackages ?? []).filter(isWebParityPack), [billing.offerings]);
    useEffect(() => { let live = true; void api.request<unknown>('/api/credit-subscription-plans').then(value => { if (live) setCatalog(parseGenerationCatalog(value)); }).catch(() => {}); return () => { live = false; }; }, [api]);
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: t('prc.title') }} />
        <Text variant="body" tone="secondary">{t('prc.intro')}</Text>
        {billing.status === 'ready' && plans.length > 0 ? <View style={styles.section}>
            <Text variant="title2" accessibilityRole="header">{t('creditsPage.subscriptions')}</Text>
            <PlanCards readOnly plans={plans} packs={packs} credits={new Map(catalog.map(p => [p.id, p.credits]))} />
        </View> : null}
        {billing.status === 'ready' && packs.length > 0 ? <View style={styles.section}>
            <Text variant="title2" accessibilityRole="header">{t('creditsPage.packs')}</Text>
            {packs.map(pack => <PackCard key={pack.id} pack={pack} readOnly best={bestPackId(packs) === pack.id} saving={packSavingPercent(pack, packs)} />)}
            <PackTaxNote />
        </View> : null}
        <CatalogList includeGated render={g => <>
            <Text variant="title3" accessibilityRole="header">{t(kindTitleKey(g.kind))}</Text>
            {g.models.map(m => <View key={m.id} style={styles.row}>
                <View style={styles.name}><Text variant="bodyStrong">{m.name}</Text>{m.gated ? <Chip label={t('creditsPage.premium')} /> : null}</View>
                <View style={styles.prices}>{priceLines(m).map(p => <Text key={p.seconds ?? 'one'} variant="footnote" tone="warning">
                    {p.seconds ? t('prc.perClip', { seconds: p.seconds, credits: p.credits }) : t('prc.each', { credits: p.credits })}
                </Text>)}</View>
            </View>)}
        </>} />
        <Text variant="footnote" tone="secondary">{t('prc.refund')}</Text>
    </ScrollView>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, paddingBottom: ds.space.huge, gap: ds.space.lg },
    section: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.borderSubtle, paddingTop: ds.space.lg, gap: ds.space.md },
    row: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', gap: ds.space.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: StyleSheet.hairlineWidth, borderRadius: ds.radius.lg, padding: ds.space.md },
    name: { flex: 1, gap: ds.space.sm }, prices: { alignItems: 'flex-end', flexShrink: 1 },
}));
