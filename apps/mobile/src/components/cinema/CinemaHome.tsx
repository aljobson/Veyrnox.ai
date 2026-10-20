import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../../lib/i18n';
import { MIN_TARGET } from '../../lib/a11y';
import { colors } from '../../theme';
import { CategoryChips } from './CategoryChips';
import { CinemaFeed } from './CinemaFeed';
import { ContinueWatching } from './ContinueWatching';
import { CinemaProfile } from './CinemaProfile';
import { DiscoveryList } from './DiscoveryList';
import { SavedList } from './SavedList';
import { WinnersList } from './WinnersList';

// The Cinema tab: section tabs over the category chips over the section. "Watch" is the one-title-per-screen feed
// (the phone's own way in); Series, Vote, Saved, Following and Winners are the web's tabs (ADR-0164, ADR-0178, ADR-0168).
type Section = 'watch' | 'series' | 'vote' | 'saved' | 'following' | 'winners' | 'profile';
const SECTIONS: readonly { key: Section; label: string }[] = [
    { key: 'watch', label: 'cinemaBrowse.tab.watch' },
    { key: 'series', label: 'cinemaBrowse.tab.series' },
    { key: 'vote', label: 'cinemaBrowse.tab.vote' },
    { key: 'saved', label: 'cinemaBrowse.tab.saved' },
    { key: 'following', label: 'cinemaBrowse.tab.following' },
    { key: 'winners', label: 'cinemaBrowse.tab.winners' },
    { key: 'profile', label: 'cinemaBrowse.tab.profile' },
];

export function CinemaHome() {
    const [section, setSection] = useState<Section>('watch');
    const [category, setCategory] = useState<string | null>(null);
    const [follow, setFollow] = useState<'creator' | 'series'>('creator');
    const browsing = section === 'watch' || section === 'series' || section === 'vote';
    return (
        <View style={styles.screen}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabRow} accessibilityRole="tablist">
                {SECTIONS.map((s) => {
                    const on = section === s.key;
                    return (
                        <Pressable key={s.key} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]} onPress={() => setSection(s.key)}>
                            <Text style={[styles.tabText, on && styles.tabTextOn]}>{t(s.label)}</Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
            {browsing ? <CategoryChips value={category} onChange={setCategory} /> : null}
            {section === 'following' ? (
                <View style={styles.sub} accessibilityRole="tablist">
                    {(['creator', 'series'] as const).map((k) => (
                        <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: follow === k }} style={[styles.subTab, follow === k && styles.tabOn]} onPress={() => setFollow(k)}>
                            <Text style={[styles.tabText, follow === k && styles.tabTextOn]}>{t(`cinemaSocial.following.${k}`)}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {section === 'watch' ? <ContinueWatching /> : null}
            <View style={styles.body}>
                {section === 'watch' ? <CinemaFeed key={`w:${category}`} category={category} />
                    : section === 'saved' ? <SavedList key="saved" kind="saved" />
                        : section === 'following' ? <SavedList key={`f:${follow}`} kind={follow} />
                            : section === 'winners' ? <WinnersList />
                                : section === 'profile' ? <CinemaProfile />
                                : <DiscoveryList key={`${section}:${category}`} mode={section === 'vote' ? 'voting' : 'series'} category={category} />}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    tabs: { flexGrow: 0 },
    tabRow: { paddingHorizontal: 12, gap: 4 },
    tab: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    sub: { flexDirection: 'row', paddingHorizontal: 12, gap: 4 },
    subTab: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: colors.accent },
    tabText: { color: colors.muted, fontWeight: '600', fontSize: 15 },
    tabTextOn: { color: colors.text },
    body: { flex: 1 },
});
