import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { rawText } from '../lib/i18n/translate';
import { t } from '../lib/i18n';
import { examplePlaysOn, type CreativeFeature } from '../lib/creativeFeatures';
import { colors } from '../theme';

// The "see the intended result" card shared by the guided tools and the studio screens (Text to speech).
export function Example({ feature }: { feature: Pick<CreativeFeature, 'title' | 'example'> }) {
    return <View style={styles.example}><View style={styles.exampleHead}><View><Text style={styles.kicker}>{t('features.wORKINGEXAMPLE')}</Text><Text style={styles.cardTitle}>{t('features.seetheintendedresult')}</Text></View></View>{examplePlaysOn(feature.example, Platform.OS) ? <ExampleVideo url={feature.example.url} poster={feature.example.posterUrl} title={feature.title} /> : <ExampleStill uri={feature.example.kind === 'video' ? feature.example.posterUrl ?? feature.example.url : feature.example.url} title={feature.title} />}</View>;
}
function ExampleStill({ uri, title }: { uri: string; title: string }) {
    return <Image source={{ uri }} style={styles.exampleMedia} contentFit="contain" accessibilityLabel={rawText(t('features.example', { value1: title }))} accessibilityIgnoresInvertColors />;
}
// The example starts on its own, muted and looping like the web preview, so it is visibly a moving result; the native
// controls still unmute or pause it. A clip that cannot load falls back to its first-frame still.
function ExampleVideo({ url, poster, title }: { url: string; poster?: string; title: string }) {
    const [failed, setFailed] = useState(false);
    const player = useVideoPlayer(url, (instance) => { instance.loop = true; instance.muted = true; instance.play(); });
    useEffect(() => {
        const subscription = player.addListener('statusChange', (event) => { if (event.status === 'error') setFailed(true); });
        return () => subscription.remove();
    }, [player]);
    if (failed && poster) return <ExampleStill uri={poster} title={title} />;
    return <VideoView player={player} style={styles.exampleMedia} nativeControls contentFit="contain" accessibilityLabel={rawText(t('features.examplevideo', { value1: title }))} />;
}

const styles = StyleSheet.create({
    example: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: '#050506' },
    exampleHead: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface },
    exampleMedia: { width: '100%', height: 260, backgroundColor: '#050506' },
    kicker: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
    cardTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
});
