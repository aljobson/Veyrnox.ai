import { Link, Stack, useRouter } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';
import { LEGAL_LINKS, PRIVACY_EMAIL, SUPPORT_EMAIL } from '../../lib/account';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { ds, LIST_END_PADDING, VIVID_HUES, type VividHue } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { Text, VividCard, themedStyles, useThemedStyles } from '../../components/ui';

// Help: the guides, where to write, the rules, and the way to contest a content decision. The Vey question box was
// removed from the app (ADR-0265); questions go to support or the chat.
export default function Help() {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('help.help') }} />
            <Link href="/guides" asChild>
                <HelpCard hue="blue" icon="bookmark" label={t('helpGuides.title')} />
            </Link>
            <Section title={t('help.contactus')}>
                <HelpCard hue="teal" icon="envelope" label={t('help.emailsupport', { value1: SUPPORT_EMAIL })} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
                <Text variant="footnote" tone="secondary">{t('help.foraproblemwithachargeor', { value1: PRIVACY_EMAIL })}</Text>
            </Section>
            <Section title={t('help.topicAskinchat')}>
                <Link href="/chat" asChild>
                    <HelpCard hue="purple" icon="chat" label={t('help.openchat')} />
                </Link>
                <Text variant="footnote" tone="secondary">{t('help.topicAskaquestionabouthowtheapp')}</Text>
            </Section>
            <Section title={t('help.contentdecisions')}>
                <Link href="/appeals" asChild>
                    <HelpCard hue="pink" icon="flag" label={t('help.contentdecisionsandappeals')} />
                </Link>
                <Text variant="footnote" tone="secondary">{t('help.seeanythingrecordedagainstyouraccountand')}</Text>
                <Link href="/report" asChild>
                    <HelpCard hue="orange" icon="flag" label={t('help.reportaproblemorcontent')} />
                </Link>
            </Section>
            <Section title={t('help.rulesandpolicies')}>
                {LEGAL_LINKS.map((link, index) => (
                    <HelpCard key={link.route} hue={VIVID_HUES[(index + 2) % VIVID_HUES.length]} icon="bookmark" label={link.label} onPress={() => router.push(link.route)} />
                ))}
            </Section>
        </ScrollView>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    const styles = useThemedStyles(sheets);
    return (
        <View style={styles.section}>
            <Text variant="footnote" tone="secondary" accessibilityRole="header">{title}</Text>
            {children}
        </View>
    );
}

// Link passes its onPress through this child; direct actions use the same component.
function HelpCard({ hue, icon, label, onPress }: { hue: VividHue; icon: MenuIcon; label: string; onPress?: () => void }) {
    return <VividCard hue={hue} icon={icon} title={label} layout="compact" showChevron accessibilityLabel={rawText(label)} onPress={onPress} />;
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.gutter, paddingBottom: ds.space.gutter + LIST_END_PADDING, gap: ds.space.xl },
    section: { gap: ds.space.sm },
}));
