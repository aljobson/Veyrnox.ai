import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Image } from 'expo-image';
import { rawText } from '../../lib/i18n/translate';
import { Text } from '../ui';
import { useSwapPreview } from '../../lib/templateSwap/preview';
// The swap template's thumbnail, above the composer. Loading shows a spinner in a box of the right shape; a poster that
// fails to load keeps the box (neutral), and a template with no poster shows nothing.
export function SwapTemplatePreview({ id, title }: { id: string; title?: string }) {
    const preview = useSwapPreview(id), [failed, setFailed] = useState<string | null>(null);
    if (preview === null) return null;
    const box = { width: '100%' as const, maxWidth: 360, alignSelf: 'center' as const, aspectRatio: preview?.ratio ?? 9 / 16, borderRadius: 16, overflow: 'hidden' as const };
    if (!preview) return <View style={box} accessibilityState={{ busy: true }}><ActivityIndicator /></View>;
    return <><View style={box}>
        {failed !== preview.posterUrl && <Image source={{ uri: preview.posterUrl }} cachePolicy="memory" contentFit="cover" style={{ width: '100%', height: '100%' }}
            accessibilityLabel={rawText(title || preview.title) || undefined} onError={() => setFailed(preview.posterUrl)} />}
    </View>{!title && preview.title ? <Text variant="title1" accessibilityRole="header">{preview.title}</Text> : null}</>;
}
