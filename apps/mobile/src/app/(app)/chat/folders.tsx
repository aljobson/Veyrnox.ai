import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { chatLibraryErrorMessage, createFolder, deleteFolder, fetchFolders, renameFolder, validateFolderName, type Folder } from '../../../lib/chatLibrary';
import { Text, TextField, Button, Card, themedStyles, useThemedStyles } from '../../../components/ui';

export default function Folders() {
    const styles = useThemedStyles(sheets);
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
                <TextField containerStyle={styles.field} accessibilityLabel={editing ? 'New folder name' : 'Folder name'} style={styles.input} value={name} onChangeText={setName} placeholder={editing ? `Rename "${editing.name}"` : 'New folder'} maxLength={60} />
                <Button accessibilityRole="button" disabled={busy} containerStyle={styles.button} onPress={save} variant="secondary" size="md" label={(editing ? 'Rename' : 'Add')}>
                    {busy ? <ActivityIndicator color={styles.accentInkInk.color} /> : <Text variant="bodyStrong" style={styles.buttonText}>{editing ? 'Rename' : 'Add'}</Text>}
                </Button>
            </View>
            {editing ? <Button accessibilityRole="button" onPress={() => { setEditing(null); setName(''); }} variant="secondary" size="md" label={"Cancel rename"}><Text style={styles.link}>Cancel rename</Text></Button> : null}
            {problem ? <Text style={styles.error}>{problem}</Text> : null}
            {folders === null && !problem ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <FlatList keyboardShouldPersistTaps="handled"
                    data={folders ?? []}
                    keyExtractor={(f) => f.id}
                    ListEmptyComponent={<Text style={styles.muted}>No folders yet.</Text>}
                    renderItem={({ item }) => (
                        <Card style={styles.row}>
                            <View style={styles.text}>
                                <Text variant="body" style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted}>{item.count} {item.count === 1 ? 'chat' : 'chats'}</Text>
                            </View>
                            <Button accessibilityRole="button" accessibilityLabel={`Rename ${item.name}`} containerStyle={styles.action} onPress={() => { setEditing(item); setName(item.name); }} variant="tertiary" size="md" label={`Rename ${item.name}`}><Text style={styles.link}>Rename</Text></Button>
                            <Button accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} containerStyle={styles.action} onPress={() => remove(item)} variant="tertiary" size="md" label={`Delete ${item.name}`}><Text style={styles.danger}>Delete</Text></Button>
                        </Card>
                    )}
                />
            )}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    field: { flex: 1 },
    accentInk: { color: p.accent },
    accentInkInk: { color: p.textPrimary },
    screen: { flex: 1, backgroundColor: p.bg, padding: 16, gap: 12 },
    form: { flexDirection: 'row', gap: 8 },
    input: { minHeight: 48 },
    button: { justifyContent: 'center', minHeight: 48 },
    buttonText: { color: p.textPrimary },
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, borderBottomColor: p.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth },
    text: { flex: 1, gap: 2 },
    name: { color: p.textPrimary },
    action: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
    link: { color: p.accent },
    danger: { color: p.danger },
    muted: { color: p.textTertiary },
    error: { color: p.danger },
}));
