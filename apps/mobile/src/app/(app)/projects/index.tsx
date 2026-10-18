import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { fetchProjects, fetchWorkspaces, projectsErrorMessage, type Project, type Workspace } from '../../../lib/projects';
import { colors } from '../../../theme';

export default function Projects() {
    const { api } = useAuth();
    const router = useRouter();
    const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
    const [workspaceId, setWorkspaceId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

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
            <Stack.Screen options={{ title: 'Projects' }} />
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
                    {!projects ? (
                        <ActivityIndicator color={colors.accent} />
                    ) : (
                        <FlatList
                            data={projects}
                            keyExtractor={(p) => p.id}
                            ListEmptyComponent={<Text style={styles.muted}>No projects in this workspace yet.</Text>}
                            ListFooterComponent={<Text style={styles.note}>Projects are made and edited in the editor on veyrnox.ai. Here you can look at them and their saved versions.</Text>}
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
});
