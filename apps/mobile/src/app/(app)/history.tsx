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
import { colors } from '../../theme';

export default function History() {
    const { api } = useAuth();
    const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
    const [next, setNext] = useState<HistoryCursor | null>(null);
    const [usage, setUsage] = useState<Usage | null>(null);
    const [failed, setFailed] = useState(false);
    const [moreFailed, setMoreFailed] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const busy = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const page = await fetchHistoryPage(api);
            setEntries([...page.entries]);
            setNext(page.next);
        } catch {
            setFailed(true);
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
            <Stack.Screen options={{ title: 'Credit history' }} />
            {failed && entries === null ? (
                <View style={styles.pad}>
                    <Text style={styles.error}>Could not load your credit history. Check your connection.</Text>
                    <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void load()}>
                        <Text style={styles.retryText}>Try again</Text>
                    </Pressable>
                </View>
            ) : entries === null ? (
                <ActivityIndicator color={colors.accent} style={styles.pad} />
            ) : (
                <FlatList
                    data={entries}
                    keyExtractor={(e) => e.id}
                    contentContainerStyle={styles.list}
                    onEndReached={() => void more()}
                    onEndReachedThreshold={0.5}
                    ListHeaderComponent={
                        usage ? (
                            <View style={styles.summary} accessibilityLabel={`Credits spent. ${usageLines(usage).join('. ')}`}>
                                <Text style={styles.label}>Credits spent on creations</Text>
                                {usageLines(usage).map((line) => (
                                    <Text key={line} style={styles.summaryLine}>
                                        {line}
                                    </Text>
                                ))}
                            </View>
                        ) : undefined
                    }
                    ListEmptyComponent={<Text style={styles.muted}>Nothing here yet. Credits you get, spend and are refunded will appear here.</Text>}
                    renderItem={({ item }) => <Entry entry={item} />}
                    ListFooterComponent={
                        loadingMore ? (
                            <ActivityIndicator color={colors.accent} />
                        ) : moreFailed ? (
                            <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void more()}>
                                <Text style={styles.retryText}>Could not load more. Try again</Text>
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
        <View style={styles.row} accessible accessibilityLabel={`${label}, ${amount}, ${date}${note ? `, ${note}` : ''}`}>
            <View style={styles.rowText}>
                <Text style={styles.name}>{label}</Text>
                <Text style={styles.muted}>{date}</Text>
                {note ? <Text style={styles.muted}>{note}</Text> : null}
            </View>
            <Text style={[styles.amount, entry.delta < 0 ? styles.out : styles.in]}>{amount}</Text>
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
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    rowText: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    amount: { fontSize: 16, fontWeight: '700' },
    in: { color: colors.accent },
    out: { color: colors.text },
    error: { color: colors.danger },
    retry: { ...touchTarget, alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16 },
    retryText: { color: colors.text, fontWeight: '600' },
});
