import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { touchTarget } from '../../lib/a11y';
import {
    creditsDelta,
    entryDate,
    fetchHistoryPage,
    fetchUsage,
    freeNote,
    kindLabel,
    mergePages,
    usageLines,
    type HistoryCursor,
    type LedgerEntry,
    type Usage,
} from '../../lib/creditHistory';
import { colors, ds } from '../../theme';
import { SlowLoader } from '../../components/SlowLoader';

export default function History() {
    const { api } = useAuth();
    const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
    const [next, setNext] = useState<HistoryCursor | null>(null);
    const [usage, setUsage] = useState<Usage | null>(null);
    const [failed, setFailed] = useState(false);
    const [moreFailed, setMoreFailed] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const busy = useRef(false);
    const [attempt, setAttempt] = useState(0);
    const latest = useRef(0);

    const load = useCallback(async () => {
        const mine = ++latest.current;
        setFailed(false);
        try {
            const page = await fetchHistoryPage(api);
            if (mine !== latest.current) return;
            setEntries([...page.entries]);
            setNext(page.next);
        } catch {
            if (mine === latest.current) setFailed(true);
        }
        // The summary is a bonus: a failure there leaves the list alone.
        fetchUsage(api).then(setUsage).catch(() => setUsage(null));
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);

    async function more() {
        if (!next || busy.current || !entries) return;
        busy.current = true;
        setLoadingMore(true);
        setMoreFailed(false);
        try {
            const page = await fetchHistoryPage(api, next);
            setEntries((shown) => mergePages(shown ?? [], page.entries));
            setNext(page.next);
        } catch {
            setMoreFailed(true);
        } finally {
            busy.current = false;
            setLoadingMore(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('history.credithistory') }} />
            {failed && entries === null ? (
                <View style={styles.pad}>
                    <Text style={styles.error}>{t('history.couldnotloadyourcredithistoryCheck')}</Text>
                    <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void load()}>
                        <Text style={styles.retryText}>{t('history.tryagain')}</Text>
                    </Pressable>
                </View>
            ) : entries === null ? (
                <SlowLoader key={attempt} onRetry={() => { setAttempt((n) => n + 1); void load(); }} />
            ) : (
                <FlatList
                    data={entries}
                    keyExtractor={(e) => e.id}
                    contentContainerStyle={styles.list}
                    onEndReached={() => void more()}
                    onEndReachedThreshold={0.5}
                    ListHeaderComponent={
                        usage ? (
                            <View style={styles.summary} accessibilityLabel={rawText(t('history.creditsspent', { value1: usageLines(usage).join('. ') }))}>
                                <Text style={styles.label}>{t('history.creditsspentoncreations')}</Text>
                                {usageLines(usage).map((line) => (
                                    <Text key={line} style={styles.summaryLine}>
                                        {line}
                                    </Text>
                                ))}
                            </View>
                        ) : undefined
                    }
                    ListEmptyComponent={<Text style={styles.muted}>{t('history.nothinghereyetCreditsyougetspend')}</Text>}
                    renderItem={({ item }) => <Entry entry={item} />}
                    ListFooterComponent={
                        loadingMore ? (
                            <ActivityIndicator color={colors.accent} />
                        ) : moreFailed ? (
                            <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void more()}>
                                <Text style={styles.retryText}>{t('history.couldnotloadmoreTryagain')}</Text>
                            </Pressable>
                        ) : undefined
                    }
                />
            )}
        </View>
    );
}

function Entry({ entry }: { entry: LedgerEntry }) {
    const note = freeNote(entry);
    const amount = creditsDelta(entry.delta);
    const label = kindLabel(entry.kind);
    const date = entryDate(entry.createdAt);
    return (
        <View style={styles.row} accessible accessibilityLabel={rawText(`${label}, ${amount}, ${date}${note ? `, ${note}` : ''}`)}>
            {/* A statement line, as on the web: label, dotted leader, amount. The leader is decoration only. */}
            <View style={styles.line}>
                <Text style={styles.name}>{label}</Text>
                <View style={styles.leader} accessibilityElementsHidden importantForAccessibility="no" />
                <Text style={styles.amount}>{amount}</Text>
            </View>
            <Text style={styles.muted}>{date}</Text>
            {note ? <Text style={styles.muted}>{note}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    pad: { padding: 16, gap: 12 },
    list: { padding: 16, gap: 10 },
    summary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 4, marginBottom: 6 },
    label: { color: colors.muted, fontSize: 13, textTransform: 'uppercase' },
    summaryLine: { color: colors.text, fontSize: 15 },
    row: { gap: ds.space.xxs, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    line: { flexDirection: 'row', alignItems: 'flex-end', gap: ds.space.sm },
    leader: { flex: 1, minWidth: ds.space.lg, marginBottom: ds.space.xs, borderBottomWidth: 1, borderStyle: 'dotted', borderBottomColor: colors.muted },
    name: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    amount: { color: colors.money, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
    error: { color: colors.danger },
    retry: { ...touchTarget, alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16 },
    retryText: { color: colors.text, fontWeight: '600' },
});
