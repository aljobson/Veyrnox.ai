import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi } from '../../../lib/chat';
import { chatLibraryErrorMessage, fetchFolders, moveThread, type Folder } from '../../../lib/chatLibrary';
import { colors } from '../../../theme';

// Files one chat into a folder, or takes it out. Reached from the chat's header.
export default function MoveToFolder() {
    const { threadId } = useLocalSearchParams<{ threadId: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [folders, setFolders] = useState<Folder[] | null>(null);
    const [current, setCurrent] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        Promise.all([fetchFolders(api), chatApi(api).listThreads()])
            .then(([f, threads]) => {
                setFolders(f);
                setCurrent(threads.find((t) => t.id === threadId)?.folder_id ?? null);
            })
            .catch((err) => setProblem(chatLibraryErrorMessage(err)));
    }, [api, threadId]);

    async function choose(folderId: string | null) {
        if (busy || !threadId) return;
        setBusy(true);
        try {
            await moveThread(api, String(threadId), folderId);
            router.back();
        } catch (err) {
            setProblem(chatLibraryErrorMessage(err));
            setBusy(false);
        }
    }

    const rows: { id: string | null; name: string }[] = [{ id: null, name: 'No folder' }, ...(folders ?? []).map((f) => ({ id: f.id, name: f.name }))];
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Move to folder' }} />
            {problem ? <Text style={styles.error}>{problem}</Text> : null}
            {!folders && !problem ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={(r) => r.id ?? 'none'}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" accessibilityState={{ selected: item.id === current, disabled: busy }} style={styles.row} onPress={() => choose(item.id)}>
                            <Text style={styles.name}>{item.name}</Text>
                            {item.id === current ? <Text style={styles.on}>Current</Text> : null}
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    row: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    name: { color: colors.text, fontSize: 16 },
    on: { color: colors.accent },
    error: { color: colors.danger },
});
