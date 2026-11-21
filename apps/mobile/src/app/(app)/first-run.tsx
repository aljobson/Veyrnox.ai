import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
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
import { FIRST_DESTINATIONS, FIRST_ROLES, needsFirstRun, type FirstOnboardingStep, type StoredDestination, type StoredRole } from '../../lib/firstProfile';
import { loadFirstOnboarding, replayFirstOnboarding, writeFirstOnboarding, writeFirstProfile } from '../../lib/firstProfileStore';
import { markWelcomeSeen } from '../../lib/markWelcomeSeen';
import { firstRunExample } from '../../lib/firstRunExamples';
import { HARD_PAYWALL_STARTER_CREDITS, afterWelcomeHref, hardPaywallEnabled } from '../../lib/hardPaywall';
import { noteOnboardingCompleted } from '../../lib/celebrate';
import { plural, t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds } from '../../theme';
import { Button, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { OnboardingShell } from '../../components/OnboardingShell';
import { OnboardingChoice } from '../../components/OnboardingChoice';
import { VeyCharacter } from '../../components/VeyCharacter';
import { creditsCardKeys, hasRecap, journeyTotalFor } from '../../lib/firstRun';
import type { MenuIcon } from '../../lib/menuIcons';

// Goal first: it is the one answer that changes what happens next, and the picture grid is the strongest first screen.
// Then where it will go, then who it is for (which shapes the example), then the recap with the idea to start from.
const STEPS = ['goal', 'destination', 'role'] as const;
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

// The first-run journey (ADR-0339), the first screen a new person sees after sign-in: Vey says hello above what to make
// first, then where it will go, then which describes you best, then a recap of the idea to start from. One per screen,
// each skippable and resumed from the account's versioned step.
export default function FirstRun() {
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const { api, beginSessionTask } = useAuth();
    const [step, setStep] = useState(0);
    const [asking, setAsking] = useState(false);
    const answers = useRef<{ role?: StoredRole; goal?: StoredFirstGoal; destination?: StoredDestination }>({});
    // The same answers as state, so the closing recap redraws with them.
    const [shown, setShown] = useState<{ role?: StoredRole; goal?: StoredFirstGoal; destination?: StoredDestination }>({});
    // The bar's length follows the goal picked: a creation goal ends on the recap, anything else finishes a screen sooner.
    const journeyTotal = journeyTotalFor(shown.goal, step);
    const leaving = useRef(false);
    const loadedFor = useRef<string | null>(null);
    const reduced = useReducedMotion();
    // Legacy personalization saves stay local; the owner-stamped onboarding outbox is written separately before replay.
    const saved = useRef<Promise<unknown>>(Promise.resolve());
    const saveLocal = useCallback((job: () => Promise<unknown>) => { saved.current = saved.current.then(job, job).catch(() => {}); }, []);
    const picking = useRef(false);
    // Set before the first await in finish(), so a second tap or a Back during the wait cannot start or undo a completion.
    const finishing = useRef(false);
    const [sampleBroken, setSampleBroken] = useState(false);
    // The pending hop to the next question, so Back or leaving can cancel it.
    const hop = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (hop.current) clearTimeout(hop.current); }, []);
    // Real template results for the goal tiles. Without them (offline, nothing published) the tiles keep their icons.
    const [photos, setPhotos] = useState<Partial<Record<FirstGoal, string>>>({});
    useEffect(() => {
        let alive = true;
        fetchPresets().then((all) => {
            if (!alive) return;
            // Only a real still: a poster, or a preview that is an image (previews can be video files, which an image view cannot show).
            const still = (p: (typeof all)[number]) => p.posterUrl ?? (p.previewUrl && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(p.previewUrl) ? p.previewUrl : null);
            const pick = (kind: 'image' | 'video') => all.find((p) => p.available && kindOf(p.modality) === kind && still(p));
            const image = pick('image'), video = pick('video');
            setPhotos({ ...(image ? { image: still(image)! } : {}), ...(video ? { video: still(video)! } : {}) });
        }).catch(() => {});
        return () => { alive = false; };
    }, []);

    const leave = useCallback(() => {
        if (leaving.current) return;
        leaving.current = true;
        // The welcome counts as seen only once these questions are answered, skipped or already on record, so quitting the
        // app part-way brings them back next launch. Anyone who answered one is not asked again (needsFirstRun).
        void markWelcomeSeen();
        // Flag off: first run ends here, so the milestones may open. Flag on, the paywall comes next and ends it.
        if (!hardPaywallEnabled()) noteOnboardingCompleted();
        router.replace(afterWelcomeHref(hardPaywallEnabled(), CREATOR_PROFILE_ENABLED));
    }, [router]);

    // Someone whose account already answered (a second phone, or an older account) goes straight on.
    // The free credits this account holds, for the recap's credits line. Unreadable means the line explains credits without a number.
    const [free, setFree] = useState<number | null>(null);
    useEffect(() => {
        let alive = true;
        Promise.resolve().then(() => api.getBalance()).then((b) => { if (alive) setFree(b.free_credits); }).catch(() => {});
        return () => { alive = false; };
    }, [api]);

    useEffect(() => {
        let alive = true;
        captureEvent('onboarding_step', { step: 'questions', action: 'view' });
        const task = beginSessionTask();
        const loadKey = `${task.user ?? 'signed-out'}:${task.gen}`;
        if (loadedFor.current === loadKey) return undefined;
        loadedFor.current = loadKey;
        loadFirstOnboarding(api, task).then((known) => {
            if (!alive || !task.current()) return;
            if (!known) { setAsking(true); return; }
            if (needsFirstRun(known)) {
                answers.current = { goal: known.goal as StoredFirstGoal | undefined, role: known.role ?? undefined, destination: known.destination ?? undefined };
                setShown(answers.current);
                const next = known.currentStep === 'recap' ? STEPS.length : Math.max(0, STEPS.indexOf(known.currentStep as Step));
                setStep(next);
                setAsking(true);
            } else leave();
        }).catch(() => { if (alive) setAsking(true); });
        return () => { alive = false; };
    }, [api, beginSessionTask, leave]);

    const finish = useCallback(async () => {
        if (finishing.current) return;
        finishing.current = true;
        const task = beginSessionTask();
        const goal = answers.current.goal;
        await saved.current;
        if (!task.current()) return;
        if (task.user) {
            const pending = { goal: answers.current.goal ?? null, role: answers.current.role ?? null, destination: answers.current.destination ?? null,
                version: 1 as const, currentStep: goal === 'skipped' ? 'role' as const : 'recap' as const,
                completed: false, pending: true, completeRequested: true };
            await writeFirstOnboarding(task.user, pending, task);
            if (!task.current()) return;
            void replayFirstOnboarding(api, task, pending);
        }
        if (!task.current()) return;
        leave();
        if (!goal) return;
        const target = firstGoalTarget(goal);
        if (target.kind === 'tab') { router.push(target.href); return; }
        if (target.kind !== 'create') return;
        // Creation goal: open that kind's starter form with an example for this person's role.
        const models = await fetchCatalogCached(() => undefined).then((r) => r.value).catch(() => null);
        const model = models ? starterModel(models, target.goal) : null;
        if (model) router.push({ pathname: '/create/[modelId]', params: { modelId: model.id, prompt: firstRunExample(answers.current.role, target.goal) } });
    }, [api, beginSessionTask, leave, router]);

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
            } else if (key === 'goal') {
                answers.current = { ...answers.current, goal: next as StoredFirstGoal };
                saveLocal(() => writeFirstGoal(next as StoredFirstGoal));
            } else {
                answers.current = { ...answers.current, destination: next as StoredDestination };
                saveLocal(() => writeFirstProfile({ destination: next as StoredDestination }));
            }
            const task = beginSessionTask();
            if (task.user) {
                const completeRequested = step === STEPS.length - 1 && answers.current.goal === 'skipped';
                const nextStep: FirstOnboardingStep = step < STEPS.length - 1 ? STEPS[step + 1] : completeRequested ? 'role' : 'recap';
                const pending = { goal: answers.current.goal ?? null, role: answers.current.role ?? null,
                    destination: answers.current.destination ?? null, version: 1 as const, currentStep: nextStep,
                    completed: false, pending: true, completeRequested };
                void writeFirstOnboarding(task.user, pending, task).then(() => replayFirstOnboarding(api, task, pending));
            }
        }
        setShown(answers.current);
        // A short beat lets the chosen card show its tick before the screen moves on (none with Reduce Motion).
        picking.current = true;
        hop.current = setTimeout(() => {
            hop.current = null;
            picking.current = false;
            if (step < STEPS.length - 1) { setStep(step + 1); return; }
            // After the last question: any answered goal gets the recap with a sample result before the paywall; a skipped one goes straight on.
            if (hasRecap(answers.current.goal)) setStep(STEPS.length);
            else void finish();
        }, reduced || word === 'skipped' ? 0 : 220);
    }, [api, beginSessionTask, finish, reduced, saveLocal, step]);

    // Back cancels a pending hop, so a quick pick-then-Back never jumps forward again.
    const goBack = useCallback((to: number) => {
        if (finishing.current) return;
        if (hop.current) { clearTimeout(hop.current); hop.current = null; }
        picking.current = false;
        setStep(to);
    }, []);

    // Moving between questions swaps the whole screen, so say which one is now showing (WCAG 4.1.3).
    const spokenTitle = step === 0 ? t('create.firstGoal.title') : step === 1 ? t('create.firstRun.destTitle') : step === 2 ? t('create.firstRun.roleTitle') : t('create.firstRun.suggested');
    useAnnouncement(asking ? `${rawText(spokenTitle)}. ${rawText(t('welcome.step', { n: step + 1, total: journeyTotal }))}` : null, { everywhere: true });

    if (!asking) return <View style={styles.screen}><Stack.Screen options={{ headerShown: false, gestureEnabled: false }} /></View>;

    // The recap is the payoff: a real result for the chosen goal, the idea this person will start from, what they told us as
    // chips, and the credits promise in the paywall's own words.
    if (step >= STEPS.length) {
        const goal = shown.goal === 'image' || shown.goal === 'video' || shown.goal === 'audio' ? shown.goal : 'image';
        // Audio has no still of its own, and the goals that are not a creation kind borrow the video or image sample.
        const sample = sampleBroken ? null : photos[goal] ?? photos.video ?? photos.image ?? null;
        const credits = creditsCardKeys(free, hardPaywallEnabled() ? HARD_PAYWALL_STARTER_CREDITS : null);
        const creditsLine = credits.count !== null ? plural(credits.body, credits.count) : t(credits.body, credits.params);
        const chips = [
            shown.role && shown.role !== 'skipped' ? ROLE_LABEL[shown.role as (typeof FIRST_ROLES)[number]]?.() : null,
            shown.goal && shown.goal !== 'skipped' ? GOAL_LABEL[shown.goal as FirstGoal]?.() : null,
            shown.destination && shown.destination !== 'skipped' ? DESTINATION_LABEL[shown.destination as (typeof FIRST_DESTINATIONS)[number]]?.() : null,
        ].filter((c): c is string => !!c);
        return (
            <OnboardingShell step={journeyTotal} total={journeyTotal} onBack={() => goBack(STEPS.length - 1)} backLabel={t('public.vey.back')}
                footer={<Button label={t('welcome.go')} onPress={() => { captureEvent('onboarding_step', { step: 'recap', action: 'next' }); void finish(); }} />}>
                <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
                <ScrollView contentContainerStyle={styles.recap} showsVerticalScrollIndicator={false}>
                    {sample ? (
                        <Image source={{ uri: sample }} style={styles.sample} contentFit="cover" transition={reduced ? 0 : 240} onError={() => setSampleBroken(true)} accessibilityIgnoresInvertColors />
                    ) : (
                        <VeyCharacter width={120} interactive />
                    )}
                    <Text variant="title1" style={styles.title} accessibilityRole="header">{t('create.firstRun.suggested')}</Text>
                    <View style={styles.idea}>
                        <Text tone="primary" style={styles.ideaText}>{firstRunExample(shown.role, goal)}</Text>
                    </View>
                    <View style={styles.chips}>
                        {chips.map((chip) => <View key={chip} style={styles.chip}><Text variant="bodyStrong" tone="primary">{chip}</Text></View>)}
                    </View>
                    {/* Credits, then the receipt promise: price first, refund if it fails. */}
                    <Text tone="secondary" style={styles.promise}>{creditsLine}</Text>
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
    const title = key === 'goal' ? t('create.firstGoal.title') : key === 'destination' ? t('create.firstRun.destTitle') : t('create.firstRun.roleTitle');
    const picked = key === 'role' ? shown.role : key === 'goal' ? shown.goal : shown.destination;

    return (
        <OnboardingShell step={step + 1} total={journeyTotal}
            onBack={step > 0 ? () => goBack(step - 1) : undefined} backLabel={t('public.vey.back')} onSkip={() => answer('skipped')} skipLabel={t('create.firstGoal.skip')} footer={null}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                {/* Vey introduces the journey above the first question, so hello and what-to-make share one screen. */}
                {key === 'goal' ? (
                    <View style={styles.intro}>
                        <VeyCharacter width={96} interactive />
                        <Text variant="bodyStrong" tone="secondary" style={styles.text}>{t('welcome.hello.title')}</Text>
                    </View>
                ) : null}
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
    intro: { alignItems: 'center', gap: ds.space.xs },
    sample: { alignSelf: 'stretch', height: 200, borderRadius: ds.radius.xl },
    idea: { alignSelf: 'stretch', borderRadius: ds.radius.xl, borderWidth: 1.5, borderColor: p.accent, backgroundColor: p.accentSubtle, padding: ds.space.xl },
    ideaText: { textAlign: 'center' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: ds.space.sm },
    chip: { borderRadius: ds.radius.pill, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm },
}));
