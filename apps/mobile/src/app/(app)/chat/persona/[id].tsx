import { KeyboardFormScrollView } from '../../../../components/KeyboardFormScrollView';
import { KeyboardScreen } from '../../../../components/KeyboardScreen';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, Switch, View } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { chatApi, type ChatModel } from '../../../../lib/chat';
import { MAX_PERSONA_TEXT, chatLibraryErrorMessage, createPersona, deletePersona, fetchPersonas, updatePersona, validatePersonaForm } from '../../../../lib/chatLibrary';
import { Text, TextField, Button, Chip, themedStyles, useThemedStyles } from '../../../../components/ui';

// id "new" makes a persona; any other id edits that one.
export default function PersonaForm() {
    const styles = useThemedStyles(sheets);
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

    if (!ready) return <View style={styles.screen}>{problem ? <Text style={styles.error}>{problem}</Text> : <ActivityIndicator color={styles.accentInk.color} />}</View>;

    return (
        <KeyboardScreen style={styles.screen}>
            <Stack.Screen options={{ title: isNew ? 'New persona' : 'Edit persona' }} />
            <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text variant="callout" style={styles.label}>Name</Text>
                <TextField accessibilityLabel="Persona name" style={styles.input} value={name} onChangeText={setName} maxLength={60} placeholder="For example, Editor" />
                <Text variant="callout" style={styles.label}>Instructions</Text>
                <TextField accessibilityLabel="Persona instructions" style={[styles.input, styles.tall]} multiline value={instructions} onChangeText={setInstructions} maxLength={MAX_PERSONA_TEXT} placeholder="How should the chat behave?" />
                <Text variant="footnote" style={styles.muted}>{instructions.length} / {MAX_PERSONA_TEXT}</Text>
                <Text variant="callout" style={styles.label}>Model</Text>
                <View style={styles.chips}>
                    <Chip accessibilityRole="button" accessibilityState={{ selected: modelId === null }} onPress={() => setModelId(null)} label={"Ask each time"} selected={modelId === null} />
                    {models.filter((m) => !m.gated).map((m) => (
                        <Chip key={m.id} accessibilityRole="button" accessibilityState={{ selected: modelId === m.id }} onPress={() => setModelId(m.id)} label={(m.name)} selected={modelId === m.id} />
                    ))}
                </View>
                <View style={styles.switchRow}><Text variant="callout" style={styles.label}>Thinking</Text><Switch accessibilityLabel="Thinking" value={thinking} onValueChange={setThinking} /></View>
                <View style={styles.switchRow}><Text variant="callout" style={styles.label}>Web search</Text><Switch accessibilityLabel="Web search" value={web} onValueChange={setWeb} /></View>
                <Text variant="footnote" style={styles.muted}>Thinking and web search are saved with the persona. The app does not turn them on in a chat yet.</Text>
                {problem ? <Text style={styles.error}>{problem}</Text> : null}
                <Button accessibilityRole="button" disabled={busy} containerStyle={styles.button} onPress={save} variant="secondary" size="md" label={"Save"}>
                    {busy ? <ActivityIndicator color={styles.accentInkInk.color} /> : <Text variant="bodyStrong" style={styles.buttonText}>Save</Text>}
                </Button>
                {!isNew ? <Button accessibilityRole="button" containerStyle={styles.deleteRow} onPress={remove} variant="tertiary" size="md" label={"Delete persona"}><Text variant="body" style={styles.danger}>Delete persona</Text></Button> : null}
            </KeyboardFormScrollView>
        </KeyboardScreen>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    accentInkInk: { color: p.textPrimary },
    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: 16, gap: 10 },
    label: { color: p.textPrimary, marginTop: 6 },
    input: { minHeight: 48 },
    tall: { minHeight: 140, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
    muted: { color: p.textTertiary },
    error: { color: p.danger },
    button: { alignItems: 'center', marginTop: 8 },
    buttonText: { color: p.textPrimary },
    deleteRow: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    danger: { color: p.danger },
}));
