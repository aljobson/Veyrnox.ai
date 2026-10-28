import { rawText } from '../../lib/i18n/translate';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { DisplayPackage } from '../../lib/billing';
import { formatLocale, plural, t } from '../../lib/i18n';
import type { typicalCosts } from '../../lib/creditOffers';
import { ds } from '../../theme';
import { Card, Chip, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { peekRoom } from '../VeyCardPeek';
export function PackCard({ pack, best, saving, costs, busy, chosen, disabled, readOnly, onPress, children }: {
    children?: ReactNode; pack: DisplayPackage; best?: boolean; saving?: number | null; costs?: ReturnType<typeof typicalCosts> | null;
    busy?: boolean; chosen?: boolean; disabled?: boolean; readOnly?: boolean; onPress?: () => void;
}) {
    const s = useThemedStyles(sheets);
    const credits = plural('credits.pack', pack.credits ?? 0);
    const videos = costs?.video ? Math.floor((pack.credits ?? 0) / costs.video).toLocaleString(formatLocale()) : null;
    const images = costs?.image ? Math.floor((pack.credits ?? 0) / costs.image).toLocaleString(formatLocale()) : null;
    const example = videos && images ? t('creditsPage.examples', { videos, images }) : videos ? t('creditsPage.videos', { videos }) : images ? t('creditsPage.images', { images }) : null;
    const save = saving != null && saving >= 1 ? t('creditsPage.save', { pct: saving }) : null;
    return <Card onPress={readOnly ? undefined : onPress} disabled={disabled} accessibilityRole={readOnly ? undefined : 'button'}
        accessibilityLabel={rawText([credits, pack.priceString, best && t('creditsPage.best'), save].filter(Boolean).join(', '))} style={[s.card, chosen && s.peek]}>
        {children}
        <View style={s.row}><Text variant="caption" tone="tertiary">{t('creditsPage.pack')}</Text>{best ? <Chip selected label={t('creditsPage.best')} /> : null}</View>
        <View style={s.band}><Icon name="coins" tint={s.money.color} /><Text variant="title2" tone="warning">{credits}</Text></View>
        <View style={s.row}>{busy ? <ActivityIndicator color={s.money.color} /> : <Text variant="title3">{pack.priceString}</Text>}{save ? <Text variant="footnote" tone="accent">{save}</Text> : null}</View>
        <View style={s.divider}>{[t('credits.packs.neverExpire'), example].filter(Boolean).map(line => <View key={line} style={s.check}><Icon name="check" size={16} /><Text variant="footnote" tone="secondary" style={s.copy}>{line}</Text></View>)}</View>
    </Card>;
}
export function PackTaxNote() { return <Text variant="caption" tone="tertiary">{t('creditsPage.tax')}</Text>; }
const sheets = themedStyles(p => ({
    card: { gap: ds.space.md }, peek: { marginTop: peekRoom() }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm, flexWrap: 'wrap' },
    band: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.accentSubtle },
    money: { color: p.warning }, copy: { flex: 1 }, check: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.borderSubtle, paddingTop: ds.space.md, gap: ds.space.sm },
}));
