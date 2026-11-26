import { rawText } from '../../../lib/i18n/translate';
import { directionalStyle } from '../../../lib/rtl';
import { Button, Card, Text, themedStyles, useThemedStyles, useAppearance } from '../../../components/ui';
import { LoadingSkeleton } from '../../../components/LoadingSkeleton';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { useAssetLinks } from '../../../components/JobThumb';
import { ProjectThumb } from '../../../components/CreationThumbs';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { formatLocale, t } from '../../../lib/i18n';
import { MENU_ICONS } from '../../../lib/menuIcons';
import { fetchProjects, fetchWorkspaces, projectSavedAt, projectsErrorMessage, projectVersion, type Project, type Workspace } from '../../../lib/projects';
import { projectsChangedGeneration, subscribeProjectsChanged } from '../../../lib/projectsChanged';
import { SmartCutBatchSheet } from '../../../components/projects/SmartCutBatchSheet';
import { ds } from '../../../theme';

const newestFirst = (items: readonly Project[]): Project[] => [...items].sort((a, b) => {
    const aSaved = projectSavedAt(a);
    const bSaved = projectSavedAt(b);
    const aTime = aSaved ? Date.parse(aSaved) : 0;
    const bTime = bSaved ? Date.parse(bSaved) : 0;
    return bTime - aTime || projectVersion(b) - projectVersion(a) || a.name.localeCompare(b.name);
});

export default function EditorHome() {
    const styles = useThemedStyles(sheets);
    const { scheme } = useAppearance();
    const { api } = useAuth();
    const links = useAssetLinks(api);
    const router = useRouter();
    const params = useLocalSearchParams<{ batch?: string }>();
    const openedBatchParam = useRef(false);
    const selectedWorkspace = useRef<string | null>(null);
    const request = useRef(0);
    const loadedOnce = useRef(false);
    const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
    const [workspaceId, setWorkspaceId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [batchOpen, setBatchOpen] = useState(false);

    useEffect(() => {
        if (params.batch === '1' && !openedBatchParam.current) {
            openedBatchParam.current = true;
            setBatchOpen(true);
        }
    }, [params.batch]);

    const load = useCallback(async (requestedWorkspace?: string, keepRows = false) => {
        const currentRequest = ++request.current;
        const startedAt = projectsChangedGeneration();
        setProblem(null);
        // Keep the rows on screen when coming back to the tab or re-fetching; only a first load or a workspace switch starts empty.
        if ((requestedWorkspace && !keepRows) || !loadedOnce.current) setProjects(null);
        try {
            const spaces = await fetchWorkspaces(api);
            if (currentRequest !== request.current) return;
            const preferred = requestedWorkspace ?? selectedWorkspace.current;
            const selected = spaces.find((item) => item.id === preferred) ?? spaces.find((item) => item.isDefault) ?? spaces[0] ?? null;
            selectedWorkspace.current = selected?.id ?? null;
            setWorkspaces(spaces);
            setWorkspaceId(selected?.id ?? null);
            if (!selected) {
                setProjects([]);
                return;
            }
            let list = await fetchProjects(api, selected.id);
            if (currentRequest !== request.current) return;
            // A save finished while this fetch was in flight: it may have missed it, so fetch once more (rows stay on screen).
            if (projectsChangedGeneration() !== startedAt) {
                list = await fetchProjects(api, selected.id);
                if (currentRequest !== request.current) return;
            }
            loadedOnce.current = true;
            setProjects(newestFirst(list));
        } catch (error) {
            if (currentRequest === request.current) {
                setProblem(projectsErrorMessage(error));
                // A quiet refresh that fails keeps the rows already shown and just offers the retry.
                if (!(keepRows && loadedOnce.current)) setProjects([]);
            }
        }
    }, [api]);

    useFocusEffect(useCallback(() => {
        if (!EDITOR_ENABLED) return undefined;
        void load();
        // A save, create or rename that lands while this tab is showing refreshes the list quietly.
        const unsubscribe = subscribeProjectsChanged(() => { void load(selectedWorkspace.current ?? undefined, true); });
        return () => { unsubscribe(); request.current += 1; };
    }, [load]));

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('editor.title') }} />
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <FlatList
                data={EDITOR_ENABLED ? projects ?? [] : []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshing={EDITOR_ENABLED && projects === null && workspaces !== null}
                onRefresh={EDITOR_ENABLED ? () => { void load(workspaceId ?? undefined); } : undefined}
                ListHeaderComponent={
                    <View style={styles.header}>
                        <View style={styles.intro}>
                            <Text variant="caption" style={styles.eyebrow}>{t('editor.home.eyebrow')}</Text>
                            <Text variant="display" style={styles.heading} accessibilityRole="header">{t('editor.title')}</Text>
                            <Text variant="body" style={styles.summary}>{t('editor.home.summary')}</Text>
                        </View>
                        {EDITOR_ENABLED ? <Button label={t('editor.new')} variant="primary"
                            accessibilityRole="button"
                            accessibilityLabel={t('editor.new')}
                            accessibilityHint={t('editor.home.newHint')}
                            style={styles.primary}
                            onPress={() => router.push({ pathname: '/editor/new', params: { blank: '1', add: '1' } })}
                        >
                            <View style={styles.primaryIconBox}>
                                <Image source={MENU_ICONS.slate} style={styles.primaryIcon} tintColor={styles.onAccentInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                            </View>
                            <View style={styles.primaryCopy}>
                                <Text variant="bodyStrong" style={styles.primaryTitle}>{t('editor.new')}</Text>
                                <Text variant="footnote" style={styles.primaryBody}>{t('editor.home.newBody')}</Text>
                            </View>
                            <Image source={MENU_ICONS.caretRight} style={[styles.caret, directionalStyle()]} tintColor={styles.onAccentInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                        </Button> : null}
                        {EDITOR_ENABLED && workspaces && workspaces.length > 1 ? (
                            <View style={styles.chips} accessibilityRole="tablist">
                                {workspaces.map((workspace) => (
                                    <Button label={workspace.name} containerStyle={{ maxWidth: '100%' }} variant="tertiary"
                                        key={workspace.id}
                                        accessibilityRole="tab"
                                        accessibilityState={{ selected: workspace.id === workspaceId }}
                                        style={[styles.chip, workspace.id === workspaceId && styles.chipOn]}
                                        onPress={() => { selectedWorkspace.current = workspace.id; void load(workspace.id); }}
                                    >
                                        <Text variant="bodyStrong" style={[styles.chipText, workspace.id === workspaceId && styles.chipTextOn]} numberOfLines={1}>{workspace.name}</Text>
                                    </Button>
                                ))}
                            </View>
                        ) : null}
                        {EDITOR_ENABLED ? <View style={styles.sectionTop}>
                            <Text variant="footnote" accessibilityRole="header" style={styles.sectionTitle}>{t('editor.home.recent')}</Text>
                            <View style={styles.sectionActions}>
                                <Button label="Batch AI Edit" variant="tertiary" accessibilityRole="button" onPress={() => setBatchOpen(true)}><Text variant="bodyStrong" style={styles.allProjects}>Batch AI Edit</Text></Button>
                                <Button label={t('editor.home.allProjects')} variant="tertiary" accessibilityRole="button" onPress={() => router.push('/projects')}><Text variant="bodyStrong" style={styles.allProjects}>{t('editor.home.allProjects')}</Text></Button>
                            </View>
                        </View> : null}
                        {EDITOR_ENABLED && problem ? (
                            <Button label={t('editor.home.retry')} variant="tertiary" accessibilityRole="button" accessibilityLabel={t('editor.home.retry')} style={styles.problem} onPress={() => { void load(workspaceId ?? undefined); }}>
                                <Text style={styles.error}>{problem}</Text>
                                <Text variant="bodyStrong" style={styles.retry}>{t('editor.home.retry')}</Text>
                            </Button>
                        ) : EDITOR_ENABLED && projects === null ? <View style={styles.loading}><LoadingSkeleton label={t('editor.home.loading')} variant="list" /></View> : null}
                    </View>
                }
                ListEmptyComponent={EDITOR_ENABLED && projects !== null && !problem ? (
                    <View style={styles.empty}>
                        <Text variant="bodyStrong" style={styles.emptyTitle}>{workspaces?.length ? t('editor.home.empty') : t('editor.home.noWorkspace')}</Text>
                        <Text variant="footnote" style={styles.emptyBody}>{workspaces?.length ? t('editor.home.emptyBody') : t('editor.home.noWorkspaceBody')}</Text>
                    </View>
                ) : undefined}
                renderItem={({ item }) => (
                    <Card
                        accessibilityRole="button"
                        accessibilityLabel={rawText(t('editor.home.openProject', { name: item.name }))}
                        accessibilityHint={t('editor.home.openHint')}
                        style={[styles.project]}
                        onPress={() => router.push({ pathname: '/editor/[projectId]', params: { projectId: item.id } })}
                    >
                        <ProjectThumb api={api} links={links} projectId={item.id} size={44} />
                        <View style={styles.projectCopy}>
                            <Text variant="bodyStrong" style={styles.projectName} numberOfLines={1}>{item.name}</Text>
                            <Text variant="footnote" style={styles.projectMeta}>{t('editor.home.version', { version: String(projectVersion(item)) })}{projectSavedAt(item) ? ` · ${new Date(projectSavedAt(item) as string).toLocaleString(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</Text>
                        </View>
                        <Image source={MENU_ICONS.caretRight} style={[styles.caret, directionalStyle()]} tintColor={styles.mutedInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                    </Card>
                )}
            />
            {EDITOR_ENABLED && workspaceId && projects ? <SmartCutBatchSheet visible={batchOpen} workspaceId={workspaceId} projects={projects} router={router} onClose={() => setBatchOpen(false)} /> : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    mutedInk: { color: p.textSecondary },
    onAccentInk: { color: p.onAccent },
    screen: { flex: 1, backgroundColor: p.bg },
    list: { paddingHorizontal: ds.space.gutter, paddingTop: ds.space.xxl, paddingBottom: ds.space.huge, gap: ds.space.md },
    header: { gap: 16 },
    intro: { gap: ds.space.sm },
    eyebrow: { color: p.textSecondary },
    heading: { color: p.textPrimary },
    summary: { color: p.textSecondary, maxWidth: 520 },
    primary: { minHeight: 82, paddingVertical: ds.space.md },
    primaryIconBox: { width: 44, height: 44, borderRadius: ds.radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentPressed },
    primaryIcon: { width: 24, height: 24 },
    primaryCopy: { flex: 1, gap: 2 },
    primaryTitle: { color: p.onAccent },
    primaryBody: { color: p.onAccent, opacity: 0.82 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: ds.space.md, borderRadius: 999, backgroundColor: p.surface, borderColor: p.borderSubtle, borderWidth: 1 },
    chipOn: { backgroundColor: p.accentSubtle, borderColor: p.accent },
    chipText: { color: p.textSecondary },
    chipTextOn: { color: p.accent },
    sectionTop: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    sectionTitle: { color: p.textSecondary },
    allProjects: { color: p.accent },
    project: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: ds.radius.md, backgroundColor: p.surface, borderColor: p.borderSubtle, borderWidth: 1 },
    projectIconBox: { width: 42, height: 42, borderRadius: ds.radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSubtle },
    projectIcon: { width: 22, height: 22 },
    projectCopy: { flex: 1, gap: ds.space.xs },
    projectName: { color: p.textPrimary },
    projectMeta: { color: p.textSecondary },
    caret: { width: 16, height: 16 },
    // Holds about two project rows (70 + gap each) so the list arriving does not push the page down under a finger.
    loading: { paddingVertical: 20, minHeight: 152, justifyContent: 'center' },
    problem: { minHeight: 44, flexDirection: 'column', justifyContent: 'center', gap: 4, paddingVertical: 8 },
    error: { color: p.danger },
    retry: { color: p.accent },
    empty: { marginTop: 8, padding: ds.space.xxl, gap: ds.space.sm, borderRadius: ds.radius.md, borderColor: p.borderSubtle, borderWidth: 1, borderStyle: 'dashed', backgroundColor: p.surface },
    emptyTitle: { color: p.textPrimary, textAlign: 'center' },
    emptyBody: { color: p.textSecondary, textAlign: 'center' },
}));
