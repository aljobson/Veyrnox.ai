import * as WebBrowser from 'expo-web-browser';
import { Stack, useRouter } from 'expo-router';
import { Share, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GrantsCard } from '../../components/account/GrantsCard';
import { API_BASE } from '../../lib/api';
import { t } from '../../lib/i18n';
import { colors, fonts } from '../../theme';

export const MCP_ENDPOINT = 'https://veyrnox.ai/api/v1/mcp';

const steps = [
    ['01', 'mcp.step1.title', 'mcp.step1.body'],
    ['02', 'mcp.step2.title', 'mcp.step2.body'],
    ['03', 'mcp.step3.title', 'mcp.step3.body'],
] as const;

export default function Mcp() {
    const router = useRouter();
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('mcp.title') }} />
            <View style={styles.hero}>
                <Text style={styles.kicker}>{t('mcp.kicker')}</Text>
                <Text style={styles.title} accessibilityRole="header">{t('mcp.title')}</Text>
                <Text style={styles.lead}>{t('mcp.lead')}</Text>
            </View>

            <View style={styles.card}>
                <Text style={styles.label}>{t('mcp.endpoint')}</Text>
                <Text selectable accessibilityLabel={`${t('mcp.endpoint')}: ${MCP_ENDPOINT}`} style={styles.endpoint}>{MCP_ENDPOINT}</Text>
                <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => void Share.share({ title: t('mcp.title'), message: MCP_ENDPOINT })}>
                    <Text style={styles.primaryText}>{t('mcp.share')}</Text>
                </Pressable>
            </View>

            <View style={styles.section}>
                <Text style={styles.heading} accessibilityRole="header">{t('mcp.connect')}</Text>
                {steps.map(([number, title, body]) => (
                    <View key={number} style={styles.step}>
                        <Text style={styles.number}>{number}</Text>
                        <View style={styles.stepCopy}>
                            <Text style={styles.stepTitle}>{t(title)}</Text>
                            <Text style={styles.body}>{t(body)}</Text>
                        </View>
                    </View>
                ))}
                <Text style={styles.note}>{t('mcp.noKey')}</Text>
            </View>

            <View style={styles.card}>
                <Text style={styles.heading} accessibilityRole="header">{t('mcp.capabilities')}</Text>
                <Text style={styles.body}>• {t('mcp.read')}</Text>
                <Text style={styles.body}>• {t('mcp.create')}</Text>
                <Text style={styles.safety}>{t('mcp.safety')}</Text>
                <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push('/credits')}>
                    <Text style={styles.secondaryText}>{t('mcp.credits')}</Text>
                </Pressable>
                <Pressable accessibilityRole="link" style={styles.secondary} onPress={() => void WebBrowser.openBrowserAsync(`${API_BASE}/mcp`)}>
                    <Text style={styles.secondaryText}>{t('mcp.webGuide')}</Text>
                </Pressable>
            </View>

            <Text style={styles.heading} accessibilityRole="header">{t('mcp.connections')}</Text>
            <GrantsCard />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 80, gap: 18 },
    hero: { gap: 8, paddingVertical: 8 },
    kicker: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
    title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 34, lineHeight: 38 },
    lead: { color: colors.body, fontSize: 17, lineHeight: 25 },
    card: { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    section: { gap: 12 },
    label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
    endpoint: { color: colors.text, fontSize: 13, lineHeight: 20 },
    heading: { color: colors.text, fontSize: 20, fontWeight: '800' },
    step: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
    number: { width: 34, color: colors.accent, fontSize: 13, fontWeight: '900' },
    stepCopy: { flex: 1, gap: 4 },
    stepTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    body: { color: colors.body, fontSize: 15, lineHeight: 22 },
    note: { color: colors.muted, fontSize: 13, lineHeight: 19, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
    safety: { color: colors.money, fontSize: 14, lineHeight: 20 },
    primary: { minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
    secondary: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    pressed: { opacity: 0.78 },
});
