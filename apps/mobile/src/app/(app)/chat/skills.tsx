import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { t } from '../../../lib/i18n';
import { fetchCatalog } from '../../../lib/media';
import { SKILL_GROUPS, SKILL_MODEL, SKILLS, skillInstructions, type Skill } from '../../../lib/studioSkills';

import { Text, Card, themedStyles, useThemedStyles } from '../../../components/ui';

// The Studio skills page (the web's /app/skills). A skill is only instructions copied onto a new chat; it costs nothing to
// start, each reply is priced as in any chat, and making the thing is a separate step in Create.
export default function StudioSkills() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const router = useRouter();
    const [models, setModels] = useState<ChatModel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        chatApi(api).listModels().then(setModels).catch(() => setError(t('chat.skills.failed')));
    }, [api]);

    async function pickSkill(skill: Skill) {
        if (creating) return;
        setCreating(true);
        setError(null);
        try {
            const open = (models ?? []).filter((m) => !m.gated);
            const model = open.find((m) => m.id === SKILL_MODEL) ?? open[0];
            if (!model) throw new Error('no_model');
            const catalog = await fetchCatalog().catch(() => []);
            const thread = await chatApi(api).createThread(model.id);
            await chatApi(api).updateThread(thread.id, { system_prompt: skillInstructions(skill, catalog) });
            router.replace({ pathname: '/chat/[id]', params: { id: thread.id, starter: skill.starter } });
        } catch {
            setError(t('chat.skills.failed'));
            setCreating(false);
        }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('chat.skills.title') }} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {models === null && !error ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <ScrollView>
                    <Text style={styles.muted}>{t('chat.skills.help')}</Text>
                    {SKILL_GROUPS.map((g) => (
                        <View key={g}>
                            <Text variant="footnote" style={styles.heading} accessibilityRole="header">{t(`chat.skills.group.${g}`)}</Text>
                            {g === 'Film' ? <Text style={styles.muted}>{t('chat.skills.filmNote')}</Text> : null}
                            {SKILLS.filter((s) => s.group === g).map((s) => (
                                <Card key={s.id} accessibilityRole="button" accessibilityLabel={`${t('chat.skills.start', { name: s.name })}. ${s.blurb}`} disabled={creating || !models} style={styles.row} onPress={() => pickSkill(s)}>
                                    <Text variant="bodyStrong" style={styles.name}>{s.name}</Text>
                                    <Text style={styles.muted}>{s.blurb}</Text>
                                </Card>
                            ))}
                        </View>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg, padding: 16 },
    row: { padding: 14, marginTop: 8, gap: 2 },
    name: { color: p.textPrimary },
    muted: { color: p.textTertiary },
    error: { color: p.danger, marginBottom: 8 },
    heading: { color: p.textTertiary, marginTop: 16 },
}));
