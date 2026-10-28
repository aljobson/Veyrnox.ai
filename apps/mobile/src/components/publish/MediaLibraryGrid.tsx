import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import type { ApiClient } from '../../lib/api';
import { choiceId, type CreationPick, type MediaChoice } from '../../lib/publishMediaChoice';
import { formatLocale, t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Card, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { useMediaAsset } from './ChosenMediaPreview';

type Props = { api: ApiClient; picks: CreationPick[]; choices: MediaChoice[]; max: number; disabled: boolean; onToggle: (pick: CreationPick) => void };
export function MediaLibraryGrid({ api, picks, choices, max, disabled, onToggle }: Props) {
    const s = useThemedStyles(sheets);
    const rows = Array.from({ length: Math.ceil(Math.min(picks.length, 24) / 3) }, (_, i) => picks.slice(i * 3, i * 3 + 3));
    return <View style={s.grid}>{rows.map((row, i) => <View key={i} style={s.row}>
        {row.map(pick => {
            const selected = choices.some(choice => choiceId(choice) === choiceId(pick));
            return <Tile key={pick.job.job_id} api={api} pick={pick} selected={selected} disabled={disabled || (!selected && max > 1 && choices.length >= max)} onToggle={onToggle} />;
        })}
        {Array.from({ length: 3 - row.length }, (_, j) => <View key={j} style={s.space} />)}
    </View>)}</View>;
}
function Tile({ api, pick, selected, disabled, onToggle }: { api: ApiClient; pick: CreationPick; selected: boolean; disabled: boolean; onToggle: Props['onToggle'] }) {
    const s = useThemedStyles(sheets);
    const uri = useMediaAsset(api, pick.mediaType === 'image' ? pick.job.job_id : undefined);
    const [failed, setFailed] = useState<string | null>(null);
    return <Card style={s.tile} selected={selected} disabled={disabled} onPress={() => onToggle(pick)}
        accessibilityRole="button" accessibilityState={{ selected, disabled }}
        accessibilityLabel={t('publishParity.media.tile', { name: pick.name, type: t(pick.mediaType === 'image' ? 'publishUploads.image' : 'publishUploads.video'), date: new Date(pick.job.created_at).toLocaleDateString(formatLocale()) })}>
        <Text numberOfLines={1} variant="caption">{pick.name}</Text>
        <View style={s.picture}>{uri && failed !== uri ? <Image source={{ uri }} cachePolicy="none" contentFit="cover" style={s.image} accessibilityElementsHidden importantForAccessibility="no" onError={() => setFailed(uri)} /> : <Icon name={pick.mediaType === 'video' ? 'play' : 'image'} size={24} />}</View>
        {selected ? <View style={s.badge}><Icon name="check" size={16} /></View> : null}
    </Card>;
}
const sheets = themedStyles(p => ({
    grid: { gap: 8 }, row: { flexDirection: 'row', gap: 8 }, space: { flex: 1 },
    tile: { flex: 1, flexDirection: 'column-reverse', minWidth: 96, aspectRatio: 1, borderRadius: ds.radius.md, padding: 4, overflow: 'hidden' },
    picture: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bgElevated1 },
    image: { width: '100%', height: '100%' },
    badge: { position: 'absolute', top: 4, right: 4, backgroundColor: p.accentSubtle, borderRadius: ds.radius.md, padding: 2 },
}));
