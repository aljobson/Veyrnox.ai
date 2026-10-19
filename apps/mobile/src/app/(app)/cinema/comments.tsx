import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { blockMember, blocksErrorKey } from '../../../lib/cinemaBlocks';
import { BODY_MAX, bodyOk, commentsErrorKey, fetchComments, parseComments, submitComment, type Comment, type OwnComment } from '../../../lib/cinemaComments';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

const STATUS: Record<string, string> = { pending: 'comments.status.pending', approved: 'comments.status.approved', rejected: 'comments.status.rejected', removed: 'comments.status.removed', withdrawn: 'comments.status.withdrawn' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

export default function Comments() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [comments, setComments] = useState<Comment[]>([]);
    const [own, setOwn] = useState<OwnComment[]>([]);
    const [next, setNext] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
    const [draft, setDraft] = useState('');
    const [posting, setPosting] = useState(false);
    const [more, setMore] = useState(false);
    // One key per draft text: a retry after a network error is one comment, not two.
    const keyRef = useRef<{ text: string; key: string } | null>(null);

    const load = useCallback(async () => {
        if (!id) return;
        try {
            const page = await fetchComments(api, id);
            setComments(page.comments);
            setOwn(page.own);
            setNext(page.next);
            setError(null);
        } catch (err) {
            setError(t(commentsErrorKey(err)));
        } finally {
            setLoaded(true);
        }
    }, [api, id]);

    useEffect(() => {
        load();
    }, [load]);

    async function loadMore() {
        if (!id || !next || more) return;
        setMore(true);
        try {
            const page = await fetchComments(api, id, next);
            setComments((c) => [...c, ...page.comments.filter((x) => !c.some((y) => y.id === x.id))]);
            setNext(page.next);
        } catch (err) {
            setNote({ text: t(commentsErrorKey(err)), bad: true });
        } finally {
            setMore(false);
        }
    }

    async function post() {
        if (!id || posting || !bodyOk(draft)) return;
        const text = draft.trim();
        const key = keyRef.current?.text === text ? keyRef.current.key : Crypto.randomUUID();
        keyRef.current = { text, key };
        setPosting(true);
        setNote(null);
        try {
            await submitComment(api, id, text, key);
            keyRef.current = null;
            setDraft('');
            setNote({ text: t('comments.posted'), bad: false });
            void load();
        } catch (err) {
            setNote({ text: t(commentsErrorKey(err)), bad: true });
        } finally {
            setPosting(false);
        }
    }

    function block(c: Comment) {
        if (!c.username) return;
        const username = c.username;
        Alert.alert(t('blocks.blockTitle', { name: c.displayName }), t('blocks.blockBody'), [
            { text: t('blocks.cancel'), style: 'cancel' },
            {
                text: t('blocks.block'),
                style: 'destructive',
                onPress: async () => {
                    try {
                        await blockMember(api, username);
                        // The server now leaves this member out; drop what is already on screen.
                        setComments((list) => list.filter((x) => x.username !== username));
                        setNote({ text: t('comments.blocked', { name: c.displayName }), bad: false });
                    } catch (err) {
                        setNote({ text: t(blocksErrorKey(err)), bad: true });
                    }
                },
            },
        ]);
    }

    const left = BODY_MAX - [...draft].length;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ title: t('comments.title') }} />
            {error && !loaded ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !loaded ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={comments}
                    keyExtractor={(c) => c.id}
                    keyboardShouldPersistTaps="handled"
                    ListHeaderComponent={
                        <View style={styles.compose}>
                            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                            <TextInput
                                accessibilityLabel={t('comments.write')}
                                placeholder={t('comments.write')}
                                placeholderTextColor={colors.muted}
                                style={styles.input}
                                multiline
                                maxLength={BODY_MAX}
                                value={draft}
                                onChangeText={setDraft}
                            />
                            <View style={styles.composeRow}>
                                <Text style={styles.muted}>{t('comments.review')}</Text>
                                <Text style={[styles.muted, left < 100 && styles.warn]}>{left}</Text>
                            </View>
                            <Pressable accessibilityRole="button" accessibilityState={{ busy: posting, disabled: posting || !bodyOk(draft) }} disabled={posting || !bodyOk(draft)} style={[styles.button, (posting || !bodyOk(draft)) && styles.off]} onPress={post}>
                                {posting ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('comments.post')}</Text>}
                            </Pressable>
                            {note ? <Text style={[styles.note, note.bad && styles.warn]} accessibilityRole={note.bad ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</Text> : null}
                            {own.length > 0 ? (
                                <View style={styles.ownBox}>
                                    <Text style={styles.heading} accessibilityRole="header">{t('comments.yours')}</Text>
                                    {own.map((o) => (
                                        <View key={o.id} style={styles.own}>
                                            <Text style={styles.body}>{o.body}</Text>
                                            <Text style={styles.muted}>{t(STATUS[o.status] ?? 'comments.status.pending')}{o.createdAt ? ` · ${when(o.createdAt)}` : ''}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                            <Text style={styles.heading} accessibilityRole="header">{t('comments.all')}</Text>
                        </View>
                    }
                    ListEmptyComponent={<Text style={styles.muted}>{t('comments.none')}</Text>}
                    ListFooterComponent={<View>{next ? <Pressable accessibilityRole="button" style={[touchTarget, styles.moreBtn]} disabled={more} onPress={loadMore}>{more ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.link}>{t('comments.more')}</Text>}</Pressable> : null}</View>}
                    renderItem={({ item }) => (
                        <View style={styles.card}>
                            <Text style={styles.author}>{item.displayName}{item.createdAt ? ` · ${when(item.createdAt)}` : ''}</Text>
                            <Text style={styles.body}>{item.body}</Text>
                            {!item.own ? (
                                <View style={styles.actions}>
                                    <Pressable accessibilityRole="button" accessibilityLabel={t('comments.reportBy', { name: item.displayName })} style={[touchTarget, styles.act]} onPress={() => router.push({ pathname: '/cinema/report-comment', params: { commentId: item.id } })}>
                                        <Text style={styles.link}>{t('comments.report')}</Text>
                                    </Pressable>
                                    {item.username ? (
                                        <Pressable accessibilityRole="button" accessibilityLabel={t('blocks.blockMember', { name: item.displayName })} style={[touchTarget, styles.act]} onPress={() => block(item)}>
                                            <Text style={styles.link}>{t('blocks.block')}</Text>
                                        </Pressable>
                                    ) : null}
                                </View>
                            ) : null}
                        </View>
                    )}
                />
            )}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    compose: { gap: 8, paddingTop: 12 },
    input: { minHeight: 90, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 16 },
    composeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    note: { color: colors.accent },
    warn: { color: colors.danger },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 10 },
    ownBox: { gap: 8 },
    own: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
    card: { paddingVertical: 12, gap: 4, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    author: { color: colors.muted, fontSize: 13 },
    body: { color: colors.text, fontSize: 15 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    act: { paddingRight: 16, justifyContent: 'center' },
    link: { color: colors.accent, fontSize: 14 },
    moreBtn: { alignItems: 'center', justifyContent: 'center' },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger, paddingTop: 12 },
});
