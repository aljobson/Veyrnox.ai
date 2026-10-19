import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { STATUSES, contactsErrorKey, fetchContacts, type Contact, type Subscription } from '../../../lib/publishContacts';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function Contacts() {
    const api = usePublishApi();
    const router = useRouter();
    const [contacts, setContacts] = useState<Contact[] | null>(null);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<Subscription | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setContacts((await fetchContacts(api, { search, status })).contacts);
            setError(null);
        } catch (err) {
            setContacts(null);
            setError(t(contactsErrorKey(err)));
        }
    }, [api, search, status]);

    useFocusEffect(useCallback(() => { void load(); }, [load]));

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('contacts.title') }} />
            <TextInput style={styles.input} value={search} onChangeText={setSearch} onSubmitEditing={load} returnKeyType="search" placeholder={t('contacts.search')} accessibilityLabel={t('contacts.search')} autoCapitalize="none" placeholderTextColor={colors.muted} maxLength={100} />
            <View style={styles.chips}>
                {([null, ...STATUSES] as (Subscription | null)[]).map((s) => (
                    <Pressable key={s ?? 'all'} accessibilityRole="button" accessibilityState={{ selected: status === s }} style={[styles.chip, touchTarget, status === s && styles.chipOn]} onPress={() => setStatus(s)}>
                        <Text style={[styles.chipText, status === s && styles.chipTextOn]}>{t(s ? `contacts.status.${s}` : 'contacts.all')}</Text>
                    </Pressable>
                ))}
            </View>
            {error && !contacts ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !contacts ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={contacts}
                    keyExtractor={(c) => `${c.accountId}:${c.externalId}`}
                    contentContainerStyle={{ paddingBottom: VEY_CLEARANCE }}
                    refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
                    ListEmptyComponent={<Text style={styles.muted}>{t('contacts.none')}</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.network}, ${t(`contacts.status.${item.status}`)}`} style={[styles.row, touchTarget]} onPress={() => router.push({ pathname: '/publish/contact-edit', params: { accountId: item.accountId, externalId: item.externalId } })}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.muted}>{item.network} · {item.accountName} · {t(`contacts.status.${item.status}`)}</Text>
                            {item.tags.length ? <Text style={styles.tags}>{item.tags.join(', ')}</Text> : null}
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, gap: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48, marginTop: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    row: { paddingVertical: 10, gap: 2, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    tags: { color: colors.accent, fontSize: 13 },
    error: { color: colors.danger },
});
