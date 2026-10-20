import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatApi, pinnedFirst, searchThreads, type ChatThread } from '../../../lib/chat';
import { fetchFolders, type Folder } from '../../../lib/chatLibrary';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

export default function Threads() {
    const { api } = useAuth();
    const router = useRouter();
    const [threads, setThreads] = useState<ChatThread[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [query, setQuery] = useState('');
    // undefined shows every chat; null shows chats in no folder; an id shows that folder.
    const [filter, setFilter] = useState<string | null | undefined>(undefined);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            setThreads(await chatApi(api).listThreads());
            // Folders are an extra: a failure here never hides the chats.
            fetchFolders(api).then(setFolders, () => undefined);
        } catch {
            setFailed(true);
        }
    }, [api]);

    const shown = useMemo(() => searchThreads(pinnedFirst(threads ?? []).filter((t) => filter === undefined || (t.folder_id ?? null) === filter), query), [threads, filter, query]);

    // Deleting a chat removes it and its messages; the credits it used stay spent (ADR-0067). It asks first.
    function confirmDelete(thread: ChatThread) {
        Alert.alert(t('chat.delete.title'), t('chat.delete.body'), [
            { text: t('chat.delete.keep'), style: 'cancel' },
            {
                text: t('chat.delete.confirm'),
                style: 'destructive',
                onPress: async () => {
                    try {
                        await chatApi(api).deleteThread(thread.id);
                        setThreads((cur) => (cur ?? []).filter((x) => x.id !== thread.id));
                    } catch {
                        Alert.alert(t('chat.delete.failed'));
                    }
                },
            },
        ]);
    }

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
            <View style={styles.links}>
                <Pressable accessibilityRole="button" style={styles.linkBox} onPress={() => router.push('/chat/personas')}><Text style={styles.link}>Personas</Text></Pressable>
                <Pressable accessibilityRole="button" style={styles.linkBox} onPress={() => router.push('/chat/folders')}><Text style={styles.link}>Folders</Text></Pressable>
            </View>
            <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder={t('chat.search.placeholder')} accessibilityLabel={t('chat.search.label')} placeholderTextColor={colors.muted} autoCorrect={false} clearButtonMode="while-editing" />
            {folders.length > 0 ? (
                <View style={styles.chips}>
                    {[{ id: undefined, name: 'All' }, { id: null, name: 'No folder' }, ...folders.map((f) => ({ id: f.id as string | null | undefined, name: f.name }))].map((c) => (
                        <Pressable key={String(c.id ?? c.name)} accessibilityRole="button" accessibilityState={{ selected: filter === c.id }} style={[styles.chip, filter === c.id && styles.chipOn]} onPress={() => setFilter(c.id)}>
                            <Text style={[styles.chipText, filter === c.id && styles.chipTextOn]}>{c.name}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {failed ? (
                <Pressable accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={load}>
                    <Text style={styles.error}>Could not load your chats. Tap to retry.</Text>
                </Pressable>
            ) : threads === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={shown}
                    keyExtractor={(t) => t.id}
                    ListEmptyComponent={<Text style={styles.muted}>{query.trim() && (threads ?? []).length > 0 ? t('chat.search.none') : 'No chats yet.'}</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.itemRow}>
                            <Pressable
                                accessibilityRole="button"
                                style={[styles.row, styles.rowMain]}
                                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
                            >
                                <Text style={styles.rowTitle} numberOfLines={1}>
                                    {item.pinned ? `${t('chat.pinned')} · ` : ''}
                                    {item.title || 'New chat'}
                                </Text>
                                <Text style={styles.muted}>{item.model_id}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('chat.delete.label', { name: item.title || 'New chat' })} style={styles.del} onPress={() => confirmDelete(item)}>
                                <Text style={styles.delText}>{t('chat.delete.button')}</Text>
                            </Pressable>
                        </View>
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
    search: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
    itemRow: { flexDirection: 'row', alignItems: 'center' },
    rowMain: { flex: 1 },
    del: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
    delText: { color: colors.danger },
    error: { color: colors.danger },
    links: { flexDirection: 'row', gap: 16 },
    linkBox: { minHeight: 44, justifyContent: 'center' },
    link: { color: colors.accent, fontSize: 16 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
});
