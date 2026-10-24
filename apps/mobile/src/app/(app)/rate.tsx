import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VeyCharacter } from '../../components/VeyCharacter';
import { touchTarget } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { markReviewAsked, openRatingSheet } from '../../lib/storeReview';
import { colors, fonts } from '../../theme';

// Shown once, after the first finished creation. Both buttons end the ask for good; the first opens the store's own
// rating sheet for everyone, with no check on how the person feels.
export default function Rate() {
    const router = useRouter();

    // Shown means asked, even if the screen is closed another way.
    useEffect(() => {
        void markReviewAsked();
    }, []);

    async function rate() {
        router.back();
        await openRatingSheet();
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
            <View style={styles.card}>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <VeyCharacter width={140} />
                </View>
                <Text style={styles.title} accessibilityRole="header">{t('rate.title')}</Text>
                <Text style={styles.text}>{t('rate.body')}</Text>
                <Text style={styles.note}>{t('rate.note')}</Text>
            </View>
            <View style={styles.footer}>
                <Pressable accessibilityRole="button" style={[touchTarget, styles.primary]} onPress={() => void rate()}>
                    <Text style={styles.primaryText}>{t('rate.cta')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={[touchTarget, styles.skip]} onPress={() => router.back()}>
                    <Text style={styles.skipText}>{t('rate.later')}</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
    card: { alignItems: 'center', gap: 16, padding: 24 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 26, textAlign: 'center' },
    text: { color: colors.body, fontSize: 17, lineHeight: 24, textAlign: 'center' },
    note: { color: colors.muted, fontSize: 14, textAlign: 'center' },
    footer: { padding: 24, gap: 8, alignItems: 'stretch' },
    primary: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingHorizontal: 16 },
    primaryText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
    skip: { alignItems: 'center' },
    skipText: { color: colors.muted, fontSize: 16 },
});
