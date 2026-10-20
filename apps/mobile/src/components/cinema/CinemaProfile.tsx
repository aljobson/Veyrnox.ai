import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { PassCard } from './PassCard';
import { MIN_TARGET } from '../../lib/a11y';
import { bioOk, BIO_MAX, createProfile, creatorErrorKey, fetchApplication, fetchProfile, nameOk, NAME_MAX, STATEMENT_MAX, STATEMENT_MIN, statementOk, submitApplication, usernameOk, type Application, type Profile } from '../../lib/cinemaCreator';
import { readOf, type Read } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// The Cinema profile tab: make a profile (username, display name, bio), see it, and apply to become a creator. Both
// parts are off in production, so each shows a closed message. There is no upload or creator workspace in the app yet.
export function CinemaProfile() {
    const { api } = useAuth();
    const [profile, setProfile] = useState<Read<Profile | null> | null>(null);
    const load = useCallback(async () => {
        setProfile(null);
        setProfile(await readOf(() => fetchProfile(api)));
    }, [api]);
    useEffect(() => { void load(); }, [load]);

    if (!profile) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
    if (profile.kind === 'closed') return <View style={styles.center}><Text style={styles.muted}>{t('cinemaCreator.closed.profile')}</Text></View>;
    if (profile.kind === 'error') return <Pressable accessibilityRole="button" style={styles.center} onPress={load}><Text style={styles.error}>{t(profile.key)} {t('cinemaSocial.tapRetry')}</Text></Pressable>;
    return (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <PassCard />
                {profile.value ? <><ProfileCard profile={profile.value} /><Apply /></> : <NewProfile onDone={load} />}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function ProfileCard({ profile }: { profile: Profile }) {
    return (
        <View style={styles.card}>
            <Text style={styles.heading} accessibilityRole="header">{profile.displayName}</Text>
            <Text style={styles.handle}>@{profile.username}</Text>
            {profile.bio ? <Text style={styles.body}>{profile.bio}</Text> : null}
            <Text style={styles.muted}>{t(profile.role === 'creator' ? 'cinemaCreator.roleCreator' : 'cinemaCreator.roleViewer')}</Text>
        </View>
    );
}

function NewProfile({ onDone }: { onDone: () => void }) {
    const { api } = useAuth();
    const [username, setUsername] = useState('');
    const [name, setName] = useState('');
    const [bio, setBio] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    // One key per exact form: a retry after a network error is one profile, not two.
    const attempt = useRef<{ sig: string; key: string } | null>(null);
    const valid = usernameOk(username) && nameOk(name) && bioOk(bio);
    async function save() {
        const sig = `${username}\n${name}\n${bio}`;
        if (attempt.current?.sig !== sig) attempt.current = { sig, key: Crypto.randomUUID() };
        setBusy(true);
        setNote(null);
        try {
            await createProfile(api, { username, displayName: name, bio }, attempt.current.key);
            onDone();
        } catch (err) {
            setNote(t(creatorErrorKey(err)));
            setBusy(false);
        }
    }
    return (
        <View style={styles.form}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinemaCreator.newProfile')}</Text>
            <Text style={styles.muted}>{t('cinemaCreator.newProfileIntro')}</Text>
            <Text style={styles.label}>{t('cinemaCreator.username')}</Text>
            <TextInput accessibilityLabel={t('cinemaCreator.username')} style={styles.input} value={username} onChangeText={(v) => setUsername(v.toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={30} />
            <Text style={styles.hint}>{t('cinemaCreator.usernameHint')}</Text>
            <Text style={styles.label}>{t('cinemaCreator.displayName')}</Text>
            <TextInput accessibilityLabel={t('cinemaCreator.displayName')} style={styles.input} value={name} onChangeText={setName} maxLength={NAME_MAX} />
            <Text style={styles.label}>{t('cinemaCreator.bio')}</Text>
            <TextInput accessibilityLabel={t('cinemaCreator.bio')} style={[styles.input, styles.multi]} value={bio} onChangeText={setBio} maxLength={BIO_MAX} multiline />
            {note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !valid }} disabled={busy || !valid} style={[styles.button, (busy || !valid) && styles.off]} onPress={save}>
                {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('cinemaCreator.createProfile')}</Text>}
            </Pressable>
        </View>
    );
}

function Apply() {
    const { api } = useAuth();
    const [app, setApp] = useState<Read<Application | null> | null>(null);
    const [statement, setStatement] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const key = useRef<{ text: string; key: string } | null>(null);
    const load = useCallback(async () => setApp(await readOf(() => fetchApplication(api))), [api]);
    useEffect(() => { void load(); }, [load]);

    async function submit() {
        const text = statement.trim();
        if (key.current?.text !== text) key.current = { text, key: Crypto.randomUUID() };
        setBusy(true);
        setNote(null);
        try {
            await submitApplication(api, text, key.current.key);
            await load();
        } catch (err) {
            setNote(t(creatorErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }
    if (!app || app.kind === 'closed') return null;
    if (app.kind === 'error') return <Pressable accessibilityRole="button" style={styles.retry} onPress={load}><Text style={styles.error}>{t(app.key)} {t('cinemaSocial.tapRetry')}</Text></Pressable>;
    if (app.value) {
        return (
            <View style={styles.card}>
                <Text style={styles.heading} accessibilityRole="header">{t('cinemaCreator.applyTitle')}</Text>
                <Text style={styles.body} accessibilityRole="text">{t(`cinemaCreator.status.${app.value.status}`)}</Text>
                <Text style={styles.muted}>{app.value.statement}</Text>
            </View>
        );
    }
    const left = STATEMENT_MAX - [...statement].length;
    return (
        <View style={styles.form}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinemaCreator.applyTitle')}</Text>
            <Text style={styles.muted}>{t('cinemaCreator.applyIntro')}</Text>
            <TextInput accessibilityLabel={t('cinemaCreator.statement')} style={[styles.input, styles.multi]} value={statement} onChangeText={setStatement} maxLength={STATEMENT_MAX} multiline />
            <Text style={styles.hint}>{t('cinemaCreator.statementHint', { min: STATEMENT_MIN, left })}</Text>
            {note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !statementOk(statement) }} disabled={busy || !statementOk(statement)} style={[styles.button, (busy || !statementOk(statement)) && styles.off]} onPress={submit}>
                {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('cinemaCreator.apply')}</Text>}
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 16, gap: 20 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
    form: { gap: 8 },
    heading: { color: colors.text, fontSize: 20, fontWeight: '700' },
    handle: { color: colors.accent },
    body: { color: colors.body, fontSize: 16 },
    muted: { color: colors.muted },
    label: { color: colors.text, fontWeight: '600', marginTop: 4 },
    hint: { color: colors.muted, fontSize: 13 },
    input: { minHeight: MIN_TARGET, color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
    multi: { minHeight: 110, textAlignVertical: 'top' },
    button: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 12 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    off: { opacity: 0.5 },
    error: { color: colors.danger },
    retry: { minHeight: MIN_TARGET, justifyContent: 'center' },
});
