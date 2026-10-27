import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { selectedState, touchTarget } from '../../lib/a11y';
import { fetchPresets, presetHref, type Preset } from '../../lib/presets';
import { colors, ds } from '../../theme';
import { Button, Card, Text, ChoiceCard, themedStyles, useThemedStyles } from '../../components/ui';
import { noteOnboardingCompleted } from '../../lib/celebrate';
import type { MenuIcon } from '../../lib/menuIcons';

type Source = 'photo' | 'video' | 'reference' | 'prompt';

const SOURCES: readonly { key: Source; icon: MenuIcon; label: string; detail: string }[] = [
    { key: 'photo', icon: 'camera', label: 'My photo', detail: 'Animate or transform it' },
    { key: 'video', icon: 'film', label: 'My video', detail: 'Add sound, sync or enhance' },
    { key: 'reference', icon: 'brush', label: 'A reference', detail: 'Guide a style or character' },
    { key: 'prompt', icon: 'sparkle', label: 'Just an idea', detail: 'Describe the video in words' },
];
const TEMPLATE_IDEAS = [
    { icon: 'camera', title: 'Animate a portrait' },
    { icon: 'bag', title: 'Product reveal' },
    { icon: 'audio', title: 'Music visualizer' },
    { icon: 'moon', title: 'Story trailer' },
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
    const styles = useThemedStyles(sheets);
    const [source, setSource] = useState<Source | null>(null);
    const [templates, setTemplates] = useState<Preset[] | null>(null);

    useEffect(() => {
        let alive = true;
        fetchPresets()
            .then((items) => alive && setTemplates(items.filter((item) => item.available && item.posterUrl).slice(0, 4)))
            .catch(() => alive && setTemplates([]));
        return () => {
            alive = false;
        };
    }, []);

    const picked = SOURCES.find((item) => item.key === source) ?? null;

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <ScrollView contentContainerStyle={styles.body}>
                <Text variant="display" style={styles.title} accessibilityRole="header">
                    What are you starting with?
                </Text>
                <Text style={styles.lead}>Pick the real material. The next screen asks for that file, reference or idea.</Text>

                <View style={styles.sourceGrid}>
                    {SOURCES.map((item) => (
                        <View key={item.key} style={styles.tile}>
                            <ChoiceCard icon={item.icon} title={item.label} detail={item.detail} selected={source === item.key} onPress={() => setSource(item.key)} />
                        </View>
                    ))}
                </View>

                <View style={styles.sectionHead}>
                    <Text variant="title2" style={styles.sectionTitle} accessibilityRole="header">
                        Or try a template
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                            noteOnboardingCompleted();
                            router.replace('/create/presets');
                        }}
                    >
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
                                onPress={() => {
                                    noteOnboardingCompleted();
                                    router.replace(presetHref(template));
                                }}
                            >
                                <Card style={styles.templateCard}>
                                    <Image source={{ uri: template.posterUrl! }} style={styles.poster} contentFit="cover" />
                                    <Text style={styles.templateName} numberOfLines={1}>
                                        {template.title}
                                    </Text>
                                    <View style={styles.tryButton}>
                                        <Text variant="footnote" style={styles.tryText}>
                                            Try this
                                        </Text>
                                    </View>
                                </Card>
                            </Pressable>
                        ))}
                    </View>
                ) : templates ? (
                    <View style={styles.templateGrid}>
                        {TEMPLATE_IDEAS.map((template) => (
                            <View key={template.title} style={styles.tile}>
                                <ChoiceCard
                                    icon={template.icon}
                                    title={template.title}
                                    detail="Explore"
                                    onPress={() => {
                                        noteOnboardingCompleted();
                                        router.replace('/create/presets');
                                    }}
                                />
                            </View>
                        ))}
                    </View>
                ) : null}
                <Button
                    variant="tertiary"
                    label="Use something from my Library"
                    onPress={() => {
                        noteOnboardingCompleted();
                        router.replace('/library');
                    }}
                />
            </ScrollView>
            <View style={styles.footer}>
                <Button
                    label={picked ? `Continue with ${picked.label.toLowerCase()}` : 'Choose where to start'}
                    disabled={!source}
                    onPress={() => {
                        if (source) {
                            noteOnboardingCompleted();
                            router.replace(sourceHref(source));
                        }
                    }}
                />
            </View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { paddingHorizontal: ds.space.gutter, paddingTop: 62, paddingBottom: ds.space.lg, gap: ds.space.md },
    title: {},
    lead: { color: p.textSecondary },
    sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: ds.space.md },
    tile: { width: '48%' },
    sectionHead: { marginTop: ds.space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: {},
    seeAll: { color: p.accent, minHeight: 44, textAlignVertical: 'center' },
    templateGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: ds.space.md },
    template: { width: '48%' },
    templateCard: { padding: 0, overflow: 'hidden' },
    templatePressed: { opacity: 0.78 },
    poster: { width: '100%', aspectRatio: 0.8, backgroundColor: p.surface },
    templateName: { paddingHorizontal: ds.space.sm, paddingTop: ds.space.sm },
    tryButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    tryText: { color: p.accent },
    footer: { paddingHorizontal: ds.space.gutter, paddingTop: ds.space.sm, paddingBottom: ds.space.xxl, backgroundColor: p.bg },
}));
