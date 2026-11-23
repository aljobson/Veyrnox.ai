import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { VeyCharacter } from '../../components/VeyCharacter';
import { touchTarget } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { modalSafePadding } from '../../lib/modalLayout';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import { markReviewAsked, openRatingSheet } from '../../lib/storeReview';
import { colors, fonts } from '../../theme';

// Shown once, after the first finished creation. Both buttons end the ask for good; the first opens the store's own
// rating sheet for everyone, with no check on how the person feels.
export default function Rate() {
    const router = useRouter();
    const insets = useOptionalSafeAreaInsets();
    const { height, fontScale } = useWindowDimensions();
    const compact = height < 500 || fontScale >= 1.3;

    // Shown means asked, even if the screen is closed another way.
    useEffect(() => {
        void markReviewAsked();
    }, []);

    // A cold open (notification, link) has no screen behind it: go home rather than do nothing.
    const close = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };

    async function rate() {
        close();
        await openRatingSheet();
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={[styles.content, modalSafePadding(insets, 24)]} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('rate.title'), headerShown: false, presentation: 'modal' }} />
            <View style={styles.card}>
                <View>
                    <VeyCharacter width={compact ? 88 : 140} interactive />
                </View>
                <Text style={styles.title} accessibilityRole="header">{t('rate.title')}</Text>
                <Text style={styles.text}>{t('rate.body')}</Text>
                <Text style={styles.note}>{t('rate.note')}</Text>
            </View>
            <View style={styles.footer}>
                <Pressable accessibilityRole="button" style={[touchTarget, styles.primary]} onPress={() => void rate()}>
                    <Text style={styles.primaryText}>{t('rate.cta')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={[touchTarget, styles.skip]} onPress={close}>
                    <Text style={styles.skipText}>{t('rate.later')}</Text>
                </Pressable>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
    card: { width: '100%', maxWidth: 560, alignItems: 'center', gap: 16, padding: 24 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 26, textAlign: 'center' },
    text: { color: colors.body, fontSize: 17, lineHeight: 24, textAlign: 'center' },
    note: { color: colors.muted, fontSize: 14, textAlign: 'center' },
    footer: { width: '100%', maxWidth: 560, padding: 24, gap: 8, alignItems: 'stretch' },
    primary: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingHorizontal: 16 },
    primaryText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
    skip: { alignItems: 'center' },
    skipText: { color: colors.muted, fontSize: 16 },
});
