import { rawText } from '../../lib/i18n/translate';
import { captureEvent } from '../../lib/analytics/events';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { markWelcomeSeen } from '../../lib/markWelcomeSeen';
import { noteOnboardingCompleted } from '../../lib/celebrate';
import { HARD_PAYWALL_STARTER_CREDITS, hardPaywallEnabled } from '../../lib/hardPaywall';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { VeyCharacter } from '../../components/VeyCharacter';
import { touchTarget } from '../../lib/a11y';
import { WELCOME_CARDS, creditsCardKeys } from '../../lib/firstRun';
import { plural, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Button, Card, Icon, Text, themedStyles, useThemedStyles } from '../../components/ui';

// Three cards, shown once and skippable on every one. Vey waves on the first and last; the second quotes the real free credits.
export default function Welcome() {
    const insets = useSafeAreaInsets();
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
    const stepLabel = rawText(t('welcome.step', { n: index + 1, total: WELCOME_CARDS.length }));
    const cardTitle = card === 'hello' ? t('welcome.hello.title') : card === 'credits' ? t(credits.title) : t('welcome.start.title');
    // Next and Back swap the card under a button that keeps focus, so a screen reader is told the new card's title and step.
    // Not on first show: the screen is read then anyway. `everywhere`: there is no live region here for Android to use.
    useAnnouncement(`${rawText(cardTitle)}. ${stepLabel}`, { everywhere: true });

    async function done(action: 'next' | 'skip' = 'next') {
        captureEvent('onboarding_step', { step: 'welcome', action });
        await markWelcomeSeen();
        // Flag off: the first-run questions, then the home screen, which is where first run ends. Flag on: the questions, the Vibe check, then the paywall.
        if (!hardPaywallEnabled()) noteOnboardingCompleted();
        // The first-run questions come next (ADR-0339); they send an already-answered account straight on to this same place.
        router.replace('/first-run');
    }

    return (
        <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body}>
                {card === 'hello' ? (
                    <Card style={styles.card}>
                        <View style={styles.hero}>
                            <VeyCharacter width={160} interactive />
                        </View>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t('welcome.hello.title')}
                        </Text>
                        <Text tone="secondary" style={styles.text}>
                            {t('welcome.hello.body')}
                        </Text>
                    </Card>
                ) : null}
                {card === 'credits' ? (
                    <Card style={styles.card}>
                        <View style={styles.coins} accessibilityElementsHidden><Icon name="coins" size={28} /></View>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t(credits.title)}
                        </Text>
                        <Text tone="secondary" style={styles.text}>
                            {credits.count !== null ? plural(credits.body, credits.count) : t(credits.body, credits.params)}
                        </Text>
                        <Text tone="secondary" style={styles.text}>
                            {t('welcome.credits.price')}
                        </Text>
                    </Card>
                ) : null}
                {card === 'start' ? (
                    <Card style={styles.card}>
                        <View style={styles.hero}>
                            <VeyCharacter width={160} interactive />
                        </View>
                        <Text variant="title1" style={styles.title} accessibilityRole="header">
                            {t('welcome.start.title')}
                        </Text>
                        <Text tone="secondary" style={styles.text}>
                            {t('welcome.start.body')}
                        </Text>
                    </Card>
                ) : null}
            </ScrollView>
            <View style={styles.footer}>
                <Text style={styles.step} accessibilityLabel={stepLabel}>
                    {index + 1} / {WELCOME_CARDS.length}
                </Text>
                <Button label={last ? t('welcome.go') : t('welcome.next')} onPress={() => (last ? void done() : (captureEvent('onboarding_step', { step: 'welcome', action: 'next' }), setIndex(index + 1)))} />
                <Button variant="tertiary" disabled={index === 0} label={t('public.vey.back')} onPress={() => setIndex(index - 1)} />
                <Button variant="tertiary" label={t('welcome.skip')} onPress={() => void done('skip')} />
            </View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { flexGrow: 1, justifyContent: 'center', padding: ds.space.gutter },
    card: { alignItems: 'center', gap: ds.space.lg },
    coins: { width: 72, height: 72, borderRadius: 36, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
    hero: { marginBottom: ds.space.sm },
    title: { textAlign: 'center' },
    text: { textAlign: 'center' },
    footer: { padding: ds.space.gutter, gap: ds.space.sm },
    step: { color: p.textTertiary, textAlign: 'center' },
}));
