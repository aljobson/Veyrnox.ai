import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { loadBeatTake, subscribeBeatTakes } from '../../lib/beatNative/takeShared';
export function takePeaks(samples: Float32Array, buckets = 48): [number, number][] {
    return Array.from({ length: Math.min(buckets, samples.length) }, (_, bucket) => {
        const count = Math.min(buckets, samples.length), start = Math.floor(bucket * samples.length / count), end = Math.floor((bucket + 1) * samples.length / count);
        let min = 0, max = 0;
        for (let i = start; i < end; i++) { min = Math.min(min, samples[i]); max = Math.max(max, samples[i]); }
        return [min, max];
    });
}
export function BeatTakeWaveform({ id, name, seconds }: { id: string; name: string; seconds: number }) {
    const s = useThemedStyles(sheets), [peaks, setPeaks] = useState<[number, number][] | null>(null), [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        const refresh = () => { void loadBeatTake(id).then(row => { if (active) { setPeaks(row ? takePeaks(row.samples) : null); setFailed(false); } }).catch(() => { if (active) setFailed(true); }); };
        refresh(); const off = subscribeBeatTakes(refresh);
        return () => { active = false; off(); };
    }, [id]);
    if (!peaks) return <Text>{t(failed ? 'beatTakes.recoveryError' : 'beatTakes.cloudOnly')}</Text>;
    return <View accessible accessibilityLabel={t('beatTakes.waveform', { name, seconds: seconds.toFixed(1) })} style={s.wave}>
        {peaks.map(([min, max], i) => <View key={i} style={[s.bucket, { height: 40 }]}><View style={[s.bar, { top: (1 - max) * 20, height: Math.max(1, (max - min) * 20) }]} /></View>)}
    </View>;
}
const sheets = themedStyles(p => ({ wave: { flexDirection: 'row', height: 40, gap: 1 }, bucket: { flex: 1 }, bar: { position: 'absolute', left: 0, right: 0, backgroundColor: p.accent } }));
