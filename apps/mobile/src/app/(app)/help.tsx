import * as WebBrowser from 'expo-web-browser';
import { Link, Stack } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { HelpAsk } from '../../components/HelpAsk';
import { LEGAL_LINKS, PRIVACY_EMAIL, SUPPORT_EMAIL } from '../../lib/account';
import { colors } from '../../theme';

// Help: where to write, the rules, and the way to contest a content decision. There is no FAQ list here: the
// server's /api/v1/help answers one question at a time (ADR-0125).
export default function Help() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: 'Help' }} />
            <HelpAsk />
            <Section title="Contact us">
                <Row label={`Email support: ${SUPPORT_EMAIL}`} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
                <Text style={styles.note}>For a problem with a charge or a creation, write from the address on your account. Privacy requests go to {PRIVACY_EMAIL}.</Text>
            </Section>
            <Section title="Ask in chat">
                <Link href="/chat" asChild>
                    <Row label="Open chat" />
                </Link>
                <Text style={styles.note}>Ask a question about how the app works in a chat. Chat messages use credits as shown there.</Text>
            </Section>
            <Section title="Content decisions">
                <Link href="/appeals" asChild>
                    <Row label="Content decisions and appeals" />
                </Link>
                <Text style={styles.note}>See anything recorded against your account and appeal it if you think it is wrong.</Text>
                <Link href="/report" asChild>
                    <Row label="Report a problem or content" />
                </Link>
            </Section>
            <Section title="Rules and policies">
                {LEGAL_LINKS.map((l) => (
                    <Row key={l.url} label={l.label} onPress={() => WebBrowser.openBrowserAsync(l.url)} />
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
    content: { padding: 16, gap: 24 },
    section: { gap: 8 },
    sectionTitle: { color: colors.muted, fontSize: 14, textTransform: 'uppercase' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    rowText: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
});
