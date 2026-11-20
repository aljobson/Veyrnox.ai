import { useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import { publicCreatorUrl, publicTrackUrl } from '../../lib/music/musicLinks';
export function MusicLinkShare(props: { slug: string } | { handle: string }) {
    const [failed, setFailed] = useState(false), live = useRef(true);
    const url = 'slug' in props ? publicTrackUrl(props.slug) : publicCreatorUrl(props.handle);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, [url]);
    async function share() {
        setFailed(false);
        try { await Share.share({ message: url, url }); }
        catch { if (live.current) setFailed(true); }
    }
    return <>
        <Button icon="shareNetwork" variant="secondary" label={t('slug' in props ? 'musicPublication.shareTrack' : 'musicPublication.shareCreator')} onPress={() => void share()} />
        {failed ? <Text tone="danger">{t('music.shareSheetError')}</Text> : null}
    </>;
}
