import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { type CancelMode, type CreditSubscription } from '../../lib/creditSubscription';
import { planName } from '../../lib/creditOffers';
import { formatLocale, t } from '../../lib/i18n';
import { isOffline, subscribe } from '../../lib/network';
import { ds } from '../../theme';
import { Button, Card, Checkbox, Chip, Text, themedStyles, useThemedStyles } from '../ui';
export function CurrentPlanCard({ subscription: row, storeBilled, missing, retry, message, busy, onCancel }: {
    subscription: CreditSubscription; storeBilled: boolean; missing: boolean; retry: boolean;
    message: string | null; busy: boolean; onCancel: (mode: CancelMode) => Promise<void>;
}) {
    const s = useThemedStyles(sheets);
    const [mode, setMode] = useState<CancelMode | null>(null);
    const [checked, setChecked] = useState(false);
    const [offline, setOffline] = useState(isOffline());
    useEffect(() => subscribe(() => setOffline(isOffline())), []);
    const live = row.status === 'active' || row.status === 'past_due';
    const ended = row.status === 'ended' && row.end_reason === 'cancelled_cooling_off';
    function choose(next: CancelMode) { setMode(next); setChecked(false); }
    async function confirm() {
        if (!mode || !checked || busy || isOffline()) return;
        await onCancel(mode); setMode(null); setChecked(false);
    }
    return <Card style={s.card}>
        <View style={s.row}><Text variant="title3">{planName(row.plan_id.split('-')[0])}</Text><Chip label={t(`creditsPage.status.${row.status}`)} /></View>
        <Text variant="body">{t('creditsPage.monthlyCredits', { count: row.credits.toLocaleString(formatLocale()) })}</Text>
        {row.current_period_end ? <Text variant="footnote" tone="secondary">{t('creditsPage.periodEnd', { date: new Date(row.current_period_end).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) })}</Text> : null}
        {row.cancel_at_period_end ? <Text variant="footnote" tone="secondary">{t('creditsPage.stopped')}</Text> : null}
        {storeBilled ? <Text variant="footnote" tone="secondary">{t('creditsPage.storeBilled')}</Text> : null}
        {message || ended ? <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{t(message ?? 'creditsPage.refundUnknown')}</Text> : null}
        {!storeBilled && !missing ? <>
            {live && !row.cancel_at_period_end ? <Button variant="tertiary" disabled={busy} label={t('creditsPage.stop')} onPress={() => choose('period_end')} /> : null}
            {live ? <Button variant="tertiary" disabled={busy} label={t('creditsPage.cancel')} onPress={() => choose('cooling_off')} /> : null}
            {ended || retry ? <Button variant="tertiary" disabled={busy} label={t(retry ? 'creditsPage.retry' : 'creditsPage.checkRefund')} onPress={() => choose('cooling_off')} /> : null}
            {mode ? <Card style={s.confirm}>
                <Text variant="footnote" tone="secondary">{t(mode === 'period_end' ? 'creditsPage.stopHelp' : 'creditsPage.cancelHelp')}</Text>
                <Checkbox checked={checked} onChange={setChecked} disabled={busy} accessibilityLabel={t('creditsPage.confirmCheck')}><Text variant="body">{t('creditsPage.confirmCheck')}</Text></Checkbox>
                <Button variant="destructive" label={t('creditsPage.confirm')} disabled={!checked || busy || offline} loading={busy} onPress={() => void confirm()} />
                <Button variant="tertiary" label={t('creditsPage.keep')} disabled={busy} onPress={() => setMode(null)} />
            </Card> : null}
        </> : null}
    </Card>;
}
const sheets = themedStyles(p => ({ card: { gap: ds.space.sm }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: ds.space.sm }, confirm: { backgroundColor: p.bgElevated2, gap: ds.space.md } }));
