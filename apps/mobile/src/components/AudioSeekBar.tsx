import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from './ui';
import { ds } from '../theme';
import { MIN_TARGET } from '../lib/a11y';
import { tAccessibility } from '../lib/i18n';
import { rawText } from '../lib/i18n/translate';

const SKIP_S = 10;
const clock = (seconds: number) => {
    const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
export function AudioSeekBar({ position, duration, label, onSeek: requestSeek, testID = 'inline-audio-position' }: {
    position: number; duration: number; label: string; onSeek(seconds: number): void; testID?: string;
}) {
    const styles = useThemedStyles(sheets);
    const [width, setWidth] = useState(0);
    const onSeek = (seconds: number) => requestSeek(Math.min(Math.max(0, seconds), duration > 0 ? duration : 0));
    const share = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    const where = tAccessibility('cinema.position', { position: clock(position), duration: clock(duration) });
    return (
        <View style={styles.timeline}>
            <Pressable testID={testID} accessibilityRole="adjustable" accessibilityLabel={rawText(label)} accessibilityValue={{ text: where }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={({ nativeEvent }) => onSeek(position + (nativeEvent.actionName === 'increment' ? SKIP_S : -SKIP_S))}
                onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
                onPress={({ nativeEvent }) => { if (width > 0 && duration > 0) onSeek((nativeEvent.locationX / width) * duration); }}
                style={styles.track}>
                <View style={styles.rail}><View style={[styles.fillBar, { width: `${share * 100}%` }]} /></View>
            </Pressable>
            <Text variant="caption" tone="secondary" accessibilityElementsHidden importantForAccessibility="no">{clock(position)} / {clock(duration)}</Text>
        </View>
    );
}
const sheets = themedStyles(p => ({
    timeline: { flex: 1, gap: ds.space.xs },
    track: { minHeight: MIN_TARGET, justifyContent: 'center' },
    rail: { height: 4, borderRadius: ds.radius.pill, backgroundColor: p.borderSubtle, overflow: 'hidden' },
    fillBar: { height: 4, backgroundColor: p.accent },
}));
