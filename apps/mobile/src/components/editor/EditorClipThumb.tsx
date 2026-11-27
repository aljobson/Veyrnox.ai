import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import type { Media } from '../../lib/nativeEditorModel';
import { posterFor } from '../../lib/videoPoster';
import { studioColors as colors } from '../../theme';

export function EditorClipThumb({ media, uri, cacheKey, size = 36 }: { media: Media; uri?: string; cacheKey: string; size?: number }) {
    const [poster, setPoster] = useState<VideoThumbnail | null>(null);
    useEffect(() => {
        if (!uri || media.kind !== 'video') { setPoster(null); return; }
        let live = true;
        void posterFor(`editor:${cacheKey}:${media.id}`, uri).then(value => { if (live) setPoster(value); });
        return () => { live = false; };
    }, [cacheKey, media.id, media.kind, uri]);
    const source = media.kind === 'image' || media.kind === 'graphic' ? uri ? { uri } : null : poster;
    return <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.frame, { width: size, height: size }]}>
        {source ? <Image source={source} cachePolicy="memory" contentFit="cover" style={StyleSheet.absoluteFill} /> : <Text style={styles.glyph}>{media.kind === 'audio' ? '♫' : '▶'}</Text>}
    </View>;
}

const styles = StyleSheet.create({
    frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.border },
    glyph: { color: colors.muted, fontSize: 15 },
});
