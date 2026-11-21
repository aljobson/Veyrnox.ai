import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { rawText } from '../lib/i18n/translate';
import { t } from '../lib/i18n';
import { ExampleStill } from './ExampleStill';

// The example starts on its own, muted and looping like the web preview, so it is visibly a moving result; the native
// controls still unmute or pause it. The poster shows until the first frame renders; a clip that cannot load falls back to it.
export function ExampleVideo({ url, poster, title }: { url: string; poster?: string; title: string }) {
    const [failed, setFailed] = useState(false);
    const [rendered, setRendered] = useState(false);
    const player = useVideoPlayer(url, (instance) => { instance.loop = true; instance.muted = true; instance.play(); });
    useEffect(() => {
        const subscription = player.addListener('statusChange', (event) => { if (event.status === 'error') setFailed(true); });
        return () => subscription.remove();
    }, [player]);
    if (failed && poster) return <ExampleStill uri={poster} title={title} />;
    return (
        <View style={exampleMedia}>
            <VideoView player={player} style={exampleMedia} nativeControls contentFit="contain" onFirstFrameRender={() => setRendered(true)} accessibilityLabel={rawText(t('features.examplevideo', { value1: title }))} />
            {poster && !rendered ? <Image source={{ uri: poster }} style={[exampleMedia, StyleSheet.absoluteFill]} contentFit="contain" pointerEvents="none" accessibilityIgnoresInvertColors /> : null}
        </View>
    );
}


const exampleMedia = { width: '100%', height: 260, backgroundColor: '#050506' } as const;
