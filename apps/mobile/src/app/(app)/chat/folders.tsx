import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatLibraryErrorMessage, createFolder, deleteFolder, fetchFolders, renameFolder, validateFolderName, type Folder } from '../../../lib/chatLibrary';
import { colors } from '../../../theme';

export default function Folders() {
    const { api } = useAuth();
    const [folders, setFolders] = useState<Folder[] | null>(null);
    const [name, setName] = useState('');
    const [editing, setEditing] = useState<Folder | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setFolders(await fetchFolders(api));
            setProblem(null);
        } catch (err) {
            setProblem(chatLibraryErrorMessage(err));
        }
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);

    async function save() {
        const checked = validateFolderName(name);
        if (!checked.ok) return setProblem(checked.message);
        setBusy(true);
        try {
            if (editing) await renameFolder(api, editing.id, checked.value);
            else await createFolder(api, checked.value);
            setName('');
            setEditing(null);
            await load();
        } catch (err) {
            setProblem(chatLibraryErrorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    function remove(f: Folder) {
        Alert.alert(`Delete "${f.name}"?`, 'Its chats stay, with no folder.', [
            { text: 'Keep it', style: 'cancel' },
            {
                text: 'Delete folder',
                style: 'destructive',
                onPress: () => {
                    deleteFolder(api, f.id).then(load, (err) => setProblem(chatLibraryErrorMessage(err)));
                },
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Folders' }} />
            <View style={styles.form}>
                <TextInput accessibilityLabel={editing ? 'New folder name' : 'Folder name'} style={styles.input} value={name} onChangeText={setName} placeholder={editing ? `Rename "${editing.name}"` : 'New folder'} placeholderTextColor={colors.muted} maxLength={60} />
                <Pressable accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{editing ? 'Rename' : 'Add'}</Text>}
                </Pressable>
            </View>
            {editing ? <Pressable accessibilityRole="button" onPress={() => { setEditing(null); setName(''); }}><Text style={styles.link}>Cancel rename</Text></Pressable> : null}
            {problem ? <Text style={styles.error}>{problem}</Text> : null}
            {folders === null && !problem ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={folders ?? []}
                    keyExtractor={(f) => f.id}
                    ListEmptyComponent={<Text style={styles.muted}>No folders yet.</Text>}
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <View style={styles.text}>
                                <Text style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted}>{item.count} {item.count === 1 ? 'chat' : 'chats'}</Text>
                            </View>
                            <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${item.name}`} style={styles.action} onPress={() => { setEditing(item); setName(item.name); }}><Text style={styles.link}>Rename</Text></Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} style={styles.action} onPress={() => remove(item)}><Text style={styles.danger}>Delete</Text></Pressable>
                        </View>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    form: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center', minHeight: 48 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    text: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    action: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 6 },
    link: { color: colors.accent },
    danger: { color: colors.danger },
    muted: { color: colors.muted },
    error: { color: colors.danger },
});
