import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { t } from '../../../lib/i18n';
import { assignThread, cleanReply, fetchMembers, fetchThread, inboxErrorKey, parseThreadView, replyToThread, setThreadStatus, type Member } from '../../../lib/publishInbox';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function InboxThread() {
    const api = usePublishApi();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const [view, setView] = useState<ReturnType<typeof parseThreadView> | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [keyboard, setKeyboard] = useState(0);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [members, setMembers] = useState<Member[] | null>(null);
    const [picking, setPicking] = useState(false);
    // One key per reply attempt: a retry after a dropped connection sends the reply once.
    const replyKey = useRef<string | null>(null);

    // The reply box rides above the keyboard (the screen sits under a navigation header, so the built-in avoiding is unreliable).
    useEffect(() => {
        const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
        const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
        return () => { show.remove(); hide.remove(); };
    }, []);

    const load = useCallback(() => fetchThread(api, String(id ?? '')).then(setView), [api, id]);

    useEffect(() => {
        let cancelled = false;
        fetchThread(api, String(id ?? ''))
            .then((v) => !cancelled && setView(v))
            .catch((err) => !cancelled && setError(t(inboxErrorKey(err))));
        return () => {
            cancelled = true;
        };
    }, [api, id]);

    async function act(run: () => Promise<unknown>) {
        if (busy) return;
        setBusy(true);
        setNote(null);
        try {
            await run();
            await load();
        } catch (err) {
            setNote(t(inboxErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    async function send() {
        const body = cleanReply(draft);
        if (!body) return setNote('Write a reply of up to 8000 characters.');
        replyKey.current ??= Crypto.randomUUID();
        await act(async () => {
            await replyToThread(api, String(id), body, replyKey.current as string);
            replyKey.current = null;
            setDraft('');
        });
    }

    async function openAssign() {
        setPicking((on) => !on);
        if (members) return;
        try {
            setMembers(await fetchMembers(api));
        } catch (err) {
            setNote(t(inboxErrorKey(err)));
        }
    }

    if (error) return <View style={styles.pad}><Stack.Screen options={{ title: t('inbox.title') }} /><Text style={styles.error} accessibilityRole="alert">{error}</Text></View>;
    if (!view) return <View style={styles.pad}><ActivityIndicator color={colors.accent} /></View>;
    const th = view.thread;

    const resolved = th?.status === 'resolved';

    return (
        <View style={styles.screen}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: th?.name || t('inbox.title') }} />
            {th ? <Text style={styles.muted}>{th.network} · {th.accountName} · {t(`inbox.kind.${th.kind}`)}{th.priority !== 'normal' ? ` · ${th.priority}` : ''}</Text> : null}
            {th ? (
                <View style={styles.actions}>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={() => act(() => setThreadStatus(api, String(id), resolved ? 'reopen' : 'resolve'))}>
                        <Text style={styles.action}>{resolved ? 'Reopen' : 'Resolve'}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={openAssign}>
                        <Text style={styles.action}>{th.assignedEmail ? `Assigned: ${th.assignedEmail}` : 'Assign'}</Text>
                    </Pressable>
                </View>
            ) : null}
            {picking ? (
                <View style={styles.picker}>
                    {members === null ? <ActivityIndicator color={colors.accent} /> : null}
                    {members?.map((m) => (
                        <Pressable key={m.userId} accessibilityRole="button" disabled={busy} style={[styles.member, touchTarget]} onPress={() => { setPicking(false); void act(() => assignThread(api, String(id), m.userId)); }}>
                            <Text style={styles.text}>{m.email}</Text>
                        </Pressable>
                    ))}
                    {th?.assignedEmail ? (
                        <Pressable accessibilityRole="button" disabled={busy} style={[styles.member, touchTarget]} onPress={() => { setPicking(false); void act(() => assignThread(api, String(id), null)); }}>
                            <Text style={styles.muted}>Unassign</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
            {note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : null}
            {th?.tags.length ? <Text style={styles.tags}>{th.tags.join(', ')}</Text> : null}
            {view.messages.length === 0 ? <Text style={styles.muted}>{t('inbox.noMessages')}</Text> : null}
            {view.messages.map((m) => (
                <View key={m.id} style={[styles.bubble, m.outgoing ? styles.out : styles.in]} accessible accessibilityLabel={`${m.outgoing ? t('inbox.you') : th?.name ?? ''}: ${m.body}`}>
                    <Text style={styles.text}>{m.body || (m.hasMedia ? t('inbox.attachment') : '')}</Text>
                    {m.body && m.hasMedia ? <Text style={styles.muted}>{t('inbox.attachment')}</Text> : null}
                    <Text style={styles.meta}>{m.sentAt ? new Date(m.sentAt).toLocaleString() : ''}{m.deliveryStatus && m.outgoing ? ` · ${m.deliveryStatus}` : ''}</Text>
                </View>
            ))}
            {view.notes.length > 0 ? <Text style={styles.heading} accessibilityRole="header">{t('inbox.notes')}</Text> : null}
            {view.notes.map((n) => (
                <View key={n.id} style={styles.note}>
                    <Text style={styles.text}>{n.body}</Text>
                    <Text style={styles.meta}>{n.author}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString()}` : ''}</Text>
                </View>
            ))}
            {!view.canReply ? <Text style={styles.muted}>{t('inbox.replyOnWeb')}</Text> : null}
        </ScrollView>
        {view.canReply ? (
            <View style={[styles.composer, keyboard > 0 && { marginBottom: keyboard, paddingBottom: 12 }]}>
                <TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder="Reply" accessibilityLabel="Reply" placeholderTextColor={colors.muted} multiline maxLength={8000} editable={!busy} />
                <Pressable accessibilityRole="button" accessibilityLabel="Send reply" disabled={busy || !draft.trim()} style={[styles.send, (busy || !draft.trim()) && styles.off]} onPress={send}>
                    <Text style={styles.sendText}>{busy ? '…' : 'Send'}</Text>
                </Pressable>
            </View>
        ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    pad: { flex: 1, backgroundColor: colors.background, padding: 16 },
    body: { padding: 16, paddingBottom: VEY_CLEARANCE, gap: 8 },
    heading: { color: colors.muted, fontSize: 13, textTransform: 'uppercase', marginTop: 12 },
    bubble: { borderRadius: 12, padding: 12, gap: 4, maxWidth: '88%' },
    in: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignSelf: 'flex-start' },
    out: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, alignSelf: 'flex-end' },
    note: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 4, borderColor: colors.border, borderWidth: 1 },
    text: { color: colors.text, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    meta: { color: colors.muted, fontSize: 12 },
    tags: { color: colors.accent, fontSize: 13 },
    error: { color: colors.danger },
    actions: { flexDirection: 'row', gap: 20, flexWrap: 'wrap' },
    action: { color: colors.accent, fontSize: 16 },
    picker: { backgroundColor: colors.surface, borderRadius: 12, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12 },
    member: { justifyContent: 'center' },
    composer: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: VEY_CLEARANCE / 2, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 120 },
    send: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
    sendText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
});
