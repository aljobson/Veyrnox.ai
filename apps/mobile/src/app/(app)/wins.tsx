import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { Card, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { VeyLoader } from '../../components/VeyLoader';
import { useYourWins } from '../../lib/useYourWins';
import { t, plural, formatNumber, getLocale } from '../../lib/i18n';
import { ds } from '../../theme';
export default function YourWinsScreen() {
    const { data, loading } = useYourWins(true);
    const [range, setRange] = useState<'week' | 'all'>('week');
    const styles = useThemedStyles(sheets);
    const value = data?.[range];
    const dateText = (date: Date) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: t('wins.title') }} />
        <Text variant="title1" accessibilityRole="header">{t('wins.title')}</Text>
        {loading ? <VeyLoader showLabel /> : !value ? <Text>{t('wins.unavailable')}</Text> : <>
            <View style={styles.switch}>{(['week', 'all'] as const).map(key => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: range === key }} onPress={() => setRange(key)} style={[styles.choice, range === key && styles.selected]}><Text>{t(`wins.${key}`)}</Text></Pressable>)}</View>
            <Card style={styles.panel}>
                <Text accessibilityRole="header">{t('wins.creations')}</Text>
                <Text style={[styles.number, styles.total]}>{formatNumber(value.creations.total)}</Text>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bar}>{Object.entries(value.creations.by_type).map(([kind, n]) => n > 0 && <View key={kind} style={[styles[kind as 'image' | 'video' | 'audio' | 'other'], { flex: n }]} />)}</View>
                <View style={styles.legend}>{Object.entries(value.creations.by_type).map(([kind, n]) => (kind !== 'other' || n > 0) && <View style={styles.legendItem} key={kind}><View style={[styles.dot, styles[kind as 'image' | 'video' | 'audio' | 'other']]} /><Text style={styles.number}>{t(`wins.${kind === 'video' ? 'videoType' : kind}`)}: {formatNumber(n)}</Text></View>)}</View>
            </Card>
            <Text variant="title2" accessibilityRole="header">{t('wins.what')}</Text>
            <Row label={t('wins.video')} value={t('wins.duration', { minutes: formatNumber(Math.floor(value.video_seconds / 60)), seconds: formatNumber(value.video_seconds % 60) })} />
            <Row label={t('wins.credits')} value={formatNumber(value.credits_used)} />
            <Row label={t('wins.posts')} value={formatNumber(value.posts)} />
            {value.views && <><Row label={t('wins.views')} value={formatNumber(value.views.total)} /><Text variant="caption">{t('wins.reported', { networks: value.views.networks.join(', ') })}</Text></>}
            {data.streak && <View style={styles.section}>
                <Text variant="title2" accessibilityRole="header">{t('wins.streak')}</Text>
                <Row label={t('wins.current')} value={plural('wins.days', data.streak.current, { count: formatNumber(data.streak.current) })} />
                <Row label={t('wins.best')} value={plural('wins.days', data.streak.best, { count: formatNumber(data.streak.best) })} />
                <View style={styles.days}>{data.streak.last7.map((checked, i) => {
                    const date = new Date(); date.setUTCDate(date.getUTCDate() - 6 + i);
                    return <View key={i} accessible accessibilityRole="image" accessibilityLabel={`${dateText(date)}: ${t(checked ? 'wins.checked' : 'wins.empty')}`} style={[styles.day, checked && styles.checked]} />;
                })}</View>
            </View>}
            <Text variant="title2" accessibilityRole="header">{t('wins.milestones')}</Text>
            <View style={styles.grid}>{data.milestones.map(m => <Card style={styles.milestone} key={m.key}><Text variant="bodyStrong">{t(`wins.${m.key}`)}</Text><Text style={styles.number}>{m.reached_at ? t('wins.reached', { date: dateText(new Date(m.reached_at)) }) : t('wins.locked', { progress: formatNumber(m.progress), target: formatNumber(m.target) })}</Text></Card>)}</View>
            <Text variant="caption">{t('wins.footer')}</Text>
        </>}
    </ScrollView>;
}
function Row({ label, value }: { label: string; value: string }) {
    const styles = useThemedStyles(sheets);
    return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.number}>{value}</Text></View>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, paddingBottom: 48, gap: ds.space.lg },
    switch: { flexDirection: 'row', gap: ds.space.sm },
    choice: { minHeight: 44, paddingHorizontal: ds.space.lg, justifyContent: 'center', borderRadius: ds.radius.pill, borderWidth: 1, borderColor: p.borderSubtle },
    selected: { borderColor: p.accent, backgroundColor: p.accentSubtle },
    panel: { padding: ds.space.lg, gap: ds.space.md },
    total: { fontSize: 56, lineHeight: 64 },
    number: { fontVariant: ['tabular-nums'] },
    bar: { height: 12, flexDirection: 'row', borderRadius: 6, overflow: 'hidden', backgroundColor: p.borderSubtle },
    image: { backgroundColor: p.accent }, video: { backgroundColor: p.iris }, audio: { backgroundColor: p.warning }, other: { backgroundColor: p.textSecondary },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: ds.space.md },
    label: { flex: 1 }, section: { gap: ds.space.md },
    days: { flexDirection: 'row', gap: ds.space.sm },
    day: { flex: 1, maxWidth: 36, height: 32, borderRadius: 6, borderWidth: 1, borderColor: p.borderSubtle },
    checked: { backgroundColor: p.accent },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    milestone: { flexGrow: 1, flexBasis: '45%', padding: ds.space.md, gap: ds.space.sm },
}));
