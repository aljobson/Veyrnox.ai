import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { HeaderAction } from '../../../components/HeaderAction';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { cleanProjectName, createProject, fetchProjects, fetchWorkspaces, projectsErrorMessage, type Project, type Workspace } from '../../../lib/projects';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

export default function Projects() {
    const { api } = useAuth();
    const router = useRouter();
    const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
    const [workspaceId, setWorkspaceId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [naming, setNaming] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    // One key per attempt: tapping Create twice, or retrying after a dropped connection, makes one project.
    const createKey = useRef<string | null>(null);

    async function create() {
        const name = cleanProjectName(newName);
        if (!name || !workspaceId || creating) return setFormError('Give the project a name of up to 120 characters.');
        setCreating(true);
        setFormError(null);
        createKey.current ??= Crypto.randomUUID();
        try {
            const made = await createProject(api, workspaceId, name, createKey.current);
            createKey.current = null;
            setNaming(false);
            setNewName('');
            if (made) router.push({ pathname: '/projects/[id]', params: { id: made.id } });
        } catch (err) {
            setFormError(projectsErrorMessage(err));
        } finally {
            setCreating(false);
        }
    }

    const loadWorkspaces = useCallback(async () => {
        setProblem(null);
        try {
            const list = await fetchWorkspaces(api);
            setWorkspaces(list);
            setWorkspaceId((cur) => cur ?? (list.find((w) => w.isDefault) ?? list[0])?.id ?? null);
        } catch (err) {
            setProblem(projectsErrorMessage(err));
        }
    }, [api]);

    useEffect(() => {
        void loadWorkspaces();
    }, [loadWorkspaces]);

    useEffect(() => {
        if (!workspaceId) return;
        let cancelled = false;
        setProjects(null);
        fetchProjects(api, workspaceId).then(
            (list) => !cancelled && setProjects(list),
            (err) => !cancelled && setProblem(projectsErrorMessage(err)),
        );
        return () => {
            cancelled = true;
        };
    }, [api, workspaceId]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Projects', ...(EDITOR_ENABLED ? { headerRight: () => <HeaderAction label={t('editor.new')} onPress={() => router.push('/editor/new')} /> } : {}) }} />
            {problem ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={loadWorkspaces}>
                    <Text style={styles.error}>{problem} Tap to retry.</Text>
                </Pressable>
            ) : !workspaces ? (
                <ActivityIndicator color={colors.accent} />
            ) : workspaces.length === 0 ? (
                <Text style={styles.muted}>You have no workspaces yet. Open the editor on veyrnox.ai to start one.</Text>
            ) : (
                <>
                    {workspaces.length > 1 ? (
                        <View style={styles.chips}>
                            {workspaces.map((w) => (
                                <Pressable key={w.id} accessibilityRole="button" accessibilityState={{ selected: w.id === workspaceId }} style={[styles.chip, w.id === workspaceId && styles.chipOn]} onPress={() => setWorkspaceId(w.id)}>
                                    <Text style={[styles.chipText, w.id === workspaceId && styles.chipTextOn]}>{w.name}</Text>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                    {naming ? (
                        <View style={styles.newBox}>
                            <TextInput
                                style={styles.input}
                                value={newName}
                                onChangeText={setNewName}
                                placeholder="Project name"
                                placeholderTextColor={colors.muted}
                                accessibilityLabel="Project name"
                                maxLength={120}
                                autoFocus
                                returnKeyType="done"
                                onSubmitEditing={create}
                            />
                            <Pressable accessibilityRole="button" disabled={creating} style={[styles.go, touchTarget, creating && styles.off]} onPress={create}>
                                <Text style={styles.goText}>{creating ? '…' : 'Create'}</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <Pressable accessibilityRole="button" style={[styles.newRow, touchTarget]} onPress={() => setNaming(true)}>
                            <Text style={styles.newText}>+ New project</Text>
                        </Pressable>
                    )}
                    {formError ? <Text style={styles.error} accessibilityRole="alert">{formError}</Text> : null}
                    {!projects ? (
                        <ActivityIndicator color={colors.accent} />
                    ) : (
                        <FlatList
                            data={projects}
                            keyExtractor={(p) => p.id}
                            ListEmptyComponent={<Text style={styles.muted}>No projects in this workspace yet.</Text>}
                            ListFooterComponent={<Text style={styles.note}>Open a project to rename it, delete it or restore a saved version. Editing the timeline is in the editor.</Text>}
                            renderItem={({ item }) => (
                                <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, version ${item.version}`} style={styles.row} onPress={() => router.push({ pathname: '/projects/[id]', params: { id: item.id } })}>
                                    <Text style={styles.name}>{item.name}</Text>
                                    <Text style={styles.muted}>Version {item.version}{item.updatedAt ? ` · updated ${new Date(item.updatedAt).toLocaleDateString()}` : ''}</Text>
                                </Pressable>
                            )}
                        />
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    row: { minHeight: 56, justifyContent: 'center', paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted },
    note: { color: colors.muted, fontSize: 13, paddingVertical: 20 },
    error: { color: colors.danger },
    newRow: { alignSelf: 'flex-start', justifyContent: 'center' },
    newText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    newBox: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
    go: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
    goText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
});
