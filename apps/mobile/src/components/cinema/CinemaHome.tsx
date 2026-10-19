import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../../lib/i18n';
import { MIN_TARGET } from '../../lib/a11y';
import { colors } from '../../theme';
import { CategoryChips } from './CategoryChips';
import { CinemaFeed } from './CinemaFeed';
import { DiscoveryList } from './DiscoveryList';

// The Cinema tab: section tabs over the category chips over the section. "Watch" is the one-title-per-screen feed
// (the phone's own way in); Series and Vote are the web's tabs of the same names (ADR-0164).
type Section = 'watch' | 'series' | 'vote';
const SECTIONS: readonly { key: Section; label: string }[] = [
    { key: 'watch', label: 'cinemaBrowse.tab.watch' },
    { key: 'series', label: 'cinemaBrowse.tab.series' },
    { key: 'vote', label: 'cinemaBrowse.tab.vote' },
];

export function CinemaHome() {
    const [section, setSection] = useState<Section>('watch');
    const [category, setCategory] = useState<string | null>(null);
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
            <CategoryChips value={category} onChange={setCategory} />
            <View style={styles.body}>
                {section === 'watch' ? <CinemaFeed key={`w:${category}`} category={category} />
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
    tabOn: { borderBottomColor: colors.accent },
    tabText: { color: colors.muted, fontWeight: '600', fontSize: 15 },
    tabTextOn: { color: colors.text },
    body: { flex: 1 },
});
