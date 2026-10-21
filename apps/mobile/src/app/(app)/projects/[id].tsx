import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { fetchHistory, fetchProject, mergeVersions, projectsErrorMessage, versionLabel, type Project, type Version } from '../../../lib/projects';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

export default function ProjectDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [project, setProject] = useState<Project | null>(null);
    const [versions, setVersions] = useState<Version[] | null>(null);
    const [next, setNext] = useState<number | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const loadingMore = useRef(false);

    const load = useCallback(async () => {
        setProblem(null);
        try {
            const [p, h] = await Promise.all([fetchProject(api, String(id)), fetchHistory(api, String(id))]);
            setProject(p);
            setVersions(h.versions);
            setNext(h.nextBefore);
        } catch (err) {
            setProblem(projectsErrorMessage(err));
        }
    }, [api, id]);

    useEffect(() => {
        void load();
    }, [load]);

    async function more() {
        if (next === null || loadingMore.current || !versions) return;
        loadingMore.current = true;
        try {
            const h = await fetchHistory(api, String(id), next);
            const merged = mergeVersions(versions, h.versions);
            setVersions(merged.versions);
            // A page that adds nothing stops paging, even if a server ignored the cursor.
            setNext(merged.added ? h.nextBefore : null);
        } catch {
            setNext(null);
        } finally {
            loadingMore.current = false;
        }
    }

    if (problem) return <View style={styles.screen}><Stack.Screen options={{ title: 'Project' }} /><Pressable accessibilityRole="button" style={touchTarget} onPress={load}><Text style={styles.error}>{problem} Tap to retry.</Text></Pressable></View>;
    if (!project || !versions) return <View style={styles.screen}><Stack.Screen options={{ title: 'Project' }} /><ActivityIndicator color={colors.accent} /></View>;

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: project.name }} />
            {EDITOR_ENABLED && <Pressable accessibilityRole="button" accessibilityLabel={t('editor.open')} style={touchTarget} onPress={() => router.push({ pathname: '/editor/[projectId]', params: { projectId: project.id } })}><Text style={styles.name}>{t('editor.open')}</Text></Pressable>}
            <Text style={styles.meta}>Version {project.version}{project.createdAt ? ` · created ${new Date(project.createdAt).toLocaleDateString()}` : ''}{project.updatedAt ? ` · updated ${new Date(project.updatedAt).toLocaleString()}` : ''}</Text>
            <Text style={styles.heading} accessibilityRole="header">Saved versions</Text>
            <FlatList
                data={versions}
                keyExtractor={(v) => String(v.revision)}
                onEndReached={more}
                onEndReachedThreshold={0.4}
                ListEmptyComponent={<Text style={styles.muted}>No saved versions yet.</Text>}
                ListFooterComponent={<Text style={styles.note}>Open the editor on veyrnox.ai to change this project or restore a version.</Text>}
                renderItem={({ item }) => (
                    <View style={styles.row} accessible accessibilityLabel={versionLabel(item)}>
                        <Text style={styles.name}>{versionLabel(item)}</Text>
                        {item.createdAt ? <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString()}</Text> : null}
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 10 },
    meta: { color: colors.body },
    heading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginTop: 8 },
    row: { minHeight: 52, justifyContent: 'center', paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    note: { color: colors.muted, fontSize: 13, paddingVertical: 20 },
    error: { color: colors.danger },
});
