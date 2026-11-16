import { rawText } from '../../lib/i18n/translate';
import { captureEvent } from '../../lib/analytics/events';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { noteOnboardingCompleted } from '../../lib/celebrate';
import { HARD_PAYWALL_STARTER_CREDITS, hardPaywallEnabled } from '../../lib/hardPaywall';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { VeyCharacter } from '../../components/VeyCharacter';
import { ONBOARDING_TOTAL, WELCOME_CARDS, creditsCardKeys } from '../../lib/firstRun';
import { OnboardingShell } from '../../components/OnboardingShell';
import { plural, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../../components/ui';

// Three cards, shown once and skippable on every one. Vey waves on the first and last; the second quotes the real free credits.
export default function Welcome() {
    const router = useRouter();
    useEffect(() => { captureEvent('onboarding_step', { step: 'welcome', action: 'view' }); }, []);
    const styles = useThemedStyles(sheets);
    const { api } = useAuth();
    const [index, setIndex] = useState(0);
    const [free, setFree] = useState<number | null>(null);

    useEffect(() => {
        let alive = true;
        api.getBalance()
            .then((b) => alive && setFree(b.free_credits))
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [api]);

    const card = WELCOME_CARDS[index] ?? 'hello';
    const last = index === WELCOME_CARDS.length - 1;
    const credits = creditsCardKeys(free, hardPaywallEnabled() ? HARD_PAYWALL_STARTER_CREDITS : null);
    const stepLabel = rawText(t('welcome.step', { n: index + 1, total: ONBOARDING_TOTAL }));
    const cardTitle = card === 'hello' ? t('welcome.hello.title') : card === 'credits' ? t(credits.title) : t('welcome.start.title');
    // Next and Back swap the card under a button that keeps focus, so a screen reader is told the new card's title and step.
    // Not on first show: the screen is read then anyway. `everywhere`: there is no live region here for Android to use.
    useAnnouncement(`${rawText(cardTitle)}. ${stepLabel}`, { everywhere: true });

    function done(action: 'next' | 'skip' = 'next') {
        captureEvent('onboarding_step', { step: 'welcome', action });
        // Not marked seen here: the first-run questions do that when they finish, so quitting during them brings the
        // welcome and its questions back on the next launch.
        // Flag off: the first-run questions, then the home screen, which is where first run ends. Flag on: the questions, the Vibe check, then the paywall.
        if (!hardPaywallEnabled()) noteOnboardingCompleted();
        // The first-run questions come next (ADR-0339); they send an already-answered account straight on to this same place.
        router.replace('/first-run');
    }

    return (
        <OnboardingShell
            step={index + 1}
            total={ONBOARDING_TOTAL}
            onBack={index > 0 ? () => setIndex(index - 1) : undefined}
            onSkip={() => done('skip')}
            skipLabel={t('welcome.skip')}
            backLabel={t('public.vey.back')}
            footer={<Button label={last ? t('welcome.go') : t('welcome.next')} onPress={() => (last ? done() : (captureEvent('onboarding_step', { step: 'welcome', action: 'next' }), setIndex(index + 1)))} />}
        >
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            {/* One layout for all three steps, so Vey stays mounted (and keeps waving) instead of loading again on every Next and Back. */}
            <ScrollView contentContainerStyle={styles.stage} showsVerticalScrollIndicator={false}>
                <View style={[styles.hero, card === 'credits' && styles.hidden]}>
                    <VeyCharacter width={200} interactive />
                </View>
                {card === 'credits' ? <View style={styles.coins} accessibilityElementsHidden><Icon name="coins" size={28} /></View> : null}
                <Text variant="title1" style={styles.title} accessibilityRole="header">
                    {cardTitle}
                </Text>
                <Text tone="secondary" style={styles.text}>
                    {card === 'hello' ? t('welcome.hello.body') : card === 'start' ? t('welcome.start.body')
                        : credits.count !== null ? plural(credits.body, credits.count) : t(credits.body, credits.params)}
                </Text>
                {card === 'credits' ? (
                    <Text tone="secondary" style={styles.text}>
                        {t('welcome.credits.price')}
                    </Text>
                ) : null}
            </ScrollView>
        </OnboardingShell>
    );
}

const sheets = themedStyles((p) => ({
    stage: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: ds.space.lg, paddingVertical: ds.space.lg },
    coins: { width: 96, height: 96, borderRadius: 48, backgroundColor: p.accentSubtle, borderWidth: 1.5, borderColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    hero: { marginBottom: ds.space.sm },
    hidden: { display: 'none' },
    title: { textAlign: 'center' },
    text: { textAlign: 'center' },
}));
