import { rawText } from '../../../lib/i18n/translate';
import { directionalStyle } from '../../../lib/rtl';
import { Button, Card, Text, themedStyles, useThemedStyles, useAppearance } from '../../../components/ui';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { formatLocale, t } from '../../../lib/i18n';
import { MENU_ICONS } from '../../../lib/menuIcons';
import { fetchProjects, fetchWorkspaces, projectsErrorMessage, type Project, type Workspace } from '../../../lib/projects';

const newestFirst = (items: readonly Project[]): Project[] => [...items].sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime || b.version - a.version || a.name.localeCompare(b.name);
});

export default function EditorHome() {
    const styles = useThemedStyles(sheets);
    const { scheme } = useAppearance();
    const { api } = useAuth();
    const router = useRouter();
    const selectedWorkspace = useRef<string | null>(null);
    const request = useRef(0);
    const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
    const [workspaceId, setWorkspaceId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    const load = useCallback(async (requestedWorkspace?: string) => {
        const currentRequest = ++request.current;
        setProblem(null);
        setProjects(null);
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
            const list = await fetchProjects(api, selected.id);
            if (currentRequest === request.current) setProjects(newestFirst(list));
        } catch (error) {
            if (currentRequest === request.current) {
                setProblem(projectsErrorMessage(error));
                setProjects([]);
            }
        }
    }, [api]);

    useFocusEffect(useCallback(() => {
        if (EDITOR_ENABLED) void load();
        return () => { request.current += 1; };
    }, [load]));

    if (!EDITOR_ENABLED) {
        return (
            <View style={styles.screen}>
                <Stack.Screen options={{ title: t('editor.title') }} />
                <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
                <View style={styles.unavailable}>
                    <Image source={MENU_ICONS.slate} style={styles.heroIcon} tintColor={styles.mutedInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                    <Text variant="bodyStrong" style={styles.emptyTitle}>{t('editor.unavailable')}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('editor.title') }} />
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <FlatList
                data={projects ?? []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshing={projects === null && workspaces !== null}
                onRefresh={() => { void load(workspaceId ?? undefined); }}
                ListHeaderComponent={
                    <View style={styles.header}>
                        <View style={styles.intro}>
                            <Text variant="caption" style={styles.eyebrow}>{t('editor.home.eyebrow')}</Text>
                            <Text variant="display" style={styles.heading} accessibilityRole="header">{t('editor.title')}</Text>
                            <Text variant="body" style={styles.summary}>{t('editor.home.summary')}</Text>
                        </View>
                        <Button label={t('editor.new')} variant="primary"
                            accessibilityRole="button"
                            accessibilityLabel={t('editor.new')}
                            accessibilityHint={t('editor.home.newHint')}
                            style={styles.primary}
                            onPress={() => router.push({ pathname: '/editor/new', params: { blank: '1' } })}
                        >
                            <View style={styles.primaryIconBox}>
                                <Image source={MENU_ICONS.slate} style={styles.primaryIcon} tintColor={styles.onAccentInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                            </View>
                            <View style={styles.primaryCopy}>
                                <Text variant="bodyStrong" style={styles.primaryTitle}>{t('editor.new')}</Text>
                                <Text variant="footnote" style={styles.primaryBody}>{t('editor.home.newBody')}</Text>
                            </View>
                            <Image source={MENU_ICONS.caretRight} style={[styles.caret, directionalStyle()]} tintColor={styles.onAccentInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                        </Button>
                        {workspaces && workspaces.length > 1 ? (
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
                        <View style={styles.sectionTop}>
                            <Text variant="footnote" accessibilityRole="header" style={styles.sectionTitle}>{t('editor.home.recent')}</Text>
                            <Button label={t('editor.home.allProjects')} variant="tertiary" accessibilityRole="button" onPress={() => router.push('/projects')}>
                                <Text variant="bodyStrong" style={styles.allProjects}>{t('editor.home.allProjects')}</Text>
                            </Button>
                        </View>
                        {problem ? (
                            <Button label={t('editor.home.retry')} variant="tertiary" accessibilityRole="button" accessibilityLabel={t('editor.home.retry')} style={styles.problem} onPress={() => { void load(workspaceId ?? undefined); }}>
                                <Text style={styles.error}>{problem}</Text>
                                <Text variant="bodyStrong" style={styles.retry}>{t('editor.home.retry')}</Text>
                            </Button>
                        ) : projects === null ? <ActivityIndicator color={styles.accentInk.color} style={styles.loading} /> : null}
                    </View>
                }
                ListEmptyComponent={projects !== null && !problem ? (
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
                        <View style={styles.projectIconBox}>
                            <Image source={MENU_ICONS.slate} style={styles.projectIcon} tintColor={styles.accentInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                        </View>
                        <View style={styles.projectCopy}>
                            <Text variant="bodyStrong" style={styles.projectName} numberOfLines={1}>{item.name}</Text>
                            <Text variant="footnote" style={styles.projectMeta}>{t('editor.home.version', { version: String(item.version) })}{item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleDateString(formatLocale())}` : ''}</Text>
                        </View>
                        <Image source={MENU_ICONS.caretRight} style={[styles.caret, directionalStyle()]} tintColor={styles.mutedInk.color} contentFit="contain" alt="" accessibilityElementsHidden />
                    </Card>
                )}
            />
        </View>
    );
}

const sheets = themedStyles((p) => ({
    mutedInk: { color: p.textSecondary },
    accentInk: { color: p.accent },
    onAccentInk: { color: p.onAccent },
    screen: { flex: 1, backgroundColor: p.bg },
    list: { padding: 16, paddingTop: 24, paddingBottom: 40, gap: 10 },
    header: { gap: 16 },
    intro: { gap: 6 },
    eyebrow: { color: p.textSecondary },
    heading: { color: p.textPrimary },
    summary: { color: p.textSecondary, maxWidth: 520 },
    primary: { minHeight: 82, paddingVertical: 14 },
    primaryIconBox: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentPressed },
    primaryIcon: { width: 24, height: 24 },
    primaryCopy: { flex: 1, gap: 2 },
    primaryTitle: { color: p.onAccent },
    primaryBody: { color: p.onAccent, opacity: 0.82 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: p.surface, borderColor: p.borderSubtle, borderWidth: 1 },
    chipOn: { backgroundColor: p.accentSubtle, borderColor: p.accent },
    chipText: { color: p.textSecondary },
    chipTextOn: { color: p.accent },
    sectionTop: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    sectionTitle: { color: p.textSecondary },
    allProjects: { color: p.accent },
    project: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 15, backgroundColor: p.surface, borderColor: p.borderSubtle, borderWidth: 1 },
    projectIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSubtle },
    projectIcon: { width: 22, height: 22 },
    projectCopy: { flex: 1, gap: 3 },
    projectName: { color: p.textPrimary },
    projectMeta: { color: p.textSecondary },
    caret: { width: 16, height: 16 },
    loading: { paddingVertical: 20 },
    problem: { minHeight: 44, flexDirection: 'column', justifyContent: 'center', gap: 4, paddingVertical: 8 },
    error: { color: p.danger },
    retry: { color: p.accent },
    empty: { marginTop: 8, padding: 22, gap: 6, borderRadius: 16, borderColor: p.borderSubtle, borderWidth: 1, borderStyle: 'dashed', backgroundColor: p.surface },
    unavailable: { flex: 1, padding: 24, gap: 12, alignItems: 'center', justifyContent: 'center' },
    heroIcon: { width: 42, height: 42 },
    emptyTitle: { color: p.textPrimary, textAlign: 'center' },
    emptyBody: { color: p.textSecondary, textAlign: 'center' },
}));
