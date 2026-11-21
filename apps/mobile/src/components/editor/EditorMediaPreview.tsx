import { EditorTransformLayer } from './EditorTransformLayer';
import { rawText } from '../../lib/i18n/translate';
import { useEditorFrame, type FrameStore } from './editorFrameStore';
import { t } from '../../lib/i18n';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { editorClipGain, editorPlaybackRate, editorSourceTimeSeconds, resolveEditorMediaSource, type EditorMediaSource } from '../../lib/editorPreview';
import type { Clip, Media } from '../../lib/nativeEditorModel';

interface Props {
    readonly api: Pick<ApiClient, 'request'>;
    readonly clip: Clip;
    readonly media: Media;
    readonly frameStore: FrameStore;
    readonly fps: number;
    readonly playing: boolean;
    readonly localUri?: string;
}

export function EditorMediaPreview({ api, clip, media, frameStore, fps, playing, localUri }: Props) {
    const localKind = media.kind === 'video' || media.kind === 'image' ? media.kind : null;
    const [state, setState] = useState<{ key: string; source: EditorMediaSource | null; error: boolean }>({ key: '', source: null, error: false });
    const sourceProjectId = media.assetSource?.projectId;
    const sourceAssetId = media.assetSource?.assetId;
    const key = `${media.id}:${media.kind || ''}:${sourceProjectId || ''}:${sourceAssetId || ''}:${localUri || ''}`;
    const [dimensions, setDimensions] = useState({ key: '', width: 0, height: 0 });
    const onDimensions = useCallback((size?: { width: number; height: number }) => {
        if (size && size.width > 0 && size.height > 0) setDimensions(current => current.key === key && current.width === size.width && current.height === size.height
            ? current : { key, width: size.width, height: size.height });
    }, [key]);
    // Video catalog/track sizes may be unrotated. Only a decoded thumbnail establishes display dimensions.
    const fittedMedia = dimensions.key === key ? { ...media, width: dimensions.width, height: dimensions.height }
        : media.kind === 'video' ? { ...media, width: 0, height: 0 } : media;
    const [videoFailure, setVideoFailure] = useState('');
    const onFailure = useCallback((failed: boolean) => setVideoFailure(failed ? key : ''), [key]);
    const remoteMedia = useMemo<Media>(() => ({ id: media.id, kind: media.kind, assetSource: sourceProjectId && sourceAssetId ? { projectId: sourceProjectId, assetId: sourceAssetId } : undefined
        }), [media.id, media.kind, sourceAssetId, sourceProjectId]);
    const localSource: EditorMediaSource | null = localUri && localKind ? { uri: localUri, kind: localKind } : null;
    const source = localSource ?? (state.key === key ? state.source : null);
    const failed = !localSource && state.key === key && state.error;

    useEffect(() => {
        let active = true;
        if (localUri && localKind) return () => { active = false; };
        void resolveEditorMediaSource(api, remoteMedia)
            .then((source) => { if (active) setState({ key, source, error: !source }); })
            .catch(() => { if (active) setState({ key, source: null, error: true }); });
        return () => { active = false; };
    }, [api, key, localKind, localUri, remoteMedia]);

    if (!source && !failed) {
        return <View accessibilityLabel={t('editor.loadingmediapreview')} style={styles.center}><ActivityIndicator color="#3ee6c4" /></View>;
    }
    if (!source) {
        return <View accessibilityLabel={t('editor.mediapreviewunavailable')} style={styles.center}><Text style={styles.problem}>{t('editor.previewunavailable')}</Text><Text
        style={styles.detail}>{t('editor.theclipremainsonyourtimelineTry')}</Text></View>;
    }
    if (source.kind === 'image') {
        return <EditorTransformLayer clip={clip} media={fittedMedia} frameStore={frameStore}>
            <Image accessibilityLabel={rawText(t('editor.preview2', { value1: media.name || t('editor.imageFallback') }))}
                alt={media.name || t('editor.imagePreviewAlt')} source={{ uri:
        source.uri }} onLoad={event => onDimensions(event.source)} contentFit={dimensions.key === key ? 'contain' : clip.fit ?? 'contain'}
                style={StyleSheet.absoluteFill} /></EditorTransformLayer>;
    }
    return <><EditorTransformLayer clip={clip} media={fittedMedia} frameStore={frameStore}>
        <EditorVideo key={key} source={source} clip={clip} frameStore={frameStore} fps={fps} playing={playing} label={media.name || t('editor.video')}
            contentFit={dimensions.key === key ? 'contain' : clip.fit ?? 'contain'} onDimensions={onDimensions} onFailure={onFailure} />
    </EditorTransformLayer>
        {videoFailure === key ? <View accessibilityLabel={t('editor.mediapreviewunavailable')} style={styles.center}>
            <Text style={styles.problem}>{t('editor.previewunavailable')}</Text></View> : null}</>;
}

function EditorVideo({ source, clip, frameStore, fps, playing, label, contentFit, onDimensions, onFailure }: {
    source: EditorMediaSource; clip: Clip; frameStore: FrameStore; fps: number; playing: boolean; label: string;
    contentFit: 'contain' | 'cover'; onDimensions(size?: { width: number; height: number }): void; onFailure(failed: boolean): void;
}) {
    const frame = useEditorFrame(frameStore);
    const player = useVideoPlayer(source.uri, (next) => {
        next.loop = false;
        next.keepScreenOnWhilePlaying = true;
        next.timeUpdateEventInterval = 0.1;
    });

    useEffect(() => {
        let active = true, requested = false;
        const decodeDimensions = async () => {
            if (requested) return;
            requested = true;
            try {
                const thumbnails = await player.generateThumbnailsAsync(0, { maxWidth: 384, maxHeight: 384 });
                try { if (active) onDimensions(thumbnails[0]); }
                finally { thumbnails.forEach(thumbnail => thumbnail.release()); }
            } catch { /* Keep native fit when a display size cannot be decoded. */ }
        };
        const loaded = player.addListener('sourceLoad', () => { void decodeDimensions(); });
        const ready = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') void decodeDimensions(); });
        if (player.status === 'readyToPlay') void decodeDimensions();
        return () => { active = false; loaded.remove(); ready.remove(); };
    }, [player, onDimensions]);
    useEffect(() => {
        onFailure(player.status === 'error');
        const subscription = player.addListener('statusChange', ({ status }) => onFailure(status === 'error'));
        return () => subscription.remove();
    }, [player, onFailure]);

    useEffect(() => {
        const wanted = editorSourceTimeSeconds(clip, frame, fps);
        syncPlayer(player, clip, wanted, playing, fps, editorPlaybackRate(clip, frame), editorClipGain(clip, frame));
    }, [clip, fps, frame, player, playing]);

    return <VideoView accessibilityLabel={rawText(t('editor.preview2', { value1: label }))} player={player} contentFit={contentFit} nativeControls={false}
        surfaceType="textureView" style={StyleSheet.absoluteFill} />;
}

function syncPlayer(player: VideoPlayer, clip: Clip, wanted: number, playing: boolean, fps: number, rate: number, gain: number) {
    const still = clip.freezeFrame !== undefined;
    if (Math.abs(player.currentTime - wanted) > (playing ? 0.2 : 0.5 * rate / fps) || clip.reverse || still) player.currentTime = wanted;
    // Freeze is represented by pausing; native playback parameters require a positive rate.
    player.playbackRate = still ? 1 : Math.max(.1, rate);
    player.preservesPitch = clip.preservePitch === true;
    player.volume = gain;
    if (playing && !clip.reverse && !still) player.play(); else player.pause();
}

const styles = StyleSheet.create({
    center: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 20, backgroundColor: '#08080a' },
    problem: { color: '#f2f2f3', fontSize: 13, fontWeight: '800' },
    detail: { maxWidth: 250, color: '#a5a5ad', fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
