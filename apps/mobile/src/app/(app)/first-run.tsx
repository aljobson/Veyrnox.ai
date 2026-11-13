import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { captureEvent } from '../../lib/analytics/events';
import { CREATOR_PROFILE_ENABLED } from '../../lib/creatorProfile';
import { fetchCatalogCached } from '../../lib/media';
import { starterModel } from '../../lib/createOptions';
import { firstGoalTarget, FIRST_GOALS, type FirstGoal, type StoredFirstGoal } from '../../lib/firstGoal';
import { writeFirstGoal } from '../../lib/firstGoalStore';
import { FIRST_DESTINATIONS, FIRST_ROLES, needsFirstRun, type StoredDestination, type StoredRole } from '../../lib/firstProfile';
import { loadFirstAnswers, writeFirstProfile } from '../../lib/firstProfileStore';
import { pushFirstAnswers } from '../../lib/firstProfileSync';
import { firstRunExample } from '../../lib/firstRunExamples';
import { afterWelcomeHref, hardPaywallEnabled } from '../../lib/hardPaywall';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds } from '../../theme';
import { Button, Text, themedStyles, useThemedStyles } from '../../components/ui';

const STEPS = ['role', 'goal', 'destination'] as const;
type Step = (typeof STEPS)[number];

// Literal keys, so the translation tooling can see every string this screen uses.
const ROLE_LABEL: Record<(typeof FIRST_ROLES)[number], () => string> = {
    creator: () => t('create.firstRun.role.creator'),
    business: () => t('create.firstRun.role.business'),
    pro: () => t('create.firstRun.role.pro'),
    hobbyist: () => t('create.firstRun.role.hobbyist'),
    beginner: () => t('create.firstRun.role.beginner'),
};
const GOAL_LABEL: Record<FirstGoal, () => string> = {
    image: () => t('create.firstGoal.image'),
    video: () => t('create.firstGoal.video'),
    audio: () => t('create.firstGoal.audio'),
    edit: () => t('create.firstGoal.edit'),
    publish: () => t('create.firstGoal.publish'),
    unsure: () => t('create.firstGoal.unsure'),
};
const DESTINATION_LABEL: Record<(typeof FIRST_DESTINATIONS)[number], () => string> = {
    tiktok: () => t('create.firstRun.dest.tiktok'),
    reels: () => t('create.firstRun.dest.reels'),
    youtube: () => t('create.firstRun.dest.youtube'),
    private: () => t('create.firstRun.dest.private'),
};

// The first-run questions (ADR-0339), right after the welcome cards: which describes you best, what to make first, where
// it will go. One per screen, each skippable, asked once of someone whose account has no goal and no role on record.
export default function FirstRun() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const [step, setStep] = useState(0);
    const [asking, setAsking] = useState(false);
    const answers = useRef<{ role?: StoredRole; goal?: StoredFirstGoal; destination?: StoredDestination }>({});
    const leaving = useRef(false);

    const leave = useCallback(() => {
        if (leaving.current) return;
        leaving.current = true;
        router.replace(afterWelcomeHref(hardPaywallEnabled(), CREATOR_PROFILE_ENABLED));
    }, [router]);

    // Someone whose account already answered (a second phone, or an older account) goes straight on.
    useEffect(() => {
        let alive = true;
        captureEvent('onboarding_step', { step: 'questions', action: 'view' });
        loadFirstAnswers(api).then((known) => {
            if (!alive) return;
            if (needsFirstRun(known)) setAsking(true);
            else leave();
        }).catch(() => { if (alive) setAsking(true); });
        return () => { alive = false; };
    }, [api, leave]);

    const finish = useCallback(async () => {
        const goal = answers.current.goal;
        leave();
        if (!goal) return;
        const target = firstGoalTarget(goal);
        if (target.kind === 'tab') { router.push(target.href); return; }
        if (target.kind !== 'create') return;
        // Creation goal: open that kind's starter form with an example for this person's role.
        const models = await fetchCatalogCached(() => undefined).then((r) => r.value).catch(() => null);
        const model = models ? starterModel(models, target.goal) : null;
        if (model) router.push({ pathname: '/create/[modelId]', params: { modelId: model.id, prompt: firstRunExample(answers.current.role, target.goal) } });
    }, [leave, router]);

    const answer = useCallback((word: string) => {
        const key: Step = STEPS[step];
        captureEvent('onboarding_step', { step: 'questions', action: word === 'skipped' ? 'skip' : 'next' });
        if (key === 'role') {
            answers.current = { ...answers.current, role: word as StoredRole };
            void writeFirstProfile({ role: word as StoredRole });
            void pushFirstAnswers(api, { role: word });
        } else if (key === 'goal') {
            answers.current = { ...answers.current, goal: word as StoredFirstGoal };
            void writeFirstGoal(word as StoredFirstGoal);
            void pushFirstAnswers(api, { goal: word });
        } else {
            answers.current = { ...answers.current, destination: word as StoredDestination };
            void writeFirstProfile({ destination: word as StoredDestination });
            void pushFirstAnswers(api, { destination: word });
        }
        if (step < STEPS.length - 1) setStep(step + 1);
        else void finish();
    }, [api, finish, step]);

    if (!asking) return <View style={styles.screen}><Stack.Screen options={{ headerShown: false, gestureEnabled: false }} /></View>;

    const key = STEPS[step];
    const options: { id: string; label: string }[] =
        key === 'role' ? FIRST_ROLES.map((id) => ({ id, label: ROLE_LABEL[id]() }))
            : key === 'goal' ? FIRST_GOALS.map((id) => ({ id, label: GOAL_LABEL[id]() }))
                : FIRST_DESTINATIONS.map((id) => ({ id, label: DESTINATION_LABEL[id]() }));
    const title = key === 'role' ? t('create.firstRun.roleTitle') : key === 'goal' ? t('create.firstGoal.title') : t('create.firstRun.destTitle');

    return (
        <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body}>
                <Text variant="title1" style={styles.title} accessibilityRole="header">{title}</Text>
                <Text tone="secondary" style={styles.text}>{t('create.firstRun.personalise')}</Text>
                <View style={styles.choices}>
                    {options.map((option) => (
                        <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={rawText(option.label)} onPress={() => answer(option.id)}
                            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
                            <Text variant="bodyStrong" tone="primary">{option.label}</Text>
                        </Pressable>
                    ))}
                </View>
            </ScrollView>
            <View style={styles.footer}>
                <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {STEPS.map((name, index) => <View key={name} style={[styles.dot, index === step && styles.dotOn]} />)}
                </View>
                <Button variant="tertiary" label={t('create.firstGoal.skip')} onPress={() => answer('skipped')} />
            </View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { flexGrow: 1, justifyContent: 'center', padding: ds.space.gutter, gap: ds.space.md },
    title: { textAlign: 'center' },
    text: { textAlign: 'center' },
    choices: { gap: ds.space.sm, marginTop: ds.space.sm },
    choice: { minHeight: 56, justifyContent: 'center', paddingHorizontal: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1 },
    pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
    footer: { padding: ds.space.gutter, gap: ds.space.sm },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: ds.space.sm },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: p.borderSubtle },
    dotOn: { backgroundColor: p.textPrimary },
}));
