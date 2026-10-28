import { rawText } from '../../lib/i18n/translate';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { ApiClient } from '../../lib/api';
import { subscribeCacheUser } from '../../lib/appCache';
import { brandStore } from '../../lib/publishBrand';
import { publishScope } from '../../lib/usePublishRole';
import { mediaApi } from '../../lib/media';
import type { MediaChoice } from '../../lib/publishMediaChoice';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { InlineMedia } from '../InlineMedia';
import { Card, Icon, Text, themedStyles, useThemedStyles } from '../ui';

// Signed links live only in this mounted component; scope changes invalidate pending reads too.
export function useMediaAsset(api: ApiClient, jobId?: string) {
    const currentApi = useRef(api); currentApi.current = api;
    const [asset, setAsset] = useState<{ api: ApiClient; id: string; scope: string; url: string } | null>(null);
    useEffect(() => {
        let live = true, generation = 0;
        const load = () => {
            const version = ++generation, scope = publishScope();
            setAsset(null);
            if (!jobId) return;
            Promise.resolve().then(() => mediaApi(api).getAsset(jobId)).then(result => {
                if (live && version === generation && scope === publishScope() && api === currentApi.current) setAsset({ api, id: jobId, scope, url: result.url });
            }).catch(() => {});
        };
        // Old picks must not acquire a fresh link in the next account's scope.
        const clear = () => { generation++; setAsset(null); };
        const userOff = subscribeCacheUser(clear), brandOff = brandStore.subscribe(clear);
        load();
        return () => { live = false; generation++; userOff(); brandOff(); };
    }, [api, jobId]);
    return asset?.api === api && asset.id === jobId && asset.scope === publishScope() ? asset.url : null;
}

export function MediaPreview({ api, choice, thumbnail = false }: { api: ApiClient; choice: MediaChoice; thumbnail?: boolean }) {
    const s = useThemedStyles(sheets);
    const uri = useMediaAsset(api, choice.kind === 'job' ? choice.job.job_id : undefined);
    const [failed, setFailed] = useState<string | null>(null);
    const label = t(choice.mediaType === 'image' ? 'publishParity.media.previewImage' : 'publishParity.media.previewVideo');
    if (uri && failed !== uri && choice.kind === 'job') {
        if (choice.mediaType === 'video') return thumbnail ? <VideoThumbnail key={uri} uri={uri} label={label} /> : <InlineMedia url={uri} label={label} />;
        if (choice.mediaType === 'image') return <Image source={{ uri }} cachePolicy="none" contentFit="cover" accessibilityLabel={rawText(label)} style={s.media} onError={() => setFailed(uri)} />;
    }
    return <View style={s.placeholder} accessibilityLabel={rawText(label)}><Icon name={choice.mediaType === 'video' ? 'play' : 'image'} size={24} />
        {choice.kind === 'upload' ? <Text tone="secondary">{t('publishParity.media.upload')}</Text> : null}
    </View>;
}

// Match the web's muted first-frame preview. There are no controls and playback never starts.
function VideoThumbnail({ uri, label }: { uri: string; label: string }) {
    const s = useThemedStyles(sheets);
    const player = useVideoPlayer({ uri, useCaching: false }, instance => { instance.muted = true; instance.loop = false; });
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (player.status === 'error') setFailed(true);
        const subscription = player.addListener('statusChange', event => { if (event.status === 'error') setFailed(true); });
        return () => subscription.remove();
    }, [player]);
    return failed ? <View style={s.placeholder} accessibilityLabel={rawText(label)}><Icon name="video" size={24} /></View> :
        <VideoView player={player} nativeControls={false} contentFit="cover" accessibilityLabel={rawText(label)} style={s.media} />;
}

export function ChosenMediaPreview({ api, choice }: { api: ApiClient; choice: MediaChoice | null }) {
    if (!choice) return null;
    return <Card><Text accessibilityRole="header" variant="bodyStrong">{t('publishParity.media.chosen')}</Text><MediaPreview api={api} choice={choice} /></Card>;
}
const sheets = themedStyles(p => ({
    media: { width: '100%', aspectRatio: 16 / 9, borderRadius: ds.radius.md },
    placeholder: { width: '100%', aspectRatio: 16 / 9, borderRadius: ds.radius.md, backgroundColor: p.bgElevated1, alignItems: 'center', justifyContent: 'center', gap: 8 },
}));
