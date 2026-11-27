import { rawText } from '../../../lib/i18n/translate';
import { isAssetId } from '../../../lib/useAskAbout';
import { plural, t } from '../../../lib/i18n';
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ApiError } from '../../../lib/api';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { chatLibraryErrorMessage, fetchPersonas, startFromPersona, type Persona } from '../../../lib/chatLibrary';
import { SKILL_MODEL } from '../../../lib/studioSkills';
import { Text, Card, Button, themedStyles, useThemedStyles } from '../../../components/ui';
import { bindMusicLyricThread, isMusicLyricHandoff, selectMusicLyricPersona } from '../../../lib/music/lyricAssistantHandoff';

export const PERSONA_WAIT_MS = 1500;

export default function NewChat() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const router = useRouter();
    const { asset, lyricHandoff } = useLocalSearchParams<{ asset?: string; lyricHandoff?: string }>();
    const [musicToken] = useState(() => typeof lyricHandoff === 'string' && isMusicLyricHandoff(lyricHandoff) ? lyricHandoff : undefined);
    const invalidMusicToken = typeof lyricHandoff === 'string' && !musicToken;
    const [models, setModels] = useState<ChatModel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [personasEnabled, setPersonasEnabled] = useState(true);
    const [profileReload, setProfileReload] = useState(0);
    const [handoffExpired, setHandoffExpired] = useState(false);
    const autoStart = useRef(false);
    const live = useRef(true);
    const busy = useRef(false);
    const [decided, setDecided] = useState(false);
    const open = (models ?? []).filter(m => !m.gated);
    const defaultModel = open.find(m => m.id === SKILL_MODEL) ?? open[0];
    useEffect(() => () => { live.current = false; }, []);

    useEffect(() => {
        if (musicToken || invalidMusicToken) return;
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
    }, [api, invalidMusicToken, musicToken]);

    useFocusEffect(useCallback(() => {
        if (!musicToken) return;
        let active = true;
        live.current = true;
        setDecided(false);
        setError(null);
        Promise.all([chatApi(api).listModels(), fetchPersonas(api)]).then(([list, result]) => {
            if (!active || !live.current) return;
            setModels(list);
            setPersonasEnabled(result.enabled);
            setPersonas(result.personas);
            setDecided(true);
        }).catch(() => {
            if (!active || !live.current) return;
            setError(t('music.lyricAssistant.loadError'));
            setDecided(true);
        });
        return () => { active = false; };
    }, [api, musicToken, profileReload]));

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
        if (!persona.modelId && !fallback) return setError(t(musicToken ? 'music.lyricAssistant.noModel' : 'chat.chooseamodelbelow'));
        busy.current = true;
        setCreating(true);
        setError(null);
        try {
            if (musicToken && !selectMusicLyricPersona(musicToken, persona.id)) throw new Error('lyric_handoff_expired');
            const id = await startFromPersona(api, persona, fallback?.id ?? '');
            if (!live.current) {
                if (musicToken) await chatApi(api).deleteThread(id).catch(() => undefined);
                return;
            }
            if (musicToken && !bindMusicLyricThread(musicToken, persona.id, id)) {
                await chatApi(api).deleteThread(id).catch(() => undefined);
                throw new Error('lyric_handoff_expired');
            }
            live.current = false;
            router.replace({ pathname: '/chat/[id]', params: { id, ...(isAssetId(asset) ? { asset } : {}), ...(musicToken ? { lyricHandoff: musicToken } : {}) } });
        } catch (err) {
            if (!live.current) return;
            busy.current = false;
            const expired = !!musicToken && err instanceof Error && err.message === 'lyric_handoff_expired';
            if (expired) { setHandoffExpired(true); setError(null); }
            else setError(chatLibraryErrorMessage(err));
            setCreating(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('chat.newchat') }} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {invalidMusicToken || handoffExpired ? <View style={styles.personas}>
                <Text style={styles.muted}>{t('music.lyricAssistant.expired')}</Text>
                <Button accessibilityRole="button" variant="secondary" label={t('music.lyricAssistant.backToMusic')} onPress={() => router.dismissTo('/music/create')} />
            </View> : (!decided && !error) || (creating && !error) ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : musicToken ? (
                <View style={styles.personas}>
                    {error ? null : !personasEnabled ? <Text style={styles.muted}>{t('music.lyricAssistant.unavailable')}</Text>
                        : personas.length === 0 ? <Text style={styles.muted}>{t('music.lyricAssistant.noProfiles')}</Text>
                            : <>
                                <Text variant="footnote" style={styles.heading} accessibilityRole="header">{t('music.lyricAssistant.chooseProfile')}</Text>
                                {personas.map((p) => (
                                    <Card key={p.id} accessibilityRole="button" accessibilityLabel={rawText(t('music.lyricAssistant.chooseNamed', { name: p.name }))}
                                        disabled={creating} accessibilityState={{ disabled: creating }} style={styles.row} onPress={() => pickPersona(p)}>
                                        <Text variant="bodyStrong" style={styles.name}>{p.name}</Text>
                                        <Text style={styles.muted} numberOfLines={1}>{p.instructions}</Text>
                                    </Card>
                                ))}
                            </>}
                    {!error && personasEnabled ? <Button accessibilityRole="button" variant="secondary" label={t(personas.length ? 'music.lyricAssistant.manageProfiles' : 'music.lyricAssistant.createProfile')}
                        onPress={() => router.push('/chat/personas')} /> : null}
                    {error ? <Button accessibilityRole="button" variant="secondary" label={t('music.lyricAssistant.retry')} onPress={() => setProfileReload(value => value + 1)} /> : null}
                </View>
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
                                        <Card key={p.id} accessibilityRole="button" accessibilityLabel={rawText(t('chat.startachatwiththepersona', { value1: p.name }))} disabled={creating} accessibilityState={{ disabled: creating }} style={styles.row} onPress={() => pickPersona(p)}>
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
                        <Card accessibilityRole="button" accessibilityLabel={rawText(item.name)} accessibilityState={{ disabled: creating || item.gated }} disabled={creating || item.gated} style={[styles.row, item.gated && styles.gated]} onPress={() => pick(item)}>
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
