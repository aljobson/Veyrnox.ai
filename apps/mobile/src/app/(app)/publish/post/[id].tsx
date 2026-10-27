import { formatLocale, t } from '../../../../lib/i18n';
import { Button } from '../../../../components/ui';
import { AddressText } from '../../../../components/AddressText';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { boundedError, fetchPost, fetchPosts, findPost, postStatusLabel, publishErrorMessage, targetStatusLabel, type PublishPost } from '../../../../lib/publish';
import { WhenPicker, whenFrom } from '../../../../components/WhenPicker';
import { cancelPost, composeErrorMessage, reschedulePost, restorePost } from '../../../../lib/publishCompose';
import { colors } from '../../../../theme';
import { usePublishApi } from '../../../../lib/usePublishApi';

// Reads the single-post route, and falls back to the newest page of the list on a server that lacks it (ADR-0121, ADR-0122).
export default function PostDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const api = usePublishApi();
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
            setProblem(t('publish.chooseatimeinthefutureat'));
            return null;
        }
        return d;
    }

    if (error) return <View style={styles.screen}><Text style={styles.error}>{error}</Text></View>;
    if (!state) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;
    const post = state.post;
    if (!post) return <View style={styles.screen}><Stack.Screen options={{ title: t('publish.post') }} /><Text style={styles.muted}>{t('publish.thispostisnotinyourmost')}</Text></View>;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: postStatusLabel(post.status) }} />
            {post.scheduledAt ? <Text style={styles.muted}>{post.status === 'canceled' ? t('publish.wasscheduledfor') : t('publish.scheduledfor')} {new Date(post.scheduledAt).toLocaleString(formatLocale())}</Text> : null}
            <Text style={styles.text}>{post.text || t('publish.notext')}</Text>
            {post.targets.map((t) => {
                const err = boundedError(t.lastError);
                return (
                    <View key={t.id} style={styles.target} accessible accessibilityLabel={`${t.network}, ${targetStatusLabel(t.publishStatus)}`}>
                        <Text style={styles.net}>{t.network}</Text>
                        <Text style={[styles.state, t.publishStatus === 'failed' && styles.bad]}>{targetStatusLabel(t.publishStatus)}</Text>
                        {err ? <Text style={styles.errBox}>{err}</Text> : null}
                        {t.url ? <AddressText address={t.url} /> : null}
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
                                {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{post.status === 'scheduled' ? t('publish.savenewtime') : t('publish.scheduleagain')}</Text>}
                            </Pressable>
                            <Button variant="tertiary" label={t('publish.cancel2')} onPress={() => setEditing(false)} />
                        </>
                    ) : (
                        <>
                            {post.status === 'scheduled' ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setEditing(true)}><Text style={styles.secondaryText}>{t('publish.changethetime')}</Text></Pressable> : null}
                            {post.status === 'canceled' && post.updatedAt ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setEditing(true)}><Text style={styles.secondaryText}>{t('publish.scheduleitagain')}</Text></Pressable> : null}
                            {post.status === 'scheduled' && post.updatedAt ? (
                                <Button variant="tertiary" tone="danger" label={t('publish.cancelthispost')} disabled={busy} onPress={() => Alert.alert(t('publish.cancelthispost2'), t('publish.itwillnotbepublishedYoucan'), [
                                    { text: t('publish.keepit'), style: 'cancel' },
                                    { text: t('publish.cancelpost'), style: 'destructive', onPress: () => void change(() => cancelPost(api, post.id, post.updatedAt as string)) },
                                ])} />
                            ) : null}
                            {!post.updatedAt ? <Text style={styles.muted2}>{t('publish.cancellingandschedulingagainarenotavailable')}</Text> : null}
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
