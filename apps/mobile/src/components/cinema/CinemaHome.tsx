import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../../lib/i18n';
import { MIN_TARGET } from '../../lib/a11y';
import { MENU_ICONS, type MenuIcon } from '../../lib/menuIcons';
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
const SECTIONS: readonly { key: Section; label: string; icon: MenuIcon }[] = [
    { key: 'watch', label: 'cinemaBrowse.tab.watch', icon: 'play' },
    { key: 'series', label: 'cinemaBrowse.tab.series', icon: 'film' },
    { key: 'vote', label: 'cinemaBrowse.tab.vote', icon: 'thumbsUp' },
    { key: 'saved', label: 'cinemaBrowse.tab.saved', icon: 'bookmark' },
    { key: 'following', label: 'cinemaBrowse.tab.following', icon: 'heart' },
    { key: 'winners', label: 'cinemaBrowse.tab.winners', icon: 'trophy' },
    { key: 'profile', label: 'cinemaBrowse.tab.profile', icon: 'user' },
];

export function CinemaHome() {
    const [section, setSection] = useState<Section>('watch');
    const [category, setCategory] = useState<string | null>(null);
    const [follow, setFollow] = useState<'creator' | 'series'>('creator');
    const browsing = section === 'watch' || section === 'series' || section === 'vote';
    return (
        <View style={styles.screen}>
            <View style={styles.tabRow} accessibilityRole="tablist">
                {SECTIONS.map((s) => {
                    const on = section === s.key;
                    return (
                        <Pressable key={s.key} accessibilityRole="tab" accessibilityLabel={t(s.label)} accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]} onPress={() => setSection(s.key)}>
                            <Image source={MENU_ICONS[s.icon]} style={styles.tabIcon} tintColor={on ? colors.accent : colors.muted} contentFit="contain" accessibilityElementsHidden />
                            {on ? <Text style={styles.tabTextOn} numberOfLines={1}>{t(s.label)}</Text> : null}
                        </Pressable>
                    );
                })}
            </View>
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
    tabRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
    tab: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabIcon: { width: 24, height: 24 },
    sub: { flexDirection: 'row', paddingHorizontal: 12, gap: 4 },
    subTab: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: colors.accent },
    tabText: { color: colors.muted, fontWeight: '600', fontSize: 15 },
    tabTextOn: { color: colors.text, fontWeight: '600', fontSize: 15 },
    body: { flex: 1 },
});
