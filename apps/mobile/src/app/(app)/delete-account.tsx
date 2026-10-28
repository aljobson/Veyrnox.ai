import { isAccountChanged } from '../../auth/sessionTask';
import { t } from '../../lib/i18n';
import { english } from '../../lib/i18n/binding';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { PRIVACY_EMAIL } from '../../lib/account';
import { blockerText, confirmDeletion, prepareDeletion, type Forfeit, type Prepared } from '../../lib/accountDeletion';
import { colors, fonts } from '../../theme';

const CONFIRM_WORD = 'DELETE';

type View_ = { readonly step: 'loading' } | { readonly step: 'prepared'; readonly result: Prepared } | { readonly step: 'erasing' };

export default function DeleteAccount() {
    const { api, signOut, sessionGeneration, beginSessionTask } = useAuth();
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
        const task = beginSessionTask();
        try {
            setNote(null);
            setView({ step: 'erasing' });
            const out = await confirmDeletion(api, token);
            if (!task.current()) return;
            if (out.kind === 'deleted') {
                // The server has removed the sign-in; this only clears what the app holds.
                const done = signOut(task.gen);
                const ended = sessionGeneration();
                await done.catch(() => undefined);
                if (ended !== task.gen && sessionGeneration() === ended) router.replace('/sign-in');
                return;
            }
            if (out.kind === 'expired') {
                setNote(t('deleteaccount.thattooktoolongPleaseconfirmagain'));
                await prepare();
                return;
            }
            if (out.kind === 'retry') {
                setNote(t('deleteaccount.yourdataiserasedbutfinishingtook'));
            } else if (out.kind === 'blocked') {
                setNote(out.blockers.map(blockerText).join('\n'));
            } else {
                setNote(t('deleteaccount.couldnotdeleteyouraccountNothingwas'));
            }
            setView({ step: 'prepared', result: { kind: 'ready', forfeit, token } });
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            throw err;
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('deleteaccount.deleteaccount') }} />
            {view.step === 'loading' || view.step === 'erasing' ? (
                <View style={styles.center}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.body}>{view.step === 'loading' ? t('deleteaccount.checkingyouraccount') : t('deleteaccount.deleting')}</Text>
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
                <Text style={styles.body}>{t('deleteaccount.deletingyouraccountfromtheappis')}</Text>
                <Text style={styles.body}>{t('deleteaccount.emailfromyouraccountaddressandwe', { value1: PRIVACY_EMAIL })}</Text>
            </>
        );
    }
    if (result.kind === 'rate_limited') {
        return <Text style={styles.body}>{t('deleteaccount.youhaveaskedtoomanytimesTry', { value1: Math.ceil(result.retryAfterSeconds / 60) })}</Text>;
    }
    if (result.kind === 'failed') {
        return (
            <>
                <Text style={styles.error}>{t('deleteaccount.couldnotcheckyouraccountNothingwas')}</Text>
                <Pressable accessibilityRole="button" style={styles.secondary} onPress={onRetry}>
                    <Text style={styles.secondaryText}>{t('deleteaccount.tryagain')}</Text>
                </Pressable>
            </>
        );
    }
    if (result.kind === 'blocked') {
        return (
            <>
                <Text style={styles.title} accessibilityRole="header">{t('deleteaccount.notyet')}</Text>
                <Text style={styles.body}>{t('deleteaccount.somethingonyouraccounthastobe')}</Text>
                {result.blockers.map((code) => (
                    <Text key={code} style={styles.blocker}>
                        {blockerText(code)}
                    </Text>
                ))}
                <Text style={styles.small}>{t('deleteaccount.questions', { value1: PRIVACY_EMAIL })}</Text>
            </>
        );
    }
    const ok = typed.trim() === CONFIRM_WORD;
    return (
        <>
            <Text style={styles.title} accessibilityRole="header">{t('deleteaccount.deleteyouraccount')}</Text>
            <Forfeits forfeit={result.forfeit} />
            <Text accessibilityLanguage="en" style={styles.body}>{english('deleteaccount.thiserasesyouraccountandwhatis')}</Text>
            <Text style={styles.body}>{t('deleteaccount.ifyousubscribedintheAppStore')}</Text>
            <Text style={styles.label}>{t('deleteaccount.typetoconfirm', { value1: CONFIRM_WORD })}</Text>
            <TextInput
                accessibilityLabel={t('deleteaccount.typetoconfirm', { value1: CONFIRM_WORD })}
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
                <Text style={styles.dangerText}>{t('deleteaccount.deletemyaccount')}</Text>
            </Pressable>
        </>
    );
}

function Forfeits({ forfeit }: { forfeit: Forfeit }) {
    if (forfeit.credits <= 0) return null;
    return (
        <Text style={styles.forfeit}>{t('deleteaccount.youwilllosecreditsTheyarenot', { value1: forfeit.credits, value2: forfeit.freeCredits > 0 ? t('deleteaccount.ofthemfree', { value1: forfeit.freeCredits }) : '' })}</Text>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    center: { alignItems: 'center', gap: 12, paddingTop: 48 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 24 },
    body: { color: colors.body, fontSize: 16 },
    small: { color: colors.muted, fontSize: 13 },
    label: { color: colors.muted, fontSize: 14, marginTop: 8 },
    forfeit: { color: colors.money, fontSize: 16, fontWeight: '600' },
    blocker: { color: colors.text, fontSize: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 14, color: colors.text, fontSize: 16 },
    error: { color: colors.danger },
    secondary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    secondaryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    danger: { marginTop: 8, backgroundColor: colors.danger, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    dangerText: { color: colors.background, fontSize: 16, fontWeight: '700' },
    off: { opacity: 0.4 },
});
