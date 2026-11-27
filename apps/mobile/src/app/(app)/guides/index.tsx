import { Stack, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { VividCard } from '../../../components/ui';
import { HELP_GUIDES } from '../../../lib/helpGuidesData';
import { t } from '../../../lib/i18n';
import { colors, fonts, LIST_END_PADDING, VIVID_HUES } from '../../../theme';

export default function HelpGuides() {
    const router = useRouter();
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('helpGuides.title') }} />
            <Text style={styles.heading} accessibilityRole="header">{t('helpGuides.title')}</Text>
            <Text style={styles.note}>{t('helpGuides.lead')}</Text>
            {HELP_GUIDES.map((guide, index) => (
                <VividCard
                    key={guide.id}
                    hue={VIVID_HUES[index % VIVID_HUES.length]}
                    icon={index % 3 === 0 ? 'lightbulb' : index % 3 === 1 ? 'listChecks' : 'sparkle'}
                    title={t(guide.title)}
                    detail={`${t(guide.summary)} · ${t('helpGuides.steps', { count: guide.steps.length })}`}
                    layout="row"
                    showChevron
                    accessibilityRole="link"
                    onPress={() => router.push({ pathname: '/guides/[id]', params: { id: guide.id } })}
                />
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 16 },
    heading: { color: colors.text, fontFamily: fonts.display, fontSize: 24 },
    note: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
