import { Image } from 'expo-image';
import { Link, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CREATIVE_FEATURE_GROUPS, CREATIVE_FEATURES } from '../../../lib/creativeFeatures';
import { colors, fonts } from '../../../theme';

export default function CreativeFeatures() {
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: 'Creative tools' }} />
            <View style={styles.hero}>
                <Text style={styles.kicker}>GUIDED CREATION</Text>
                <Text style={styles.title} accessibilityRole="header">Make the exact thing you need</Text>
                <Text style={styles.lead}>Choose a workflow. Veyrnox sets the right model, prompt shape and required uploads, then opens the final review in Create.</Text>
            </View>
            {CREATIVE_FEATURE_GROUPS.map((group) => {
                const features = CREATIVE_FEATURES.filter((item) => item.group === group);
                return <View key={group} style={styles.group}>
                    <View style={styles.groupHeading}><Text style={styles.groupTitle} accessibilityRole="header">{group}</Text><Text style={styles.count}>{features.length} tools</Text></View>
                    <View style={styles.grid}>{features.map((feature) => (
                        <Link key={feature.slug} href={{ pathname: '/features/[slug]', params: { slug: feature.slug } }} asChild>
                            <Pressable accessibilityRole="button" accessibilityLabel={`${feature.title}. ${feature.steps.join('. ')}`} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
                                {feature.example.kind === 'image' ? <Image source={{ uri: feature.example.url }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={styles.videoThumb}><Text style={styles.play}>▶</Text></View>}
                                <View style={styles.cardCopy}>
                                    <Text style={styles.kind}>{feature.kind.toUpperCase()}</Text>
                                    <Text style={styles.name}>{feature.title}</Text>
                                    <Text style={styles.summary} numberOfLines={2}>{feature.steps.join(' · ')}</Text>
                                </View>
                            </Pressable>
                        </Link>
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
    grid: { gap: 10 }, card: { minHeight: 116, flexDirection: 'row', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    thumb: { width: 116, minHeight: 116, backgroundColor: colors.background }, videoThumb: { width: 116, minHeight: 116, alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090B' },
    play: { color: colors.accent, fontSize: 25 }, cardCopy: { flex: 1, padding: 14, gap: 5, justifyContent: 'center' }, kind: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
    name: { color: colors.text, fontSize: 17, fontWeight: '800' }, summary: { color: colors.muted, fontSize: 12, lineHeight: 17 }, pressed: { opacity: 0.72 },
});
