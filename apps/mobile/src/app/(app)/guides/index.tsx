import { Stack, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { HELP_GUIDES } from '../../../lib/helpGuidesData';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

export default function HelpGuides() {
    const router = useRouter();
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('helpGuides.title') }} />
            <Text style={styles.heading} accessibilityRole="header">{t('helpGuides.title')}</Text>
            <Text style={styles.note}>{t('helpGuides.lead')}</Text>
            {HELP_GUIDES.map(guide => (
                <Pressable
                    key={guide.id}
                    accessibilityRole="link"
                    style={[styles.row, touchTarget]}
                    onPress={() => router.push({ pathname: '/guides/[id]', params: { id: guide.id } })}
                >
                    <Text style={styles.name}>{t(guide.title)}</Text>
                    <Text style={styles.note}>{t(guide.summary)}</Text>
                    <Text style={styles.note}>{t('helpGuides.steps', { count: guide.steps.length })}</Text>
                </Pressable>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + VEY_CLEARANCE, gap: 16 },
    heading: { color: colors.text, fontSize: 24, fontWeight: '700' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
    name: { color: colors.text, fontSize: 17, fontWeight: '600' },
    note: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
