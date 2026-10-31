import { useHandoffScope } from '../../../lib/useHandoffScope';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/AuthProvider';
import { SkillCard } from '../../../components/chat/SkillCard';
import { SkillDetails } from '../../../components/chat/SkillDetails';
import { WorkflowCard } from '../../../components/chat/WorkflowCard';
import { WorkflowDetails } from '../../../components/chat/WorkflowDetails';
import { Text, Button, themedStyles, useAppearance, useThemedStyles } from '../../../components/ui';
import { chatApi, type ChatModel } from '../../../lib/chat';
import { createTileColumns } from '../../../lib/createLayout';
import { t } from '../../../lib/i18n';
import { fetchCatalog } from '../../../lib/media';
import { SKILL_GROUPS, SKILL_MODEL, SKILLS, skillById, skillsInstructions, fittingSkills, MAX_SELECTED_SKILLS, type Skill } from '../../../lib/studioSkills';
import { STUDIO_WORKFLOWS, workflowById, workflowSteps, type Workflow } from '../../../lib/studioWorkflows';
import { ds, LIST_END_PADDING, TEXT_SCALE } from '../../../theme';

export default function StudioSkills() {
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const router = useRouter();
    const beginHandoff = useHandoffScope();
    const params = useLocalSearchParams<{ skill?: string; workflow?: string; prompt?: string; modelId?: string }>();
    const { width, fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const single = createTileColumns(width, fontScale, TEXT_SCALE[settings.textSize]) === 1;
    const [models, setModels] = useState<ChatModel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const busy = useRef(false);
    const [selected, setSelected] = useState<Skill[]>([]);
    const [skill, setSkill] = useState<Skill | null>(null);
    const [workflow, setWorkflow] = useState<Workflow | null>(null);
    const [footerHeight, setFooterHeight] = useState(0);
    const opened = useRef(new Set<string>());
    const openModels = (models ?? []).filter(m => !m.gated);
    const model = openModels.find(m => m.id === SKILL_MODEL) ?? openModels[0];

    useEffect(() => {
        let live = true;
        chatApi(api).listModels().then(list => { if (live) setModels(list); }).catch(() => { if (live) setError(t('chat.skills.failed')); });
        return () => { live = false; };
    }, [api]);
    useEffect(() => {
        if (typeof params.skill === 'string' && !opened.current.has(`skill:${params.skill}`)) {
            const value = skillById(params.skill);
            if (value) { opened.current.add(`skill:${params.skill}`); setWorkflow(null); setSkill(value); }
        }
        if (typeof params.workflow === 'string' && !opened.current.has(`workflow:${params.workflow}`)) {
            const value = workflowById(params.workflow);
            if (value) { opened.current.add(`workflow:${params.workflow}`); setSkill(null); setWorkflow(value); }
        }
    }, [params.skill, params.workflow]);

    async function startSkills(skills: readonly Skill[]) {
        if (busy.current || !skills.length) return;
        const current = beginHandoff();
        busy.current = true;
        setCreating(true);
        setError(null);
        let started = false;
        try {
            if (!model) throw new Error('no_model');
            const catalog = await fetchCatalog();
            if (!current()) return;
            if (fittingSkills(skills, catalog).length !== skills.length) { setError(t('chatDepth.skillsTooLong')); return; }
            const thread = await chatApi(api).createThread(model.id);
            const discard = () => { void chatApi(api).deleteThread(thread.id).catch(() => undefined); };
            if (!current()) { discard(); return; }
            try { await chatApi(api).updateThread(thread.id, { system_prompt: skillsInstructions(skills, catalog, (params.modelId && /^[A-Za-z0-9._-]{1,80}$/.test(params.modelId) ? `Current generation model: ${params.modelId}` : '')) }); }
            catch (err) { discard(); if (!current()) return; throw err; }
            if (!current()) { discard(); return; }
            setSkill(null); setWorkflow(null);
            router.replace({ pathname: '/chat/[id]', params: { id: thread.id, starter: skills[0].starter, ...(typeof params.prompt === 'string' ? { prompt: params.prompt } : {}), ...(params.modelId ? { modelId: params.modelId } : {}) } });
            started = true;
        } catch {
            if (current()) setError(t('chat.skills.failed'));
        } finally { if (!started) { busy.current = false; setCreating(false); } }
    }
    function toggle(value: Skill) {
        if (busy.current || !models) return;
        setSelected(current => current.some(s => s.id === value.id) ? current.filter(s => s.id !== value.id) : current.length < MAX_SELECTED_SKILLS ? [...current, value] : current);
    }
    function startWorkflow(value: Workflow) {
        if (busy.current) return;
        if (value.href) { setWorkflow(null); router.push(value.href); }
        else { setWorkflow(null); void startSkills(workflowSteps(value).slice(0, MAX_SELECTED_SKILLS)); }
    }
    return <View style={styles.screen}>
        <Stack.Screen options={{ title: t('chat.skills.title') }} />
        <SkillDetails skill={skill} chosen={selected.some(s => s.id === skill?.id)} count={selected.length} busy={creating}
            model={model} onClose={() => setSkill(null)} onUse={value => { setSkill(null); void startSkills([value]); }} onToggle={toggle} />
        <WorkflowDetails workflow={workflow} busy={creating} onClose={() => setWorkflow(null)} onOpen={value => { setWorkflow(null); void startSkills([value]); }} onStart={startWorkflow} />
        {error ? <Text tone="danger" style={styles.error}>{error}</Text> : null}
        {models === null && !error ? <ActivityIndicator color={styles.accentInk.color} /> :
            <ScrollView contentContainerStyle={[styles.list, { paddingBottom: LIST_END_PADDING + (selected.length ? footerHeight : 0) }]} keyboardShouldPersistTaps="handled">
                <View style={styles.hero}><Text variant="display" accessibilityRole="header" style={styles.center}>{t('chat.skills.title')}</Text>
                    <Text variant="callout" tone="secondary" style={styles.center}>{t('chat.skills.help')}</Text></View>
                <Text variant="caption" tone="accent">{t('skillsUi.wfKicker')}</Text>
                <Text variant="title1" accessibilityRole="header">{t('chatDepth.wfTitle')}</Text>
                <Text variant="callout" tone="secondary">{t('chatDepth.wfHelp')}</Text>
                <View style={styles.pill}><Text variant="caption">{t('skillsUi.wfControl')}</Text></View>
                {STUDIO_WORKFLOWS.map(w => <WorkflowCard key={w.id} workflow={w} disabled={creating} onPress={() => { setSkill(null); setWorkflow(w); }} />)}
                <Text variant="title1" accessibilityRole="header">{t('skillsUi.skillsTitle')}</Text>
                <Button variant="tertiary" label={t('chat.openFilmStudio')} icon="arrowRight" onPress={() => router.push('/film')} />
                {SKILL_GROUPS.map(g => <View key={g} style={styles.group}>
                    <Text variant="title3" accessibilityRole="header">{t(`chat.skills.group.${g}`)}</Text>
                    <View style={styles.grid}>{SKILLS.filter(s => s.group === g).map(s => {
                        const chosen = selected.some(value => value.id === s.id);
                        return <View key={s.id} style={single ? styles.full : styles.half}>
                            <SkillCard skill={s} selected={chosen} onPress={() => { setWorkflow(null); setSkill(s); }}
                                select={{ onToggle: () => toggle(s), disabled: creating || !models || (!chosen && selected.length >= MAX_SELECTED_SKILLS) }} />
                        </View>;
                    })}</View>
                </View>)}
            </ScrollView>}
        {selected.length ? <SkillsFooter count={selected.length} disabled={creating || !models} onStart={() => void startSkills(selected)}
            onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} /> : null}
    </View>;
}
function SkillsFooter({ count, disabled, onStart, onLayout }: { count: number; disabled: boolean; onStart(): void; onLayout(event: LayoutChangeEvent): void }) {
    const styles = useThemedStyles(sheets);
    const insets = useSafeAreaInsets();
    return <View style={[styles.footer, { paddingBottom: ds.space.lg + insets.bottom }]} onLayout={onLayout}>
        <Text accessibilityLiveRegion="polite">{t('chatDepth.selected', { count, max: MAX_SELECTED_SKILLS })}</Text>
        {count >= MAX_SELECTED_SKILLS ? <Text variant="caption">{t('skillsUi.limit', { max: MAX_SELECTED_SKILLS })}</Text> : null}
        <Button label={t('chatDepth.startSkills')} disabled={disabled} onPress={onStart} />
    </View>;
}
const sheets = themedStyles(p => ({
    accentInk: { color: p.accent }, screen: { flex: 1, backgroundColor: p.bg },
    list: { padding: ds.space.lg, gap: ds.space.md }, hero: { gap: ds.space.md, paddingVertical: ds.space.lg }, center: { textAlign: 'center' },
    pill: { alignSelf: 'flex-start', borderRadius: ds.radius.pill, backgroundColor: p.surface, padding: ds.space.sm },
    group: { gap: ds.space.sm }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, half: { width: '48.7%' }, full: { width: '100%' },
    error: { margin: ds.space.lg },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: ds.space.lg, gap: ds.space.sm, backgroundColor: p.bgElevated1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.borderSubtle },
}));
