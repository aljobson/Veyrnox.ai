import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { VeyCharacter } from '../../components/VeyCharacter';
import { selectedState, touchTarget } from '../../lib/a11y';
import { CHAOS_MAX, CREATOR_ANSWERS, STUDIO_NAME_MAX, isCreatorAnswers, type CreatorAnswers, type Goal } from '../../lib/creatorAnswers';
import { creatorCard } from '../../lib/creatorArchetype';
import { saveVibe, skipVibe } from '../../lib/creatorProfile';
import { loadVibe, storeVibe } from '../../lib/creatorProfileStore';
import { rankPresets, tastePicks } from '../../lib/creatorTaste';
import { presetKind } from '../../lib/explore';
import { chooseLocale, getLocale, t } from '../../lib/i18n';
import { LANGUAGES } from '../../lib/language';
import { loadLanguage, saveAccountLanguage, storeLanguage } from '../../lib/languageStore';
import { fetchPresets, presetHref } from '../../lib/presets';
import { colors, ds } from '../../theme';
import { Button, Card as SurfaceCard, Chip, Text, TextField, ChoiceCard, themedStyles, useThemedStyles } from '../../components/ui';
import { noteOnboardingCompleted } from '../../lib/celebrate';
import type { MenuIcon } from '../../lib/menuIcons';

// The Vibe Check (server ADR-0251): seven taps, one question each, then a creator card. Skippable on every screen, and a
// skip never throws away answers already saved. Everything chosen here only reorders templates and sets a default.
type Draft = Partial<CreatorAnswers>;
type ChoiceKey = 'look' | 'goal' | 'pace' | 'destination' | 'audience';
// Lead with intent: the Mobbin-inspired first choice immediately makes the feed useful, then the remaining
// questions refine the look and working style without introducing a second onboarding system.
const STEPS = ['goal', 'look', 'pace', 'chaos', 'destination', 'audience', 'voice'] as const;
const TOTAL = STEPS.length;
const SUBTITLED: ReadonlySet<string> = new Set(['pace', 'voice']);
const GOAL_PRESENTATION: Record<Goal, { icon: MenuIcon }> = {
    sell: { icon: 'bag' },
    story: { icon: 'film' },
    music_video: { icon: 'audio' },
    meme: { icon: 'phone' },
    character: { icon: 'sparkle' },
    bedtime: { icon: 'moon' },
};

export default function Vibe() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const { retake } = useLocalSearchParams<{ retake?: string }>();
    // 0 = intro, 1..7 = questions, 8 = card, -1 = skipped.
    const [step, setStep] = useState(0);
    const [draft, setDraft] = useState<Draft>({ chaos: 2 });
    const [studio, setStudio] = useState('');
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const [synced, setSynced] = useState(true);
    const [saved, setSaved] = useState<CreatorAnswers | null>(null);
    // The language comes first (not on a retake): every language the site offers, each by its own name and flag. The choice is
    // saved on the phone and on the account; the app shows it as soon as that language is switched on (ADR-0132).
    const [language, setLanguage] = useState<'ask' | 'done'>(retake === '1' ? 'done' : 'ask');
    const [picked, setPicked] = useState<string>(getLocale());
    const [languageNote, setLanguageNote] = useState(false);
    useEffect(() => {
        let alive = true;
        void loadLanguage().then((stored) => alive && stored && setPicked(stored));
        return () => {
            alive = false;
        };
    }, []);

    async function continueLanguage(next = picked) {
        if (next !== getLocale()) {
            await storeLanguage(next);
            void saveAccountLanguage(api, next);
            if (!chooseLocale(next)) {
                // Saved, not shown yet: say so, then go on in English.
                setLanguageNote(true);
                return;
            }
        }
        setLanguage('done');
    }

    function choose(key: ChoiceKey, value: string) {
        setDraft((d) => ({ ...d, [key]: value }));
        setStep((s) => s + 1);
    }

    async function skip() {
        const existing = await loadVibe();
        // Retaking and backing out leaves the saved answers alone.
        if (existing) {
            router.back();
            return;
        }
        await storeVibe({ state: 'skipped', answers: null, synced: false });
        const r = await skipVibe(api);
        if (r.kind === 'ok') await storeVibe({ state: 'skipped', answers: null, synced: true });
        setStep(-1);
    }

    async function finish() {
        const name = studio.trim();
        const answers = { ...draft, ...(name ? { studio_name: name } : {}) };
        if (!isCreatorAnswers(answers)) return;
        setSaving(true);
        setFailed(false);
        const r = await saveVibe(api, answers);
        // Only a real failure holds the person here. "Unavailable" (server flag off) keeps the answers on the phone.
        if (r.kind === 'failed') {
            setSaving(false);
            setFailed(true);
            return;
        }
        await storeVibe({ state: 'completed', answers, synced: r.kind === 'ok' });
        setSynced(r.kind === 'ok');
        noteOnboardingCompleted();
        setSaved(answers);
        setSaving(false);
        setStep(TOTAL + 1);
    }

    async function makeFirst() {
        try {
            const all = await fetchPresets();
            // A template with a picture that fits comes first; with none, the best fit that is not audio (a still cannot show it).
            const pick = tastePicks(all, saved, 1)[0] ?? rankPresets(all, saved).find((p) => p.available && presetKind(p) !== 'audio');
            router.replace(pick ? presetHref(pick) : '/');
        } catch {
            router.replace('/');
        }
    }

    const key = step >= 1 && step <= TOTAL ? STEPS[step - 1] : null;
    const skipLink = <Button variant="tertiary" label={t('vibe.skip')} onPress={() => void skip()} />;

    return (
        <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            {/* Questions start at the top so the first choice is where the thumb expects it on every screen; the intro, the skip note and the card sit in the middle. */}
            <ScrollView contentContainerStyle={key ? styles.bodyTop : styles.body} keyboardShouldPersistTaps="handled">
                {step === 0 && language === 'ask' ? (
                    <View style={styles.question}>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t('vibe.language.title')}
                        </Text>
                        <Text style={styles.text}>{t('vibe.language.hint')}</Text>
                        <View style={styles.options}>
                            {LANGUAGES.map((l) => (
                                <Pressable
                                    key={l.code}
                                    accessibilityRole="button"
                                    accessibilityLabel={l.name}
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
                                {t('vibe.language.later')}
                            </Text>
                        ) : null}
                    </View>
                ) : null}

                {step === 0 && language === 'done' ? (
                    <View style={styles.center}>
                        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <VeyCharacter width={140} />
                        </View>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t('vibe.intro.title')}
                        </Text>
                        <Text style={styles.text}>{t('vibe.intro.body')}</Text>
                    </View>
                ) : null}

                {step === -1 ? (
                    <View style={styles.center}>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t('vibe.skipped.title')}
                        </Text>
                        <Text style={styles.text}>{t('vibe.skipped.body')}</Text>
                    </View>
                ) : null}

                {key ? (
                    <View style={styles.question}>
                        <View style={styles.progress} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            {STEPS.map((s, i) => (
                                <View key={s} style={[styles.progressStep, i < step && styles.progressStepOn]} />
                            ))}
                        </View>
                        <Text style={styles.step} accessibilityLabel={t('vibe.step', { n: step, total: TOTAL })}>
                            {t('vibe.step', { n: step, total: TOTAL })}
                        </Text>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t(`vibe.${key}.title`)}
                        </Text>
                        {key === 'goal' ? (
                            <View style={styles.goalGrid}>
                                {CREATOR_ANSWERS.goal.map((goal) => (
                                    <View key={goal} style={styles.goalChoice}>
                                        <ChoiceCard
                                            icon={GOAL_PRESENTATION[goal].icon}
                                            title={t(`vibe.goal.${goal}`)}
                                            selected={draft.goal === goal}
                                            onPress={() => choose('goal', goal)}
                                        />
                                    </View>
                                ))}
                            </View>
                        ) : key === 'chaos' ? (
                            <View style={styles.options}>
                                <Text style={styles.readout} accessibilityLiveRegion="polite">
                                    {t(`vibe.chaos.${draft.chaos ?? 2}`)}
                                </Text>
                                <View style={styles.dial}>
                                    {Array.from({ length: CHAOS_MAX + 1 }, (_, i) => (
                                        <Pressable
                                            key={i}
                                            accessibilityRole="button"
                                            accessibilityLabel={t(`vibe.chaos.${i}`)}
                                            accessibilityState={selectedState(draft.chaos === i)}
                                            style={[styles.dialStop, draft.chaos === i && styles.dialStopOn]}
                                            onPress={() => { setDraft((d) => ({ ...d, chaos: i })); setStep(s => s + 1); }}
                                        />
                                    ))}
                                </View>
                                <View style={styles.ends}>
                                    <Text style={styles.endText}>{t('vibe.chaos.less')}</Text>
                                    <Text style={styles.endText}>{t('vibe.chaos.more')}</Text>
                                </View>
                                <Text style={styles.text}>{t('vibe.chaos.hint')}</Text>
                            </View>
                        ) : key === 'voice' ? (
                            <View style={styles.options}>
                                <TextField
                                    label={t('vibe.voice.studio')}
                                    value={studio}
                                    onChangeText={setStudio}
                                    maxLength={STUDIO_NAME_MAX}
                                    placeholder={t('vibe.voice.studio')}
                                    accessibilityLabel={t('vibe.voice.studio')}
                                    autoCapitalize="words"
                                />
                                {CREATOR_ANSWERS.voice.map((v) => (
                                    <Choice
                                        key={v}
                                        label={t(`vibe.voice.${v}`)}
                                        sub={t(`vibe.voice.${v}.sub`)}
                                        on={draft.voice === v}
                                        onPress={() => setDraft((d) => ({ ...d, voice: v }))}
                                    />
                                ))}
                            </View>
                        ) : (
                            <View style={styles.options}>
                                {CREATOR_ANSWERS[key].map((v) => (
                                    <Choice
                                        key={v}
                                        label={t(`vibe.${key}.${v}`)}
                                        sub={SUBTITLED.has(key) ? t(`vibe.${key}.${v}.sub`) : null}
                                        on={draft[key] === v}
                                        onPress={() => choose(key, v)}
                                    />
                                ))}
                            </View>
                        )}
                        {failed ? (
                            <Text style={styles.error} accessibilityLiveRegion="polite">
                                {t('vibe.error')}
                            </Text>
                        ) : null}
                    </View>
                ) : null}

                {step === TOTAL + 1 && saved ? <Card answers={saved} synced={synced} /> : null}
            </ScrollView>

            <View style={styles.footer}>
                {step === 0 && language === 'ask' && languageNote ? (
                    <Button label={t('vibe.language.continue')} onPress={() => (languageNote ? setLanguage('done') : void continueLanguage())} />
                ) : null}
                {step === 0 && language === 'done' ? (
                    <>
                        <Button label={t('vibe.start')} onPress={() => setStep(1)} />
                    </>
                ) : null}
                {step === -1 ? <Button label={t('vibe.skipped.go')} onPress={() => router.replace('/')} /> : null}
                {key === 'voice' ? <Button label={saving ? t('vibe.saving') : t('vibe.voice.done')} disabled={!draft.voice || saving} onPress={() => void finish()} /> : null}
                {key ? (
                    <View style={styles.row}>
                        {step > 1 ? <Button variant="tertiary" label={t('vibe.back')} onPress={() => setStep(step - 1)} /> : <View />}
                    </View>
                ) : null}
                {step >= 0 && step <= TOTAL ? skipLink : null}
                {step === TOTAL + 1 ? (
                    <>
                        <Button label={t('vibe.card.first')} onPress={() => void makeFirst()} />
                        <Button variant="tertiary" label={t('vibe.card.home')} onPress={() => router.replace('/')} />
                    </>
                ) : null}
            </View>
        </KeyboardAvoidingView>
    );
}

function Choice({ label, sub, on, onPress }: { label: string; sub?: string | null; on: boolean; onPress: () => void }) {
    return <ChoiceCard icon="sliders" title={label} detail={sub ?? undefined} selected={on} onPress={onPress} />;
}

function Card({ answers, synced }: { answers: CreatorAnswers; synced: boolean }) {
    const styles = useThemedStyles(sheets);
    const card = creatorCard(answers);
    return (
        <View style={styles.cardWrap}>
            <SurfaceCard style={styles.card} accessible accessibilityLabel={`${card.studio ?? t('vibe.card.kicker')}. ${card.name}. ${card.traits.join(', ')}`}>
                <Text variant="footnote" style={styles.cardKicker}>
                    {card.studio ?? t('vibe.card.kicker')}
                </Text>
                <Text variant="display" style={styles.cardName}>
                    {card.name}
                </Text>
                <View style={styles.chips}>
                    {card.traits.map((trait) => (
                        <Chip key={trait} label={trait} />
                    ))}
                </View>
            </SurfaceCard>
            <Text style={styles.text}>{t('vibe.card.leads')}</Text>
            {synced ? null : <Text style={styles.endText}>{t('vibe.card.local')}</Text>}
        </View>
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
