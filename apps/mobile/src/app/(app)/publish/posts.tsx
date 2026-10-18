import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { fetchPosts, mergePage, postStatusLabel, publishErrorMessage, type PublishPost } from '../../../lib/publish';
import { colors } from '../../../theme';
import { HeaderAction } from '../../../components/HeaderAction';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

export default function Posts() {
    const { api } = useAuth();
    const router = useRouter();
    const [posts, setPosts] = useState<PublishPost[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [more, setMore] = useState(true);
    const loadingMore = useRef(false);

    const load = useCallback(async () => {
        try {
            const first = await fetchPosts(api);
            setPosts(first);
            setMore(first.length > 0);
            setError(null);
        } catch (err) {
            setError(publishErrorMessage(err));
        }
    }, [api]);

    useEffect(() => {
        load();
    }, [load]);

    async function loadMore() {
        const last = posts?.[posts.length - 1];
        if (!last?.createdAt || !more || loadingMore.current) return;
        loadingMore.current = true;
        try {
            const next = await fetchPosts(api, { createdAt: last.createdAt, id: last.id });
            const merged = mergePage(posts ?? [], next);
            setPosts(merged.posts);
            setMore(merged.added);
        } catch {
            setMore(false);
        } finally {
            loadingMore.current = false;
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Posts', headerRight: () => <HeaderAction label="New post" onPress={() => router.push('/publish/compose')} /> }} />
            {error && !posts ? (
                <Text style={styles.error}>{error}</Text>
            ) : !posts ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={posts}
                    keyExtractor={(p) => p.id}
                    onEndReached={loadMore}
                    onEndReachedThreshold={0.4}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListEmptyComponent={<Text style={styles.muted}>No posts yet.</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" accessibilityLabel={`${postStatusLabel(item.status)} post: ${item.text.slice(0, 60)}`} style={styles.row} onPress={() => router.push({ pathname: '/publish/post/[id]', params: { id: item.id } })}>
                            <Text style={[styles.status, (item.status === 'failed') && styles.bad]}>{postStatusLabel(item.status)}{item.scheduledAt ? `  ·  ${when(item.scheduledAt)}` : ''}</Text>
                            <Text style={styles.text} numberOfLines={2}>{item.text || 'No text'}</Text>
                            <Text style={styles.muted}>{item.targets.map((t) => t.network).join(', ') || 'No networks'}</Text>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    row: { paddingVertical: 14, gap: 4, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    status: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    bad: { color: colors.danger },
    text: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger, paddingTop: 16 },
});
