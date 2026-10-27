import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { subscribeCacheUser } from '../../../lib/appCache';
import { formatLocale, t } from '../../../lib/i18n';
import { brandStore } from '../../../lib/publishBrand';
import { networkLabel } from '../../../lib/publishCompose';
import { inboxScope } from '../../../lib/publishInbox';
import { fetchInboxAnalytics, inboxAnalyticsErrorKey, type parseInboxAnalytics } from '../../../lib/publishInboxAnalytics';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function InboxAnalytics() {
    const api = usePublishApi();
    const [days, setDays] = useState<7 | 30 | 90>(30);
    const [data, setData] = useState<ReturnType<typeof parseInboxAnalytics> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [scope, setScope] = useState(0);
    useEffect(() => {
        const reset = () => { setData(null); setError(null); setScope(v => v + 1); };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { userOff(); brandOff(); };
    }, []);
    useEffect(() => {
        let active = true;
        const token = inboxScope();
        setData(null); setError(null);
        fetchInboxAnalytics(api, days).then(next => { if (active && token === inboxScope()) setData(next); })
            .catch(err => { if (active && token === inboxScope()) setError(t(inboxAnalyticsErrorKey(err))); });
        return () => { active = false; };
    }, [api, days, scope]);
    const number = new Intl.NumberFormat(formatLocale());
    const median = data?.summary.median_response_seconds;
    const duration = median == null ? '—' : t(median < 60 ? 'publishDepth.analytics.seconds' : 'publishDepth.analytics.minutes', { count: number.format(Math.round(median < 60 ? median : median / 60)) });
    return <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        <Stack.Screen options={{ title: t('publishDepth.analytics.title') }} />
        <View style={styles.chips}>{([7, 30, 90] as const).map(value => <Pressable key={value} style={[touchTarget, styles.card]} accessibilityRole="button" accessibilityState={{ selected: days === value }} onPress={() => setDays(value)}><Text style={days === value ? styles.action : styles.text}>{t('analytics.range', { days: value })}</Text></Pressable>)}</View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : !data ? <ActivityIndicator accessibilityState={{ busy: true }} /> : <>
            <View style={styles.chips}>{(['conversations', 'received', 'sent', 'failed', 'read_actions', 'median'] as const).map(key => <View style={styles.card} key={key}>
                <Text style={styles.muted}>{t(`publishDepth.analytics.${key}`)}</Text><Text style={styles.text}>{key === 'median' ? duration : number.format(data.summary[key])}</Text>
            </View>)}</View>
            <Text accessibilityRole="header" style={styles.text}>{t('publishDepth.analytics.platforms')}</Text>
            {data.platforms.map((row, index) => <View style={styles.card} key={`${row.network}-${index}`}>
                <Text style={styles.text}>{networkLabel(row.network)}</Text>
                {(['received', 'sent', 'failed'] as const).map(key => <Text key={key} style={styles.muted}>{t(`publishDepth.analytics.${key}`)}: {number.format(row[key])}</Text>)}
            </View>)}
        </>}
    </ScrollView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background }, body: { padding: 16, gap: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, card: { padding: 12, gap: 6, backgroundColor: colors.surface, borderRadius: 10 }, text: { color: colors.text }, muted: { color: colors.muted }, action: { color: colors.accent }, error: { color: colors.danger } });
