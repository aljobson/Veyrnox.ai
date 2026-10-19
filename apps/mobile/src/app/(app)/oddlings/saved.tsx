import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { fileStore, loadDoc, removePassport, type Passport } from '../../../lib/oddlingsLibrary';
import { colors } from '../../../theme';

export default function SavedPassports() {
    const router = useRouter();
    const [items, setItems] = useState<readonly Passport[] | null>(null);

    useFocusEffect(useCallback(() => {
        let live = true;
        void loadDoc(fileStore).then((doc) => { if (live) setItems(doc.items); });
        return () => { live = false; };
    }, []));

    function confirmDelete(item: Passport) {
        Alert.alert(t('oddlings.saved.deleteTitle'), t('oddlings.saved.deleteBody'), [
            { text: t('oddlings.saved.cancel'), style: 'cancel' },
            { text: t('oddlings.saved.delete', { name: item.name }), style: 'destructive', onPress: () => { void removePassport(fileStore, item.id).then((doc) => setItems(doc.items)); } },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('oddlings.saved.title') }} />
            <FlatList
                data={items ?? []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                ListEmptyComponent={items ? <Text style={styles.empty}>{t('oddlings.saved.empty')}</Text> : undefined}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('oddlings.saved.edit', { name: item.name })} style={styles.main} onPress={() => router.push({ pathname: '/oddlings/build', params: { passport: item.id } })}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.sub} numberOfLines={2}>{item.picks.oddling_obsession || t('oddlings.saved.noPremise')}</Text>
                            <Text style={styles.date}>{new Date(item.savedAt).toLocaleString()}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('oddlings.saved.delete', { name: item.name })} style={styles.del} onPress={() => confirmDelete(item)}>
                            <Text style={styles.delText}>✕</Text>
                        </Pressable>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, paddingBottom: VEY_CLEARANCE + 16, gap: 12 },
    empty: { color: colors.muted, textAlign: 'center', padding: 24 },
    card: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    main: { flex: 1, padding: 14, minHeight: MIN_TARGET },
    name: { color: colors.text, fontSize: 17, fontWeight: '800' },
    sub: { color: colors.body, fontSize: 13, marginTop: 4 },
    date: { color: colors.muted, fontSize: 11, marginTop: 8 },
    del: { width: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    delText: { color: colors.danger, fontSize: 18 },
});
