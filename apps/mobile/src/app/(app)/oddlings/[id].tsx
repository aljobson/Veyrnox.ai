import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { OddlingPortrait } from '../../../components/oddlings/OddlingPortrait';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { findOddling, shareMessage, shareUrl } from '../../../lib/oddlings';
import { colors } from '../../../theme';

export default function OddlingSheet() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const oddling = findOddling(id);
    if (!oddling) {
        return (
            <View style={styles.screen}>
                <Stack.Screen options={{ title: t('oddlings.title') }} />
                <Text style={styles.muted}>{t('oddlings.sheet.notFound')}</Text>
            </View>
        );
    }
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: oddling.name }} />
            <OddlingPortrait id={oddling.id} name={oddling.name} />
            <Text style={styles.kicker}>{t('oddlings.sheet.title').toUpperCase()}</Text>
            <Text style={styles.name} accessibilityRole="header">{oddling.name}</Text>
            <Text style={styles.hook}>{oddling.hook}</Text>
            <Text style={styles.section} accessibilityRole="header">{t('oddlings.sheet.premise')}</Text>
            {oddling.identity.map((line) => <Text key={line} style={styles.line}>— {line}</Text>)}
            <Text style={styles.section} accessibilityRole="header">{t('oddlings.sheet.canon')}</Text>
            <View style={styles.tags}>
                {oddling.traits.map((line) => <Text key={line} style={styles.tag}>{line}</Text>)}
            </View>
            <Pressable accessibilityRole="button" style={styles.build} onPress={() => router.push({ pathname: '/oddlings/build', params: { from: oddling.id } })}>
                <Text style={styles.buildText}>{t('oddlings.build.recreate')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.share} onPress={() => { void Share.share({ message: shareMessage(oddling.name, oddling.hook), url: shareUrl(oddling.id) }).catch(() => undefined); }}>
                <Text style={styles.shareText}>{t('oddlings.sheet.share')}</Text>
            </Pressable>
            <Text style={styles.note}>{t('oddlings.sheet.preview')}</Text>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: VEY_CLEARANCE + 32 },
    muted: { color: colors.muted, padding: 24 },
    kicker: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginTop: 16 },
    name: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
    hook: { color: colors.body, fontSize: 16, lineHeight: 22, marginTop: 8 },
    section: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 24, marginBottom: 8, textTransform: 'uppercase' },
    line: { color: colors.body, fontSize: 15, lineHeight: 22, marginBottom: 4 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { color: colors.muted, fontSize: 12, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
    build: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, marginTop: 24 },
    buildText: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
    share: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, marginTop: 12 },
    shareText: { color: colors.text, fontSize: 16, fontWeight: '700' },
    note: { color: colors.muted, fontSize: 13, marginTop: 24 },
});
