import { useEffect, useRef } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

// Plays one audio template's sample. AudioTemplateCard loads this file only while its card is playing, so screens that
// list templates never load expo-audio until someone presses play, and unmounting releases the player.
export function SamplePlayer({ url, onEnd }: { readonly url: string; onEnd(): void }) {
    const player = useAudioPlayer({ uri: url });
    const status = useAudioPlayerStatus(player);
    useEffect(() => {
        setAudioModeAsync({ playsInSilentMode: true }).catch(() => { /* Playback still works with the default mode. */ });
        player.play();
    }, [player]);
    // onEnd toggles the card, so it must run once per playback: a new onEnd from a re-render while didJustFinish is
    // still true would otherwise toggle the sample back on.
    const latestOnEnd = useRef(onEnd);
    latestOnEnd.current = onEnd;
    const ended = useRef(false);
    useEffect(() => {
        if (!status.didJustFinish || ended.current) return;
        ended.current = true;
        latestOnEnd.current();
    }, [status.didJustFinish]);
    return null;
}
