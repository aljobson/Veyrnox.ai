import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useAuth } from '../../auth/AuthProvider';
import { mediaApi } from '../media';
import { recordListen } from './client';
import { createMusicPlayer, type PlaybackInput, type PlayerState } from './player';

const idle: PlayerState = { state: 'idle', position: 0, duration: 0 };
export function useMusicPlayer() {
    const { api } = useAuth();
    const [state, setState] = useState(idle);
    const ref = useRef<ReturnType<typeof createMusicPlayer> | null>(null);
    const loaded = useRef<PlaybackInput | null>(null);
    useFocusEffect(useCallback(() => {
        const controller = createMusicPlayer({
            getAsset: mediaApi(api).getAsset,
            factory: url => createAudioPlayer({ uri: url }, { updateInterval: 100 }),
            setAudioMode: setAudioModeAsync,
            recordListen: songId => recordListen(api, songId),
            subscribeAppState: cb => {
                // Seed the current state without treating inactive/unknown as a Play lock.
                cb(AppState.currentState);
                const sub = AppState.addEventListener('change', cb);
                return () => sub.remove();
            },
            onState: setState,
        });
        ref.current = controller; loaded.current = null; setState(idle);
        return () => { controller.dispose(); ref.current = null; loaded.current = null; };
    }, [api]));
    return {
        state,
        async play(input: PlaybackInput) {
            const controller = ref.current;
            if (!controller) return;
            if (JSON.stringify(loaded.current) !== JSON.stringify(input)) {
                loaded.current = input;
                if (!await controller.load(input)) return;
            }
            await controller.play();
        },
        pause: () => ref.current?.pause(),
        seek: (seconds: number) => ref.current?.seek(seconds),
    };
}
