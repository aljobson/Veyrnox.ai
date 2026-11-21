import { rawText } from '../../lib/i18n/translate';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { DisplayPackage } from '../../lib/billing';
import { formatLocale, plural, t } from '../../lib/i18n';
import type { typicalCosts } from '../../lib/creditOffers';
import { ds } from '../../theme';
import { Card, Chip, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { peekRoom } from '../VeyCardPeek';
export function PackCard({ pack, best, saving, costs, busy, chosen, disabled, readOnly, selectionMode = 'button', selected, compact, onPress, children }: {
    children?: ReactNode; pack: DisplayPackage; best?: boolean; saving?: number | null; costs?: ReturnType<typeof typicalCosts> | null;
    selectionMode?: 'button' | 'radio'; selected?: boolean; compact?: boolean;
    busy?: boolean; chosen?: boolean; disabled?: boolean; readOnly?: boolean; onPress?: () => void;
}) {
    const s = useThemedStyles(sheets);
    const credits = plural('credits.pack', pack.credits ?? 0);
    const videos = costs?.video ? Math.floor((pack.credits ?? 0) / costs.video).toLocaleString(formatLocale()) : null;
    const images = costs?.image ? Math.floor((pack.credits ?? 0) / costs.image).toLocaleString(formatLocale()) : null;
    const example = videos && images ? t('creditsPage.examples', { videos, images }) : videos ? t('creditsPage.videos', { videos }) : images ? t('creditsPage.images', { images }) : null;
    const save = saving != null && saving >= 1 ? t('creditsPage.save', { pct: saving }) : null;
    const isSelected = !!(chosen || selected);
    return <Card onPress={readOnly ? undefined : () => { if (!disabled) onPress?.(); }} disabled={disabled} accessibilityRole={readOnly ? undefined : selectionMode}
        selected={isSelected} accessibilityState={{ disabled: !!disabled, busy: !!busy, ...(selectionMode === 'radio' ? { selected: isSelected } : {}) }}
        accessibilityLabel={rawText([credits, pack.priceString, best && t('creditsPage.best'), save].filter(Boolean).join(', '))} style={[s.card, compact && s.compact, isSelected && s.selected, isSelected && s.peek]}>
        {children}
        <View style={s.row}><Text variant="caption" tone="tertiary">{t('creditsPage.pack')}</Text><View style={s.badges}>
            {best ? <Chip label={t('creditsPage.best')} /> : null}
            {isSelected ? <View testID="pack-selected-indicator" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.selectedMark}>
                <Icon name="check" size={16} tint={s.selectedInk.color} />
            </View> : null}
        </View></View>
        <View style={s.band}><Icon name="coins" tint={s.value.color} /><Text variant="title2" tone="primary" style={s.value}>{credits}</Text></View>
        <View style={s.row}>{busy ? <ActivityIndicator color={s.money.color} /> : <Text variant="title3" tone="primary">{pack.priceString}</Text>}{save ? <Text variant="footnote" tone="secondary">{save}</Text> : null}</View>
        <View style={s.divider}>{[compact ? null : t('credits.packs.neverExpire'), example].filter(Boolean).map(line => <View key={line} style={s.check}><Icon name="check" size={16} /><Text variant="footnote" tone="secondary" style={s.copy}>{line}</Text></View>)}</View>
    </Card>;
}
export function PackTaxNote() { return <Text variant="caption" tone="tertiary">{t('creditsPage.tax')}</Text>; }
const sheets = themedStyles(p => ({
    compact: { padding: ds.space.sm, gap: ds.space.xs },
    card: { gap: ds.space.md }, selected: { backgroundColor: p.bgElevated2 }, peek: { marginTop: peekRoom() }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm, flexWrap: 'wrap' },
    badges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: ds.space.xs, flexWrap: 'wrap' },
    selectedMark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent }, selectedInk: { color: p.onAccent },
    band: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated2 },
    value: { color: p.textPrimary }, money: { color: p.textPrimary }, copy: { flex: 1 }, check: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.borderSubtle, paddingTop: ds.space.md, gap: ds.space.sm },
}));
