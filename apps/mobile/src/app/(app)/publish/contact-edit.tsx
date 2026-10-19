import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { STATUSES, contactsErrorKey, fetchContacts, parseTags, saveContact, validateEdit, type Contact, type Subscription } from '../../../lib/publishContacts';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function ContactEdit() {
    const api = usePublishApi();
    const router = useRouter();
    const { accountId, externalId } = useLocalSearchParams<{ accountId?: string; externalId?: string }>();
    const [contact, setContact] = useState<Contact | null>(null);
    const [canEdit, setCanEdit] = useState(false);
    const [tags, setTags] = useState('');
    const [status, setStatus] = useState<Subscription>('unknown');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchContacts(api)
            .then((r) => {
                if (cancelled) return;
                const c = r.contacts.find((x) => x.accountId === accountId && x.externalId === externalId);
                if (!c) {
                    setProblem(t('contacts.err.gone'));
                    return;
                }
                setContact(c);
                setCanEdit(r.canEdit);
                setTags(c.tags.join(', '));
                setStatus(c.status);
                setNotes(c.notes);
            })
            .catch((err) => !cancelled && setProblem(t(contactsErrorKey(err))));
        return () => {
            cancelled = true;
        };
    }, [api, accountId, externalId]);

    async function save() {
        if (!contact || busy) return;
        const invalid = validateEdit(tags, notes);
        if (invalid) {
            setProblem(t(invalid));
            return;
        }
        setBusy(true);
        setProblem(null);
        try {
            await saveContact(api, contact, parseTags(tags).tags, status, notes);
            router.back();
        } catch (err) {
            setProblem(t(contactsErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    if (!contact) return <View style={styles.screen}><Stack.Screen options={{ title: t('contacts.edit') }} />{problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : <ActivityIndicator color={colors.accent} />}</View>;

    return (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: contact.name }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.muted}>{contact.network} · {contact.accountName}</Text>
                <Text style={styles.muted}>{t('contacts.counts', { messages: contact.messages, unread: contact.unread })}</Text>
                <Text style={styles.label} accessibilityRole="header">{t('contacts.subscription')}</Text>
                <View style={styles.chips}>
                    {STATUSES.map((s) => (
                        <Pressable key={s} disabled={!canEdit} accessibilityRole="button" accessibilityState={{ selected: status === s, disabled: !canEdit }} style={[styles.chip, touchTarget, status === s && styles.chipOn]} onPress={() => setStatus(s)}>
                            <Text style={[styles.chipText, status === s && styles.chipTextOn]}>{t(`contacts.status.${s}`)}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={styles.label}>{t('contacts.tags')}</Text>
                <TextInput editable={canEdit} style={styles.input} value={tags} onChangeText={setTags} autoCapitalize="none" accessibilityLabel={t('contacts.tags')} placeholderTextColor={colors.muted} />
                <Text style={styles.muted}>{t('contacts.tagsHint')}</Text>
                <Text style={styles.label}>{t('contacts.notes')}</Text>
                <TextInput editable={canEdit} style={[styles.input, styles.multi]} multiline value={notes} onChangeText={setNotes} maxLength={2000} accessibilityLabel={t('contacts.notes')} placeholderTextColor={colors.muted} />
                {!canEdit ? <Text style={styles.muted}>{t('contacts.readOnly')}</Text> : null}
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                {canEdit ? (
                    <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('contacts.save')}</Text>}
                    </Pressable>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
    body: { padding: 16, paddingBottom: VEY_CLEARANCE, gap: 8 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    multi: { minHeight: 100 },
    muted: { color: colors.muted, fontSize: 13 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});
