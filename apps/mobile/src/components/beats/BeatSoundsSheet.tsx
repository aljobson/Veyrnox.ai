import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View, TextInput } from 'react-native';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { t } from '../../lib/i18n';
import { BEAT_SOUNDS, filterSounds, suggestBeatCategories, type BeatSound, type SoundCategory } from '../../lib/beatNative/labs';
import { createSoundPreview } from '../../lib/beatNative/soundPreview';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';

const CATEGORIES = ['All', 'Bass', 'Keys', 'Synth', 'FX'] as const;
const CATEGORY_ICONS: Record<(typeof CATEGORIES)[number], MenuIcon> = {
    All: 'squares',
    Bass: 'waveSine',
    Keys: 'pianoKeys',
    Synth: 'keyboard',
    FX: 'magicWand',
};
type SoundsBrowserProps = { bpm: number; onAdd(sound: BeatSound): boolean; onClose(): void; inline?: boolean };

export function BeatSoundsSheet(props: Omit<SoundsBrowserProps, 'inline'>) {
    return <BeatModal title={t('beatLabs.sounds')} closeLabel={t('beatLabs.close')} onClose={props.onClose}>
        <BeatSoundsBrowser {...props} />
    </BeatModal>;
}

export function BeatSoundsTray(props: Omit<SoundsBrowserProps, 'inline'>) {
    return <BeatSoundsBrowser {...props} inline />;
}

function BeatSoundsBrowser({ bpm, onAdd, onClose, inline = false }: SoundsBrowserProps) {
    const s = useThemedStyles(sheets);
    const [query, setQuery] = useState(''), [category, setCategory] = useState<SoundCategory | 'All'>('All');
    const [preparing, setPreparing] = useState<string | null>(null);
    const [playing, setPlaying] = useState<string | null>(null), [error, setError] = useState(false), [refused, setRefused] = useState(false);
    const preview = useRef<ReturnType<typeof createSoundPreview> | null>(null);
    const ticket = useRef(0);
    useEffect(() => () => { ticket.current++; preview.current?.stop(); }, []);
    const stop = () => { ticket.current++; preview.current?.stop(); setPlaying(null); setPreparing(null); };
    const close = () => { stop(); onClose(); };
    async function audition(sound: BeatSound) {
        const epoch = ++ticket.current; setError(false); setPreparing(sound.id);
        try { const id = await (preview.current ??= createSoundPreview(undefined, () => { setPlaying(null); setPreparing(null); })).toggle(sound, bpm); if (epoch === ticket.current) { setPlaying(id); setPreparing(null); } }
        catch { if (epoch === ticket.current) { setPlaying(null); setPreparing(null); setError(true); } }
    }
    const sounds = filterSounds(query, category, sound => t(`beatLabs.sound.${sound.id}`));
    const add = (sound: BeatSound) => { stop(); if (onAdd(sound)) onClose(); else setRefused(true); };
    const list = <View style={s.list}>
        {sounds.map(sound => { const name = t(`beatLabs.sound.${sound.id}`); const busy = preparing === sound.id; const active = playing === sound.id; return <View key={sound.id} style={s.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('beatLabs.addNamed', { name })}
                onPress={() => add(sound)} style={s.soundChoice}>
                <View style={s.soundIcon}><Icon name={CATEGORY_ICONS[sound.category]} size={20} tint={s.soundIconTint.color} /></View>
                <View style={s.copy}>
                    <Text variant="bodyStrong" numberOfLines={1}>{name}</Text>
                    <Text variant="footnote" tone="secondary" numberOfLines={1}>{t(`beatLabs.category.${sound.category}`)} · {t('beatLabs.bars', { count: sound.bars })}</Text>
                </View>
            </Pressable>
            <Button testID={`beat-sound-preview-${sound.id}`} size="md" variant={active ? 'secondary' : 'tertiary'}
                icon={active ? 'pauseCircle' : 'play'} iconOnly
                accessibilityState={{ busy }} loading={busy}
                label={t(active ? 'beatLabs.stopNamed' : 'beatLabs.auditionNamed', { name })}
                onPress={() => void audition(sound)} containerStyle={s.preview} />
        </View>; })}
    </View>;
    return <View testID={inline ? 'beat-sounds-tray' : undefined} style={inline ? s.inline : undefined}>
        {inline ? <View style={s.inlineHeader}>
            <Button testID="beat-sounds-back" size="md" variant="tertiary" icon="arrowLeft" iconOnly label={t('beat.back')} onPress={close} />
            <Text variant="bodyStrong" accessibilityRole="header">{t('beatLabs.sounds')}</Text>
        </View> : null}
        <View style={s.intro}>
            <Text variant="footnote" tone="secondary">{t('beatLabs.minor')}</Text>
            <View style={s.searchBox}>
                <Icon name="search" size={20} tint={s.searchIcon.color} />
                <TextInput style={s.search} accessibilityLabel={t('beatLabs.search')} placeholder={t('beatLabs.search')}
                    placeholderTextColor={s.placeholder.color} value={query} onChangeText={setQuery} />
            </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.categoryScroller} contentContainerStyle={s.categories}>
            {CATEGORIES.map(value => { const selected = category === value; return <Pressable key={value}
                accessibilityRole="button" accessibilityLabel={t(`beatLabs.category.${value}`)} accessibilityState={{ selected }}
                onPress={() => setCategory(value)} style={[s.category, selected && s.categorySelected]}>
                <Icon name={CATEGORY_ICONS[value]} size={20} tint={selected ? s.categoryIconSelected.color : s.categoryIcon.color} />
                <Text variant="footnote" numberOfLines={1} style={selected ? s.categoryTextSelected : s.categoryText}>{t(`beatLabs.category.${value}`)}</Text>
            </Pressable>; })}
        </ScrollView>
        {inline ? <ScrollView style={s.inlineList} contentContainerStyle={s.inlineListContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>{list}</ScrollView> : list}
        {sounds.length === 0 ? <><Text>{t('beatLabs.noSounds')}</Text>
            {suggestBeatCategories(query, BEAT_SOUNDS).map(value => <Button key={value} label={t(`beatLabs.category.${value}`)} onPress={() => { setQuery(''); setCategory(value); }} />)}
            <Button label={t('beatLabs.clear')} onPress={() => { setQuery(''); setCategory('All'); }} /></> : null}
        {error ? <Text accessibilityLiveRegion="polite">{t('beat.audioError')}</Text> : null}
        {refused ? <Text accessibilityLiveRegion="polite">{t('beatLabs.addFailed')}</Text> : null}
    </View>;
}
const sheets = themedStyles(p => ({
    intro: { gap: ds.space.sm },
    inline: { flex: 1, minHeight: 0, gap: ds.space.xs, paddingHorizontal: ds.space.xs },
    inlineHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.xs },
    inlineList: { flex: 1, minHeight: 0 },
    inlineListContent: { paddingBottom: ds.space.sm },
    searchBox: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, paddingHorizontal: ds.space.md,
        borderRadius: ds.radius.lg, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.surface },
    search: { flex: 1, minWidth: 0, paddingVertical: ds.space.sm, color: p.textPrimary },
    searchIcon: { color: p.textSecondary },
    placeholder: { color: p.textTertiary },
    categoryScroller: { flexGrow: 0, marginHorizontal: -ds.space.xs },
    categories: { gap: ds.space.xs, paddingHorizontal: ds.space.xs },
    category: { minWidth: 58, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 2,
        paddingHorizontal: ds.space.sm, borderRadius: ds.radius.md, borderWidth: 1, borderColor: 'transparent' },
    categorySelected: { borderColor: p.borderStrong, backgroundColor: p.bgElevated2 },
    categoryIcon: { color: p.textSecondary },
    categoryIconSelected: { color: p.textPrimary },
    categoryText: { color: p.textSecondary },
    categoryTextSelected: { color: p.textPrimary },
    list: { gap: ds.space.xs },
    row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: ds.space.xs,
        paddingLeft: ds.space.xs, borderRadius: ds.radius.lg, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated2 },
    soundChoice: { minWidth: 0, flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    soundIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: ds.radius.md, backgroundColor: p.surface },
    soundIconTint: { color: p.textSecondary },
    copy: { minWidth: 0, flex: 1, gap: 2 },
    preview: { width: 52, flexShrink: 0 },
}));
