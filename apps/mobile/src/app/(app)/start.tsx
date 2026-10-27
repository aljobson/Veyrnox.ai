import { markWelcomeSeen } from '../../lib/markWelcomeSeen';
import { t } from '../../lib/i18n';
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
    { key: 'photo', icon: 'camera', label: t('start.myphoto'), detail: t('start.animateortransformit') },
    { key: 'video', icon: 'film', label: t('start.myvideo'), detail: t('start.addsoundsyncorenhance') },
    { key: 'reference', icon: 'brush', label: t('start.areference'), detail: t('start.guideastyleorcharacter') },
    { key: 'prompt', icon: 'sparkle', label: t('start.justanidea'), detail: t('start.describethevideoinwords') },
];
const TEMPLATE_IDEAS = [
    { icon: 'camera', title: t('start.animateaportrait') },
    { icon: 'bag', title: t('start.productreveal') },
    { icon: 'audio', title: t('start.musicvisualizer') },
    { icon: 'moon', title: t('start.storytrailer') },
] as const;

export function sourceHref(source: Source) {
    if (source === 'photo') return '/create/tools?source=image&mode=photo' as const;
    if (source === 'video') return '/create/tools?source=video&mode=video' as const;
    if (source === 'reference') return '/create/tools?source=image&mode=reference' as const;
    return '/?focusIdea=1' as const;
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
                <Text variant="display" style={styles.title} accessibilityRole="header">{t('start.whatareyoustartingwith')}</Text>
                <Text style={styles.lead}>{t('start.picktherealmaterialThenextscreen')}</Text>

                <View style={styles.sourceGrid}>
                    {SOURCES.map((item) => (
                        <View key={item.key} style={styles.tile}>
                            <ChoiceCard icon={item.icon} title={item.label} detail={item.detail} selected={source === item.key} onPress={() => setSource(item.key)} />
                        </View>
                    ))}
                </View>

                <View style={styles.sectionHead}>
                    <Text variant="title2" style={styles.sectionTitle} accessibilityRole="header">{t('start.ortryatemplate')}</Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                            noteOnboardingCompleted();
                            router.replace('/create/presets');
                        }}
                    >
                        <Text style={styles.seeAll}>{t('start.seeall')}</Text>
                    </Pressable>
                </View>
                {templates === null ? <ActivityIndicator color={colors.accent} /> : null}
                {templates?.length ? (
                    <View style={styles.templateGrid}>
                        {templates.map((template) => (
                            <Pressable
                                key={template.id}
                                accessibilityRole="button"
                                accessibilityLabel={t('start.try', { value1: template.title })}
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
                                        <Text variant="footnote" style={styles.tryText}>{t('start.trythis')}</Text>
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
                                    detail={t('start.explore')}
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
                    label={t('start.usesomethingfrommyLibrary')}
                    onPress={() => {
                        noteOnboardingCompleted();
                        router.replace('/library');
                    }}
                />
            </ScrollView>
            <View style={styles.footer}>
                <Button
                    label={picked ? t('start.continuewith', { value1: picked.label.toLowerCase() }) : t('start.choosewheretostart')}
                    disabled={!source}
                    onPress={() => {
                        if (source) {
                            noteOnboardingCompleted();
                            router.replace(sourceHref(source));
                        }
                    }}
                />
                <Button variant="tertiary" label={t('start.skip')} onPress={() => {
                    void markWelcomeSeen().then(() => { noteOnboardingCompleted(); router.replace('/'); });
                }} />
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
