import { rawText } from '../../../lib/i18n/translate';
import { plural, t } from '../../../lib/i18n';
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
        Alert.alert(t('chat.delete', { value1: f.name }), t('chat.itschatsstaywithnofolder'), [
            { text: t('chat.keepit'), style: 'cancel' },
            {
                text: t('chat.deletefolder'),
                style: 'destructive',
                onPress: () => {
                    deleteFolder(api, f.id).then(load, (err) => setProblem(chatLibraryErrorMessage(err)));
                },
            },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('chat.folders') }} />
            <View style={styles.form}>
                <TextField containerStyle={styles.field} accessibilityLabel={rawText(editing ? t('chat.newfoldername') : t('chat.foldername'))} style={styles.input} value={name} onChangeText={setName} placeholder={editing ? t('chat.rename2', { value1: editing.name }) : t('chat.newfolder')} maxLength={60} />
                <Button accessibilityRole="button" disabled={busy} containerStyle={styles.button} onPress={save} variant="secondary" size="md" label={(editing ? t('chat.rename3') : t('chat.add'))}>
                    {busy ? <ActivityIndicator color={styles.accentInkInk.color} /> : <Text variant="bodyStrong" style={styles.buttonText}>{editing ? t('chat.rename3') : t('chat.add')}</Text>}
                </Button>
            </View>
            {editing ? <Button accessibilityRole="button" onPress={() => { setEditing(null); setName(''); }} variant="secondary" size="md" label={t('chat.cancelrename')}><Text style={styles.link}>{t('chat.cancelrename')}</Text></Button> : null}
            {problem ? <Text style={styles.error}>{problem}</Text> : null}
            {folders === null && !problem ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : (
                <FlatList keyboardShouldPersistTaps="handled"
                    data={folders ?? []}
                    keyExtractor={(f) => f.id}
                    ListEmptyComponent={folders ? <Text style={styles.muted}>{t('chat.nofoldersyet')}</Text> : undefined}
                    renderItem={({ item }) => (
                        <Card style={styles.row}>
                            <View style={styles.text}>
                                <Text variant="body" style={styles.name}>{item.name}</Text>
                                <Text style={styles.muted}>{plural('chat.folderCount', item.count)}</Text>
                            </View>
                            <Button accessibilityRole="button" accessibilityLabel={rawText(t('chat.rename4', { value1: item.name }))} containerStyle={styles.action} onPress={() => { setEditing(item); setName(item.name); }} variant="tertiary" size="md" label={t('chat.rename4', { value1: item.name })}><Text style={styles.link}>{t('chat.rename3')}</Text></Button>
                            <Button accessibilityRole="button" accessibilityLabel={rawText(t('chat.delete2', { value1: item.name }))} containerStyle={styles.action} onPress={() => remove(item)} variant="tertiary" size="md" label={t('chat.delete2', { value1: item.name })}><Text style={styles.danger}>{t('chat.delete3')}</Text></Button>
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
