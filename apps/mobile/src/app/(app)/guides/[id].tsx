import * as WebBrowser from 'expo-web-browser';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { guideById, guideDestination, presentGuide } from '../../../lib/helpGuides';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

export default function HelpGuide() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const [unavailable, setUnavailable] = useState(false);
    const source = guideById(id);
    const guide = source ? presentGuide(source, t) : null;

    function allGuides() {
        if (router.canGoBack()) router.back();
        else router.replace('/guides');
    }

    async function open(href: string) {
        setUnavailable(false);
        const destination = guideDestination(href);
        try {
            if (destination.kind === 'native') router.push(destination.href);
            else await WebBrowser.openBrowserAsync(destination.href);
        } catch {
            setUnavailable(true);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: guide?.title ?? t('helpGuides.title') }} />
            <Pressable accessibilityRole="link" style={touchTarget} onPress={allGuides}>
                <Text style={styles.link}>{t('helpGuides.all')}</Text>
            </Pressable>
            {guide ? (
                <>
                    <Text style={styles.title} accessibilityRole="header">{guide.title}</Text>
                    <Text style={styles.body}>{guide.summary}</Text>
                    {guide.steps.map((step, index) => (
                        <View key={index} style={styles.section}>
                            <Text style={styles.heading} accessibilityRole="header">{t('helpGuides.step', { number: index + 1, title: step.title })}</Text>
                            <Text style={styles.body}>{step.body}</Text>
                        </View>
                    ))}
                    <Text style={styles.heading} accessibilityRole="header">{t('helpGuides.links')}</Text>
                    {guide.links.map(link => (
                        <Pressable key={link.href} accessibilityRole="link" style={[styles.row, touchTarget]} onPress={() => void open(link.href)}>
                            <Text style={styles.link}>{link.label}</Text>
                        </Pressable>
                    ))}
                </>
            ) : <Text style={styles.body}>{t('helpGuides.unavailable')}</Text>}
            {unavailable ? <Text style={styles.body} accessibilityLiveRegion="polite">{t('helpGuides.unavailable')}</Text> : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + VEY_CLEARANCE, gap: 20 },
    title: { color: colors.text, fontSize: 24, fontWeight: '700' },
    heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
    body: { color: colors.body, fontSize: 16, lineHeight: 24 },
    section: { gap: 8 },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    link: { color: colors.accent, fontSize: 16 },
});
