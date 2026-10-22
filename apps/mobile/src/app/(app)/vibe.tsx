import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { VeyCharacter } from '../../components/VeyCharacter';
import { selectedState, touchTarget } from '../../lib/a11y';
import { CHAOS_MAX, CREATOR_ANSWERS, STUDIO_NAME_MAX, isCreatorAnswers, type CreatorAnswers } from '../../lib/creatorAnswers';
import { creatorCard } from '../../lib/creatorArchetype';
import { saveVibe, skipVibe } from '../../lib/creatorProfile';
import { loadVibe, storeVibe } from '../../lib/creatorProfileStore';
import { rankPresets, tastePicks } from '../../lib/creatorTaste';
import { presetKind } from '../../lib/explore';
import { t } from '../../lib/i18n';
import { fetchPresets, presetHref } from '../../lib/presets';
import { colors } from '../../theme';

// The Vibe Check (server ADR-0251): seven taps, one question each, then a creator card. Skippable on every screen, and a
// skip never throws away answers already saved. Everything chosen here only reorders templates and sets a default.
type Draft = Partial<CreatorAnswers>;
type ChoiceKey = 'look' | 'goal' | 'pace' | 'destination' | 'audience';
const STEPS = ['look', 'goal', 'pace', 'chaos', 'destination', 'audience', 'voice'] as const;
const TOTAL = STEPS.length;
const SUBTITLED: ReadonlySet<string> = new Set(['pace', 'voice']);

export default function Vibe() {
    const router = useRouter();
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
        setSaved(answers);
        setSaving(false);
        setStep(TOTAL + 1);
    }

    async function makeFirst() {
        try {
            const all = await fetchPresets();
            // A template with a picture that fits comes first; with none, the best fit that is not audio (a still cannot show it).
            const pick = tastePicks(all, saved, 1)[0] ?? rankPresets(all, saved).find((p) => presetKind(p) !== 'audio');
            router.replace(pick ? presetHref(pick) : '/');
        } catch {
            router.replace('/');
        }
    }

    const key = step >= 1 && step <= TOTAL ? STEPS[step - 1] : null;
    const skipLink = (
        <Pressable accessibilityRole="button" style={[touchTarget, styles.link]} onPress={() => void skip()}>
            <Text style={styles.linkText}>{t('vibe.skip')}</Text>
        </Pressable>
    );

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            {/* Questions start at the top so the first choice is where the thumb expects it on every screen; the intro, the skip note and the card sit in the middle. */}
            <ScrollView contentContainerStyle={key ? styles.bodyTop : styles.body} keyboardShouldPersistTaps="handled">
                {step === 0 ? (
                    <View style={styles.center}>
                        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><VeyCharacter width={140} /></View>
                        <Text style={styles.title} accessibilityRole="header">{t('vibe.intro.title')}</Text>
                        <Text style={styles.text}>{t('vibe.intro.body')}</Text>
                    </View>
                ) : null}

                {step === -1 ? (
                    <View style={styles.center}>
                        <Text style={styles.title} accessibilityRole="header">{t('vibe.skipped.title')}</Text>
                        <Text style={styles.text}>{t('vibe.skipped.body')}</Text>
                    </View>
                ) : null}

                {key ? (
                    <View style={styles.question}>
                        <Text style={styles.step} accessibilityLabel={t('vibe.step', { n: step, total: TOTAL })}>{t('vibe.step', { n: step, total: TOTAL })}</Text>
                        <Text style={styles.title} accessibilityRole="header">{t(`vibe.${key}.title`)}</Text>
                        {key === 'chaos' ? (
                            <View style={styles.options}>
                                <Text style={styles.readout} accessibilityLiveRegion="polite">{t(`vibe.chaos.${draft.chaos ?? 2}`)}</Text>
                                <View style={styles.dial}>
                                    {Array.from({ length: CHAOS_MAX + 1 }, (_, i) => (
                                        <Pressable
                                            key={i}
                                            accessibilityRole="button"
                                            accessibilityLabel={t(`vibe.chaos.${i}`)}
                                            accessibilityState={selectedState(draft.chaos === i)}
                                            style={[styles.dialStop, draft.chaos === i && styles.dialStopOn]}
                                            onPress={() => setDraft((d) => ({ ...d, chaos: i }))}
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
                                <TextInput
                                    style={styles.input}
                                    value={studio}
                                    onChangeText={setStudio}
                                    maxLength={STUDIO_NAME_MAX}
                                    placeholder={t('vibe.voice.studio')}
                                    placeholderTextColor={colors.muted}
                                    accessibilityLabel={t('vibe.voice.studio')}
                                    autoCapitalize="words"
                                />
                                {CREATOR_ANSWERS.voice.map((v) => (
                                    <Choice key={v} label={t(`vibe.voice.${v}`)} sub={t(`vibe.voice.${v}.sub`)} on={draft.voice === v} onPress={() => setDraft((d) => ({ ...d, voice: v }))} />
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
                        {failed ? <Text style={styles.error} accessibilityLiveRegion="polite">{t('vibe.error')}</Text> : null}
                    </View>
                ) : null}

                {step === TOTAL + 1 && saved ? <Card answers={saved} synced={synced} /> : null}
            </ScrollView>

            <View style={styles.footer}>
                {step === 0 ? (
                    <>
                        <Pressable accessibilityRole="button" style={[touchTarget, styles.primary]} onPress={() => setStep(1)}>
                            <Text style={styles.primaryText}>{t('vibe.start')}</Text>
                        </Pressable>
                        {retake === '1' ? null : skipLink}
                    </>
                ) : null}
                {step === -1 ? (
                    <Pressable accessibilityRole="button" style={[touchTarget, styles.primary]} onPress={() => router.replace('/')}>
                        <Text style={styles.primaryText}>{t('vibe.skipped.go')}</Text>
                    </Pressable>
                ) : null}
                {key === 'chaos' ? (
                    <Pressable accessibilityRole="button" style={[touchTarget, styles.primary]} onPress={() => setStep(step + 1)}>
                        <Text style={styles.primaryText}>{t('vibe.next')}</Text>
                    </Pressable>
                ) : null}
                {key === 'voice' ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !draft.voice || saving }}
                        disabled={!draft.voice || saving}
                        style={[touchTarget, styles.primary, (!draft.voice || saving) && styles.disabled]}
                        onPress={() => void finish()}
                    >
                        <Text style={styles.primaryText}>{saving ? t('vibe.saving') : t('vibe.voice.done')}</Text>
                    </Pressable>
                ) : null}
                {key ? (
                    <View style={styles.row}>
                        {step > 1 ? (
                            <Pressable accessibilityRole="button" style={[touchTarget, styles.link]} onPress={() => setStep(step - 1)}>
                                <Text style={styles.linkText}>{t('vibe.back')}</Text>
                            </Pressable>
                        ) : <View />}
                        {skipLink}
                    </View>
                ) : null}
                {step === TOTAL + 1 ? (
                    <>
                        <Pressable accessibilityRole="button" style={[touchTarget, styles.primary]} onPress={() => void makeFirst()}>
                            <Text style={styles.primaryText}>{t('vibe.card.first')}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" style={[touchTarget, styles.link]} onPress={() => router.replace('/')}>
                            <Text style={styles.linkText}>{t('vibe.card.home')}</Text>
                        </Pressable>
                    </>
                ) : null}
            </View>
        </KeyboardAvoidingView>
    );
}

function Choice({ label, sub, on, onPress }: { label: string; sub?: string | null; on: boolean; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={sub ? `${label}. ${sub}` : label}
            accessibilityState={selectedState(on)}
            style={({ pressed }) => [touchTarget, styles.choice, on && styles.choiceOn, pressed && styles.pressed]}
            onPress={onPress}
        >
            <Text style={styles.choiceLabel}>{label}</Text>
            {sub ? <Text style={styles.choiceSub}>{sub}</Text> : null}
        </Pressable>
    );
}

function Card({ answers, synced }: { answers: CreatorAnswers; synced: boolean }) {
    const card = creatorCard(answers);
    return (
        <View style={styles.cardWrap}>
            <View style={styles.card} accessible accessibilityLabel={`${card.studio ?? t('vibe.card.kicker')}. ${card.name}. ${card.traits.join(', ')}`}>
                <Text style={styles.cardKicker}>{card.studio ?? t('vibe.card.kicker')}</Text>
                <Text style={styles.cardName}>{card.name}</Text>
                <View style={styles.chips}>
                    {card.traits.map((trait) => (
                        <Text key={trait} style={styles.chip}>{trait}</Text>
                    ))}
                </View>
            </View>
            <Text style={styles.text}>{t('vibe.card.leads')}</Text>
            {synced ? null : <Text style={styles.endText}>{t('vibe.card.local')}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    bodyTop: { flexGrow: 1, justifyContent: 'flex-start', padding: 24, paddingTop: 72 },
    center: { alignItems: 'center', gap: 16 },
    question: { gap: 16 },
    step: { color: colors.muted, fontSize: 14 },
    title: { color: colors.text, fontSize: 26, fontWeight: '700' },
    text: { color: colors.body, fontSize: 17, lineHeight: 24 },
    options: { gap: 10 },
    choice: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
    choiceOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    pressed: { opacity: 0.85 },
    choiceLabel: { color: colors.text, fontSize: 17, fontWeight: '600' },
    choiceSub: { color: colors.muted, fontSize: 14 },
    readout: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center', minHeight: 30 },
    dial: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    dialStop: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
    dialStopOn: { borderColor: colors.accent, backgroundColor: colors.accent },
    ends: { flexDirection: 'row', justifyContent: 'space-between' },
    endText: { color: colors.muted, fontSize: 14 },
    input: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 },
    error: { color: colors.danger, fontSize: 15 },
    footer: { padding: 24, gap: 8, alignItems: 'stretch' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    primary: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingHorizontal: 16 },
    disabled: { opacity: 0.4 },
    primaryText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
    link: { alignItems: 'center', paddingHorizontal: 8 },
    linkText: { color: colors.muted, fontSize: 16 },
    cardWrap: { gap: 16 },
    card: { backgroundColor: colors.accent, borderRadius: 20, padding: 22, minHeight: 200, justifyContent: 'flex-end', gap: 10 },
    cardKicker: { color: colors.accentInk, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.85 },
    cardName: { color: colors.accentInk, fontSize: 30, fontWeight: '800' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { color: colors.accentInk, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 13, fontWeight: '600', overflow: 'hidden' },
});
