import { rawText } from '../../lib/i18n/translate';
import { Image, type ImageStyle } from 'expo-image';
import { useState } from 'react';
import { type StyleProp } from 'react-native';
import { posterSources } from '../../lib/cinemaViewer';

export function CinemaPosterImage(props: { id: string; label?: string; style?: StyleProp<ImageStyle> }) {
    return <Poster key={props.id} {...props} />;
}
function Poster({ id, label, style }: { id: string; label?: string; style?: StyleProp<ImageStyle> }) {
    const [index, setIndex] = useState(0);
    const sources = posterSources(id);
    if (index >= sources.length) return null;
    return <Image key={index} source={{ uri: sources[index] }} style={[{ width: '100%', aspectRatio: 16 / 9 }, style]}
        contentFit="cover" accessible={!!label} accessibilityLabel={rawText(label)} accessibilityIgnoresInvertColors
        onError={() => setIndex(current => current === index ? current + 1 : current)} />;
}
