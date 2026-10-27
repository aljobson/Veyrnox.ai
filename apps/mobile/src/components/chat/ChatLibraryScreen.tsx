import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { chatApi, pinnedFirst, searchThreads, type ChatThread } from '../../lib/chat';
import { fetchFolders, type Folder } from '../../lib/chatLibrary';
import { t } from '../../lib/i18n';

import { Text, TextField, Button, Card, Chip, Icon, themedStyles, useThemedStyles } from '../ui';
import { radius } from '../../theme';

export function ChatLibraryScreen() {
    const styles = useThemedStyles(sheets);
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
            <Stack.Screen options={{ title: t('chat.yourchats') }} />
            <View style={styles.intro}>
                <Text variant="caption" style={styles.eyebrow}>{t('chat.lLMChat')}</Text>
                <Text variant="display" accessibilityRole="header" style={styles.hero}>{t('chat.yourworkspace')}</Text>
                <Text variant="callout" style={styles.heroHelp}>{t('chat.jumpbackintoanideaorstart')}</Text>
            </View>
            <Link href="/chat/new" asChild>
                <Button accessibilityRole="button" containerStyle={styles.newButton} variant="secondary" size="md" label={t('chat.newchat')}><Icon name="plus" size={20} /><Text variant="bodyStrong" style={styles.newText}>{t('chat.newchat')}</Text></Button>
            </Link>
            <View style={styles.links}>
                <Button accessibilityRole="button" containerStyle={styles.linkBox} onPress={() => router.push('/chat/personas')} variant="tertiary" size="md" label={t('chat.personas')}><Text variant="callout" style={styles.link}>{t('chat.personas')}</Text></Button>
                <Button accessibilityRole="button" containerStyle={styles.linkBox} onPress={() => router.push('/chat/folders')} variant="tertiary" size="md" label={t('chat.folders')}><Text variant="callout" style={styles.link}>{t('chat.folders')}</Text></Button>
            </View>
            <TextField style={styles.search} value={query} onChangeText={setQuery} placeholder={t('chat.search.placeholder')} accessibilityLabel={t('chat.search.label')} autoCorrect={false} clearButtonMode="while-editing" />
            {folders.length > 0 ? (
                <View style={styles.chips}>
                    {[{ id: undefined, name: t('chat.all') }, { id: null, name: t('chat.nofolder') }, ...folders.map((folder) => ({ id: folder.id as string | null | undefined, name: folder.name }))].map((chip) => (
                        <Chip key={String(chip.id ?? chip.name)} accessibilityRole="button" accessibilityState={{ selected: filter === chip.id }} onPress={() => setFilter(chip.id)} label={(chip.name)} selected={filter === chip.id} />
                    ))}
                </View>
            ) : null}
            {failed ? (
                <Button accessibilityRole="button" containerStyle={styles.retry} onPress={load} variant="tertiary" size="md" label={t('chat.couldnotloadyourchatsTapto')}><Text style={styles.error}>{t('chat.couldnotloadyourchatsTapto')}</Text></Button>
            ) : threads === null ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <FlatList
                    data={shown}
                    keyExtractor={(thread) => thread.id}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={<Text style={styles.muted}>{query.trim() && (threads ?? []).length > 0 ? t('chat.search.none') : t('chat.nochatsyet')}</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.itemRow}>
                            <Card accessibilityRole="button" style={[styles.row, styles.rowMain]} onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: item.id } })}>
                                <View style={styles.badge}><Icon name="chat" /></View>
                                <View style={styles.rowText}>
                                    <Text variant="bodyStrong" style={styles.rowTitle} numberOfLines={1}>{item.pinned ? `${t('chat.pinned')} · ` : ''}{item.title || t('chat.newchat')}</Text>
                                    <Text style={styles.muted} numberOfLines={1}>{item.model_id}</Text>
                                </View>
                            </Card>
                            <Button accessibilityRole="button" accessibilityLabel={t('chat.delete.label', { name: item.title || t('chat.newChatFallback') })} containerStyle={styles.deleteButton} onPress={() => confirmDelete(item)} variant="tertiary" size="md" label={t('chat.delete.label', { name: item.title || t('chat.newChatFallback') })}>
                                <Text style={styles.deleteText}>{t('chat.delete.button')}</Text>
                            </Button>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg, padding: 16, gap: 12 },
    intro: { paddingTop: 4, gap: 4 },
    eyebrow: { color: p.accent },
    hero: { color: p.textPrimary },
    heroHelp: { color: p.textTertiary, maxWidth: 330 },
    newButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
    newText: { color: p.textPrimary },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
    badge: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { color: p.textPrimary },
    muted: { color: p.textTertiary },
    search: { minHeight: 46 },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
    rowMain: { flex: 1 },
    deleteButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
    deleteText: { color: p.danger },
    error: { color: p.danger },
    links: { flexDirection: 'row', gap: 16 },
    linkBox: { minHeight: 44, justifyContent: 'center' },
    link: { color: p.accent },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    retry: { minHeight: 44, justifyContent: 'center' },
    list: { paddingBottom: 24 },
}));
