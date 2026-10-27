import { t } from '../../../../lib/i18n';
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
                if (!p) return setProblem(t('chat.thatpersonaisnolongerthere'));
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
        Alert.alert(t('chat.deletethispersona'), t('chat.chatsalreadystartedfromitkeeptheir'), [
            { text: t('chat.keepit'), style: 'cancel' },
            {
                text: t('chat.deletepersona'),
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
            <Stack.Screen options={{ title: isNew ? t('chat.newpersona') : t('chat.editpersona') }} />
            <KeyboardFormScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text variant="callout" style={styles.label}>{t('chat.name')}</Text>
                <TextField accessibilityLabel={t('chat.personaname')} style={styles.input} value={name} onChangeText={setName} maxLength={60} placeholder={t('chat.forexampleEditor')} />
                <Text variant="callout" style={styles.label}>{t('chat.instructions')}</Text>
                <TextField accessibilityLabel={t('chat.personainstructions')} style={[styles.input, styles.tall]} multiline value={instructions} onChangeText={setInstructions} maxLength={MAX_PERSONA_TEXT} placeholder={t('chat.howshouldthechatbehave')} />
                <Text variant="footnote" style={styles.muted}>{instructions.length} / {MAX_PERSONA_TEXT}</Text>
                <Text variant="callout" style={styles.label}>{t('chat.model')}</Text>
                <View style={styles.chips}>
                    <Chip accessibilityRole="button" accessibilityState={{ selected: modelId === null }} onPress={() => setModelId(null)} label={t('chat.askeachtime')} selected={modelId === null} />
                    {models.filter((m) => !m.gated).map((m) => (
                        <Chip key={m.id} accessibilityRole="button" accessibilityState={{ selected: modelId === m.id }} onPress={() => setModelId(m.id)} label={(m.name)} selected={modelId === m.id} />
                    ))}
                </View>
                <View style={styles.switchRow}><Text variant="callout" style={styles.label}>{t('chat.thinking')}</Text><Switch accessibilityLabel={t('chat.thinking')} value={thinking} onValueChange={setThinking} /></View>
                <View style={styles.switchRow}><Text variant="callout" style={styles.label}>{t('chat.websearch')}</Text><Switch accessibilityLabel={t('chat.websearch')} value={web} onValueChange={setWeb} /></View>
                <Text variant="footnote" style={styles.muted}>{t('chat.thinkingandwebsearcharesavedwith')}</Text>
                {problem ? <Text style={styles.error}>{problem}</Text> : null}
                <Button accessibilityRole="button" disabled={busy} containerStyle={styles.button} onPress={save} variant="secondary" size="md" label={t('chat.save')}>
                    {busy ? <ActivityIndicator color={styles.accentInkInk.color} /> : <Text variant="bodyStrong" style={styles.buttonText}>{t('chat.save')}</Text>}
                </Button>
                {!isNew ? <Button accessibilityRole="button" containerStyle={styles.deleteRow} onPress={remove} variant="tertiary" size="md" label={t('chat.deletepersona')}><Text variant="body" style={styles.danger}>{t('chat.deletepersona')}</Text></Button> : null}
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
