import { router } from 'expo-router';
import { Link, Stack } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LEGAL_LINKS, PRIVACY_EMAIL, SUPPORT_EMAIL } from '../../lib/account';
import { t } from '../../lib/i18n';
import { colors, LIST_END_PADDING } from '../../theme';

// Help: the guides, where to write, the rules, and the way to contest a content decision. The Vey question box was
// removed from the app (ADR-0265); questions go to support or the chat.
export default function Help() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('help.help') }} />
            <Link href="/guides" asChild>
                <Row label={t('helpGuides.title')} />
            </Link>
            <Section title={t('help.contactus')}>
                <Row label={t('help.emailsupport', { value1: SUPPORT_EMAIL })} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
                <Text style={styles.note}>{t('help.foraproblemwithachargeor', { value1: PRIVACY_EMAIL })}</Text>
            </Section>
            <Section title={t('help.topicAskinchat')}>
                <Link href="/chat" asChild>
                    <Row label={t('help.openchat')} />
                </Link>
                <Text style={styles.note}>{t('help.topicAskaquestionabouthowtheapp')}</Text>
            </Section>
            <Section title={t('help.contentdecisions')}>
                <Link href="/appeals" asChild>
                    <Row label={t('help.contentdecisionsandappeals')} />
                </Link>
                <Text style={styles.note}>{t('help.seeanythingrecordedagainstyouraccountand')}</Text>
                <Link href="/report" asChild>
                    <Row label={t('help.reportaproblemorcontent')} />
                </Link>
            </Section>
            <Section title={t('help.rulesandpolicies')}>
                {LEGAL_LINKS.map((l) => (
                    <Row key={l.route} label={l.label} onPress={() => router.push(l.route)} />
                ))}
            </Section>
        </ScrollView>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
            {children}
        </View>
    );
}

// Forwards the ref and any props a parent Link adds, so it also works as a Link child.
const Row = ({ label, onPress, ...rest }: { label: string; onPress?: () => void }) => (
    <Pressable {...rest} accessibilityRole="button" style={styles.row} onPress={onPress}>
        <Text style={styles.rowText}>{label}</Text>
    </Pressable>
);

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 24 },
    section: { gap: 8 },
    sectionTitle: { color: colors.muted, fontSize: 14, textTransform: 'uppercase' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    rowText: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
});
