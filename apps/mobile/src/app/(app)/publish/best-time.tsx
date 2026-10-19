import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { plural, t } from '../../../lib/i18n';
import { accountStatusLabel, fetchAccounts, type PublishAccount } from '../../../lib/publish';
import { fetchInsights, insightsErrorKey, MIN_HISTORY_DAYS, MIN_MEASURED_POSTS, MIN_SLOT_POSTS, summarizeInsights, type Insights } from '../../../lib/publishInsights';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;
const num = (n: number) => (Math.round(n * 10) / 10).toString();

export default function BestTime() {
    const api = usePublishApi();
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [insights, setInsights] = useState<Insights | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setAccounts(null);
        setAccountId(null);
        fetchAccounts(api)
            .then(({ accounts: list }) => {
                if (cancelled) return;
                const active = list.filter((a) => a.status === 'active');
                setAccounts(active);
                setAccountId(active[0]?.id ?? null);
            })
            .catch(() => !cancelled && setError(t('common.error')));
        return () => {
            cancelled = true;
        };
    }, [api]);

    useEffect(() => {
        if (!accountId) return;
        let cancelled = false;
        setInsights(undefined);
        setError(null);
        fetchInsights(api, accountId)
            .then((i) => !cancelled && setInsights(i))
            .catch((err) => !cancelled && setError(t(insightsErrorKey(err))));
        return () => {
            cancelled = true;
        };
    }, [api, accountId]);

    const summary = insights ? summarizeInsights(insights) : null;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('insights.title') }} />
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            {!accounts && !error ? <ActivityIndicator color={colors.accent} /> : null}
            {accounts && accounts.length === 0 ? <Text style={styles.muted}>{t('insights.noAccounts')}</Text> : null}
            {accounts && accounts.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    {accounts.map((a) => (
                        <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`${a.displayName}, ${a.network}, ${accountStatusLabel(a.status)}`} accessibilityState={{ selected: a.id === accountId }} style={[styles.chip, a.id === accountId && styles.chipOn, touchTarget]} onPress={() => setAccountId(a.id)}>
                            <Text style={[styles.chipText, a.id === accountId && styles.chipTextOn]}>{a.displayName}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
            ) : null}
            {accountId && insights === undefined && !error ? <ActivityIndicator color={colors.accent} /> : null}
            {insights === null ? <Text style={styles.muted}>{t('insights.notYet')}</Text> : null}
            {insights && summary ? (
                <>
                    <Text style={styles.heading} accessibilityRole="header">{t('insights.bestTime')}</Text>
                    <Text style={styles.muted}>{t('insights.basis', { tz: insights.timezone, start: insights.periodStart ?? '', end: insights.periodEnd ?? '' })}</Text>
                    {summary.topSlots.length > 0 ? (
                        summary.topSlots.map((s, i) => (
                            <View key={`${s.day}-${s.hour}`} style={styles.slot} accessible accessibilityLabel={`${i + 1}. ${DAYS[s.day - 1]} ${hour(s.hour)}, ${num(s.score ?? 0)} ${t('insights.perPost')}, ${plural('insights.posts', s.posts)}`}>
                                <Text style={styles.slotTime}>{DAYS[s.day - 1]} {hour(s.hour)}</Text>
                                <Text style={styles.muted}>{num(s.score ?? 0)} {t('insights.perPost')} · {plural('insights.posts', s.posts)}</Text>
                            </View>
                        ))
                    ) : (
                        <Text style={styles.body2}>{t('insights.notEnough', { posts: MIN_MEASURED_POSTS, days: MIN_HISTORY_DAYS })}</Text>
                    )}
                    <Text style={styles.note}>{t('insights.measured', { measured: insights.measuredPosts, recorded: insights.recordedPosts, slot: MIN_SLOT_POSTS })}</Text>
                    {summary.frequency.length > 0 ? (
                        <>
                            <Text style={styles.heading} accessibilityRole="header">{t('insights.frequency')}</Text>
                            <Text style={styles.muted}>{t('insights.frequencyNote')}</Text>
                            {summary.frequency.map((g) => (
                                <View key={g.postsPerWeek} style={styles.freq} accessible accessibilityLabel={`${plural('insights.postsPerWeek', g.postsPerWeek)}, ${plural('insights.weeks', g.weeks)}, ${g.score === null ? t('insights.noScore') : `${num(g.score)} ${t('insights.perPost')}`}`}>
                                    <Text style={styles.freqMain}>{plural('insights.postsPerWeek', g.postsPerWeek)}</Text>
                                    <Text style={styles.freqCell}>{plural('insights.weeks', g.weeks)} · {g.score === null ? '—' : num(g.score)}</Text>
                                </View>
                            ))}
                        </>
                    ) : null}
                    <Text style={styles.note}>{t('insights.disclaimer')}</Text>
                </>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 10 },
    chips: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
    chip: { paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, justifyContent: 'center' },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
    slot: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    slotTime: { color: colors.text, fontSize: 17, fontWeight: '600' },
    freq: { paddingVertical: 8, gap: 2, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    freqMain: { color: colors.text, fontSize: 15, fontWeight: '600' },
    freqCell: { color: colors.body, fontSize: 14 },
    body2: { color: colors.body },
    muted: { color: colors.muted, fontSize: 13 },
    note: { color: colors.muted, fontSize: 12, marginTop: 4 },
    error: { color: colors.danger },
});
