import { useEffect, useRef, useState } from 'react';
import { View, TextInput } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { t } from '../../lib/i18n';
import { BEAT_SOUNDS, filterSounds, suggestBeatCategories, type BeatSound, type SoundCategory } from '../../lib/beatNative/labs';
import { createSoundPreview } from '../../lib/beatNative/soundPreview';
import { ds } from '../../theme';
export function BeatSoundsSheet({ bpm, onAdd, onClose }: { bpm: number; onAdd(sound: BeatSound): boolean; onClose(): void }) {
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
    return <BeatModal title={t('beatLabs.sounds')} onClose={close}>
        <Text>{t('beatLabs.minor')}</Text>
        <TextInput style={s.search} accessibilityLabel={t('beatLabs.search')} placeholder={t('beatLabs.search')} value={query} onChangeText={setQuery} />
        <View style={s.chips}>{(['All', 'Bass', 'Keys', 'Synth', 'FX'] as const).map(value => <Button key={value} label={t(`beatLabs.category.${value}`)}
            variant={category === value ? 'primary' : 'secondary'} accessibilityState={{ selected: category === value }} onPress={() => setCategory(value)} />)}</View>
        {sounds.map(sound => { const name = t(`beatLabs.sound.${sound.id}`); return <View key={sound.id} style={s.row}>
            <Text variant="bodyStrong">{name}</Text><Text>{t(`beatLabs.category.${sound.category}`)}</Text><Text>{t('beatLabs.bars', { count: sound.bars })}</Text>
            {preparing === sound.id ? <Text accessibilityLiveRegion="polite">{t('beatLabs.previewLoading')}</Text> : null}
            <Button accessibilityState={{ busy: preparing === sound.id }} label={playing === sound.id ? t('beatLabs.stop') : t('beatLabs.audition')} accessibilityLabel={t(playing === sound.id ? 'beatLabs.stopNamed' : 'beatLabs.auditionNamed', { name })} onPress={() => void audition(sound)} />
            <Button label={t('beatLabs.add')} accessibilityLabel={t('beatLabs.addNamed', { name })} onPress={() => { stop(); if (onAdd(sound)) onClose(); else setRefused(true); }} />
        </View>; })}
        {sounds.length === 0 ? <><Text>{t('beatLabs.noSounds')}</Text>
            {suggestBeatCategories(query, BEAT_SOUNDS).map(value => <Button key={value} label={t(`beatLabs.category.${value}`)} onPress={() => { setQuery(''); setCategory(value); }} />)}
            <Button label={t('beatLabs.clear')} onPress={() => { setQuery(''); setCategory('All'); }} /></> : null}
        {error ? <Text accessibilityLiveRegion="polite">{t('beat.audioError')}</Text> : null}
        {refused ? <Text accessibilityLiveRegion="polite">{t('beatLabs.addFailed')}</Text> : null}
        <Button label={t('beatLabs.close')} onPress={close} />
    </BeatModal>;
}
const sheets = themedStyles(p => ({ search: { color: p.textPrimary, backgroundColor: p.surface, padding: ds.space.md, borderRadius: ds.radius.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }, row: { gap: ds.space.sm, paddingVertical: ds.space.md } }));
