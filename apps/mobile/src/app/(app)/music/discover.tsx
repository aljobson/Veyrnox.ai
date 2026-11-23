import { useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { DISCOVER_SEEDS } from '../../../lib/music/discoverSeeds';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { SafeContentScrollView } from '../../../components/SafeContentScrollView';
export default function Discover() {
    const [mood, setMood] = useState('all'), router = useRouter(), s = useThemedStyles(sheets);
    return <SafeContentScrollView style={s.screen} contentContainerStyle={s.content} gutter={ds.space.gutter}>
        <Stack.Screen options={{ title: t('musicDiscover.title') }} />
        <Text>{t('musicDiscover.body')}</Text>
        <SegmentedControl value={mood} onChange={setMood} options={['all', ...new Set(DISCOVER_SEEDS.map(seed => seed.mood))]
            .map(value => ({ value, label: t(`musicDiscover.mood.${value}`) }))} />
        {DISCOVER_SEEDS.filter(seed => mood === 'all' || seed.mood === mood).map(seed => <View key={seed.id} style={s.row}>
            <Text variant="bodyStrong">{seed.title}</Text>
            <Text variant="footnote" tone="secondary">{t('musicDiscover.details', { mood: t(`musicDiscover.mood.${seed.mood}`), bpm: seed.bpm, key: seed.musicalKey })}</Text>
            <Button variant="secondary" label={t('musicDiscover.use', { title: seed.title })}
                onPress={() => router.push({ pathname: '/music/create', params: { sample: seed.id } } as never)} />
        </View>)}
    </SafeContentScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { gap: ds.space.lg }, row: { gap: ds.space.sm } }));
