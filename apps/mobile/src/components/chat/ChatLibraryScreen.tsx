import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { chatApi, pinnedFirst, searchThreads, type ChatThread } from '../../lib/chat';
import { fetchFolders, type Folder } from '../../lib/chatLibrary';
import { t } from '../../lib/i18n';
import { MENU_ICONS } from '../../lib/menuIcons';
import { colors, fonts, radius } from '../../theme';

export function ChatLibraryScreen() {
    const { api } = useAuth();
    const router = useRouter();
    const [threads, setThreads] = useState<ChatThread[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<string | null | undefined>(undefined);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            setThreads(await chatApi(api).listThreads());
            fetchFolders(api).then(setFolders, () => undefined);
        } catch {
            setFailed(true);
        }
    }, [api]);

    const shown = useMemo(() => searchThreads(pinnedFirst(threads ?? []).filter((thread) => filter === undefined || (thread.folder_id ?? null) === filter), query), [threads, filter, query]);

    function confirmDelete(thread: ChatThread) {
        Alert.alert(t('chat.delete.title'), t('chat.delete.body'), [
            { text: t('chat.delete.keep'), style: 'cancel' },
            {
                text: t('chat.delete.confirm'),
                style: 'destructive',
                onPress: async () => {
                    try {
                        await chatApi(api).deleteThread(thread.id);
                        setThreads((current) => (current ?? []).filter((candidate) => candidate.id !== thread.id));
                    } catch {
                        Alert.alert(t('chat.delete.failed'));
                    }
                },
            },
        ]);
    }

    useFocusEffect(useCallback(() => { void load(); }, [load]));

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Your chats' }} />
            <View style={styles.intro}>
                <Text style={styles.eyebrow}>LLM CHAT</Text>
                <Text accessibilityRole="header" style={styles.hero}>Your workspace</Text>
                <Text style={styles.heroHelp}>Jump back into an idea, or start with a clean conversation.</Text>
            </View>
            <Link href="/chat/new" asChild>
                <Pressable accessibilityRole="button" style={styles.newButton}><Text style={styles.newText}>＋ New chat</Text></Pressable>
            </Link>
            <View style={styles.links}>
                <Pressable accessibilityRole="button" style={styles.linkBox} onPress={() => router.push('/chat/personas')}><Text style={styles.link}>Personas</Text></Pressable>
                <Pressable accessibilityRole="button" style={styles.linkBox} onPress={() => router.push('/chat/folders')}><Text style={styles.link}>Folders</Text></Pressable>
            </View>
            <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder={t('chat.search.placeholder')} accessibilityLabel={t('chat.search.label')} placeholderTextColor={colors.muted} autoCorrect={false} clearButtonMode="while-editing" />
            {folders.length > 0 ? (
                <View style={styles.chips}>
                    {[{ id: undefined, name: 'All' }, { id: null, name: 'No folder' }, ...folders.map((folder) => ({ id: folder.id as string | null | undefined, name: folder.name }))].map((chip) => (
                        <Pressable key={String(chip.id ?? chip.name)} accessibilityRole="button" accessibilityState={{ selected: filter === chip.id }} style={[styles.chip, filter === chip.id && styles.chipOn]} onPress={() => setFilter(chip.id)}>
                            <Text style={[styles.chipText, filter === chip.id && styles.chipTextOn]}>{chip.name}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {failed ? (
                <Pressable accessibilityRole="button" style={styles.retry} onPress={load}><Text style={styles.error}>Could not load your chats. Tap to retry.</Text></Pressable>
            ) : threads === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={shown}
                    keyExtractor={(thread) => thread.id}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={<Text style={styles.muted}>{query.trim() && (threads ?? []).length > 0 ? t('chat.search.none') : 'No chats yet.'}</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.itemRow}>
                            <Pressable accessibilityRole="button" style={[styles.row, styles.rowMain]} onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: item.id } })}>
                                <View style={styles.badge}><Image source={MENU_ICONS.chat} style={styles.badgeIcon} tintColor={colors.accent} contentFit="contain" alt="" accessibilityElementsHidden /></View>
                                <View style={styles.rowText}>
                                    <Text style={styles.rowTitle} numberOfLines={1}>{item.pinned ? `${t('chat.pinned')} · ` : ''}{item.title || 'New chat'}</Text>
                                    <Text style={styles.muted} numberOfLines={1}>{item.model_id}</Text>
                                </View>
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('chat.delete.label', { name: item.title || 'New chat' })} style={styles.deleteButton} onPress={() => confirmDelete(item)}>
                                <Text style={styles.deleteText}>{t('chat.delete.button')}</Text>
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
    intro: { paddingTop: 4, gap: 4 },
    eyebrow: { color: colors.accent, fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.3 },
    hero: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 30, lineHeight: 34, letterSpacing: -1 },
    heroHelp: { color: colors.muted, fontSize: 14, lineHeight: 20, maxWidth: 330 },
    newButton: { minHeight: 52, backgroundColor: colors.accent, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    newText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    badge: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    badgeIcon: { width: 22, height: 22 },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted },
    search: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 46 },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
    rowMain: { flex: 1 },
    deleteButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
    deleteText: { color: colors.danger },
    error: { color: colors.danger },
    links: { flexDirection: 'row', gap: 16 },
    linkBox: { minHeight: 44, justifyContent: 'center' },
    link: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    retry: { minHeight: 44, justifyContent: 'center' },
    list: { paddingBottom: 24 },
});
