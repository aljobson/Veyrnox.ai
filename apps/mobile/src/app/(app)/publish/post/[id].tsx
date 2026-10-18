import * as WebBrowser from 'expo-web-browser';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { boundedError, fetchPost, fetchPosts, findPost, postStatusLabel, publishErrorMessage, targetStatusLabel, type PublishPost } from '../../../../lib/publish';
import { WhenPicker, whenFrom } from '../../../../components/WhenPicker';
import { cancelPost, composeErrorMessage, reschedulePost, restorePost } from '../../../../lib/publishCompose';
import { colors } from '../../../../theme';

// Reads the single-post route, and falls back to the newest page of the list on a server that lacks it (ADR-0121, ADR-0122).
export default function PostDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const [state, setState] = useState<{ post: PublishPost | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    const load = useCallback(() => {
        // The single-post row carries the version cancel and restore need. A server without that route falls back
        // to the newest page of the list, which does not, so those buttons stay hidden.
        fetchPost(api, String(id))
            .then((post) => (post ? setState({ post }) : Promise.reject(new Error('unreadable'))))
            .catch(() =>
                fetchPosts(api)
                    .then((posts) => setState({ post: findPost(posts, String(id)) }))
                    .catch((err) => setError(publishErrorMessage(err))),
            );
    }, [api, id]);

    useEffect(() => {
        load();
    }, [load]);

    // Runs one change, then reloads the post so the screen shows what the server now holds.
    async function change(run: () => Promise<unknown>) {
        setBusy(true);
        setProblem(null);
        try {
            await run();
            setEditing(false);
            load();
        } catch (err) {
            setProblem(composeErrorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    function chosenTime(): Date | null {
        const d = whenFrom(date, time);
        if (!d || d.getTime() <= Date.now() + 60_000) {
            setProblem('Choose a time in the future (at least a minute away), as YYYY-MM-DD and HH:MM.');
            return null;
        }
        return d;
    }

    if (error) return <View style={styles.screen}><Text style={styles.error}>{error}</Text></View>;
    if (!state) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;
    const post = state.post;
    if (!post) return <View style={styles.screen}><Stack.Screen options={{ title: 'Post' }} /><Text style={styles.muted}>This post is not in your most recent posts, so its details cannot be shown here yet.</Text></View>;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: postStatusLabel(post.status) }} />
            {post.scheduledAt ? <Text style={styles.muted}>{post.status === 'canceled' ? 'Was scheduled for' : 'Scheduled for'} {new Date(post.scheduledAt).toLocaleString()}</Text> : null}
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
            {post.status === 'scheduled' || post.status === 'canceled' ? (
                <View style={styles.actions}>
                    {editing ? (
                        <>
                            <WhenPicker date={date} time={time} onChange={(d, t) => { setDate(d); setTime(t); }} />
                            <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.off]} onPress={() => {
                                const d = chosenTime();
                                if (!d) return;
                                if (post.status === 'scheduled') void change(() => reschedulePost(api, post.id, post.scheduledAt ?? '', d));
                                else if (post.updatedAt) void change(() => restorePost(api, post.id, post.updatedAt as string, d));
                            }}>
                                {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{post.status === 'scheduled' ? 'Save new time' : 'Schedule again'}</Text>}
                            </Pressable>
                            <Pressable accessibilityRole="button" onPress={() => setEditing(false)}><Text style={styles.link}>Cancel</Text></Pressable>
                        </>
                    ) : (
                        <>
                            {post.status === 'scheduled' ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setEditing(true)}><Text style={styles.secondaryText}>Change the time</Text></Pressable> : null}
                            {post.status === 'canceled' && post.updatedAt ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setEditing(true)}><Text style={styles.secondaryText}>Schedule it again</Text></Pressable> : null}
                            {post.status === 'scheduled' && post.updatedAt ? (
                                <Pressable accessibilityRole="button" disabled={busy} onPress={() => Alert.alert('Cancel this post?', 'It will not be published. You can schedule it again later.', [
                                    { text: 'Keep it', style: 'cancel' },
                                    { text: 'Cancel post', style: 'destructive', onPress: () => void change(() => cancelPost(api, post.id, post.updatedAt as string)) },
                                ])}><Text style={styles.danger}>Cancel this post</Text></Pressable>
                            ) : null}
                            {!post.updatedAt ? <Text style={styles.muted2}>Cancelling and scheduling again are not available in the app yet.</Text> : null}
                        </>
                    )}
                    {problem ? <Text style={styles.error2}>{problem}</Text> : null}
                </View>
            ) : null}
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
    actions: { gap: 12, marginTop: 8 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    secondary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    secondaryText: { color: colors.text, fontSize: 16 },
    danger: { color: colors.danger, textAlign: 'center', fontSize: 16, paddingVertical: 8 },
    muted2: { color: colors.muted, fontSize: 13 },
    error2: { color: colors.danger },
});
