import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useAuth } from '../../auth/AuthProvider';
import { subscribeCacheUser } from '../appCache';
import { mediaApi } from '../media';
import { recordListen, getTrackAddAudio } from './client';
import { createMusicPlayer, type PlaybackInput, type PlayerState } from './player';
import { claimAudioFocus, isAudioFocusOwner, releaseAudioFocus } from '../audioFocus';

const idle: PlayerState = { state: 'idle', position: 0, duration: 0 };
export function useMusicPlayer() {
    const { api } = useAuth();
    const [state, setState] = useState(idle);
    const ref = useRef<ReturnType<typeof createMusicPlayer> | null>(null);
    const loaded = useRef<PlaybackInput | null>(null);
    const focusId = useRef(Symbol('music-screen-player')).current;
    useFocusEffect(useCallback(() => {
        const build = () => createMusicPlayer({
            getAsset: mediaApi(api).getAsset,
            getTrackAddAudio: id => getTrackAddAudio(api, id),
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
        let controller = build();
        // An account change drops the old account's audio and builds a fresh controller so Play keeps working.
        const stopAccount = subscribeCacheUser(() => { releaseAudioFocus(focusId); controller.dispose(); controller = build(); ref.current = controller; loaded.current = null; setState(idle); });
        ref.current = controller; loaded.current = null; setState(idle);
        return () => { stopAccount(); releaseAudioFocus(focusId); controller.dispose(); ref.current = null; loaded.current = null; };
    }, [api, focusId]));
    return {
        state,
        async play(input: PlaybackInput) {
            const controller = ref.current;
            if (!controller) return;
            claimAudioFocus(focusId, () => controller.pause());
            if (JSON.stringify(loaded.current) !== JSON.stringify(input)) {
                loaded.current = input;
                if (!await controller.load(input)) return;
            }
            if (!isAudioFocusOwner(focusId)) return;
            await controller.play();
        },
        pause: () => { releaseAudioFocus(focusId); ref.current?.pause(); },
        seek: (seconds: number) => ref.current?.seek(seconds),
    };
}
