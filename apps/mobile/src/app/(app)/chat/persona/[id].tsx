import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { chatApi, type ChatModel } from '../../../../lib/chat';
import { MAX_PERSONA_TEXT, chatLibraryErrorMessage, createPersona, deletePersona, fetchPersonas, updatePersona, validatePersonaForm } from '../../../../lib/chatLibrary';
import { colors } from '../../../../theme';

// id "new" makes a persona; any other id edits that one.
export default function PersonaForm() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const isNew = id === 'new';
    const { api } = useAuth();
    const router = useRouter();
    const [models, setModels] = useState<ChatModel[]>([]);
    const [ready, setReady] = useState(isNew);
    const [name, setName] = useState('');
    const [instructions, setInstructions] = useState('');
    const [modelId, setModelId] = useState<string | null>(null);
    const [thinking, setThinking] = useState(false);
    const [web, setWeb] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        chatApi(api).listModels().then(setModels).catch(() => undefined);
        if (isNew) return;
        fetchPersonas(api)
            .then((r) => {
                const p = r.personas.find((x) => x.id === id);
                if (!p) return setProblem('That persona is no longer there.');
                setName(p.name);
                setInstructions(p.instructions);
                setModelId(p.modelId);
                setThinking(p.thinking);
                setWeb(p.web);
                setReady(true);
            })
            .catch((err) => setProblem(chatLibraryErrorMessage(err)));
    }, [api, id, isNew]);

    async function save() {
        const checked = validatePersonaForm({ name, instructions, modelId, thinking, web });
        if (!checked.ok) return setProblem(checked.message);
        setBusy(true);
        setProblem(null);
        try {
            if (isNew) await createPersona(api, checked.value);
            else await updatePersona(api, String(id), checked.value);
            router.back();
        } catch (err) {
            setProblem(chatLibraryErrorMessage(err));
            setBusy(false);
        }
    }

    function remove() {
        Alert.alert('Delete this persona?', 'Chats already started from it keep their instructions.', [
            { text: 'Keep it', style: 'cancel' },
            {
                text: 'Delete persona',
                style: 'destructive',
                onPress: () => {
                    deletePersona(api, String(id)).then(() => router.back(), (err) => setProblem(chatLibraryErrorMessage(err)));
                },
            },
        ]);
    }

    if (!ready) return <View style={styles.screen}>{problem ? <Text style={styles.error}>{problem}</Text> : <ActivityIndicator color={colors.accent} />}</View>;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: isNew ? 'New persona' : 'Edit persona' }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>Name</Text>
                <TextInput accessibilityLabel="Persona name" style={styles.input} value={name} onChangeText={setName} maxLength={60} placeholder="For example, Editor" placeholderTextColor={colors.muted} />
                <Text style={styles.label}>Instructions</Text>
                <TextInput accessibilityLabel="Persona instructions" style={[styles.input, styles.tall]} multiline value={instructions} onChangeText={setInstructions} maxLength={MAX_PERSONA_TEXT} placeholder="How should the chat behave?" placeholderTextColor={colors.muted} />
                <Text style={styles.muted}>{instructions.length} / {MAX_PERSONA_TEXT}</Text>
                <Text style={styles.label}>Model</Text>
                <View style={styles.chips}>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected: modelId === null }} style={[styles.chip, modelId === null && styles.chipOn]} onPress={() => setModelId(null)}><Text style={[styles.chipText, modelId === null && styles.chipTextOn]}>Ask each time</Text></Pressable>
                    {models.filter((m) => !m.gated).map((m) => (
                        <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: modelId === m.id }} style={[styles.chip, modelId === m.id && styles.chipOn]} onPress={() => setModelId(m.id)}>
                            <Text style={[styles.chipText, modelId === m.id && styles.chipTextOn]}>{m.name}</Text>
                        </Pressable>
                    ))}
                </View>
                <View style={styles.switchRow}><Text style={styles.label}>Thinking</Text><Switch accessibilityLabel="Thinking" value={thinking} onValueChange={setThinking} /></View>
                <View style={styles.switchRow}><Text style={styles.label}>Web search</Text><Switch accessibilityLabel="Web search" value={web} onValueChange={setWeb} /></View>
                <Text style={styles.muted}>Thinking and web search are saved with the persona. The app does not turn them on in a chat yet.</Text>
                {problem ? <Text style={styles.error}>{problem}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>Save</Text>}
                </Pressable>
                {!isNew ? <Pressable accessibilityRole="button" style={styles.deleteRow} onPress={remove}><Text style={styles.danger}>Delete persona</Text></Pressable> : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 10 },
    label: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 6 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    tall: { minHeight: 140, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    deleteRow: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    danger: { color: colors.danger, fontSize: 16 },
});
