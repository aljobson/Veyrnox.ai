import { isAssetId } from '../../../lib/useAskAbout';
import { plural, t } from '../../../lib/i18n';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { chatLibraryErrorMessage, fetchPersonas, startFromPersona, type Persona } from '../../../lib/chatLibrary';
import { SKILL_MODEL } from '../../../lib/studioSkills';
import { Text, Card, themedStyles, useThemedStyles } from '../../../components/ui';

export const PERSONA_WAIT_MS = 1500;

export default function NewChat() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const router = useRouter();
    const { asset } = useLocalSearchParams<{ asset?: string }>();
    const [models, setModels] = useState<ChatModel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const autoStart = useRef(false);
    const live = useRef(true);
    const busy = useRef(false);
    const [decided, setDecided] = useState(false);
    const open = (models ?? []).filter(m => !m.gated);
    const defaultModel = open.find(m => m.id === SKILL_MODEL) ?? open[0];

    useEffect(() => {
        let active = true, settled = false, done = false;
        let available: Persona[] = [];
        let loaded: ChatModel[] | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        live.current = true;
        function decide() {
            if (!active || !live.current || !loaded || done) return;
            done = true;
            clearTimeout(timer);
            setDecided(true);
            if (available.length) { setPersonas(available); return; }
            const open = loaded.filter(m => !m.gated);
            const model = open.find(m => m.id === SKILL_MODEL) ?? open[0];
            if (model && !autoStart.current) { autoStart.current = true; void pick(model); }
        }
        chatApi(api).listModels().then(list => {
            if (!active || !live.current) return;
            loaded = list; setModels(list);
            if (settled) decide();
            else timer = setTimeout(decide, PERSONA_WAIT_MS);
        }).catch(() => { if (active && live.current) setError(t('chat.couldnotloadmodels')); });
        fetchPersonas(api).then(result => {
            if (!active || !live.current || done) return;
            settled = true; available = result.personas; decide();
        }, () => { if (active && live.current && !done) { settled = true; decide(); } });
        return () => { active = false; live.current = false; clearTimeout(timer); };
    }, [api]);

    async function pick(model: ChatModel) {
        if (busy.current || !live.current) return;
        busy.current = true;
        setCreating(true);
        setError(null);
        try {
            const thread = await chatApi(api).createThread(model.id);
            if (!live.current) return;
            live.current = false;
            router.replace({ pathname: '/chat/[id]', params: { id: thread.id, ...(isAssetId(asset) ? { asset } : {}) } });
        } catch (err) {
            if (!live.current) return;
            busy.current = false;
            setError(err instanceof ApiError && err.code === 'thread_limit' ? t('chat.youhavereachedthechatlimitDelete') : t('chat.couldnotstartthechat'));
            setCreating(false);
        }
    }

    async function pickPersona(persona: Persona) {
        if (busy.current || !live.current) return;
        const fallback = (models ?? []).find((m) => !m.gated);
        if (!persona.modelId && !fallback) return setError(t('chat.chooseamodelbelow'));
        busy.current = true;
        setCreating(true);
        setError(null);
        try {
            const id = await startFromPersona(api, persona, fallback?.id ?? '');
            if (!live.current) return;
            live.current = false;
            router.replace({ pathname: '/chat/[id]', params: { id, ...(isAssetId(asset) ? { asset } : {}) } });
        } catch (err) {
            if (!live.current) return;
            busy.current = false;
            setError(chatLibraryErrorMessage(err));
            setCreating(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('chat.newchat') }} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {(!decided && !error) || (creating && !error) ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <FlatList
                    ListHeaderComponent={
                        <>
                            {personas.length > 0 ? (
                                <View style={styles.personas}>
                                    {defaultModel ? <Card selected accessibilityLabel={t('skillsUi.blankChat')} disabled={creating} accessibilityState={{ disabled: creating }} style={styles.row} onPress={() => void pick(defaultModel)}>
                                        <Text variant="bodyStrong">{t('skillsUi.blankChat')}</Text>
                                        <Text>{defaultModel.name}</Text><Text tone="secondary">{plural('chat.creditsPerReply', defaultModel.credits_per_reply)}</Text>
                                    </Card> : null}
                                    <Text variant="footnote" style={styles.heading} accessibilityRole="header">{t('chat.startfromapersona')}</Text>
                                    {personas.map((p) => (
                                        <Card key={p.id} accessibilityRole="button" accessibilityLabel={t('chat.startachatwiththepersona', { value1: p.name })} disabled={creating} accessibilityState={{ disabled: creating }} style={styles.row} onPress={() => pickPersona(p)}>
                                            <Text variant="bodyStrong" style={styles.name}>{p.name}</Text>
                                            <Text style={styles.muted} numberOfLines={1}>{p.instructions}</Text>
                                        </Card>
                                    ))}
                                </View>
                            ) : null}
                            <Text variant="footnote" style={styles.heading} accessibilityRole="header">{t('chat.orchooseamodel')}</Text>
                        </>
                    }
                    data={models ?? []}
                    keyExtractor={(m) => m.id}
                    renderItem={({ item }) => (
                        <Card accessibilityRole="button" accessibilityLabel={item.name} accessibilityState={{ disabled: creating || item.gated }} disabled={creating || item.gated} style={[styles.row, item.gated && styles.gated]} onPress={() => pick(item)}>
                            <Text variant="bodyStrong" style={styles.name}>{item.name}</Text>
                            <Text style={styles.muted}>
                                {item.maker_label} · <Text tone="warning">{plural('chat.creditsPerReply', item.credits_per_reply)}</Text>
                            </Text>
                        </Card>
                    )}
                />
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg, padding: 16 },
    row: { padding: 14, marginTop: 8, gap: 2 },
    gated: { opacity: 0.4 },
    name: { color: p.textPrimary },
    muted: { color: p.textTertiary },
    error: { color: p.danger, marginBottom: 8 },
    personas: { marginBottom: 8 },
    heading: { color: p.textTertiary, marginTop: 16 },
}));
