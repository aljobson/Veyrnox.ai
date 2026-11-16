import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { captureEvent } from '../../lib/analytics/events';
import { CREATOR_PROFILE_ENABLED } from '../../lib/creatorProfile';
import { fetchCatalogCached, kindOf } from '../../lib/media';
import { fetchPresets } from '../../lib/presets';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { useReducedMotion } from '../../components/ui/useReducedMotion';
import { starterModel } from '../../lib/createOptions';
import { firstGoalTarget, FIRST_GOALS, type FirstGoal, type StoredFirstGoal } from '../../lib/firstGoal';
import { writeFirstGoal } from '../../lib/firstGoalStore';
import { FIRST_DESTINATIONS, FIRST_ROLES, needsFirstRun, type StoredDestination, type StoredRole } from '../../lib/firstProfile';
import { loadFirstAnswers, writeFirstProfile } from '../../lib/firstProfileStore';
import { markWelcomeSeen } from '../../lib/markWelcomeSeen';
import { pushFirstAnswers } from '../../lib/firstProfileSync';
import { firstRunExample } from '../../lib/firstRunExamples';
import { afterWelcomeHref, hardPaywallEnabled } from '../../lib/hardPaywall';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds } from '../../theme';
import { Button, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { OnboardingShell } from '../../components/OnboardingShell';
import { OnboardingChoice } from '../../components/OnboardingChoice';
import { VeyCharacter } from '../../components/VeyCharacter';
import { ONBOARDING_TOTAL, WELCOME_CARDS } from '../../lib/firstRun';
import type { MenuIcon } from '../../lib/menuIcons';

const STEPS = ['role', 'goal', 'destination'] as const;
const JOURNEY_TOTAL = ONBOARDING_TOTAL;
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

const ROLE_ICON: Record<(typeof FIRST_ROLES)[number], MenuIcon> = { creator: 'video', business: 'store', pro: 'brush', hobbyist: 'smiley', beginner: 'lightbulb' };
const GOAL_ICON: Record<FirstGoal, MenuIcon> = { image: 'image', video: 'video', audio: 'audio', edit: 'magicWand', publish: 'send', unsure: 'sparkle' };
const DESTINATION_ICON: Record<(typeof FIRST_DESTINATIONS)[number], MenuIcon> = { tiktok: 'video', reels: 'camera', youtube: 'monitorPlay', private: 'eyeOff' };

// The first-run questions (ADR-0339), right after the welcome cards: which describes you best, what to make first, where
// it will go. One per screen, each skippable, asked once of someone whose account has no goal and no role on record.
export default function FirstRun() {
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const { api, beginSessionTask } = useAuth();
    const [step, setStep] = useState(0);
    const [asking, setAsking] = useState(false);
    const answers = useRef<{ role?: StoredRole; goal?: StoredFirstGoal; destination?: StoredDestination }>({});
    // The same answers as state, so the closing recap redraws with them.
    const [shown, setShown] = useState<{ role?: StoredRole; goal?: StoredFirstGoal; destination?: StoredDestination }>({});
    const leaving = useRef(false);
    const reduced = useReducedMotion();
    // Account writes go out one after another, so a quick Back and re-pick can never let an older request land last.
    const writes = useRef<Promise<unknown>>(Promise.resolve());
    // Remote writes only: each is dropped if the session that made the answer has ended by the time its turn comes.
    const queueWrite = useCallback((job: () => Promise<unknown>) => {
        const task = beginSessionTask();
        const run = () => (task.current() ? job() : Promise.resolve());
        writes.current = writes.current.then(run, run).catch(() => {});
    }, [beginSessionTask]);
    // Local saves go straight out (not behind the network) and finish() waits for them, so Create reads the answers.
    const saved = useRef<Promise<unknown>>(Promise.resolve());
    const saveLocal = useCallback((job: () => Promise<unknown>) => { saved.current = saved.current.then(job, job).catch(() => {}); }, []);
    const picking = useRef(false);
    // The pending hop to the next question, so Back or leaving can cancel it.
    const hop = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (hop.current) clearTimeout(hop.current); }, []);
    // Real template results for the goal tiles. Without them (offline, nothing published) the tiles keep their icons.
    const [photos, setPhotos] = useState<Partial<Record<FirstGoal, string>>>({});
    useEffect(() => {
        let alive = true;
        fetchPresets().then((all) => {
            if (!alive) return;
            const pick = (kind: 'image' | 'video') => all.find((p) => p.available && kindOf(p.modality) === kind && (p.posterUrl || p.previewUrl));
            const image = pick('image'), video = pick('video');
            setPhotos({ ...(image ? { image: (image.posterUrl ?? image.previewUrl)! } : {}), ...(video ? { video: (video.posterUrl ?? video.previewUrl)! } : {}) });
        }).catch(() => {});
        return () => { alive = false; };
    }, []);

    const leave = useCallback(() => {
        if (leaving.current) return;
        leaving.current = true;
        // The welcome counts as seen only once these questions are answered, skipped or already on record, so quitting the
        // app part-way brings them back next launch. Anyone who answered one is not asked again (needsFirstRun).
        void markWelcomeSeen();
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
        await saved.current;
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

    // A real answer already given is not replaced by a skip or "not sure" when someone goes Back, so what the recap shows,
    // what is stored here and what the account holds stay the same.
    const answer = useCallback((word: string) => {
        if (picking.current) return;
        const key: Step = STEPS[step];
        const given = key === 'role' ? answers.current.role : key === 'goal' ? answers.current.goal : answers.current.destination;
        const weak = word === 'skipped' || (key === 'goal' && word === 'unsure');
        const keep = weak && !!given && given !== 'skipped' && given !== 'unsure';
        captureEvent('onboarding_step', { step: 'questions', action: word === 'skipped' ? 'skip' : 'next' });
        const next = keep ? (given as string) : word;
        if (!keep) {
            if (key === 'role') {
                answers.current = { ...answers.current, role: next as StoredRole };
                saveLocal(() => writeFirstProfile({ role: next as StoredRole }));
                queueWrite(() => pushFirstAnswers(api, { role: next }));
            } else if (key === 'goal') {
                answers.current = { ...answers.current, goal: next as StoredFirstGoal };
                saveLocal(() => writeFirstGoal(next as StoredFirstGoal));
                queueWrite(() => pushFirstAnswers(api, { goal: next }));
            } else {
                answers.current = { ...answers.current, destination: next as StoredDestination };
                saveLocal(() => writeFirstProfile({ destination: next as StoredDestination }));
                queueWrite(() => pushFirstAnswers(api, { destination: next }));
            }
        }
        setShown(answers.current);
        // A short beat lets the chosen card show its tick before the screen moves on (none with Reduce Motion).
        picking.current = true;
        hop.current = setTimeout(() => {
            hop.current = null;
            picking.current = false;
            if (step < STEPS.length - 1) { setStep(step + 1); return; }
            // After the last question: a creation goal gets a recap with the idea it will start from; any other goes straight on.
            const goal = answers.current.goal;
            if (goal === 'image' || goal === 'video' || goal === 'audio') setStep(STEPS.length);
            else void finish();
        }, reduced || word === 'skipped' ? 0 : 220);
    }, [api, finish, queueWrite, reduced, saveLocal, step]);

    // Back cancels a pending hop, so a quick pick-then-Back never jumps forward again.
    const goBack = useCallback((to: number) => {
        if (hop.current) { clearTimeout(hop.current); hop.current = null; }
        picking.current = false;
        setStep(to);
    }, []);

    // Moving between questions swaps the whole screen, so say which one is now showing (WCAG 4.1.3).
    const spokenTitle = step === 0 ? t('create.firstRun.roleTitle') : step === 1 ? t('create.firstGoal.title') : step === 2 ? t('create.firstRun.destTitle') : t('create.firstRun.suggested');
    useAnnouncement(asking ? `${rawText(spokenTitle)}. ${rawText(t('welcome.step', { n: WELCOME_CARDS.length + step + 1, total: ONBOARDING_TOTAL }))}` : null, { everywhere: true });

    if (!asking) return <View style={styles.screen}><Stack.Screen options={{ headerShown: false, gestureEnabled: false }} /></View>;

    // The recap closes the journey: the idea this person will start from, and what they told us, as chips.
    if (step >= STEPS.length) {
        const goal = shown.goal === 'image' || shown.goal === 'video' || shown.goal === 'audio' ? shown.goal : 'image';
        const chips = [
            shown.role && shown.role !== 'skipped' ? ROLE_LABEL[shown.role as (typeof FIRST_ROLES)[number]]?.() : null,
            shown.goal && shown.goal !== 'skipped' ? GOAL_LABEL[shown.goal as FirstGoal]?.() : null,
            shown.destination && shown.destination !== 'skipped' ? DESTINATION_LABEL[shown.destination as (typeof FIRST_DESTINATIONS)[number]]?.() : null,
        ].filter((c): c is string => !!c);
        return (
            <OnboardingShell step={JOURNEY_TOTAL} total={JOURNEY_TOTAL} onBack={() => goBack(STEPS.length - 1)}
                footer={<Button label={t('welcome.go')} onPress={() => { captureEvent('onboarding_step', { step: 'recap', action: 'next' }); void finish(); }} />}>
                <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
                <ScrollView contentContainerStyle={styles.recap} showsVerticalScrollIndicator={false}>
                    <VeyCharacter width={120} interactive />
                    <Text variant="title1" style={styles.title} accessibilityRole="header">{t('create.firstRun.suggested')}</Text>
                    <View style={styles.idea}>
                        <Text tone="primary" style={styles.ideaText}>{firstRunExample(shown.role, goal)}</Text>
                    </View>
                    <View style={styles.chips}>
                        {chips.map((chip) => <View key={chip} style={styles.chip}><Text variant="bodyStrong" tone="primary">{chip}</Text></View>)}
                    </View>
                    {/* The receipt promise, in the app's own words: price first, refund if it fails. */}
                    <Text tone="secondary" style={styles.promise}>{t('welcome.credits.price')}</Text>
                </ScrollView>
            </OnboardingShell>
        );
    }

    const key = STEPS[step];
    const options: { id: string; label: string; icon: MenuIcon }[] =
        key === 'role' ? FIRST_ROLES.map((id) => ({ id, label: ROLE_LABEL[id](), icon: ROLE_ICON[id] }))
            : key === 'goal' ? FIRST_GOALS.map((id) => ({ id, label: GOAL_LABEL[id](), icon: GOAL_ICON[id] }))
                : FIRST_DESTINATIONS.map((id) => ({ id, label: DESTINATION_LABEL[id](), icon: DESTINATION_ICON[id] }));
    const title = key === 'role' ? t('create.firstRun.roleTitle') : key === 'goal' ? t('create.firstGoal.title') : t('create.firstRun.destTitle');
    const picked = key === 'role' ? shown.role : key === 'goal' ? shown.goal : shown.destination;

    return (
        <OnboardingShell step={WELCOME_CARDS.length + step + 1} total={JOURNEY_TOTAL}
            onBack={step > 0 ? () => goBack(step - 1) : undefined} onSkip={() => answer('skipped')} skipLabel={t('create.firstGoal.skip')} footer={null}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                <Text variant="title1" style={styles.title} accessibilityRole="header">{title}</Text>
                <Text tone="secondary" style={styles.text}>{t('create.firstRun.personalise')}</Text>
                {/* The goal is the picture-led question: a two-column grid of big tiles. The others are full-width rows. */}
                <View accessibilityRole="radiogroup" style={key === 'goal' ? styles.grid : styles.list}>
                    {options.map((option, index) => (
                        <OnboardingChoice key={`${key}-${option.id}`} label={option.label} icon={option.icon} layout={key === 'goal' ? 'tile' : 'row'}
                            selected={picked === option.id} imageUri={key === 'goal' ? photos[option.id as FirstGoal] ?? null : null} index={index} onPress={() => answer(option.id)} />
                    ))}
                </View>
            </ScrollView>
        </OnboardingShell>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { flexGrow: 1, justifyContent: 'center', paddingVertical: ds.space.xl, gap: ds.space.md },
    title: { textAlign: 'center' },
    text: { textAlign: 'center', marginBottom: ds.space.sm },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: ds.space.md },
    list: { gap: ds.space.md },
    recap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: ds.space.lg, paddingVertical: ds.space.lg },
    promise: { textAlign: 'center' },
    idea: { alignSelf: 'stretch', borderRadius: ds.radius.xl, borderWidth: 1.5, borderColor: p.accent, backgroundColor: p.accentSubtle, padding: ds.space.xl },
    ideaText: { textAlign: 'center' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: ds.space.sm },
    chip: { borderRadius: ds.radius.pill, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm },
}));
