import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { PRIVACY_EMAIL } from '../../lib/account';
import { blockerText, confirmDeletion, prepareDeletion, type Forfeit, type Prepared } from '../../lib/accountDeletion';
import { colors } from '../../theme';

const CONFIRM_WORD = 'DELETE';

type View_ = { readonly step: 'loading' } | { readonly step: 'prepared'; readonly result: Prepared } | { readonly step: 'erasing' };

export default function DeleteAccount() {
    const { api, signOut } = useAuth();
    const router = useRouter();
    const [view, setView] = useState<View_>({ step: 'loading' });
    const [typed, setTyped] = useState('');
    const [note, setNote] = useState<string | null>(null);
    const [forfeit, setForfeit] = useState<Forfeit>({ credits: 0, freeCredits: 0 });

    const prepare = useCallback(async () => {
        setView({ step: 'loading' });
        setTyped('');
        const result = await prepareDeletion(api);
        if (result.kind === 'ready' || result.kind === 'blocked') setForfeit(result.forfeit);
        setView({ step: 'prepared', result });
    }, [api]);

    useEffect(() => {
        void prepare();
    }, [prepare]);

    async function erase(token: string) {
        setNote(null);
        setView({ step: 'erasing' });
        const out = await confirmDeletion(api, token);
        if (out.kind === 'deleted') {
            // The server has removed the sign-in; this only clears what the app holds.
            await signOut().catch(() => undefined);
            router.replace('/sign-in');
            return;
        }
        if (out.kind === 'expired') {
            setNote('That took too long. Please confirm again.');
            await prepare();
            return;
        }
        if (out.kind === 'retry') {
            setNote('Your data is erased but finishing took a moment. Tap delete again to finish.');
        } else if (out.kind === 'blocked') {
            setNote(out.blockers.map(blockerText).join('\n'));
        } else {
            setNote('Could not delete your account. Nothing was lost; try again.');
        }
        setView({ step: 'prepared', result: { kind: 'ready', forfeit, token } });
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: 'Delete account' }} />
            {view.step === 'loading' || view.step === 'erasing' ? (
                <View style={styles.center}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.body}>{view.step === 'loading' ? 'Checking your account…' : 'Deleting…'}</Text>
                </View>
            ) : (
                <Prepared_ result={view.result} typed={typed} setTyped={setTyped} note={note} onErase={erase} onRetry={prepare} />
            )}
        </ScrollView>
    );
}

interface PreparedProps {
    readonly result: Prepared;
    readonly typed: string;
    readonly setTyped: (v: string) => void;
    readonly note: string | null;
    readonly onErase: (token: string) => void;
    readonly onRetry: () => void;
}

function Prepared_({ result, typed, setTyped, note, onErase, onRetry }: PreparedProps) {
    if (result.kind === 'unavailable') {
        return (
            <>
                <Text style={styles.body}>Deleting your account from the app is not available yet.</Text>
                <Text style={styles.body}>Email {PRIVACY_EMAIL} from your account address and we will delete it.</Text>
            </>
        );
    }
    if (result.kind === 'rate_limited') {
        return <Text style={styles.body}>You have asked too many times. Try again in about {Math.ceil(result.retryAfterSeconds / 60)} minutes.</Text>;
    }
    if (result.kind === 'failed') {
        return (
            <>
                <Text style={styles.error}>Could not check your account. Nothing was changed.</Text>
                <Pressable accessibilityRole="button" style={styles.secondary} onPress={onRetry}>
                    <Text style={styles.secondaryText}>Try again</Text>
                </Pressable>
            </>
        );
    }
    if (result.kind === 'blocked') {
        return (
            <>
                <Text style={styles.title} accessibilityRole="header">Not yet</Text>
                <Text style={styles.body}>Something on your account has to be sorted first:</Text>
                {result.blockers.map((code) => (
                    <Text key={code} style={styles.blocker}>
                        {blockerText(code)}
                    </Text>
                ))}
                <Text style={styles.small}>Questions: {PRIVACY_EMAIL}</Text>
            </>
        );
    }
    const ok = typed.trim() === CONFIRM_WORD;
    return (
        <>
            <Text style={styles.title} accessibilityRole="header">Delete your account?</Text>
            <Forfeits forfeit={result.forfeit} />
            <Text style={styles.body}>
                This erases your account and what is stored with it. It cannot be undone. Records we must keep by law, such as payment records, are kept.
            </Text>
            <Text style={styles.body}>
                If you subscribed in the App Store or Google Play, deleting your account does not cancel it. Cancel in the store first.
            </Text>
            <Text style={styles.label}>Type {CONFIRM_WORD} to confirm</Text>
            <TextInput
                accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder={CONFIRM_WORD}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={typed}
                onChangeText={setTyped}
            />
            {note ? <Text style={styles.error}>{note}</Text> : null}
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !ok }}
                disabled={!ok}
                style={[styles.danger, !ok && styles.off]}
                onPress={() => onErase(result.token)}
            >
                <Text style={styles.dangerText}>Delete my account</Text>
            </Pressable>
        </>
    );
}

function Forfeits({ forfeit }: { forfeit: Forfeit }) {
    if (forfeit.credits <= 0) return null;
    return (
        <Text style={styles.forfeit}>
            You will lose {forfeit.credits} credits{forfeit.freeCredits > 0 ? ` (${forfeit.freeCredits} of them free)` : ''}. They are not refunded.
        </Text>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    center: { alignItems: 'center', gap: 12, paddingTop: 48 },
    title: { color: colors.text, fontSize: 24, fontWeight: '700' },
    body: { color: colors.body, fontSize: 16 },
    small: { color: colors.muted, fontSize: 13 },
    label: { color: colors.muted, fontSize: 14, marginTop: 8 },
    forfeit: { color: colors.money, fontSize: 16, fontWeight: '600' },
    blocker: { color: colors.text, fontSize: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, color: colors.text, fontSize: 16 },
    error: { color: colors.danger },
    secondary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    secondaryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    danger: { marginTop: 8, backgroundColor: colors.danger, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    dangerText: { color: colors.background, fontSize: 16, fontWeight: '700' },
    off: { opacity: 0.4 },
});
