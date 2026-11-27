import { useMemo } from 'react';
import { useWindowDimensions, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { Text, themedStyles, useAppearance, useThemedStyles } from '../ui';
import { ds, featureHue, TEXT_SCALE } from '../../theme';
import { t } from '../../lib/i18n';
import { copyRegion, moveRegion, resizeRegion, trimRegionStart, type BeatDoc, type BeatRegionDoc, type BeatTrackDoc } from '../../lib/beatNative/doc';
import { dragValue, tickToX, xToTick, type DragMode, type DragValue } from '../../lib/beatNative/arrange';
import { useRegionHold } from '../../lib/beatNative/useRegionHold';
import { position, regionActions, regionLabel, regionName, type Apply } from '../../lib/beatNative/regionActions';

type Props = {
    doc: BeatDoc; track: BeatTrackDoc; region: BeatRegionDoc; zoom: number; snap: number; locator: number;
    selected: boolean; copy: boolean; ripple: boolean; disabled: boolean; apply: Apply; select: () => void; announce: (message: string) => void;
    laneHeight: number;
    lock: (held: boolean) => void; preview: (value: DragValue | null) => void; trackAt: (dy: number, originY: number) => string;
};
export type RegionTimelineMark = { tick: number; height: number };
export const regionTextureVisible = (regionHeight: number, systemFontScale: number, appTextScale: number) =>
    regionHeight >= 56 && appTextScale < TEXT_SCALE.xl && systemFontScale * appTextScale <= 1.35;
export function regionTimelineMarks(id: string, length: number, zoom = 96): RegionTimelineMark[] {
    let seed = 2166136261;
    for (const character of `${id}:${length}`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    const divisions = Math.max(1, Math.ceil(length / 240));
    const stride = Math.max(1, Math.ceil(96 / Math.max(1, zoom)), Math.ceil(divisions / 64));
    return Array.from({ length: Math.ceil(divisions / stride) }, (_, markIndex) => {
        const index = markIndex * stride;
        seed = Math.imul(seed ^ (index + 1), 16777619) >>> 0;
        const major = index % 4 === 0;
        return { tick: index * 240, height: major ? 12 + (seed % 5) : 5 + (seed % 6) };
    });
}
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
        accessibilityValue={{ text: position(mode === 'trim' ? props.region.start : props.region.start + props.region.length) }}
        accessibilityActions={[{ name: 'increment', label: t(mode === 'trim' ? 'beat.region.trim' : 'beat.region.longer') }, { name: 'decrement', label: t(mode === 'trim' ? 'beat.region.extend' : 'beat.region.shorter') }]}
        onAccessibilityAction={event => props.apply(d => mode === 'trim'
            ? trimRegionStart(d, props.region.id, props.region.start + (event.nativeEvent.actionName === 'increment' ? props.snap : -props.snap))
            : resizeRegion(d, props.region.id, props.region.length + (event.nativeEvent.actionName === 'increment' ? props.snap : -props.snap)), t('beat.region.changed'))} /></View>;
}
export function BeatRegionView(props: Props) {
    const { doc, region, track, zoom, selected, apply } = props;
    const s = useThemedStyles(sheets);
    const handlers = useDrag(props, 'move');
    const actions = regionActions(doc, track, region, props.snap, props.locator, props.ripple);
    const width = tickToX(region.length, zoom);
    const { fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const regionHeight = Math.max(44, props.laneHeight - 2 * ds.space.xs);
    const showTexture = regionTextureVisible(regionHeight, fontScale, TEXT_SCALE[settings.textSize]);
    const showHandles = selected && !props.disabled && width >= 88;
    // Quarter-beat positions stay aligned to musical time; deterministic heights distinguish regions without pretending to decode audio.
    const texture = useMemo(() => regionTimelineMarks(region.id, region.length, zoom), [region.id, region.length, zoom]);
    return <View pointerEvents="box-none" testID={`region-frame-${region.id}`} style={[s.region, {
        left: tickToX(region.start, zoom), width: Math.max(44, width + (showHandles ? 22 : 0)), height: regionHeight,
    }]}>
        <View {...(props.disabled ? { onTouchStart: (event: GestureResponderEvent) => event.stopPropagation(),
            onTouchEnd: (event: GestureResponderEvent) => { event.stopPropagation(); props.select(); } } : handlers)}
            testID={`region-${region.id}`} pointerEvents="box-only" accessible accessibilityRole="button"
            accessibilityLabel={regionLabel(doc, track, region)} accessibilityState={{ selected }}
            accessibilityActions={[{ name: 'activate', label: t('beat.region.select') }, ...(props.disabled ? [] : actions.map(({ name, label }) => ({ name, label })))]}
            onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'activate') { props.select(); return; }
                const action = actions.find(item => item.name === event.nativeEvent.actionName);
                if (action && !props.disabled) apply(action.operation, action.label);
            }}
            hitSlop={{ left: 0, right: Math.max(0, 44 - width), top: 0, bottom: 0 }}
            style={[s.block, { width }, region.clipId ? s.midi : region.assetId ? s.audio : s.drums, selected && s.selected]}>
            <Text testID={`region-label-${region.id}`} pointerEvents="none" numberOfLines={1} variant="caption">{regionName(doc, region)}</Text>
            {showTexture ? <View pointerEvents="none" style={s.texture}>{texture.map(mark =>
                <View key={mark.tick} style={[s.textureBar, { left: tickToX(mark.tick, zoom), height: mark.height }]} />)}</View>
                : null}
        </View>
        {showHandles && <><Handle mode="trim" props={props} style={{ left: 0, top: 0 }} />
            <Handle mode="resize" props={props} style={{ left: width - 22, bottom: 0 }} /></>}
    </View>;
}
const sheets = themedStyles((p, _r, scheme) => ({
    region: { position: 'absolute', top: ds.space.xs },
    block: { minHeight: 44, height: '100%', borderWidth: 2, borderRadius: ds.radius.xs, backgroundColor: p.surface, paddingVertical: ds.space.sm, paddingHorizontal: ds.space.sm, overflow: 'hidden' },
    selected: { borderColor: p.accent },
    drums: { borderColor: featureHue('iris', scheme).ink, backgroundColor: featureHue('iris', scheme).wash },
    audio: { borderColor: featureHue('sky', scheme).ink, backgroundColor: featureHue('sky', scheme).wash },
    midi: { borderColor: featureHue('rose', scheme).ink, backgroundColor: featureHue('rose', scheme).wash },
    texture: { position: 'absolute', left: ds.space.sm, right: ds.space.sm, bottom: 5, height: 17, overflow: 'hidden', opacity: 0.42 },
    textureBar: { position: 'absolute', bottom: 0, width: 2, borderRadius: 1, backgroundColor: p.textSecondary },
    handleHit: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    handle: { width: 24, height: 24, borderRadius: ds.radius.xs, backgroundColor: p.accent },
}));
