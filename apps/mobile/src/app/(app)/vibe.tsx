import { rawText } from '../../lib/i18n/translate';
import { captureEvent } from '../../lib/analytics/events';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { VeyCharacter } from '../../components/VeyCharacter';
import { selectedState, touchTarget } from '../../lib/a11y';
import { loadVibe, recordVibeSkip } from '../../lib/creatorProfileStore';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { getLocale, t } from '../../lib/i18n';
import { activeLanguages, hasActiveChoice, needsLanguageChoice, changeLanguage } from '../../lib/languageTransition';
import { loadLanguage, readLanguage, saveAccountLanguage, saveLanguage } from '../../lib/languageStore';
import { ds } from '../../theme';
import { Button, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { noteOnboardingCompleted } from '../../lib/celebrate';

// The Vibe Check once asked seven questions (goal, look, pace, chaos, destination, audience, voice) and showed a creator
// card. Those are removed: what is left is the language choice and Vey's intro. Continuing records the check as done
// (a skip, which the server accepts without answers) so it is not offered again.

export default function Vibe() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    useEffect(() => { captureEvent('onboarding_step', { step: 'vibe', action: 'view' }); }, []);
    const styles = useThemedStyles(sheets);
    const { api, canReloadSession, beginSessionTask, generation } = useAuth();
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const opRef = useRef(0);
    const [identity, setIdentity] = useState({ owner, generation });
    const { retake, from } = useLocalSearchParams<{ retake?: string; from?: string }>();
    // Arrived by replace from the first-run Welcome: there is nothing to go back to, so leave for the app (and the paywall).
    const leave = () => { if (from === 'welcome') router.replace('/'); else router.back(); };
    const [busy, setBusy] = useState(false);
    // Reset during render so even the first render for the next session has no old busy state.
    if (identity.owner !== owner || identity.generation !== generation) {
        setIdentity({ owner, generation }); opRef.current++; setBusy(false);
    }
    // Ask only when there is no active saved choice; first launch normally handles this before sign-in.
    const [language, setLanguage] = useState<'ask' | 'done'>(retake === '1' || !needsLanguageChoice(readLanguage()) ? 'done' : 'ask');
    const [picked, setPicked] = useState<string>(getLocale());
    const [languageNote, setLanguageNote] = useState(false);
    useEffect(() => {
        let alive = true;
        void loadLanguage().then((stored) => {
            if (alive && hasActiveChoice(stored)) { setPicked(stored!); setLanguage('done'); }
        });
        return () => {
            alive = false;
        };
    }, []);

    async function continueLanguage(next = picked) {
        setLanguageNote(false);
        const ok = next === getLocale()
            ? await saveLanguage(next)
            : await changeLanguage(next, '/vibe', { signedIn: true, canReloadSession }, { onChosen: code => saveAccountLanguage(api, code) });
        if (!ok) { setLanguageNote(true); return; }
        if (next === getLocale()) void saveAccountLanguage(api, next);
        if (next === getLocale()) setLanguage('done');
    }

    async function proceed(action: 'next' | 'skip') {
        const task = beginSessionTask();
        const op = ++opRef.current;
        captureEvent('onboarding_step', { step: 'vibe', action });
        setBusy(true);
        const existing = await loadVibe();
        if (!task.current() || op !== opRef.current) return;
        if (!existing) {
            const r = await recordVibeSkip(api, task);
            if (!task.current() || r.kind === 'stale-session' || opRef.current !== op) return;
        }
        setBusy(false);
        noteOnboardingCompleted();
        leave();
    }

    // The intro is gone: once the language is settled the check completes itself and the person moves on.
    const started = useRef(false);
    useEffect(() => {
        if (language !== 'done' || started.current) return;
        started.current = true;
        void proceed('skip');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language]);

    return (
        <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {language === 'ask' ? (
                    <View style={styles.question}>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t('vibe.language.title')}
                        </Text>
                        <Text style={styles.text}>{t('vibe.language.hint')}</Text>
                        <View style={styles.options}>
                            {activeLanguages().map((l) => (
                                <Pressable
                                    key={l.code}
                                    accessibilityRole="button"
                                    accessibilityLabel={rawText(l.name)}
                                    accessibilityLanguage={l.tag}
                                    accessibilityState={selectedState(picked === l.code)}
                                    style={({ pressed }) => [touchTarget, styles.choice, styles.languageRow, picked === l.code && styles.choiceOn, pressed && styles.pressed]}
                                    onPress={() => {
                                        setPicked(l.code);
                                        setLanguageNote(false);
                                        void continueLanguage(l.code);
                                    }}
                                >
                                    <Text style={styles.choiceLabel}>{l.name}</Text>
                                </Pressable>
                            ))}
                        </View>
                        {languageNote ? (
                            <Text style={styles.text} accessibilityLiveRegion="polite">
                                {t('language.failed')}
                            </Text>
                        ) : null}
                    </View>
                ) : (
                    <View style={styles.center} accessible accessibilityRole="progressbar" accessibilityLabel={t('common.loading')} accessibilityLiveRegion="polite">
                        <ActivityIndicator />
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                {language === 'ask' && languageNote ? (
                    <Button label={t('vibe.language.continue')} onPress={() => void continueLanguage()} />
                ) : null}
            </View>
        </KeyboardAvoidingView>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { flexGrow: 1, justifyContent: 'center', padding: ds.space.gutter },
    bodyTop: { flexGrow: 1, padding: ds.space.gutter },
    center: { alignItems: 'center', gap: ds.space.lg },
    question: { gap: ds.space.lg },
    progress: { flexDirection: 'row', gap: ds.space.xs },
    progressStep: { flex: 1, height: 4, borderRadius: ds.radius.xs, backgroundColor: p.borderSubtle },
    progressStepOn: { backgroundColor: p.accent },
    step: { color: p.textTertiary },
    title: {},
    text: { color: p.textSecondary },
    options: { gap: ds.space.md },
    goalGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: ds.space.md },
    goalChoice: { width: '48%' },
    choice: { minHeight: 52, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1, borderRadius: ds.radius.md, padding: ds.space.lg },
    choiceOn: { borderWidth: 2, borderColor: p.accent, backgroundColor: p.accentSubtle },
    pressed: { opacity: 0.85 },
    languageRow: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md },
    choiceLabel: {},
    readout: { textAlign: 'center', minHeight: 30 },
    dial: { flexDirection: 'row', justifyContent: 'space-between', gap: ds.space.sm },
    dialStop: { flex: 1, height: 44, borderRadius: ds.radius.md, borderWidth: 1.5, borderColor: p.borderSubtle, backgroundColor: p.surface },
    dialStopOn: { borderColor: p.accent, backgroundColor: p.accentSubtle },
    ends: { flexDirection: 'row', justifyContent: 'space-between' },
    endText: { color: p.textTertiary },
    error: { color: p.danger },
    footer: { padding: ds.space.gutter, gap: ds.space.sm },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardWrap: { gap: ds.space.lg },
    card: { minHeight: 200, justifyContent: 'flex-end', gap: ds.space.md },
    cardKicker: { color: p.textSecondary },
    cardName: {},
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
}));
