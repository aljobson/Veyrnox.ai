import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { ds } from '../theme';
import { themedStyles, useThemedStyles } from './ui/AppearanceContext';
import { useReducedMotion } from './ui/useReducedMotion';

export const REEL_MS = 1800;
const SPOKES = [0, 60, 120];

// A cassette drawn for an audio result. Decoration only: the player's own controls stay the way to
// play, seek and hear it. The reels turn while `playing`; Reduce Motion keeps the tape still.
export function CassetteReels({ playing }: { playing: boolean }) {
    const s = useThemedStyles(sheets);
    const reduced = useReducedMotion();
    const turn = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!playing || reduced) return;
        turn.setValue(0);
        const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: REEL_MS, easing: Easing.linear, useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [playing, reduced, turn]);
    const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    const reel = (
        <View style={s.well}>
            <Animated.View style={[s.hub, { transform: [{ rotate }] }]}>
                {SPOKES.map(deg => <View key={deg} style={[s.spoke, { transform: [{ rotate: `${deg}deg` }] }]} />)}
            </Animated.View>
        </View>
    );
    return (
        <View style={s.body} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="cassette-reels">
            <View style={s.label}><View style={s.labelLine} /></View>
            <View style={s.window}>{reel}<View style={s.tape} />{reel}</View>
            <View style={s.foot} />
        </View>
    );
}

const CASE = '#2a2724';
const PAPER = '#f5f1e8';
const INK = '#1d1b17';
const sheets = themedStyles(() => ({
    body: { alignSelf: 'center', width: 220, height: 138, borderRadius: ds.radius.md, backgroundColor: CASE, padding: ds.space.sm, gap: ds.space.xs },
    label: { height: 40, borderRadius: 4, backgroundColor: PAPER, justifyContent: 'center', paddingHorizontal: ds.space.sm },
    labelLine: { height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: INK, opacity: 0.35 },
    window: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44, borderRadius: 22, backgroundColor: INK, paddingHorizontal: ds.space.sm },
    well: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#6b4a2f', alignItems: 'center', justifyContent: 'center' },
    hub: { width: 22, height: 22, borderRadius: 11, backgroundColor: PAPER, alignItems: 'center', justifyContent: 'center' },
    spoke: { position: 'absolute', width: 2, height: 22, backgroundColor: INK },
    tape: { flex: 1, height: 2, backgroundColor: '#6b4a2f', marginHorizontal: -ds.space.xs },
    foot: { alignSelf: 'center', width: 120, height: 14, borderRadius: 3, backgroundColor: '#3a3632', marginTop: 'auto' },
}));
