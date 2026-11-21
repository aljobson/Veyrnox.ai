import { useEffect, useRef } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';
import { t } from '../../lib/i18n';

// Plays one video template's preview over its poster, muted and looping. TemplatePreviewControls loads this file only
// while a tile is playing, so a list of templates holds no video players. A preview that cannot load hands back to the poster.
export function TemplateVideoPreview({ url, onFail }: { readonly url: string; onFail(): void }) {
    const player = useVideoPlayer(url, (p) => { p.muted = true; p.loop = true; });
    const latestOnFail = useRef(onFail);
    latestOnFail.current = onFail;
    useEffect(() => {
        const sub = player.addListener('statusChange', ({ status }) => { if (status === 'error') latestOnFail.current(); });
        player.play();
        return () => { sub.remove(); player.pause(); };
    }, [player]);
    return <VideoView player={player} nativeControls={false} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel={t('job.playVideo')} />;
}
