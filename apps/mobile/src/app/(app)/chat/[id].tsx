import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { ReplyOptionsBar } from '../../../components/chat/ReplyOptionsBar';
import { chatApi, cleanOptions, NO_OPTIONS, replyPrice, sendKeyFor, type ChatMessage, type ChatModel, type PendingSend, type ReplyOptions } from '../../../lib/chat';
import { plural, t } from '../../../lib/i18n';
import { ensureOnline, OFFLINE_PAID_MESSAGE, OfflineError } from '../../../lib/network';
import { colors } from '../../../theme';
import { HeaderAction } from '../../../components/HeaderAction';

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
    const [messages, setMessages] = useState<ChatMessage[] | null>(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Kept until a send finishes so a retry of the same text is charged once.
    const pendingKey = useRef<PendingSend | null>(null);
    const [model, setModel] = useState<ChatModel | null>(null);
    const [options, setOptions] = useState<ReplyOptions>(NO_OPTIONS);
    const abort = useRef<AbortController | null>(null);

    useEffect(() => {
        chatApi(api)
            .getThread(id)
            .then(async (r) => {
                setTitle(r.thread.title || 'Chat');
                setMessages(r.messages);
                // The price is shown before sending, so the model list is read; if it fails the chat still opens and
                // sending is held back until the price is known.
                const models = await chatApi(api).listModels().catch(() => null);
                setModel(models?.find((m) => m.id === r.thread.model_id) ?? null);
            })
            .catch(() => setError('Could not load this chat.'));
        return () => abort.current?.abort();
    }, [api, id]);

    const send = useCallback(async () => {
        const text = draft.trim();
        if (!text || sending || !messages) return;
        if (!model) return;
        const chosen = cleanOptions(model, options);
        try {
            await ensureOnline();
        } catch (err) {
            if (err instanceof OfflineError) return setError(OFFLINE_PAID_MESSAGE);
            throw err;
        }
        const pending = sendKeyFor(pendingKey.current, text, chosen, Crypto.randomUUID);
        pendingKey.current = pending;
        const key = pending.key;
        setError(null);
        setSending(true);
        setDraft('');
        const stamp = Date.now();
        setMessages((m) => [...(m ?? []), { id: `u${stamp}`, role: 'user', content: text }, { id: `a${stamp}`, role: 'assistant', content: '' }]);
        const controller = new AbortController();
        abort.current = controller;
        let failed: string | null = null;
        try {
            await chatApi(api).sendMessage(id, text, key, (e) => {
                if (e.type === 'delta') {
                    setMessages((m) => (m ?? []).map((x) => (x.id === `a${stamp}` ? { ...x, content: x.content + e.text } : x)));
                } else if (e.type === 'error') {
                    failed = e.error;
                }
            }, controller.signal, chosen);
        } catch (err) {
            if (!controller.signal.aborted) failed = err instanceof ApiError ? err.code : 'network';
        }
        if (failed) {
            setError(ERROR_TEXT[failed] ?? 'The reply did not complete. You were not charged for a failed reply.');
            setMessages((m) => (m ?? []).filter((x) => x.id !== `a${stamp}` || x.content.length > 0));
            setDraft(text);
        } else {
            pendingKey.current = null;
        }
        setSending(false);
    }, [api, draft, id, messages, model, options, sending]);

    const price = model ? replyPrice(model, options) : null;
    const canSend = !sending && !!draft.trim() && price !== null;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title, headerRight: () => <HeaderAction label="Folder" accessibilityLabel="Move to folder" onPress={() => router.push({ pathname: '/chat/move', params: { threadId: String(id) } })} /> }} />
            {messages === null && !error ? (
                <ActivityIndicator color={colors.accent} style={styles.center} />
            ) : (
                <FlatList
                    data={messages ?? []}
                    keyExtractor={(m) => m.id}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => (
                        <View accessible accessibilityLabel={`${item.role === 'user' ? 'You' : 'Vey'}: ${item.content || (sending ? 'writing' : '')}`} style={[styles.bubble, item.role === 'user' ? styles.user : styles.assistant]}>
                            <Text style={[styles.text, item.role === 'user' && styles.userText]}>{item.content || (sending ? '…' : '')}</Text>
                        </View>
                    )}
                />
            )}
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
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={price !== null ? plural('chat.sendPrice', price) : t('chat.send')}
                    disabled={!canSend}
                    style={[styles.send, !canSend && styles.sendOff]}
                    onPress={send}
                >
                    <Text style={styles.sendText}>{t('chat.send')}</Text>
                    {price !== null ? <Text style={styles.sendPrice}>{plural('chat.sendPriceShort', price)}</Text> : null}
                </Pressable>
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
    error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 4 },
    composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 120 },
    send: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
    sendOff: { opacity: 0.4 },
    sendText: { color: colors.accentInk, fontWeight: '600', textAlign: 'center' },
    sendPrice: { color: colors.accentInk, fontSize: 12, textAlign: 'center' },
    modelLine: { color: colors.muted, fontSize: 13, paddingHorizontal: 12, paddingTop: 8 },
});
