import { Text as StatusText } from '../../../components/ui/Text';
import { VividCard } from '../../../components/ui/VividCard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { guideById, guideDestination, presentGuide } from '../../../lib/helpGuides';
import { t } from '../../../lib/i18n';
import { colors, fonts, LIST_END_PADDING, VIVID_HUES } from '../../../theme';

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
            if (destination) router.push(destination.href);
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
                    {guide.steps.map((step, index) => <VividCard
                        key={index}
                        hue={VIVID_HUES[index % VIVID_HUES.length]}
                        icon="listChecks"
                        title={t('helpGuides.step', { number: index + 1, title: step.title })}
                        detail={step.body}
                        layout="row"
                    />)}
                    {guide.links.length > 0 && <Text style={styles.heading} accessibilityRole="header">{t('helpGuides.links')}</Text>}
                    {guide.links.map(link => (
                        <VividCard key={link.href} hue="teal" icon="externalLink" title={link.label} layout="compact" showChevron accessibilityRole="link" onPress={() => void open(link.href)} />
                    ))}
                </>
            ) : <Text style={styles.body}>{t('helpGuides.unavailable')}</Text>}
            {unavailable ? <StatusText variant="inherit" style={styles.body} accessibilityLiveRegion="polite">{t('helpGuides.unavailable')}</StatusText> : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 20 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 24 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
    body: { color: colors.body, fontSize: 16, lineHeight: 24 },
    link: { color: colors.accent, fontSize: 16 },
});
