import { Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { manifestUrl } from '../../../lib/cinemaPlayback';

// Development only (spike part 2): plays a real Stream manifest from a token minted elsewhere, and shows
// the startup time and player status. Open it with dev/open-manifest.mjs. Not reachable in a release build.
export default function Probe() {
    const { code, token } = useLocalSearchParams<{ code?: string; token?: string }>();
    const started = useRef(0);
    const [log, setLog] = useState<string[]>([]);
    const add = (line: string) => setLog((l) => [...l, `${((Date.now() - started.current) / 1000).toFixed(2)}s ${line}`]);
    const player = useVideoPlayer(null);

    useEffect(() => {
        if (!__DEV__ || !code || !token) return;
        const subs = [
            player.addListener('statusChange', ({ status, error }) => add(`status ${status}${error ? ` ${error.message}` : ''}`)),
            player.addListener('playingChange', ({ isPlaying }) => add(`playing ${isPlaying}`)),
        ];
        started.current = Date.now();
        player.replace({ uri: manifestUrl({ customerCode: code, token }, undefined) });
        player.play();
        return () => subs.forEach((s) => s.remove());
    }, [player, code, token]);

    if (!__DEV__) return null;
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Playback probe' }} />
            <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
            <Text style={styles.log}>{log.join('\n') || 'Waiting for ?code= and ?token='}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#000' },
    video: { flex: 1 },
    log: { color: '#3ee6c4', padding: 12, fontFamily: 'Courier', fontSize: 12 },
});
