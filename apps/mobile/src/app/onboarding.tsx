import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VeyCharacter } from '../components/VeyCharacter';
import { Button, Card, Icon, Text, themedStyles, usePressStyle, useThemedStyles } from '../components/ui';
import type { MenuIcon } from '../lib/menuIcons';
import { FIRST_GOALS, type StoredFirstGoal } from '../lib/firstGoal';
import { FIRST_DESTINATIONS, FIRST_ROLES, defaultAspectFor, type StoredDestination, type StoredRole } from '../lib/firstProfile';
import { firstRunExample } from '../lib/firstRunExamples';
import { t } from '../lib/i18n';
import { markWelcomeSeen } from '../lib/markWelcomeSeen';
import { browsePreAuthOnboarding, completePreAuthOnboarding, readPreAuthOnboarding, savePreAuthAnswers, skipPreAuthOnboarding, type PreAuthAnswers } from '../lib/preAuthOnboarding';
import { captureEvent } from '../lib/analytics/events';
import { ds } from '../theme';

type Stage = 'intro' | 'role' | 'goal' | 'destination' | 'result';
type QuestionStage = Exclude<Stage, 'intro' | 'result'>;
const QUESTIONS: readonly QuestionStage[] = ['role', 'goal', 'destination'];

const ROLE_LABEL: Record<(typeof FIRST_ROLES)[number], () => string> = {
    creator: () => t('create.firstRun.role.creator'),
    business: () => t('create.firstRun.role.business'),
    pro: () => t('create.firstRun.role.pro'),
    hobbyist: () => t('create.firstRun.role.hobbyist'),
    beginner: () => t('create.firstRun.role.beginner'),
};
const ROLE_ICON: Record<(typeof FIRST_ROLES)[number], MenuIcon> = {
    creator: 'video', business: 'bag', pro: 'slate', hobbyist: 'heart', beginner: 'sparkle',
};
const GOAL_LABEL: Record<(typeof FIRST_GOALS)[number], () => string> = {
    image: () => t('create.firstGoal.image'),
    video: () => t('create.firstGoal.video'),
    audio: () => t('create.firstGoal.audio'),
    edit: () => t('create.firstGoal.edit'),
    publish: () => t('create.firstGoal.publish'),
    unsure: () => t('create.firstGoal.unsure'),
};
const GOAL_ICON: Record<(typeof FIRST_GOALS)[number], MenuIcon> = {
    image: 'image', video: 'film', audio: 'audio', edit: 'sliders', publish: 'send', unsure: 'lightbulb',
};
const DESTINATION_LABEL: Record<(typeof FIRST_DESTINATIONS)[number], () => string> = {
    tiktok: () => t('create.firstRun.dest.tiktok'),
    reels: () => t('create.firstRun.dest.reels'),
    youtube: () => t('create.firstRun.dest.youtube'),
    private: () => t('create.firstRun.dest.private'),
};
const DESTINATION_ICON: Record<(typeof FIRST_DESTINATIONS)[number], MenuIcon> = {
    tiktok: 'phone', reels: 'video', youtube: 'play', private: 'shieldCheck',
};

const EMPTY: PreAuthAnswers = { role: null, goal: null, destination: null };

function firstOpenStage(answers: PreAuthAnswers): Stage {
    if (!answers.role) return 'role';
    if (!answers.goal) return 'goal';
    if (!answers.destination) return 'destination';
    return 'result';
}

export default function Onboarding() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(sheets);
    const pressStyle = usePressStyle();
    const [stage, setStage] = useState<Stage>('intro');
    const [editing, setEditing] = useState<QuestionStage | null>(null);
    const [answers, setAnswers] = useState<PreAuthAnswers>(EMPTY);
    const [loading, setLoading] = useState(true);
    const leaving = useRef(false);
    const startedTracked = useRef(false);
    const resultTracked = useRef(false);

    useEffect(() => {
        let alive = true;
        void readPreAuthOnboarding().then((saved) => {
            if (!alive) return;
            if (saved.completed) {
                if (saved.resume === 'preview') router.replace('/preview');
                else if (saved.pending) router.replace({ pathname: '/sign-in', params: { from: 'onboarding' } });
                else router.replace('/sign-in');
                return;
            }
            const restored = { role: saved.role, goal: saved.goal, destination: saved.destination };
            setAnswers(restored);
            if (saved.role || saved.goal || saved.destination) setStage(firstOpenStage(restored));
            setLoading(false);
        });
        return () => { alive = false; };
    }, [router]);

    useEffect(() => {
        if (loading) return;
        if (!startedTracked.current) {
            startedTracked.current = true;
            captureEvent('onboarding_started', { cohort: 'new' });
        }
        if (stage === 'result' && !resultTracked.current && answers.role && answers.goal && answers.destination) {
            resultTracked.current = true;
            captureEvent('onboarding_result_viewed', { role: answers.role, goal: answers.goal, destination: answers.destination });
        }
    }, [answers.destination, answers.goal, answers.role, loading, stage]);

    const choose = (key: keyof PreAuthAnswers, value: StoredRole | StoredFirstGoal | StoredDestination) => {
        const next = { ...answers, [key]: value };
        setAnswers(next);
        captureEvent('onboarding_answered', { question: key, answer: value });
        void savePreAuthAnswers({ [key]: value });
        if (editing === key) {
            setEditing(null);
            setStage('result');
        } else setStage(key === 'role' ? 'goal' : key === 'goal' ? 'destination' : 'result');
    };

    const finish = async (destination: 'sign-in' | 'preview') => {
        if (leaving.current || !answers.role || !answers.goal || !answers.destination) return;
        leaving.current = true;
        await completePreAuthOnboarding(answers, destination);
        if (destination === 'preview') {
            captureEvent('guest_browse_started', { source: 'result' });
            router.replace('/preview');
        }
        else router.push({ pathname: '/sign-in', params: { from: 'onboarding' } });
    };

    const browseFromIntro = async () => {
        if (leaving.current) return;
        leaving.current = true;
        captureEvent('guest_browse_started', { source: 'intro' });
        await Promise.all([browsePreAuthOnboarding(), markWelcomeSeen()]);
        router.replace('/preview');
    };

    const signInExisting = async () => {
        if (leaving.current) return;
        leaving.current = true;
        await Promise.all([skipPreAuthOnboarding(), markWelcomeSeen()]);
        router.push({ pathname: '/sign-in', params: { from: 'existing' } });
    };

    if (loading) return (
        <View style={[styles.screen, styles.loading]}>
            <Stack.Screen options={{ headerShown: false }} />
            <ActivityIndicator />
        </View>
    );

    const questionIndex = QUESTIONS.indexOf(stage as QuestionStage);
    const back = () => {
        if (editing) {
            setEditing(null);
            setStage('result');
            return;
        }
        setStage(stage === 'role' ? 'intro' : stage === 'goal' ? 'role' : stage === 'destination' ? 'goal' : 'destination');
    };
    const edit = (next: QuestionStage) => { setEditing(next); setStage(next); };

    return (
        <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: stage === 'intro' }} />
            {stage === 'intro' ? (
                <ScrollView contentContainerStyle={styles.intro} showsVerticalScrollIndicator={false}>
                    <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        <VeyCharacter width={150} interactive />
                    </View>
                    <Text variant="caption" tone="accent">{t('onboarding.kicker')}</Text>
                    <Text variant="display" accessibilityRole="header" style={styles.center}>{t('onboarding.title')}</Text>
                    <Text tone="secondary" style={styles.center}>{t('onboarding.body')}</Text>
                    <Card style={styles.promiseCard}>
                        <View style={styles.promiseRow}><Icon name="listChecks" size={24} /><Text variant="bodyStrong">{t('onboarding.start')}</Text></View>
                        <Text variant="footnote" tone="secondary">{t('onboarding.why')}</Text>
                    </Card>
                    <Button label={t('onboarding.start')} onPress={() => setStage(firstOpenStage(answers))} />
                    <Button variant="secondary" label={t('onboarding.preview')} onPress={() => void browseFromIntro()} />
                    <Button variant="tertiary" label={t('onboarding.existing')} onPress={() => void signInExisting()} />
                </ScrollView>
            ) : stage === 'result' ? (
                <Result answers={answers} onBack={back} onEdit={edit} onFinish={finish} />
            ) : (
                <View style={styles.questionShell}>
                    <View style={styles.questionTop}>
                        <Button variant="tertiary" size="sm" icon="arrowLeft" label={t('onboarding.back')} onPress={back} />
                        <Text variant="footnote" tone="secondary">{t('onboarding.progress', { current: questionIndex + 1, total: QUESTIONS.length })}</Text>
                    </View>
                    <View style={styles.progress} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        {QUESTIONS.map((item, index) => <View key={item} style={[styles.progressBar, index <= questionIndex && styles.progressBarOn]} />)}
                    </View>
                    <ScrollView contentContainerStyle={styles.questionBody} showsVerticalScrollIndicator={false}>
                        <Text variant="title1" accessibilityRole="header">
                            {stage === 'role' ? t('onboarding.role.title') : stage === 'goal' ? t('onboarding.goal.title') : t('onboarding.destination.title')}
                        </Text>
                        <Text tone="secondary">{t('create.firstRun.personalise')}</Text>
                        <View style={styles.options}>
                            {stage === 'role' ? FIRST_ROLES.map((value) => (
                                <Choice key={value} icon={ROLE_ICON[value]} label={ROLE_LABEL[value]()} onPress={() => choose('role', value)} pressStyle={pressStyle} styles={styles} />
                            )) : stage === 'goal' ? FIRST_GOALS.map((value) => (
                                <Choice key={value} icon={GOAL_ICON[value]} label={GOAL_LABEL[value]()} onPress={() => choose('goal', value)} pressStyle={pressStyle} styles={styles} />
                            )) : FIRST_DESTINATIONS.map((value) => (
                                <Choice key={value} icon={DESTINATION_ICON[value]} label={DESTINATION_LABEL[value]()} onPress={() => choose('destination', value)} pressStyle={pressStyle} styles={styles} />
                            ))}
                        </View>
                    </ScrollView>
                </View>
            )}
        </View>
    );
}

function Choice({ icon, label, onPress, pressStyle, styles }: { icon: MenuIcon; label: string; onPress: () => void; pressStyle: object; styles: ReturnType<typeof sheets> }) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.choice, pressed && pressStyle]}>
            <View style={styles.choiceIcon}><Icon name={icon} size={24} /></View>
            <Text variant="bodyStrong" style={styles.choiceLabel}>{label}</Text>
            <Icon name="caretRight" size={20} />
        </Pressable>
    );
}

function Result({ answers, onBack, onEdit, onFinish }: { answers: PreAuthAnswers; onBack: () => void; onEdit: (stage: QuestionStage) => void; onFinish: (destination: 'sign-in' | 'preview') => Promise<void> }) {
    const styles = useThemedStyles(sheets);
    const role = answers.role && answers.role !== 'skipped' ? ROLE_LABEL[answers.role]?.() : t('create.firstRun.role.beginner');
    const goal = answers.goal && answers.goal !== 'skipped' ? GOAL_LABEL[answers.goal]?.() : t('create.firstGoal.unsure');
    const destination = answers.destination && answers.destination !== 'skipped' ? DESTINATION_LABEL[answers.destination]?.() : t('create.firstRun.dest.private');
    const aspect = defaultAspectFor(answers.destination);
    const example = answers.goal === 'image' || answers.goal === 'video' || answers.goal === 'audio' ? firstRunExample(answers.role, answers.goal) : null;
    const goalKey = answers.goal && answers.goal !== 'skipped' ? answers.goal : 'unsure';
    const tool = t(`onboarding.result.tool.${goalKey}`);
    const timing = t(`onboarding.result.timing.${goalKey}`);
    const previewAspect = aspect === '9:16' ? 9 / 16 : aspect === '16:9' ? 16 / 9 : 1;
    return (
        <ScrollView contentContainerStyle={styles.result} showsVerticalScrollIndicator={false}>
            <Button variant="tertiary" size="sm" icon="arrowLeft" label={t('onboarding.back')} onPress={onBack} containerStyle={styles.backButton} />
            <Text variant="caption" tone="accent">{t('onboarding.result.kicker')}</Text>
            <Text variant="title1" accessibilityRole="header">{t('onboarding.result.title')}</Text>
            <Text tone="secondary">{t('onboarding.result.body')}</Text>
            <Card style={styles.starterCard}>
                <View style={styles.starterHeading}><Icon name="sparkle" size={22} /><Text variant="bodyStrong">{t('onboarding.result.workspace')}</Text></View>
                <View style={[styles.outputPreview, { aspectRatio: previewAspect }]}>
                    <Icon name={GOAL_ICON[goalKey]} size={34} />
                    <Text variant="title3" style={styles.center}>{tool}</Text>
                    {aspect ? <View style={styles.formatBadge}><Text variant="caption">{aspect}</Text></View> : null}
                </View>
                <ResultRow icon="sliders" label={t('onboarding.result.tool')} value={tool} styles={styles} />
                <ResultRow icon="hourglass" label={t('onboarding.result.timing')} value={timing} styles={styles} />
                {example ? <ResultRow icon="lightbulb" label={t('onboarding.result.example')} value={example} styles={styles} /> : null}
            </Card>
            <Card style={styles.resultCard}>
                <ResultRow icon="user" label={t('onboarding.result.role')} value={role} onChange={() => onEdit('role')} styles={styles} />
                <ResultRow icon="sparkle" label={t('onboarding.result.goal')} value={goal} onChange={() => onEdit('goal')} styles={styles} />
                <ResultRow icon="phone" label={aspect ? t('onboarding.result.format') : t('onboarding.result.private')} value={aspect ? `${aspect} · ${destination}` : destination} onChange={() => onEdit('destination')} styles={styles} />
            </Card>
            <Text variant="footnote" tone="secondary">{t('onboarding.why')}</Text>
            <Button label={t('onboarding.result.save')} onPress={() => void onFinish('sign-in')} />
            <Button variant="secondary" label={t('onboarding.result.browse')} onPress={() => void onFinish('preview')} />
        </ScrollView>
    );
}

function ResultRow({ icon, label, value, onChange, styles }: { icon: MenuIcon; label: string; value: string; onChange?: () => void; styles: ReturnType<typeof sheets> }) {
    return <View style={styles.resultRow}><View style={styles.resultIcon}><Icon name={icon} size={20} /></View><View style={styles.resultCopy}><Text variant="footnote" tone="secondary">{label}</Text><Text variant="bodyStrong">{value}</Text></View>{onChange ? <Pressable accessibilityRole="button" accessibilityLabel={t('onboarding.changeField', { field: label })} onPress={onChange} style={styles.change}><Text variant="footnote" tone="accent">{t('onboarding.change')}</Text></Pressable> : null}</View>;
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    loading: { alignItems: 'center', justifyContent: 'center' },
    intro: { flexGrow: 1, justifyContent: 'center', padding: ds.space.gutter, gap: ds.space.lg },
    hero: { alignItems: 'center', marginBottom: ds.space.sm },
    center: { textAlign: 'center' },
    promiseCard: { gap: ds.space.md, backgroundColor: p.accentSubtle, borderColor: p.accent },
    promiseRow: { flexDirection: 'row', gap: ds.space.md, alignItems: 'center' },
    questionShell: { flex: 1 },
    questionTop: { minHeight: 52, paddingHorizontal: ds.space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    progress: { flexDirection: 'row', gap: ds.space.sm, paddingHorizontal: ds.space.gutter },
    progressBar: { flex: 1, height: 4, borderRadius: ds.radius.pill, backgroundColor: p.borderSubtle },
    progressBarOn: { backgroundColor: p.accent },
    questionBody: { padding: ds.space.gutter, paddingTop: ds.space.xxxl, gap: ds.space.md },
    options: { gap: ds.space.sm, marginTop: ds.space.md },
    choice: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: ds.space.md, padding: ds.space.md, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, borderWidth: 1, borderColor: p.borderSubtle },
    choiceIcon: { width: 42, height: 42, borderRadius: ds.radius.md, backgroundColor: p.accentSubtle, alignItems: 'center', justifyContent: 'center' },
    choiceLabel: { flex: 1 },
    result: { flexGrow: 1, padding: ds.space.gutter, gap: ds.space.lg, justifyContent: 'center' },
    backButton: { alignSelf: 'flex-start' },
    starterCard: { gap: ds.space.lg, backgroundColor: p.accentSubtle, borderColor: p.accent },
    starterHeading: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    outputPreview: { width: '52%', minWidth: 150, maxHeight: 240, alignSelf: 'center', borderRadius: ds.radius.lg, backgroundColor: p.bgElevated2, borderWidth: 1, borderColor: p.borderSubtle, alignItems: 'center', justifyContent: 'center', gap: ds.space.sm, padding: ds.space.md },
    formatBadge: { position: 'absolute', right: ds.space.sm, bottom: ds.space.sm, borderRadius: ds.radius.pill, backgroundColor: p.bgElevated1, paddingHorizontal: ds.space.sm, paddingVertical: ds.space.xs },
    resultCard: { gap: ds.space.xl, backgroundColor: p.bgElevated1 },
    resultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: ds.space.md },
    resultIcon: { width: 40, height: 40, borderRadius: ds.radius.md, backgroundColor: p.accentSubtle, alignItems: 'center', justifyContent: 'center' },
    resultCopy: { flex: 1, gap: ds.space.xs },
    change: { minHeight: 44, minWidth: 60, alignItems: 'flex-end', justifyContent: 'center' },
}));
