import { rawText } from '../../lib/i18n/translate';
import { captureEvent } from '../../lib/analytics/events';
import { markWelcomeSeen } from '../../lib/markWelcomeSeen';
import { afterWelcomeHref, hardPaywallEnabled } from '../../lib/hardPaywall';
import { CREATOR_PROFILE_ENABLED } from '../../lib/creatorProfile';
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
    const credits = creditsCardKeys(free);

    async function done(action: 'next' | 'skip' = 'next') {
        captureEvent('onboarding_step', { step: 'welcome', action });
        await markWelcomeSeen();
        // Start with the person's actual material; with the hard paywall on, Vibe check comes next, then the paywall.
        router.replace(afterWelcomeHref(hardPaywallEnabled(), CREATOR_PROFILE_ENABLED));
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
                            {credits.count === null ? t(credits.body) : plural(credits.body, credits.count)}
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
                <Text style={styles.step} accessibilityLabel={rawText(t('welcome.step', { n: index + 1, total: WELCOME_CARDS.length }))}>
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
