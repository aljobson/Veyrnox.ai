import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { createAssetLinks, type AssetLink } from '../lib/libraryMedia';
import { mediaApi } from '../lib/media';
import { posterFor } from '../lib/videoPoster';
import { colors } from '../theme';

export type AssetLinks = ReturnType<typeof createAssetLinks>;

// One short-lived link cache for a list of pickable creations. Signed links stay in memory only.
export function useAssetLinks(api: ApiClient): AssetLinks {
    const links = useMemo(() => createAssetLinks({ getAsset: mediaApi(api).getAsset }), [api]);
    useEffect(() => () => links.clear(), [links]);
    return links;
}

interface Props {
    readonly links: AssetLinks;
    readonly jobId: string;
    readonly size?: number;
    readonly posterTimeSeconds?: number;
}

const is = (mime: string | undefined, prefix: string): boolean => typeof mime === 'string' && mime.startsWith(prefix);
const GLYPH = { video: '▶', audio: '♫', image: '▧' } as const;

// The picture of one of the person's creations: the image itself, a frame from a video, or a note for audio.
// Resolved only when the row is on screen, so a long list does not fetch every file.
export function JobThumb({ links, jobId, size = 56, posterTimeSeconds }: Props) {
    const [link, setLink] = useState<AssetLink | undefined>(() => links.peek(jobId));
    const [poster, setPoster] = useState<VideoThumbnail | null>(null);
    // A video whose frame could not be made keeps the play glyph; it must not spin for ever.
    const [posterTried, setPosterTried] = useState(false);

    useEffect(() => {
        let live = true;
        void links.request(jobId).then((result) => {
            if (!live) return;
            setLink(result);
            if (result.kind === 'file' && is(result.mime, 'video/')) {
                void posterFor(jobId, result.url, undefined, posterTimeSeconds).then(
                    (frame) => { if (live) { setPoster(frame); setPosterTried(true); } },
                    () => { if (live) setPosterTried(true); },
                );
            }
        });
        return () => { live = false; };
    }, [links, jobId, posterTimeSeconds]);

    const file = link?.kind === 'file' ? link : null;
    const box = { width: size, height: size };
    return (
        <View style={[styles.frame, box]} accessible={false} importantForAccessibility="no-hide-descendants">
            {is(file?.mime, 'image/') ? <Image source={{ uri: file?.url }} cachePolicy="memory" contentFit="cover" style={styles.fill} />
                : is(file?.mime, 'video/') && poster ? <Image source={poster} cachePolicy="memory" contentFit="cover" style={styles.fill} />
                : !link || (is(file?.mime, 'video/') && !poster && !posterTried) ? <ActivityIndicator testID="job-thumb-loading" color={colors.muted} />
                : <Text style={styles.glyph}>{is(file?.mime, 'audio/') ? GLYPH.audio : is(file?.mime, 'video/') ? GLYPH.video : GLYPH.image}</Text>}
            {is(file?.mime, 'video/') ? <View style={styles.play}><Text style={styles.playText}>▶</Text></View> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    frame: { borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    fill: { width: '100%', height: '100%' },
    glyph: { color: colors.muted, fontSize: 20 },
    play: { position: 'absolute', bottom: 3, end: 3, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    playText: { color: '#fff', fontSize: 8 },
});
