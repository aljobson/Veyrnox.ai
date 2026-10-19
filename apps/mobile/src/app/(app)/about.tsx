import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ABOUT_FACTS, LEGAL_EMAIL, LEGAL_LINKS } from '../../lib/account';
import { t } from '../../lib/i18n';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { colors } from '../../theme';

// About Veyrnox.ai: what it is, who runs it, how to write to us and the policies (the web's /about).
export default function About() {
    const version = Constants.expoConfig?.version;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('abt.title') }} />
            <Text style={styles.lead}>{t('abt.lead')}</Text>
            <Text style={styles.heading} accessibilityRole="header">{t('abt.details')}</Text>
            <View style={styles.card}>
                {ABOUT_FACTS.map((f) => (
                    <View key={f.labelKey} style={styles.fact} accessible accessibilityLabel={`${t(f.labelKey)}: ${f.value}`}>
                        <Text style={styles.note}>{t(f.labelKey)}</Text>
                        <Text style={styles.value}>{f.value}</Text>
                    </View>
                ))}
            </View>
            <Text style={styles.heading} accessibilityRole="header">{t('abt.contact')}</Text>
            <Pressable accessibilityRole="button" style={styles.row} onPress={() => Linking.openURL(`mailto:${LEGAL_EMAIL}`)}>
                <Text style={styles.value}>{t('abt.emailUs', { email: LEGAL_EMAIL })}</Text>
            </Pressable>
            {LEGAL_LINKS.map((l) => (
                <Pressable key={l.url} accessibilityRole="link" style={styles.row} onPress={() => WebBrowser.openBrowserAsync(l.url)}>
                    <Text style={styles.value}>{t(l.labelKey)}</Text>
                </Pressable>
            ))}
            {version ? <Text style={styles.note}>{t('abt.version', { version })}</Text> : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + VEY_CLEARANCE, gap: 14 },
    lead: { color: colors.text, fontSize: 16, lineHeight: 24 },
    heading: { color: colors.muted, fontSize: 14, textTransform: 'uppercase', marginTop: 8 },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
    fact: { paddingVertical: 12, gap: 2 },
    row: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
    value: { color: colors.text, fontSize: 15 },
    note: { color: colors.muted, fontSize: 13 },
});
