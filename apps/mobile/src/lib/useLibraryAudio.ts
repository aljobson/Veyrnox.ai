import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer } from 'expo-video';
import { subscribeCacheUser } from './appCache';
import type { createAssetLinks } from './libraryMedia';

const empty = { loaded: null, playing: null, position: 0, duration: 0 };
type Playback = { loaded: string | null; playing: string | null; position: number; duration: number };

export function useLibraryAudio(links: Pick<ReturnType<typeof createAssetLinks>, 'request'>) {
    const player = useVideoPlayer(null, p => { p.muted = true; p.loop = false; p.timeUpdateEventInterval = 0.5; });
    const [state, setState] = useState<Playback>(empty);
    const current = useRef<Playback>(empty);
    const version = useRef(0);
    const atEnd = useRef(false);
    // Serialize native replacements: a late completion must never overwrite the newer source.
    const replacements = useRef<Promise<void>>(Promise.resolve());
    const update = useCallback((next: Playback) => { current.current = next; setState(next); }, []);
    const clear = useCallback(() => {
        version.current++;
        atEnd.current = false;
        player.pause();
        update(empty);
    }, [player, update]);
    useFocusEffect(useCallback(() => clear, [clear]));
    useEffect(() => {
        const app = AppState.addEventListener('change', value => { if (value !== 'active') clear(); });
        const unsubscribe = subscribeCacheUser(() => {
            clear();
            const ticket = version.current;
            replacements.current = replacements.current.then(async () => {
                if (ticket === version.current) await player.replaceAsync(null);
            }).catch(() => {});
        });
        const time = player.addListener('timeUpdate', ({ currentTime }) => {
            if (current.current.loaded) update({ ...current.current, position: currentTime, duration: player.duration });
        });
        const source = player.addListener('sourceLoad', ({ duration }) => {
            if (current.current.loaded) update({ ...current.current, duration });
        });
        const ended = player.addListener('playToEnd', () => {
            if (current.current.loaded) {
                atEnd.current = true;
                update({ ...current.current, playing: null, position: player.duration });
            }
        });
        return () => { app.remove(); unsubscribe(); time.remove(); source.remove(); ended.remove(); clear(); };
    }, [player, clear, update, links]);

    const seek = (seconds: number) => {
        if (!current.current.loaded) return;
        const position = Math.min(Math.max(0, seconds), Math.max(0, current.current.duration));
        atEnd.current = false;
        player.currentTime = position;
        update({ ...current.current, position });
    };
    const toggle = async (id: string) => {
        if (current.current.loaded === id) {
            if (current.current.playing === id) {
                player.pause();
                update({ ...current.current, playing: null });
            } else {
                if (atEnd.current) seek(0);
                player.play();
                update({ ...current.current, playing: id });
            }
            return;
        }
        clear();
        const ticket = version.current;
        try {
            const link = await links.request(id);
            if (ticket !== version.current || link.kind !== 'file') return;
            const replace = replacements.current.then(async () => {
                if (ticket !== version.current) return;
                await player.replaceAsync(link.url);
                if (ticket !== version.current) return;
                player.currentTime = 0;
                update({ loaded: id, playing: id, position: 0, duration: player.duration });
                player.muted = false;
                player.play();
            });
            replacements.current = replace.catch(() => {});
            await replace;
        } catch { if (ticket === version.current) clear(); }
    };
    return { ...state, toggle, seek };
}
