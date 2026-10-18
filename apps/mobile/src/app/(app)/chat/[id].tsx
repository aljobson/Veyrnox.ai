import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { chatApi, type ChatMessage } from '../../../lib/chat';
import { colors } from '../../../theme';

const ERROR_TEXT: Record<string, string> = {
    insufficient_credits: 'Not enough credits for this reply.',
    rate_limited: 'Too many messages. Wait a moment.',
    chat_not_open: 'Chat is not available right now.',
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
    const pendingKey = useRef<{ text: string; key: string } | null>(null);
    const abort = useRef<AbortController | null>(null);

    useEffect(() => {
        chatApi(api)
            .getThread(id)
            .then((r) => {
                setTitle(r.thread.title || 'Chat');
                setMessages(r.messages);
            })
            .catch(() => setError('Could not load this chat.'));
        return () => abort.current?.abort();
    }, [api, id]);

    const send = useCallback(async () => {
        const text = draft.trim();
        if (!text || sending || !messages) return;
        const key = pendingKey.current?.text === text ? pendingKey.current.key : Crypto.randomUUID();
        pendingKey.current = { text, key };
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
            }, controller.signal);
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
    }, [api, draft, id, messages, sending]);

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title, headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Move to folder" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => router.push({ pathname: '/chat/move', params: { threadId: String(id) } })}><Text style={{ color: colors.accent, fontSize: 16 }}>Folder</Text></Pressable> }} />
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
                <Pressable accessibilityRole="button" disabled={sending || !draft.trim()} style={[styles.send, (sending || !draft.trim()) && styles.sendOff]} onPress={send}>
                    <Text style={styles.sendText}>Send</Text>
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
    sendText: { color: colors.accentInk, fontWeight: '600' },
});
