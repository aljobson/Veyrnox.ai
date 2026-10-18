import * as WebBrowser from 'expo-web-browser';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { boundedError, fetchPosts, findPost, postStatusLabel, publishErrorMessage, targetStatusLabel, type PublishPost } from '../../../../lib/publish';
import { colors } from '../../../../theme';

// There is no GET for a single post yet (ADR-0121), so the post is found in the newest page of the list.
export default function PostDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const [state, setState] = useState<{ post: PublishPost | null } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchPosts(api)
            .then((posts) => setState({ post: findPost(posts, String(id)) }))
            .catch((err) => setError(publishErrorMessage(err)));
    }, [api, id]);

    if (error) return <View style={styles.screen}><Text style={styles.error}>{error}</Text></View>;
    if (!state) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;
    const post = state.post;
    if (!post) return <View style={styles.screen}><Stack.Screen options={{ title: 'Post' }} /><Text style={styles.muted}>This post is not in your most recent posts, so its details cannot be shown here yet.</Text></View>;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: postStatusLabel(post.status) }} />
            {post.scheduledAt ? <Text style={styles.muted}>Scheduled for {new Date(post.scheduledAt).toLocaleString()}</Text> : null}
            <Text style={styles.text}>{post.text || 'No text'}</Text>
            {post.targets.map((t) => {
                const err = boundedError(t.lastError);
                return (
                    <View key={t.id} style={styles.target} accessible accessibilityLabel={`${t.network}, ${targetStatusLabel(t.publishStatus)}`}>
                        <Text style={styles.net}>{t.network}</Text>
                        <Text style={[styles.state, t.publishStatus === 'failed' && styles.bad]}>{targetStatusLabel(t.publishStatus)}</Text>
                        {err ? <Text style={styles.errBox}>{err}</Text> : null}
                        {t.url ? <Pressable accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(t.url as string)}><Text style={styles.link}>Open the live post</Text></Pressable> : null}
                    </View>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 14 },
    text: { color: colors.text, fontSize: 17 },
    muted: { color: colors.muted, padding: 16 },
    target: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
    net: { color: colors.text, fontSize: 16, fontWeight: '600' },
    state: { color: colors.accent },
    bad: { color: colors.danger },
    errBox: { color: colors.body, fontSize: 13, backgroundColor: colors.background, borderRadius: 8, padding: 10, marginTop: 4 },
    link: { color: colors.accent, textDecorationLine: 'underline', paddingTop: 6 },
    error: { color: colors.danger, padding: 16 },
});
