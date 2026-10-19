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
import { HeaderAction } from '../../components/HeaderAction';
import { t } from '../../lib/i18n';
import { touchTarget } from '../../lib/a11y';

// Catalog keys, looked up when shown.
const BADGE: Record<Job['state'], string> = { queued: 'library.queued', running: 'library.running', succeeded: 'library.succeeded', failed: 'library.failed' };

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
            <Stack.Screen options={{ title: t('label.Library'), headerRight: () => <HeaderAction label={t('library.videoFiles')} accessibilityLabel={t('library.videoFilesLabel')} onPress={() => router.push('/library/files')} /> }} />
            {failed ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={load}>
                    <Text style={styles.error}>{t('library.loadError')}</Text>
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
                    ListEmptyComponent={<Text style={styles.muted}>{t('library.empty')}</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" accessibilityLabel={`${item.label || item.model_id}, ${t(BADGE[item.state])}, ${new Date(item.created_at).toLocaleString()}`} style={styles.row} onPress={() => router.push({ pathname: '/job/[id]', params: { id: item.job_id } })}>
                            <View style={styles.rowText}>
                                <Text style={styles.name} numberOfLines={1}>{item.label || item.model_id}</Text>
                                <Text style={styles.muted}>{new Date(item.created_at).toLocaleString()}</Text>
                            </View>
                            <Text style={[styles.badge, item.state === 'failed' && styles.badgeFailed]}>{t(BADGE[item.state])}</Text>
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
