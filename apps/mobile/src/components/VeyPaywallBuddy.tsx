import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AMBIENT_HOP_MS, paywallMoodFor, type PaywallEvent, type VeyMood } from '../lib/veyMotion';
import { VeyCharacter } from './VeyCharacter';

// The mood of the companion beside a paywall. `notify` takes what the reader just did; a mood with a hold settles back
// to idle by itself. `welcome` is how Vey greets the reader when the screen opens.
export function useVeyPaywallMood(welcome?: PaywallEvent) {
    const [mood, setMood] = useState<VeyMood>('idle');
    const current = useRef<VeyMood>('idle');
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const change = useCallback((next: VeyMood) => {
        current.current = next;
        setMood(next);
    }, []);

    const notify = useCallback(
        (event: PaywallEvent) => {
            const { mood: next, holdMs } = paywallMoodFor(event);
            // A store sheet in flight is not interrupted by an idle hop.
            if (event === 'ambient' && current.current !== 'idle') return;
            if (timer.current) clearTimeout(timer.current);
            change(next);
            timer.current = holdMs ? setTimeout(() => change('idle'), holdMs) : null;
        },
        [change],
    );

    useEffect(() => {
        if (welcome) notify(welcome);
        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, [welcome, notify]);

    useEffect(() => {
        const id = setInterval(() => notify('ambient'), AMBIENT_HOP_MS);
        return () => clearInterval(id);
    }, [notify]);

    return { mood, notify };
}

// Vey beside a paywall, standing on the top edge of what it sells. Decoration: the words and prices carry the meaning,
// so it is hidden from screen readers (VeyCharacter does that), takes no touches, and holds still under Reduce Motion.
export function VeyPaywallBuddy({ mood, width = 72 }: { mood: VeyMood; width?: number }) {
    return (
        <View style={styles.row} pointerEvents="none">
            <VeyCharacter width={width} mood={mood} />
        </View>
    );
}

const styles = StyleSheet.create({
    row: { alignItems: 'flex-end', marginBottom: -4, paddingEnd: 12 },
});
