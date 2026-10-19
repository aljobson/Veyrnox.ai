import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { findOddling, portraitUrl } from '../../../lib/oddlings';
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
            <Image source={{ uri: portraitUrl(oddling.id) }} style={styles.portrait} contentFit="cover" cachePolicy="disk" accessibilityLabel={t('oddlings.portrait', { name: oddling.name })} accessibilityIgnoresInvertColors />
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
            <Text style={styles.note}>{t('oddlings.sheet.preview')}</Text>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 40 },
    muted: { color: colors.muted, padding: 24 },
    portrait: { width: '100%', aspectRatio: 2 / 3, borderRadius: 16, backgroundColor: colors.surface },
    kicker: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginTop: 16 },
    name: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
    hook: { color: colors.body, fontSize: 16, lineHeight: 22, marginTop: 8 },
    section: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 24, marginBottom: 8, textTransform: 'uppercase' },
    line: { color: colors.body, fontSize: 15, lineHeight: 22, marginBottom: 4 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { color: colors.muted, fontSize: 12, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
    build: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, marginTop: 24 },
    buildText: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
    note: { color: colors.muted, fontSize: 13, marginTop: 24 },
});
