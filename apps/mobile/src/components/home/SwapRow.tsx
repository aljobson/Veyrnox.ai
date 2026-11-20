import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { rawText } from '../../lib/i18n/translate';
import { t } from '../../lib/i18n';
import { swapRowPoster, useSwapRow } from '../../lib/templateSwap/row';
import { Text } from '../ui';
// "Put yourself in": swap templates the server says are live. Renders nothing otherwise, so the home is unchanged with the switch off.
const ratio = (value: string) => { const m = /^\s*(\d+)\s*[/:]\s*(\d+)\s*$/.exec(value); return m && Number(m[2]) > 0 ? Math.min(16 / 9, Math.max(9 / 16, Number(m[1]) / Number(m[2]))) : 9 / 16; };
const title = (name: string) => name.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase());
export function SwapRow() {
    const cards = useSwapRow(), router = useRouter();
    if (!cards.length) return null;
    return <View style={{ gap: 12 }}>
        <Text variant="title2" accessibilityRole="header">{t('presets.swap.title')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {cards.map(card => <Pressable key={card.id} accessibilityRole="button" accessibilityLabel={`${rawText(title(card.name))}, ${t('presets.swap.price', { credits: card.credits })}`}
                onPress={() => router.push({ pathname: '/templates/[id]', params: { id: card.id } })} style={{ width: 150, gap: 6 }}>
                <Image source={{ uri: swapRowPoster(card.poster) }} cachePolicy="memory" contentFit="cover" accessible={false} style={{ width: 150, aspectRatio: ratio(card.aspectRatio), borderRadius: 12 }} />
                <Text variant="bodyStrong" numberOfLines={2}>{rawText(title(card.name))}</Text>
                <Text variant="caption" tone="warning">{t('presets.swap.price', { credits: card.credits })}</Text>
            </Pressable>)}
        </ScrollView>
    </View>;
}
