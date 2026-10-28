import { WorkflowDetails } from '../../../components/chat/WorkflowDetails';
import { STUDIO_WORKFLOWS, workflowSteps, type Workflow } from '../../../lib/studioWorkflows';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { t } from '../../../lib/i18n';
import { fetchCatalog } from '../../../lib/media';
import { SKILL_GROUPS, SKILL_MODEL, SKILLS, skillsInstructions, fittingSkills, MAX_SELECTED_SKILLS, type Skill } from '../../../lib/studioSkills';

import { Text, Button, Card, Icon, IconBadge, themedStyles, useThemedStyles } from '../../../components/ui';
import { skillIcon } from '../../../lib/featureIcons';

// The Studio skills page (the web's /app/skills). A skill is only instructions copied onto a new chat; it costs nothing to
// start, each reply is priced as in any chat, and making the thing is a separate step in Create.
export default function StudioSkills() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const router = useRouter();
    const [models, setModels] = useState<ChatModel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const busy = useRef(false);
    const [selected, setSelected] = useState<Skill[]>([]);
    const [workflow, setWorkflow] = useState<Workflow | null>(null);

    useEffect(() => {
        chatApi(api).listModels().then(setModels).catch(() => setError(t('chat.skills.failed')));
    }, [api]);

    async function startSkills(skills: readonly Skill[]) {
        if (busy.current || !skills.length) return;
        busy.current = true;
        setCreating(true);
        setError(null);
        try {
            const open = (models ?? []).filter((m) => !m.gated);
            const model = open.find((m) => m.id === SKILL_MODEL) ?? open[0];
            if (!model) throw new Error('no_model');
            const catalog = await fetchCatalog().catch(() => []);
            if (fittingSkills(skills, catalog).length !== skills.length) { setError(t('chatDepth.skillsTooLong')); setCreating(false); busy.current = false; return; }
            const thread = await chatApi(api).createThread(model.id);
            await chatApi(api).updateThread(thread.id, { system_prompt: skillsInstructions(skills, catalog) });
            router.replace({ pathname: '/chat/[id]', params: { id: thread.id, starter: skills[0].starter } });
        } catch {
            setError(t('chat.skills.failed'));
            setCreating(false); busy.current = false;
        }
    }

    function toggle(skill: Skill) {
        setSelected(current => current.some(s => s.id === skill.id) ? current.filter(s => s.id !== skill.id) : current.length < MAX_SELECTED_SKILLS ? [...current, skill] : current);
    }
    function startWorkflow(value: Workflow) {
        if (value.href) { setWorkflow(null); router.push(value.href); }
        else { setWorkflow(null); void startSkills(workflowSteps(value).slice(0, MAX_SELECTED_SKILLS)); }
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('chat.skills.title') }} />
            <WorkflowDetails workflow={workflow} busy={creating} onClose={() => setWorkflow(null)} onOpen={skill => { setWorkflow(null); void startSkills([skill]); }} onStart={startWorkflow} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {models === null && !error ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
                    <Text style={styles.muted}>{t('chat.skills.help')}</Text>
                    <Text>{t('chatDepth.selected', { count: selected.length, max: MAX_SELECTED_SKILLS })}</Text>
                    <Button variant="primary" label={t('chatDepth.startSkills')} disabled={creating || !models || !selected.length} onPress={() => void startSkills(selected)} />
                    {SKILL_GROUPS.map((g) => (
                        <View key={g}>
                            <Text variant="footnote" style={styles.heading} accessibilityRole="header">{t(`chat.skills.group.${g}`)}</Text>
                            {g === 'Film' ? <><Text style={styles.muted}>{t('chat.skills.filmNote')}</Text><Button label={t('chat.openFilmStudio')} onPress={() => router.push('/film')} /></> : null}
                            {SKILLS.filter((s) => s.group === g).map((s) => (
                                <Card key={s.id} accessibilityRole="button" accessibilityLabel={`${s.name}. ${s.blurb}`} selected={selected.some(skill => skill.id === s.id)} accessibilityState={{ selected: selected.some(skill => skill.id === s.id) }} disabled={creating || !models || (selected.length >= MAX_SELECTED_SKILLS && !selected.some(skill => skill.id === s.id))} style={styles.row} onPress={() => toggle(s)}>
                                    <IconBadge {...skillIcon(s.id, s.group)} />
                                    <View style={styles.copy}>
                                        <Text variant="bodyStrong" style={styles.name}>{s.name}</Text>
                                        <Text variant="footnote" style={styles.muted}>{s.blurb}</Text>
                                    </View>
                                    <Icon name="caretRight" size={20} />
                                </Card>
                            ))}
                        </View>
                    ))}
                    <Text variant="title2" accessibilityRole="header">{t('chatDepth.wfTitle')}</Text>
                    <Text>{t('chatDepth.wfHelp')}</Text>
                    {STUDIO_WORKFLOWS.map(w => <Card key={w.id} style={styles.workflowRow} accessibilityRole="button" accessibilityLabel={`${t('chatDepth.wfView')}: ${w.name}`} onPress={() => setWorkflow(w)} disabled={creating}>
                        <Text variant="bodyStrong">{w.name}</Text><Text>{w.blurb}</Text><Text>{t('chatDepth.wfSteps', { count: workflowSteps(w).length })}</Text>
                    </Card>)}
                </ScrollView>
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg, padding: 16 },
    list: { paddingBottom: 32 },
    row: { padding: 14, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 14 },
    workflowRow: { padding: 14, marginTop: 8, gap: 2 },
    copy: { flex: 1, gap: 2 },
    name: { color: p.textPrimary },
    muted: { color: p.textTertiary },
    error: { color: p.danger, marginBottom: 8 },
    heading: { color: p.textTertiary, marginTop: 20 },
}));
