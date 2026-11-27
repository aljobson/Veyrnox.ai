import { rawText } from '../../lib/i18n/translate';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { VividCard } from '../../components/ui';
import { ABOUT_FACTS, LEGAL_EMAIL, LEGAL_LINKS } from '../../lib/account';
import { t } from '../../lib/i18n';
import { colors, LIST_END_PADDING, VIVID_HUES } from '../../theme';

// About Veyrnox.ai: what it is, who runs it, how to write to us and the policies (the web's /about).
export default function About() {
    const version = Constants.expoConfig?.version;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('abt.title') }} />
            <Text style={styles.lead}>{t('abt.lead')}</Text>
            <Text style={styles.heading} accessibilityRole="header">{t('abt.details')}</Text>
            {ABOUT_FACTS.map((f, index) => <VividCard
                key={f.labelKey}
                hue={VIVID_HUES[index % VIVID_HUES.length]}
                icon="idCard"
                eyebrow={t(f.labelKey)}
                title={f.value}
                layout="compact"
                accessibilityRole="text"
                accessibilityLabel={rawText(`${t(f.labelKey)}: ${f.value}`)}
            />)}
            <Text style={styles.heading} accessibilityRole="header">{t('abt.contact')}</Text>
            <VividCard hue="orange" icon="envelope" title={t('abt.emailUs', { email: LEGAL_EMAIL })} layout="row" showChevron accessibilityRole="button" onPress={() => void Linking.openURL(`mailto:${LEGAL_EMAIL}`)} />
            {LEGAL_LINKS.map((l, index) => <VividCard key={l.route} hue={VIVID_HUES[(index + 3) % VIVID_HUES.length]} icon="shieldCheck" title={t(l.labelKey)} layout="compact" showChevron accessibilityRole="link" onPress={() => router.push(l.route)} />)}
            {version ? <Text style={styles.note}>{t('abt.version', { version })}</Text> : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 14 },
    lead: { color: colors.text, fontSize: 16, lineHeight: 24 },
    heading: { color: colors.muted, fontSize: 14, textTransform: 'uppercase', marginTop: 8 },
    note: { color: colors.muted, fontSize: 13 },
});
