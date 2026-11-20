import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { useReducedMotion } from '../ui/useReducedMotion';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { meterText, subscribeMeter } from '../../lib/beatNative/meter';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

export function BeatMeter({ audio, trackId, name }: { audio: BeatAudio | null; trackId: string; name: string }) {
    const [db, setDb] = useState(-60);
    const reduced = useReducedMotion();
    const s = useThemedStyles(sheets);
    useEffect(() => subscribeMeter(audio, trackId, reduced, setDb), [audio, trackId, reduced]);
    return <View accessible accessibilityRole="progressbar" accessibilityLabel={t('beatMix.meter.label', { track: name })}
        accessibilityValue={{ min: -60, max: 0, now: db, text: meterText(db) }}>
        <Text variant="footnote">{meterText(db)}</Text>
        {!reduced && <View style={s.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[s.fill, { width: `${(db + 60) / 60 * 100}%` }]} />
        </View>}
    </View>;
}
const sheets = themedStyles(p => ({ track: { height: 6, backgroundColor: p.borderSubtle, overflow: 'hidden', borderRadius: ds.radius.pill }, fill: { height: 6, backgroundColor: p.accent } }));
