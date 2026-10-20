import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { LEGAL_LINKS, PRIVACY_EMAIL, SUPPORT_EMAIL } from '../../lib/account';
import { MIN_TARGET } from '../../lib/a11y';
import { askHelp, helpErrorKey, helpRoute, MAX_QUESTION, type HelpPlan, type HelpTurn } from '../../lib/help';
import { t } from '../../lib/i18n';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { colors } from '../../theme';

// Help: where to write, the rules, and the way to contest a content decision. There is no FAQ list here: the
// server's /api/v1/help answers one question at a time (ADR-0125).
export default function Help() {
    const { api } = useAuth();
    const router = useRouter();
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [turns, setTurns] = useState<HelpTurn[]>([]);
    const [plan, setPlan] = useState<HelpPlan | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function ask() {
        const q = question.trim();
        if (!q || busy) return;
        setBusy(true);
        setError(null);
        try {
            const answer = await askHelp(api, q, turns);
            setPlan(answer);
            setTurns((cur) => [...cur, { role: 'user', content: q }, { role: 'assistant', content: answer.message }]);
            setQuestion('');
        } catch (err) {
            setError(t(helpErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    const route = plan ? helpRoute(plan) : null;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: 'Help' }} />
            <Section title={t('help.ask.title')}>
                <TextInput style={styles.input} value={question} onChangeText={setQuestion} maxLength={MAX_QUESTION} multiline placeholder={t('help.ask.placeholder')} accessibilityLabel={t('help.ask.label')} placeholderTextColor={colors.muted} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('help.ask.send')} disabled={busy || !question.trim()} style={[styles.ask, (busy || !question.trim()) && styles.off]} onPress={ask}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.askText}>{t('help.ask.send')}</Text>}
                </Pressable>
                <Text style={styles.note}>{t('help.ask.free')}</Text>
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                {plan ? (
                    <View style={styles.answer} accessible accessibilityLabel={`${t('help.answer')}: ${plan.message}`}>
                        <Text style={styles.rowText}>{plan.message}</Text>
                        {route ? <Row label={t('help.go')} onPress={() => router.push(route as never)} /> : null}
                    </View>
                ) : null}
            </Section>
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
    content: { padding: 16, paddingBottom: 16 + VEY_CLEARANCE, gap: 24 },
    section: { gap: 8 },
    sectionTitle: { color: colors.muted, fontSize: 14, textTransform: 'uppercase' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    rowText: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
    input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: MIN_TARGET * 1.5, maxHeight: 140 },
    ask: { minHeight: MIN_TARGET, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    askText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
    error: { color: colors.danger },
    answer: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 8 },
});
