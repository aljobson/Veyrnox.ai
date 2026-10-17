import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { colors } from '../../../theme';

export default function NewChat() {
    const { api } = useAuth();
    const router = useRouter();
    const [models, setModels] = useState<ChatModel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        chatApi(api)
            .listModels()
            .then(setModels)
            .catch(() => setError('Could not load models.'));
    }, [api]);

    async function pick(model: ChatModel) {
        if (creating) return;
        setCreating(true);
        setError(null);
        try {
            const thread = await chatApi(api).createThread(model.id);
            router.replace({ pathname: '/chat/[id]', params: { id: thread.id } });
        } catch (err) {
            setError(err instanceof ApiError && err.code === 'thread_limit' ? 'You have reached the chat limit. Delete one first.' : 'Could not start the chat.');
            setCreating(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Choose a model' }} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {models === null && !error ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={models ?? []}
                    keyExtractor={(m) => m.id}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" disabled={creating || item.gated} style={[styles.row, item.gated && styles.gated]} onPress={() => pick(item)}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.muted}>
                                {item.maker_label} · {item.credits_per_reply} {item.credits_per_reply === 1 ? 'credit' : 'credits'} per reply
                            </Text>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
    row: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
    gated: { opacity: 0.4 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted },
    error: { color: colors.danger, marginBottom: 8 },
});
