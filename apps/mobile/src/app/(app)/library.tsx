import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { StaleNote } from '../../components/StaleNote';
import { appCache, getCacheUser } from '../../lib/appCache';
import { POLICIES, type CacheMeta } from '../../lib/cache';
import { observe } from '../../lib/network';
import { mediaApi, type Job, type JobPage } from '../../lib/media';
import { colors } from '../../theme';
import { touchTarget } from '../../lib/a11y';

const BADGE: Record<Job['state'], string> = { queued: 'Queued', running: 'Creating', succeeded: 'Ready', failed: 'Refunded' };

export default function Library() {
    const { api } = useAuth();
    const router = useRouter();
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [next, setNext] = useState<JobPage['next']>(null);
    const [failed, setFailed] = useState(false);
    const [saved, setSaved] = useState<CacheMeta | null>(null);
    const loadingMore = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            // First page only is saved (labels are personal data: per user, wiped on sign-out). Older pages load live.
            const out = await appCache.swr({
                policy: POLICIES.library,
                userId: getCacheUser(),
                fetcher: () => observe(mediaApi(api).listJobs()),
                onData: (page) => {
                    setJobs(page.jobs);
                    setNext(page.next);
                },
            });
            setSaved(out.meta);
        } catch {
            setFailed(true);
        }
    }, [api]);

    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    async function more() {
        if (!next || loadingMore.current) return;
        loadingMore.current = true;
        try {
            const page = await observe(mediaApi(api).listJobs(next));
            setJobs((j) => [...(j ?? []), ...page.jobs]);
            setNext(page.next);
        } catch {
            // The next scroll retries.
        } finally {
            loadingMore.current = false;
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Library', headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Video files: film masters and editor renders" style={touchTarget} onPress={() => router.push('/library/files')}><Text style={{ color: colors.accent, fontSize: 16 }}>Video files</Text></Pressable> }} />
            {failed ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={load}>
                    <Text style={styles.error}>Could not load your library. Tap to retry.</Text>
                </Pressable>
            ) : jobs === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={jobs}
                    ListHeaderComponent={<StaleNote meta={saved} />}
                    keyExtractor={(j) => j.job_id}
                    onEndReached={more}
                    onRefresh={load}
                    refreshing={false}
                    ListEmptyComponent={<Text style={styles.muted}>Nothing here yet. Create something.</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" accessibilityLabel={`${item.label || item.model_id}, ${BADGE[item.state]}, ${new Date(item.created_at).toLocaleString()}`} style={styles.row} onPress={() => router.push({ pathname: '/job/[id]', params: { id: item.job_id } })}>
                            <View style={styles.rowText}>
                                <Text style={styles.name} numberOfLines={1}>{item.label || item.model_id}</Text>
                                <Text style={styles.muted}>{new Date(item.created_at).toLocaleString()}</Text>
                            </View>
                            <Text style={[styles.badge, item.state === 'failed' && styles.badgeFailed]}>{BADGE[item.state]}</Text>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
    row: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowText: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted },
    badge: { color: colors.accent, fontWeight: '600' },
    badgeFailed: { color: colors.muted },
    error: { color: colors.danger },
});
