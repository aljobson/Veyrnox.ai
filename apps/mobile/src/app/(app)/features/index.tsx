import { rawText } from '../../../lib/i18n/translate';
import { displayLabel } from '../../../lib/displayLabels';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CREATIVE_FEATURE_GROUPS, CREATIVE_FEATURES } from '../../../lib/creativeFeatures';
import { compatibleCreativeFeatures, creativeReuseTargetHref, readCreativeReuse } from '../../../lib/creativeReuse';
import { t } from '../../../lib/i18n';
import { colors, fonts } from '../../../theme';

export default function CreativeFeatures() {
    const { sourceJobId, sourceKind } = useLocalSearchParams<{ sourceJobId?: string; sourceKind?: string }>();
    const router = useRouter();
    const reuse = readCreativeReuse(sourceJobId, sourceKind);
    const available = reuse ? compatibleCreativeFeatures(reuse.kind) : CREATIVE_FEATURES;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('features.creativetools') }} />
            <View style={styles.hero}>
                <Text style={styles.kicker}>{reuse ? t('features.reuse.kicker') : t('features.gUIDEDCREATION')}</Text>
                <Text style={styles.title} accessibilityRole="header">{reuse ? t('features.reuse.title', { kind: t(`mediaKind.${reuse.kind}`) }) : t('features.maketheexactthingyouneed')}</Text>
                <Text style={styles.lead}>{reuse ? t('features.reuse.lead') : t('features.chooseaworkflowVeyrnoxsetstheright')}</Text>
            </View>
            {CREATIVE_FEATURE_GROUPS.map((group) => {
                const features = available.filter((item) => item.group === group);
                if (!features.length) return null;
                return <View key={displayLabel(group)} style={styles.group}>
                    <View style={styles.groupHeading}><Text style={styles.groupTitle} accessibilityRole="header">{displayLabel(group)}</Text><Text style={styles.count}>{t('features.tools', { value1: features.length })}</Text></View>
                    <View style={styles.grid}>{features.map((feature) => (
                        <Pressable key={feature.slug} accessibilityRole="button" accessibilityLabel={rawText(`${feature.title}. ${feature.steps.join('. ')}`)} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => router.push(reuse ? creativeReuseTargetHref(feature.slug, reuse) : { pathname: '/features/[slug]', params: { slug: feature.slug } })}>
                            <View style={styles.mediaFrame}>
                                <Image source={{ uri: feature.example.posterUrl ?? feature.example.url }} style={styles.thumb} contentFit="contain" accessibilityLabel={rawText(t('features.example', { value1: feature.title }))} accessibilityIgnoresInvertColors />
                                {feature.example.kind === 'video' ? <View style={styles.playBadge} accessibilityElementsHidden><Text style={styles.play}>▶</Text></View> : null}
                            </View>
                                <View style={styles.cardCopy}>
                                    <Text style={styles.kind}>{t(`mediaKind.${feature.kind}`)}</Text>
                                    <Text style={styles.name}>{feature.title}</Text>
                                    <Text style={styles.summary} numberOfLines={2}>{feature.steps.join(' · ')}</Text>
                                </View>
                        </Pressable>
                    ))}</View>
                </View>;
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 80, gap: 28 },
    hero: { gap: 10, paddingVertical: 8 },
    kicker: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
    title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 38, lineHeight: 40 },
    lead: { color: colors.body, fontSize: 16, lineHeight: 24, maxWidth: 680 },
    group: { gap: 12 }, groupHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: colors.text, paddingBottom: 8 },
    groupTitle: { color: colors.text, fontSize: 23, fontWeight: '900' }, count: { color: colors.muted, fontSize: 11, fontWeight: '700' },
    grid: { gap: 12 }, card: { width: '100%', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    mediaFrame: { width: '100%', height: 210, alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090B' }, thumb: { width: '100%', height: '100%' },
    playBadge: { position: 'absolute', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
    play: { color: colors.accent, fontSize: 22, marginStart: 3 }, cardCopy: { padding: 16, gap: 5 }, kind: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
    name: { color: colors.text, fontSize: 17, fontWeight: '800' }, summary: { color: colors.muted, fontSize: 12, lineHeight: 17 }, pressed: { opacity: 0.72 },
});
