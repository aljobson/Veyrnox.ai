import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { t } from '../../../lib/i18n';
import { fetchCatalog } from '../../../lib/media';
import { SKILL_GROUPS, SKILL_MODEL, SKILLS, skillInstructions, type Skill } from '../../../lib/studioSkills';
import { MIN_TARGET } from '../../../lib/a11y';
import { colors } from '../../../theme';

// The Studio skills page (the web's /app/skills). A skill is only instructions copied onto a new chat; it costs nothing to
// start, each reply is priced as in any chat, and making the thing is a separate step in Create.
export default function StudioSkills() {
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
                <ActivityIndicator color={colors.accent} />
            ) : (
                <ScrollView>
                    <Text style={styles.muted}>{t('chat.skills.help')}</Text>
                    {SKILL_GROUPS.map((g) => (
                        <View key={g}>
                            <Text style={styles.heading} accessibilityRole="header">{t(`chat.skills.group.${g}`)}</Text>
                            {g === 'Film' ? <Text style={styles.muted}>{t('chat.skills.filmNote')}</Text> : null}
                            {SKILLS.filter((s) => s.group === g).map((s) => (
                                <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`${t('chat.skills.start', { name: s.name })}. ${s.blurb}`} disabled={creating || !models} style={[styles.row, { minHeight: MIN_TARGET }]} onPress={() => pickSkill(s)}>
                                    <Text style={styles.name}>{s.name}</Text>
                                    <Text style={styles.muted}>{s.blurb}</Text>
                                </Pressable>
                            ))}
                        </View>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
    row: { padding: 14, marginTop: 8, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted },
    error: { color: colors.danger, marginBottom: 8 },
    heading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginTop: 16 },
});
