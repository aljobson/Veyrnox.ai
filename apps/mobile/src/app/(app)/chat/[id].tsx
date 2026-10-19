import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/AuthProvider';
import { ReplyOptionsBar } from '../../../components/chat/ReplyOptionsBar';
import { HeaderAction } from '../../../components/HeaderAction';
import { ApiError } from '../../../lib/api';
import { MIN_TARGET } from '../../../lib/a11y';
import { chatApi, cleanOptions, cleanTitle, NO_OPTIONS, replyPrice, sendKeyFor, type ChatMessage, type ChatModel, type PendingSend, type ReplyOptions } from '../../../lib/chat';
import { makeSendKey, resolveStoppedSend, stopNoticeKey } from '../../../lib/chatStop';
import { plural, t } from '../../../lib/i18n';
import { ensureOnline, OFFLINE_PAID_MESSAGE, OfflineError } from '../../../lib/network';
import { colors } from '../../../theme';

const ERROR_TEXT: Record<string, string> = {
    insufficient_credits: 'Not enough credits for this reply.',
    rate_limited: 'Too many messages. Wait a moment.',
    option_unavailable: 'That choice is not available for this model.',
    chat_not_open: 'Chat is not available right now.',
    consent_declined: 'You need to agree to AI sharing to chat.',
};

export default function Conversation() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [title, setTitle] = useState('Chat');
    const [pinned, setPinned] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[] | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    // Kept only while a send is unsettled, so a retry of the same message with the same choices is charged once.
    const pendingKey = useRef<PendingSend | null>(null);
    const [model, setModel] = useState<ChatModel | null>(null);
    const [options, setOptions] = useState<ReplyOptions>(NO_OPTIONS);
    const abort = useRef<AbortController | null>(null);
    const busy = useRef(false); // synchronous: a second tap must not start a second turn

    useEffect(() => {
        chatApi(api)
            .getThread(id)
            .then(async (r) => {
                setTitle(r.thread.title || 'Chat');
                setPinned(r.thread.pinned);
                setMessages(r.messages);
                // The price is shown before sending, so the model list is read; if it fails the chat still opens and
                // sending is held back until the price is known.
                const models = await chatApi(api).listModels().catch(() => null);
                setModel(models?.find((m) => m.id === r.thread.model_id) ?? null);
            })
            .catch(() => setError('Could not load this chat.'));
        return () => abort.current?.abort();
    }, [api, id]);

    const send = useCallback(
        async (again?: string) => {
            const text = (again ?? draft).trim();
            if (!text || busy.current || !messages || !model) return;
            const chosen = cleanOptions(model, options);
            setError(null);
            setNotice(null);
            try {
                await ensureOnline();
            } catch (err) {
                if (err instanceof OfflineError) return setError(OFFLINE_PAID_MESSAGE);
                throw err;
            }
            busy.current = true;
            const pending = sendKeyFor(pendingKey.current, text, chosen, () => makeSendKey(Crypto.randomUUID()));
            pendingKey.current = pending;
            setSending(true);
            if (again === undefined) setDraft('');
            const knownIds = new Set(messages.map((m) => m.id));
            const stamp = Date.now();
            setMessages((m) => [...(m ?? []), { id: `u${stamp}`, role: 'user', content: text }, { id: `a${stamp}`, role: 'assistant', content: '' }]);
            const controller = new AbortController();
            abort.current = controller;
            let failed: string | null = null;
            let unanswered = false;
            let jobId: string | null = null;
            try {
                await chatApi(api).sendMessage(
                    id,
                    text,
                    pending.key,
                    (e) => {
                        if (e.type === 'start') jobId = e.jobId;
                        else if (e.type === 'delta') setMessages((m) => (m ?? []).map((x) => (x.id === `a${stamp}` ? { ...x, content: x.content + e.text } : x)));
                        else if (e.type === 'error') failed = e.error;
                    },
                    controller.signal,
                    chosen,
                );
            } catch (err) {
                // A refusal from the server made no reply. Anything else (Stop, a dropped connection, no answer) may have
                // reached the server, which charges what it produced, so the send is looked for before it is called free.
                if (controller.signal.aborted || !(err instanceof ApiError && err.status > 0)) unanswered = true;
                else failed = err.code;
            }
            const giveBack = () => {
                setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` && x.id !== `u${stamp}`));
                if (again === undefined) setDraft(text);
            };
            if (unanswered) {
                setStopping(true);
                const outcome = await resolveStoppedSend(
                    { closeSend: chatApi(api).closeSend, getThread: () => chatApi(api).getThread(id), getJob: chatApi(api).getJob },
                    { key: pending.key, jobId, text, knownIds },
                );
                if (outcome === 'saved' || outcome === 'unsaved') {
                    const r = await chatApi(api).getThread(id).catch(() => null);
                    if (r) setMessages(r.messages);
                } else if (outcome === 'nothing') {
                    giveBack();
                } else {
                    // Not settled: what arrived stays on screen; with nothing on screen the message goes back.
                    setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` || x.content.length > 0));
                }
                // Only an unsettled send keeps its key, so retrying it cannot be charged twice. A closed key can never send again.
                if (outcome !== 'pending') pendingKey.current = null;
                setNotice(t(outcome === 'nothing' && !controller.signal.aborted ? 'chat.lost.nothing' : stopNoticeKey(outcome)));
                setStopping(false);
            } else if (failed) {
                setError(ERROR_TEXT[failed] ?? 'The reply did not complete. You were not charged for a failed reply.');
                setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` || x.content.length > 0));
                if (again === undefined) setDraft(text);
                pendingKey.current = null;
            } else {
                pendingKey.current = null;
                // The saved reply carries its real price.
                const r = await chatApi(api).getThread(id).catch(() => null);
                if (r) setMessages(r.messages);
            }
            setSending(false);
            busy.current = false;
        },
        [api, draft, id, messages, model, options],
    );

    async function togglePin() {
        const next = !pinned;
        setPinned(next);
        try {
            await chatApi(api).updateThread(id, { pinned: next });
        } catch {
            setPinned(!next);
            setError(t('chat.updateFailed'));
        }
    }

    async function saveRename() {
        const name = cleanTitle(renaming ?? '');
        if (!name) return setError(t('chat.renameInvalid'));
        try {
            const thread = await chatApi(api).updateThread(id, { title: name });
            setTitle(thread.title || name);
            setRenaming(null);
            setError(null);
        } catch {
            setError(t('chat.updateFailed'));
        }
    }

    const price = model ? replyPrice(model, options) : null;
    const canSend = !sending && !!draft.trim() && price !== null;
    const last = messages && messages.length >= 2 ? messages[messages.length - 1] : null;
    const lastUser = last?.role === 'assistant' && last.content ? messages![messages!.length - 2] : null;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title, headerRight: () => <HeaderAction label="Folder" accessibilityLabel="Move to folder" onPress={() => router.push({ pathname: '/chat/move', params: { threadId: String(id) } })} /> }} />
            {renaming !== null ? (
                <View style={styles.toolbar}>
                    <TextInput style={[styles.input, styles.renameInput]} value={renaming} onChangeText={setRenaming} placeholder={t('chat.renamePlaceholder')} accessibilityLabel={t('chat.rename')} placeholderTextColor={colors.muted} maxLength={120} autoFocus />
                    <Pressable accessibilityRole="button" style={styles.tool} onPress={saveRename}><Text style={styles.toolText}>{t('chat.renameSave')}</Text></Pressable>
                    <Pressable accessibilityRole="button" style={styles.tool} onPress={() => setRenaming(null)}><Text style={styles.toolText}>{t('chat.renameCancel')}</Text></Pressable>
                </View>
            ) : (
                <View style={styles.toolbar}>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected: pinned }} style={styles.tool} onPress={togglePin}>
                        <Text style={styles.toolText}>{pinned ? t('chat.unpin') : t('chat.pin')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={styles.tool} onPress={() => setRenaming(title === 'Chat' ? '' : title)}>
                        <Text style={styles.toolText}>{t('chat.rename')}</Text>
                    </Pressable>
                </View>
            )}
            {messages === null && !error ? (
                <ActivityIndicator color={colors.accent} style={styles.center} />
            ) : (
                <FlatList
                    data={messages ?? []}
                    keyExtractor={(m) => m.id}
                    contentContainerStyle={styles.list}
                    ListFooterComponent={
                        lastUser && !sending && model && price !== null ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={plural('chat.againLabel', price)} style={styles.again} onPress={() => void send(lastUser.content)}>
                                <Text style={styles.toolText}>{plural('chat.again', price)}</Text>
                            </Pressable>
                        ) : undefined
                    }
                    renderItem={({ item }) => (
                        <View accessible accessibilityLabel={`${item.role === 'user' ? 'You' : 'Vey'}: ${item.content || (sending ? 'writing' : '')}`} style={[styles.bubble, item.role === 'user' ? styles.user : styles.assistant]}>
                            <Text style={[styles.text, item.role === 'user' && styles.userText]}>{item.content || (sending ? '…' : '')}</Text>
                            {item.role === 'assistant' && item.credits ? <Text style={styles.cost}>{plural('chat.replyCost', item.credits)}</Text> : null}
                        </View>
                    )}
                />
            )}
            {notice ? <Text style={styles.notice} accessibilityRole="alert">{notice}</Text> : null}
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            {model ? (
                <>
                    <Text style={styles.modelLine} accessibilityLabel={`${model.name}, ${plural('chat.perReply', model.credits_per_reply)}`}>
                        {model.name} · {plural('chat.perReply', model.credits_per_reply)}
                    </Text>
                    <ReplyOptionsBar model={model} options={cleanOptions(model, options)} disabled={sending} onChange={setOptions} />
                </>
            ) : null}
            <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <TextInput
                    style={styles.input}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Message Vey"
                    accessibilityLabel="Message Vey"
                    placeholderTextColor={colors.muted}
                    multiline
                    maxLength={8000}
                />
                {sending ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={stopping ? t('chat.stopping') : t('chat.stopLabel')} disabled={stopping} style={[styles.send, stopping && styles.sendOff]} onPress={() => abort.current?.abort()}>
                        <Text style={styles.sendText}>{stopping ? '…' : t('chat.stop')}</Text>
                    </Pressable>
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={price !== null ? plural('chat.sendPrice', price) : t('chat.send')}
                        disabled={!canSend}
                        style={[styles.send, !canSend && styles.sendOff]}
                        onPress={() => void send()}
                    >
                        <Text style={styles.sendText}>{t('chat.send')}</Text>
                        {price !== null ? <Text style={styles.sendPrice}>{plural('chat.sendPriceShort', price)}</Text> : null}
                    </Pressable>
                )}
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1 },
    list: { padding: 16, gap: 10 },
    bubble: { maxWidth: '85%', borderRadius: 14, padding: 12 },
    user: { alignSelf: 'flex-end', backgroundColor: colors.accent },
    assistant: { alignSelf: 'flex-start', backgroundColor: colors.surface },
    text: { color: colors.text, fontSize: 16 },
    userText: { color: colors.accentInk },
    cost: { color: colors.muted, fontSize: 12, marginTop: 4 },
    error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 4 },
    notice: { color: colors.body, paddingHorizontal: 16, paddingBottom: 4 },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 4 },
    tool: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 8 },
    toolText: { color: colors.accent, fontSize: 15 },
    renameInput: { flex: 1 },
    again: { alignSelf: 'flex-start', minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 4 },
    composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 120 },
    send: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, minHeight: MIN_TARGET, justifyContent: 'center' },
    sendOff: { opacity: 0.4 },
    sendText: { color: colors.accentInk, fontWeight: '600', textAlign: 'center' },
    sendPrice: { color: colors.accentInk, fontSize: 12, textAlign: 'center' },
    modelLine: { color: colors.muted, fontSize: 13, paddingHorizontal: 12, paddingTop: 8 },
});
