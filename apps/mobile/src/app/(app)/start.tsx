import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { selectedState, touchTarget } from '../../lib/a11y';
import { fetchPresets, presetHref, type Preset } from '../../lib/presets';
import { colors, fonts } from '../../theme';

type Source = 'photo' | 'video' | 'reference' | 'prompt';

const SOURCES: readonly {
    key: Source;
    emoji: string;
    label: string;
    detail: string;
    color: string;
    selected: string;
    border: string;
}[] = [
    { key: 'photo', emoji: '📸', label: 'My photo', detail: 'Animate or transform it', color: '#FFE0F0', selected: '#FF9DCC', border: '#DC3988' },
    { key: 'video', emoji: '🎬', label: 'My video', detail: 'Add sound, sync or enhance', color: '#DDF5FF', selected: '#82D8FF', border: '#168BC0' },
    { key: 'reference', emoji: '🎨', label: 'A reference', detail: 'Guide a style or character', color: '#FFF2C7', selected: '#FFD65A', border: '#E4A900' },
    { key: 'prompt', emoji: '✨', label: 'Just an idea', detail: 'Describe the video in words', color: '#DDF9F1', selected: '#80E3CA', border: '#168E73' },
] as const;

const TEMPLATE_IDEAS = [
    { emoji: '🤳', title: 'Animate a portrait', color: '#DCCBFF' },
    { emoji: '🛒', title: 'Product reveal', color: '#FFDDA3' },
    { emoji: '🎵', title: 'Music visualizer', color: '#FFBBDD' },
    { emoji: '🌙', title: 'Story trailer', color: '#BFC7FF' },
] as const;

export function sourceHref(source: Source) {
    if (source === 'photo') return '/create/tools?source=image&mode=photo' as const;
    if (source === 'video') return '/create/tools?source=video&mode=video' as const;
    if (source === 'reference') return '/create/tools?source=image&mode=reference' as const;
    return '/create?goal=video' as const;
}

// Mobbin references: Picsart leads with Try/Remix previews, while Grok, Meta AI and ElevenLabs put the source
// (photo, gallery or prompt) next to creation. This screen combines those patterns instead of asking a preference quiz.
export default function Start() {
    const router = useRouter();
    const [source, setSource] = useState<Source | null>(null);
    const [templates, setTemplates] = useState<Preset[] | null>(null);

    useEffect(() => {
        let alive = true;
        fetchPresets()
            .then((items) => alive && setTemplates(items.filter((item) => item.available && item.posterUrl).slice(0, 4)))
            .catch(() => alive && setTemplates([]));
        return () => { alive = false; };
    }, []);

    const picked = SOURCES.find((item) => item.key === source) ?? null;

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body}>
                <Text style={styles.kicker}>CREATE YOUR FIRST VIDEO</Text>
                <Text style={styles.title} accessibilityRole="header">What are you starting with?</Text>
                <Text style={styles.lead}>Pick the real material. The next screen asks for that file, reference or idea.</Text>

                <View style={styles.sourceGrid}>
                    {SOURCES.map((item) => {
                        const on = source === item.key;
                        return (
                            <Pressable
                                key={item.key}
                                accessibilityRole="button"
                                accessibilityLabel={`${item.label}. ${item.detail}`}
                                accessibilityState={selectedState(on)}
                                style={({ pressed }) => [
                                    touchTarget,
                                    styles.source,
                                    { backgroundColor: on ? item.selected : item.color, borderColor: on ? item.border : item.color },
                                    on && styles.sourceOn,
                                    pressed && styles.pressed,
                                ]}
                                onPress={() => setSource(item.key)}
                            >
                                <View style={styles.sourceTop}>
                                    <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">{item.emoji}</Text>
                                    {on ? (
                                        <View style={[styles.check, { backgroundColor: item.border }]} accessibilityElementsHidden importantForAccessibility="no">
                                            <Text style={styles.checkText}>✓</Text>
                                        </View>
                                    ) : null}
                                </View>
                                <View style={styles.sourceCopy}>
                                    <Text style={styles.sourceLabel}>{item.label}</Text>
                                    <Text style={styles.sourceDetail}>{item.detail}</Text>
                                </View>
                            </Pressable>
                        );
                    })}
                </View>

                <View style={styles.sectionHead}>
                    <Text style={styles.sectionTitle} accessibilityRole="header">Or try a template</Text>
                    <Pressable accessibilityRole="button" onPress={() => router.replace('/create/presets')}>
                        <Text style={styles.seeAll}>See all</Text>
                    </Pressable>
                </View>
                {templates === null ? <ActivityIndicator color={colors.accent} /> : null}
                {templates?.length ? (
                    <View style={styles.templateGrid}>
                        {templates.map((template) => (
                            <Pressable
                                key={template.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Try ${template.title}`}
                                style={({ pressed }) => [styles.template, pressed && styles.templatePressed]}
                                onPress={() => router.replace(presetHref(template))}
                            >
                                <Image source={{ uri: template.posterUrl! }} style={styles.poster} contentFit="cover" />
                                <Text style={styles.templateName} numberOfLines={1}>{template.title}</Text>
                                <View style={styles.tryButton}><Text style={styles.tryText}>Try this</Text></View>
                            </Pressable>
                        ))}
                    </View>
                ) : templates ? (
                    <View style={styles.templateGrid}>
                        {TEMPLATE_IDEAS.map((template) => (
                            <Pressable
                                key={template.title}
                                accessibilityRole="button"
                                accessibilityLabel={`Browse ${template.title} templates`}
                                style={({ pressed }) => [styles.template, pressed && styles.templatePressed]}
                                onPress={() => router.replace('/create/presets')}
                            >
                                <View style={[styles.fallbackPoster, { backgroundColor: template.color }]}>
                                    <Text style={styles.fallbackEmoji} accessibilityElementsHidden importantForAccessibility="no">{template.emoji}</Text>
                                    <Text style={styles.fallbackTitle}>{template.title}</Text>
                                </View>
                                <View style={styles.tryButton}><Text style={styles.tryText}>Explore</Text></View>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                <Pressable accessibilityRole="button" style={[touchTarget, styles.library]} onPress={() => router.replace('/library')}>
                    <Text style={styles.libraryText}>Use something from my Library</Text>
                </Pressable>
            </ScrollView>

            <View style={styles.footer}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !source }}
                    disabled={!source}
                    style={[touchTarget, styles.primary, !source && styles.primaryOff]}
                    onPress={() => source && router.replace(sourceHref(source))}
                >
                    <Text style={styles.primaryText}>{picked ? `Continue with ${picked.label.toLowerCase()}` : 'Choose where to start'}</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { paddingHorizontal: 20, paddingTop: 62, paddingBottom: 18, gap: 12 },
    kicker: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
    title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 31, lineHeight: 36 },
    lead: { color: colors.body, fontSize: 16, lineHeight: 22, marginBottom: 4 },
    sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
    source: { width: '48%', minHeight: 124, borderWidth: 2, borderRadius: 20, padding: 13, justifyContent: 'space-between', shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
    sourceOn: { borderWidth: 3, transform: [{ scale: 1.025 }], shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
    pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
    sourceTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    emoji: { fontSize: 28, lineHeight: 34 },
    check: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    checkText: { color: '#FFFFFF', fontSize: 15, lineHeight: 18, fontWeight: '900' },
    sourceCopy: { gap: 2 },
    sourceLabel: { color: '#17171A', fontSize: 17, lineHeight: 21, fontWeight: '900' },
    sourceDetail: { color: '#34343A', fontSize: 12, lineHeight: 16, fontWeight: '600' },
    sectionHead: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: colors.text, fontFamily: fonts.display, fontSize: 21 },
    seeAll: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    templateGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
    template: { width: '48%', borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    templatePressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
    poster: { width: '100%', aspectRatio: 0.8, backgroundColor: colors.border },
    fallbackPoster: { width: '100%', aspectRatio: 0.8, padding: 14, justifyContent: 'space-between' },
    fallbackEmoji: { fontSize: 40 },
    fallbackTitle: { color: '#17171A', fontFamily: fonts.display, fontSize: 19, lineHeight: 23 },
    templateName: { color: colors.text, fontSize: 14, fontWeight: '700', paddingHorizontal: 10, paddingTop: 8 },
    tryButton: { margin: 8, marginTop: 6, borderRadius: 9, paddingVertical: 7, alignItems: 'center', backgroundColor: colors.accentSoft },
    tryText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
    library: { alignItems: 'center' },
    libraryText: { color: colors.muted, fontSize: 15, fontWeight: '600' },
    footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, backgroundColor: colors.background },
    primary: { backgroundColor: colors.accent, borderRadius: 14, alignItems: 'center', paddingHorizontal: 16 },
    primaryOff: { opacity: 0.35 },
    primaryText: { color: colors.accentInk, fontSize: 17, fontWeight: '800' },
});
