import { View } from 'react-native';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { BeatDoc, BeatTrackDoc, Edit } from '../../lib/beatNative/doc';
import { deleteLane, flattenGroup, setCrossfade, useWholeTake } from '../../lib/beatNative/takeShared';
import { BeatTakeWaveform } from './BeatTakeWaveform';
export function BeatTakeLanes({ doc, track, apply, locked }: { doc: BeatDoc; track: BeatTrackDoc; apply(edit: Edit, label?: string): boolean; locked: boolean }) {
    return <View>{track.takeGroups?.map((group, index) => <View key={group.id}>
        <Text accessibilityRole="header">{t('beatTakes.group', { n: index + 1 })}</Text>
        {group.lanes.map((id, lane) => {
            const asset = doc.assets?.[id]; if (asset?.source !== 'take') return null;
            const name = t('beatTakes.take', { n: lane + 1 });
            return <View key={id}>
                <Text>{name}</Text>
                <BeatTakeWaveform id={asset.ref} name={name} seconds={asset.durationSec} />
                <Button label={t('beatTakes.choose', { name })} disabled={locked} accessibilityState={{ selected: group.comp.length === 1 && group.comp[0][1] === lane }} onPress={() => apply(d => useWholeTake(d, track.id, group.id, lane))} />
                <Button label={t('beatTakes.delete', { name })} disabled={locked || group.lanes.length === 1} onPress={() => apply(d => deleteLane(d, track.id, group.id, lane))} />
            </View>;
        })}
        <Text>{t('beatTakes.crossfade', { ms: group.xfadeMs })}</Text>
        <Button label={t('beatTakes.crossfadeDown')} disabled={locked || group.xfadeMs <= 0} onPress={() => apply(d => setCrossfade(d, track.id, group.id, [0, 5, 10, 20, 50][Math.max(0, [0, 5, 10, 20, 50].indexOf(group.xfadeMs) - 1)]))} />
        <Button label={t('beatTakes.crossfadeUp')} disabled={locked || group.xfadeMs >= 50} onPress={() => apply(d => setCrossfade(d, track.id, group.id, [0, 5, 10, 20, 50][Math.min(4, [0, 5, 10, 20, 50].indexOf(group.xfadeMs) + 1)]))} />
        <Button label={t('beatTakes.flatten')} disabled={locked} onPress={() => apply(d => flattenGroup(d, track.id, group.id))} />
    </View>)}</View>;
}
