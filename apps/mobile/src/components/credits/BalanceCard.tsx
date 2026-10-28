import { rawText } from '../../lib/i18n/translate';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Balance } from '../../lib/api';
import { formatLocale, plural, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Card, Icon, Text, themedStyles, useThemedStyles } from '../ui';
export function BalanceCard({ details, failed, children }: { details: Balance | null; failed: boolean; children?: ReactNode }) {
    const s = useThemedStyles(sheets);
    return <Card style={s.card}>
        <View accessible accessibilityLabel={rawText(`${t('creditsPage.balance')}: ${details ? plural('home.credits', details.balance) : '—'}`)}>
            <Text variant="caption" tone="tertiary">{t('creditsPage.balance')}</Text>
            <View style={s.row}><Icon name="coins" tint={s.money.color} /><Text variant="display" tone="warning" style={s.number}>{details ? details.balance.toLocaleString(formatLocale()) : '—'}</Text></View>
        </View>
        {details && details.free_credits > 0 && details.free_expires_at ? <View style={s.divider}>
            <View style={s.row}><Text variant="footnote" tone="secondary">{t('creditsPage.free')}</Text><Text variant="footnote">{plural('credits.pack', details.free_credits)}</Text></View>
            <View style={s.row}><Text variant="footnote" tone="secondary">{t('creditsPage.expire')}</Text><Text variant="footnote">{new Date(details.free_expires_at).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</Text></View>
        </View> : null}
        {failed ? <Text variant="caption" tone="tertiary">{t('creditsPage.balanceUnavailable')}</Text> : null}
        <View style={s.footer}>{children}</View>
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { gap: ds.space.md }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm, flexWrap: 'wrap' },
    money: { color: p.warning }, number: { fontVariant: ['tabular-nums'] },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.borderSubtle, paddingTop: ds.space.md, gap: ds.space.sm },
    footer: { gap: ds.space.sm },
}));
