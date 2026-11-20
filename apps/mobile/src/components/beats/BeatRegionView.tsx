import { View, type ViewStyle } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ds, featureHue } from '../../theme';
import { t } from '../../lib/i18n';
import { copyRegion, moveRegion, resizeRegion, trimRegionStart, type BeatDoc, type BeatRegionDoc, type BeatTrackDoc } from '../../lib/beatNative/doc';
import { dragValue, tickToX, xToTick, type DragMode, type DragValue } from '../../lib/beatNative/arrange';
import { useRegionHold } from '../../lib/beatNative/useRegionHold';
import { regionActions, regionLabel, regionName, type Apply } from '../../lib/beatNative/regionActions';

type Props = {
    doc: BeatDoc; track: BeatTrackDoc; region: BeatRegionDoc; zoom: number; snap: number; locator: number;
    selected: boolean; copy: boolean; apply: Apply; select: () => void; announce: (message: string) => void;
    lock: (held: boolean) => void; preview: (value: DragValue | null) => void; trackAt: (dy: number, originY: number) => string;
};
function useDrag(props: Props, mode: DragMode) {
    return useRegionHold({
        value: (dx, dy, originY) => dragValue(props.region, mode, xToTick(dx, props.zoom), props.snap, mode === 'move' ? props.trackAt(dy, originY) : props.track.id),
        preview: props.preview, lock: props.lock, select: props.select, announce: props.announce,
        commit: value => props.apply(d => mode === 'trim' ? trimRegionStart(d, props.region.id, value.start)
            : mode === 'resize' ? resizeRegion(d, props.region.id, value.length)
                : (props.copy ? copyRegion : moveRegion)(d, props.region.id, value.start, value.trackId), t('beat.region.changed')),
    });
}
function Handle({ mode, props, style }: { mode: 'trim' | 'resize'; props: Props; style: ViewStyle }) {
    const handlers = useDrag(props, mode);
    const s = useThemedStyles(sheets);
    return <View pointerEvents="box-none" testID={`${props.region.id}-${mode}-hit`} style={[s.handleHit, style]}><View {...handlers} testID={`${props.region.id}-${mode}`} pointerEvents="box-only" style={s.handle} hitSlop={10}
        accessible accessibilityRole="adjustable" accessibilityLabel={t(mode === 'trim' ? 'beat.region.trim' : 'beat.region.resize')}
        accessibilityActions={[{ name: 'increment', label: t(mode === 'trim' ? 'beat.region.trim' : 'beat.region.longer') }, { name: 'decrement', label: t(mode === 'trim' ? 'beat.region.extend' : 'beat.region.shorter') }]}
        onAccessibilityAction={event => props.apply(d => mode === 'trim'
            ? trimRegionStart(d, props.region.id, props.region.start + (event.nativeEvent.actionName === 'increment' ? props.snap : -props.snap))
            : resizeRegion(d, props.region.id, props.region.length + (event.nativeEvent.actionName === 'increment' ? props.snap : -props.snap)), t('beat.region.changed'))} /></View>;
}
export function BeatRegionView(props: Props) {
    const { doc, region, track, zoom, selected, apply } = props;
    const s = useThemedStyles(sheets);
    const handlers = useDrag(props, 'move');
    const actions = regionActions(doc, track, region, props.snap, props.locator);
    const width = tickToX(region.length, zoom);
    const showHandles = selected && width >= 88;
    return <View pointerEvents="box-none" testID={`region-frame-${region.id}`} style={[s.region, { left: tickToX(region.start, zoom), width: Math.max(44, width + (showHandles ? 22 : 0)) }]}>
        <View {...handlers} testID={`region-${region.id}`} pointerEvents="box-only" accessible accessibilityRole="button"
            accessibilityLabel={regionLabel(doc, track, region)} accessibilityState={{ selected }}
            accessibilityActions={[{ name: 'activate', label: t('beat.region.select') }, ...actions.map(({ name, label }) => ({ name, label }))]}
            onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'activate') { props.select(); return; }
                const action = actions.find(item => item.name === event.nativeEvent.actionName);
                if (action) apply(action.operation, action.label);
            }}
            hitSlop={{ left: 0, right: Math.max(0, 44 - width), top: 0, bottom: 0 }}
            style={[s.block, { width }, region.clipId ? s.midi : region.assetId ? s.audio : s.drums, selected && s.selected]}>
            <Text testID={`region-label-${region.id}`} pointerEvents="none" numberOfLines={2} variant="caption">{regionName(doc, region)}</Text>
        </View>
        {showHandles && <><Handle mode="trim" props={props} style={{ left: 0, top: 0 }} />
            <Handle mode="resize" props={props} style={{ left: width - 22, bottom: 0 }} /></>}
    </View>;
}
const sheets = themedStyles((p, _r, scheme) => ({
    region: { position: 'absolute', top: ds.space.xs, height: 88 },
    block: { minHeight: 88, height: '100%', borderWidth: 2, borderRadius: ds.radius.xs, backgroundColor: p.surface, paddingVertical: ds.space.xxl, overflow: 'hidden' },
    selected: { borderColor: p.accent },
    drums: { borderColor: featureHue('iris', scheme).ink, backgroundColor: featureHue('iris', scheme).wash },
    audio: { borderColor: featureHue('sky', scheme).ink, backgroundColor: featureHue('sky', scheme).wash },
    midi: { borderColor: featureHue('rose', scheme).ink, backgroundColor: featureHue('rose', scheme).wash },
    handleHit: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    handle: { width: 24, height: 24, borderRadius: ds.radius.xs, backgroundColor: p.accent },
}));
