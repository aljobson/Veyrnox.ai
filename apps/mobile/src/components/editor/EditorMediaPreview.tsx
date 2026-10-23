import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { editorSourceTimeSeconds, resolveEditorMediaSource, type EditorMediaSource } from '../../lib/editorPreview';
import type { Clip, Media } from '../../lib/nativeEditorModel';

interface Props {
    readonly api: Pick<ApiClient, 'request'>;
    readonly clip: Clip;
    readonly media: Media;
    readonly frame: number;
    readonly fps: number;
    readonly playing: boolean;
    readonly localUri?: string;
}

export function EditorMediaPreview({ api, clip, media, frame, fps, playing, localUri }: Props) {
    const localKind = media.kind === 'video' || media.kind === 'image' ? media.kind : null;
    const [state, setState] = useState<{ key: string; source: EditorMediaSource | null; error: boolean }>({ key: '', source: null, error: false });
    const sourceProjectId = media.assetSource?.projectId;
    const sourceAssetId = media.assetSource?.assetId;
    const key = `${media.id}:${media.kind || ''}:${sourceProjectId || ''}:${sourceAssetId || ''}:${localUri || ''}`;
    const remoteMedia = useMemo<Media>(() => ({ id: media.id, kind: media.kind, assetSource: sourceProjectId && sourceAssetId ? { projectId: sourceProjectId, assetId: sourceAssetId } : undefined }), [media.id, media.kind, sourceAssetId, sourceProjectId]);
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
        return <View accessibilityLabel="Loading media preview" style={styles.center}><ActivityIndicator color="#3ee6c4" /></View>;
    }
    if (!source) {
        return <View accessibilityLabel="Media preview unavailable" style={styles.center}><Text style={styles.problem}>Preview unavailable</Text><Text style={styles.detail}>The clip remains on your timeline. Try reopening it when you are online.</Text></View>;
    }
    if (source.kind === 'image') {
        return <Image accessibilityLabel={`Preview ${media.name || 'image'}`} alt={media.name || 'Image preview'} source={{ uri: source.uri }} contentFit={clip.fit === 'cover' ? 'cover' : 'contain'} style={StyleSheet.absoluteFill} />;
    }
    return <EditorVideo source={source} clip={clip} frame={frame} fps={fps} playing={playing} label={media.name || 'video'} />;
}

function EditorVideo({ source, clip, frame, fps, playing, label }: { source: EditorMediaSource; clip: Clip; frame: number; fps: number; playing: boolean; label: string }) {
    const [failed, setFailed] = useState(false);
    const player = useVideoPlayer(source.uri, (next) => {
        next.loop = false;
        next.keepScreenOnWhilePlaying = true;
        next.timeUpdateEventInterval = 0.1;
    });

    useEffect(() => {
        const subscription = player.addListener('statusChange', ({ status }) => setFailed(status === 'error'));
        return () => subscription.remove();
    }, [player]);

    useEffect(() => {
        const wanted = editorSourceTimeSeconds(clip, frame, fps);
        syncPlayer(player, clip, wanted, playing);
    }, [clip, fps, frame, player, playing]);

    if (failed) return <View accessibilityLabel="Media preview unavailable" style={styles.center}><Text style={styles.problem}>Preview unavailable</Text></View>;
    return <VideoView accessibilityLabel={`Preview ${label}`} player={player} contentFit={clip.fit === 'cover' ? 'cover' : 'contain'} nativeControls={false} style={StyleSheet.absoluteFill} />;
}

function syncPlayer(player: VideoPlayer, clip: Clip, wanted: number, playing: boolean) {
    if (Math.abs(player.currentTime - wanted) > 0.2 || clip.reverse) player.currentTime = wanted;
    player.playbackRate = Math.max(0.1, Math.min(16, clip.rate ?? 1));
    player.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
    if (playing && !clip.reverse) player.play(); else player.pause();
}

const styles = StyleSheet.create({
    center: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 20, backgroundColor: '#08080a' },
    problem: { color: '#f2f2f3', fontSize: 13, fontWeight: '800' },
    detail: { maxWidth: 250, color: '#a5a5ad', fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
