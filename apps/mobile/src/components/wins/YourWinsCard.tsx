import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, ListRow, Text, themedStyles, useThemedStyles } from '../ui';
import { VeyCardPeek, peekRoom } from '../VeyCardPeek';
import { useYourWins } from '../../lib/useYourWins';
import { nextMilestone } from '../../lib/yourWins';
import { t, formatNumber, plural } from '../../lib/i18n';
import { ds } from '../../theme';
export function YourWinsCard({ linkOnly = false }: { linkOnly?: boolean }) {
    const { data } = useYourWins(!linkOnly);
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    if (!data) return null;
    const open = () => router.push('/wins' as never);
    if (linkOnly) return <ListRow title={t('wins.title')} onPress={open} accessibilityRole="button" />;
    const next = nextMilestone(data);
    const stats = [[data.all.creations.total, 'creations'], [data.all.posts, 'posts'], ...(data.streak ? [[data.streak.current, 'streak']] : [])] as [number, string][];
    const nextLabel = next ? t('wins.next', { milestone: t(`wins.${next.key}`), progress: formatNumber(next.progress), target: formatNumber(next.target) }) : '';
    const label = [t('wins.title'), ...stats.map(([value, key]) => `${t(`wins.${key}`)}: ${key === 'streak' ? plural('wins.days', value) : formatNumber(value)}`), nextLabel].filter(Boolean).join('. ');
    return <Card onPress={open} style={styles.card} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('wins.see')}>
        <VeyCardPeek />
        <Text variant="title2" accessibilityRole="header">{t('wins.title')}</Text>
        <View style={styles.stats}>{stats.map(([value, key]) => <View key={key} style={styles.stat}><Text variant="title1" style={styles.number}>{formatNumber(value)}</Text><Text variant="caption">{t(`wins.${key}`)}</Text></View>)}</View>
        {next && <><Text>{t('wins.next', { milestone: t(`wins.${next.key}`), progress: formatNumber(next.progress), target: formatNumber(next.target) })}</Text><View accessible accessibilityRole="progressbar" accessibilityLabel={t(`wins.${next.key}`)} accessibilityValue={{ min: 0, max: next.target, now: next.progress }} style={styles.track}><View style={[styles.fill, { width: `${next.progress / next.target * 100}%` }]} /></View></>}
    </Card>;
}
const sheets = themedStyles(p => ({
    card: { marginTop: peekRoom() + ds.space.lg, marginBottom: ds.space.lg, padding: ds.space.lg, overflow: 'visible', minHeight: 44 },
    stats: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.lg, marginVertical: ds.space.lg },
    stat: { flexGrow: 1, flexBasis: 80 },
    number: { fontVariant: ['tabular-nums'] },
    track: { height: 6, borderRadius: 3, backgroundColor: p.borderSubtle, marginTop: ds.space.sm, overflow: 'hidden' },
    fill: { height: 6, backgroundColor: p.accent },
}));
