import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi, type ChatThread } from '../../../lib/chat';
import { colors } from '../../../theme';

export default function Threads() {
    const { api } = useAuth();
    const router = useRouter();
    const [threads, setThreads] = useState<ChatThread[] | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            setThreads(await chatApi(api).listThreads());
        } catch {
            setFailed(true);
        }
    }, [api]);

    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Chats' }} />
            <Link href="/chat/new" asChild>
                <Pressable accessibilityRole="button" style={styles.newButton}>
                    <Text style={styles.newText}>New chat</Text>
                </Pressable>
            </Link>
            {failed ? (
                <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={load}>
                    <Text style={styles.error}>Could not load your chats. Tap to retry.</Text>
                </Pressable>
            ) : threads === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={threads}
                    keyExtractor={(t) => t.id}
                    ListEmptyComponent={<Text style={styles.muted}>No chats yet.</Text>}
                    renderItem={({ item }) => (
                        <Pressable
                            accessibilityRole="button"
                            style={styles.row}
                            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
                        >
                            <Text style={styles.rowTitle} numberOfLines={1}>
                                {item.title || 'New chat'}
                            </Text>
                            <Text style={styles.muted}>{item.model_id}</Text>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    newButton: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    newText: { color: colors.accentInk, fontWeight: '600', fontSize: 16 },
    row: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted },
    error: { color: colors.danger },
});
