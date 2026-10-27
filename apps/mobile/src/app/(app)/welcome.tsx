import * as SecureStore from 'expo-secure-store';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { VeyCharacter } from '../../components/VeyCharacter';
import { touchTarget } from '../../lib/a11y';
import { appStorage } from '../../lib/appCache';
import { FIRST_RUN_SLOT, WELCOME_CARDS, creditsCardKeys, serializeSeen } from '../../lib/firstRun';
import { plural, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../../components/ui';

// Records that the welcome was shown (or skipped). A failure to save only means it may show once more.
export async function markWelcomeSeen(): Promise<void> {
    const seen = serializeSeen();
    await Promise.all([SecureStore.setItemAsync(FIRST_RUN_SLOT, seen).catch(() => undefined), appStorage.set(FIRST_RUN_SLOT, seen).catch(() => undefined)]);
}

// Three cards, shown once and skippable on every one. Vey waves on the first and last; the second quotes the real free credits.
export default function Welcome() {
    const router = useRouter();
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

    async function done() {
        await markWelcomeSeen();
        // Start with the person's actual material. The optional preference quiz remains available from Account.
        router.replace('/start');
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body}>
                {card === 'hello' ? (
                    <Card style={styles.card}>
                        <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <VeyCharacter width={160} />
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
                        <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <VeyCharacter width={160} />
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
                <Text style={styles.step} accessibilityLabel={t('welcome.step', { n: index + 1, total: WELCOME_CARDS.length })}>
                    {index + 1} / {WELCOME_CARDS.length}
                </Text>
                <Button label={last ? t('welcome.go') : t('welcome.next')} onPress={() => (last ? void done() : setIndex(index + 1))} />
                {index > 0 ? <Button variant="tertiary" label={t('public.vey.back')} onPress={() => setIndex(index - 1)} /> : null}
                {last ? null : <Button variant="tertiary" label={t('welcome.skip')} onPress={() => void done()} />}
            </View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { flexGrow: 1, justifyContent: 'center', padding: ds.space.gutter },
    card: { alignItems: 'center', gap: ds.space.lg },
    hero: { marginBottom: ds.space.sm },
    title: { textAlign: 'center' },
    text: { textAlign: 'center' },
    footer: { padding: ds.space.gutter, gap: ds.space.sm },
    step: { color: p.textTertiary, textAlign: 'center' },
}));
