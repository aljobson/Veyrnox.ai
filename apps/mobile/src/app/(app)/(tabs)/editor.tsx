import { Image } from 'expo-image';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { t } from '../../../lib/i18n';
import { MENU_ICONS } from '../../../lib/menuIcons';
import { fetchProjects, fetchWorkspaces, projectsErrorMessage, type Project, type Workspace } from '../../../lib/projects';
import { colors, fonts, isDark } from '../../../theme';

const newestFirst = (items: readonly Project[]): Project[] => [...items].sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime || b.version - a.version || a.name.localeCompare(b.name);
});

export default function EditorHome() {
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
                <StatusBar style={isDark ? 'light' : 'dark'} />
                <View style={styles.unavailable}>
                    <Image source={MENU_ICONS.slate} style={styles.heroIcon} tintColor={colors.muted} contentFit="contain" alt="" accessibilityElementsHidden />
                    <Text style={styles.emptyTitle}>{t('editor.unavailable')}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('editor.title') }} />
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <FlatList
                data={projects ?? []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshing={projects === null && workspaces !== null}
                onRefresh={() => { void load(workspaceId ?? undefined); }}
                ListHeaderComponent={
                    <View style={styles.header}>
                        <View style={styles.intro}>
                            <Text style={styles.eyebrow}>{t('editor.home.eyebrow')}</Text>
                            <Text style={styles.heading} accessibilityRole="header">{t('editor.title')}</Text>
                            <Text style={styles.summary}>{t('editor.home.summary')}</Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('editor.new')}
                            accessibilityHint={t('editor.home.newHint')}
                            style={({ pressed }) => [styles.primary, touchTarget, pressed && styles.pressed]}
                            onPress={() => router.push({ pathname: '/editor/new', params: { blank: '1' } })}
                        >
                            <View style={styles.primaryIconBox}>
                                <Image source={MENU_ICONS.slate} style={styles.primaryIcon} tintColor={colors.accentInk} contentFit="contain" alt="" accessibilityElementsHidden />
                            </View>
                            <View style={styles.primaryCopy}>
                                <Text style={styles.primaryTitle}>{t('editor.new')}</Text>
                                <Text style={styles.primaryBody}>{t('editor.home.newBody')}</Text>
                            </View>
                            <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.accentInk} contentFit="contain" alt="" accessibilityElementsHidden />
                        </Pressable>
                        {workspaces && workspaces.length > 1 ? (
                            <View style={styles.chips} accessibilityRole="tablist">
                                {workspaces.map((workspace) => (
                                    <Pressable
                                        key={workspace.id}
                                        accessibilityRole="tab"
                                        accessibilityState={{ selected: workspace.id === workspaceId }}
                                        style={[styles.chip, workspace.id === workspaceId && styles.chipOn]}
                                        onPress={() => { selectedWorkspace.current = workspace.id; void load(workspace.id); }}
                                    >
                                        <Text style={[styles.chipText, workspace.id === workspaceId && styles.chipTextOn]} numberOfLines={1}>{workspace.name}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        ) : null}
                        <View style={styles.sectionTop}>
                            <Text style={styles.sectionTitle}>{t('editor.home.recent')}</Text>
                            <Pressable accessibilityRole="button" style={touchTarget} onPress={() => router.push('/projects')}>
                                <Text style={styles.allProjects}>{t('editor.home.allProjects')}</Text>
                            </Pressable>
                        </View>
                        {problem ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={t('editor.home.retry')} style={[styles.problem, touchTarget]} onPress={() => { void load(workspaceId ?? undefined); }}>
                                <Text style={styles.error}>{problem}</Text>
                                <Text style={styles.retry}>{t('editor.home.retry')}</Text>
                            </Pressable>
                        ) : projects === null ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
                    </View>
                }
                ListEmptyComponent={projects !== null && !problem ? (
                    <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>{workspaces?.length ? t('editor.home.empty') : t('editor.home.noWorkspace')}</Text>
                        <Text style={styles.emptyBody}>{workspaces?.length ? t('editor.home.emptyBody') : t('editor.home.noWorkspaceBody')}</Text>
                    </View>
                ) : undefined}
                renderItem={({ item }) => (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('editor.home.openProject', { name: item.name })}
                        accessibilityHint={t('editor.home.openHint')}
                        style={({ pressed }) => [styles.project, pressed && styles.pressed]}
                        onPress={() => router.push({ pathname: '/editor/[projectId]', params: { projectId: item.id } })}
                    >
                        <View style={styles.projectIconBox}>
                            <Image source={MENU_ICONS.slate} style={styles.projectIcon} tintColor={colors.accent} contentFit="contain" alt="" accessibilityElementsHidden />
                        </View>
                        <View style={styles.projectCopy}>
                            <Text style={styles.projectName} numberOfLines={1}>{item.name}</Text>
                            <Text style={styles.projectMeta}>{t('editor.home.version', { version: String(item.version) })}{item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleDateString()}` : ''}</Text>
                        </View>
                        <Image source={MENU_ICONS.caretRight} style={styles.caret} tintColor={colors.muted} contentFit="contain" alt="" accessibilityElementsHidden />
                    </Pressable>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, paddingTop: 24, paddingBottom: 40, gap: 10 },
    header: { gap: 16 },
    intro: { gap: 6 },
    eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
    heading: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 40, lineHeight: 42, letterSpacing: -1.2 },
    summary: { color: colors.body, fontSize: 16, lineHeight: 24, maxWidth: 520 },
    primary: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.accent },
    primaryIconBox: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.22)' },
    primaryIcon: { width: 24, height: 24 },
    primaryCopy: { flex: 1, gap: 2 },
    primaryTitle: { color: colors.accentInk, fontSize: 17, fontWeight: '800' },
    primaryBody: { color: colors.accentInk, fontSize: 13, lineHeight: 18, opacity: 0.82 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accent },
    sectionTop: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    sectionTitle: { color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
    allProjects: { color: colors.accent, fontWeight: '700' },
    project: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 15, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    projectIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    projectIcon: { width: 22, height: 22 },
    projectCopy: { flex: 1, gap: 3 },
    projectName: { color: colors.text, fontSize: 16, fontWeight: '700' },
    projectMeta: { color: colors.muted, fontSize: 12 },
    caret: { width: 16, height: 16 },
    pressed: { opacity: 0.76, transform: [{ scale: 0.992 }] },
    loading: { paddingVertical: 20 },
    problem: { justifyContent: 'center', gap: 4, paddingVertical: 8 },
    error: { color: colors.danger },
    retry: { color: colors.accent, fontWeight: '700' },
    empty: { marginTop: 8, padding: 22, gap: 6, borderRadius: 16, borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed', backgroundColor: colors.surface },
    unavailable: { flex: 1, padding: 24, gap: 12, alignItems: 'center', justifyContent: 'center' },
    heroIcon: { width: 42, height: 42 },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    emptyBody: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
