import * as SecureStore from 'expo-secure-store';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { VeyCharacter } from '../../components/VeyCharacter';
import { touchTarget } from '../../lib/a11y';
import { appStorage } from '../../lib/appCache';
import { FIRST_RUN_SLOT, WELCOME_CARDS, creditsCardKeys, serializeSeen } from '../../lib/firstRun';
import { plural, t } from '../../lib/i18n';
import { colors, fonts } from '../../theme';

// Records that the welcome was shown (or skipped). A failure to save only means it may show once more.
export async function markWelcomeSeen(): Promise<void> {
    const seen = serializeSeen();
    await Promise.all([
        SecureStore.setItemAsync(FIRST_RUN_SLOT, seen).catch(() => undefined),
        appStorage.set(FIRST_RUN_SLOT, seen).catch(() => undefined),
    ]);
}

// Three cards, shown once and skippable on every one. Vey waves on the first and last; the second quotes the real free credits.
export default function Welcome() {
    const router = useRouter();
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
                    <View style={styles.card}>
                        <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <VeyCharacter width={160} />
                        </View>
                        <Text style={styles.title} accessibilityRole="header">{t('welcome.hello.title')}</Text>
                        <Text style={styles.text}>{t('welcome.hello.body')}</Text>
                    </View>
                ) : null}
                {card === 'credits' ? (
                    <View style={styles.card}>
                        <Text style={styles.title} accessibilityRole="header">{t(credits.title)}</Text>
                        <Text style={styles.text}>{credits.count === null ? t(credits.body) : plural(credits.body, credits.count)}</Text>
                        <Text style={styles.text}>{t('welcome.credits.price')}</Text>
                    </View>
                ) : null}
                {card === 'start' ? (
                    <View style={styles.card}>
                        <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            <VeyCharacter width={160} />
                        </View>
                        <Text style={styles.title} accessibilityRole="header">{t('welcome.start.title')}</Text>
                        <Text style={styles.text}>{t('welcome.start.body')}</Text>
                    </View>
                ) : null}
            </ScrollView>
            <View style={styles.footer}>
                <Text style={styles.step} accessibilityLabel={t('welcome.step', { n: index + 1, total: WELCOME_CARDS.length })}>
                    {index + 1} / {WELCOME_CARDS.length}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    style={[touchTarget, styles.primary]}
                    onPress={() => (last ? void done() : setIndex(index + 1))}
                >
                    <Text style={styles.primaryText}>{last ? t('welcome.go') : t('welcome.next')}</Text>
                </Pressable>
                {index > 0 ? (
                    <Pressable accessibilityRole="button" style={[touchTarget, styles.skip]} onPress={() => setIndex(index - 1)}>
                        <Text style={styles.skipText}>{t('public.vey.back')}</Text>
                    </Pressable>
                ) : null}
                {last ? null : (
                    <Pressable accessibilityRole="button" style={[touchTarget, styles.skip]} onPress={() => void done()}>
                        <Text style={styles.skipText}>{t('welcome.skip')}</Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    card: { alignItems: 'center', gap: 16 },
    hero: { marginBottom: 8 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 26, textAlign: 'center' },
    text: { color: colors.body, fontSize: 17, lineHeight: 24, textAlign: 'center' },
    footer: { padding: 24, gap: 8, alignItems: 'stretch' },
    step: { color: colors.muted, fontSize: 14, textAlign: 'center' },
    primary: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingHorizontal: 16 },
    primaryText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
    skip: { alignItems: 'center' },
    skipText: { color: colors.muted, fontSize: 16 },
});
