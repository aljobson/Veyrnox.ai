import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { chatLibraryErrorMessage, fetchPersonas, startFromPersona, type Persona } from '../../../lib/chatLibrary';
import { SKILL_MODEL } from '../../../lib/studioSkills';
import { colors } from '../../../theme';

export default function NewChat() {
    const { api } = useAuth();
    const router = useRouter();
    const [models, setModels] = useState<ChatModel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const autoStart = useRef(false);

    useEffect(() => {
        chatApi(api)
            .listModels()
            .then((list) => {
                setModels(list);
                // One screen, like the web: open a chat on the default model straight away. The model, Thinking and Web
                // are changed inside the chat, each priced before anything is sent.
                if (autoStart.current) return;
                const open = list.filter((m) => !m.gated);
                const model = open.find((m) => m.id === SKILL_MODEL) ?? open[0];
                if (model) {
                    autoStart.current = true;
                    void pick(model);
                }
            })
            .catch(() => setError('Could not load models.'));
        // Personas are an extra: off, or failing, shows nothing.
        fetchPersonas(api).then((r) => setPersonas(r.personas), () => undefined);
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

    async function pickPersona(persona: Persona) {
        if (creating) return;
        const fallback = (models ?? []).find((m) => !m.gated);
        if (!persona.modelId && !fallback) return setError('Choose a model below.');
        setCreating(true);
        setError(null);
        try {
            const id = await startFromPersona(api, persona, fallback?.id ?? '');
            router.replace({ pathname: '/chat/[id]', params: { id } });
        } catch (err) {
            setError(chatLibraryErrorMessage(err));
            setCreating(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'New chat' }} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {personas.length > 0 ? (
                <View style={styles.personas}>
                    <Text style={styles.heading} accessibilityRole="header">Start from a persona</Text>
                    {personas.map((p) => (
                        <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Start a chat with the ${p.name} persona`} disabled={creating} style={styles.row} onPress={() => pickPersona(p)}>
                            <Text style={styles.name}>{p.name}</Text>
                            <Text style={styles.muted} numberOfLines={1}>{p.instructions}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {(models === null && !error) || (creating && !error) ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    ListHeaderComponent={
                        <>
                            <Text style={styles.heading} accessibilityRole="header">Or choose a model</Text>
                        </>
                    }
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
    row: { padding: 14, marginTop: 8, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, gap: 2 },
    gated: { opacity: 0.4 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted },
    error: { color: colors.danger, marginBottom: 8 },
    personas: { marginBottom: 8 },
    heading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginTop: 16 },
});
