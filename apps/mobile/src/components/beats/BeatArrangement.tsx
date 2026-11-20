import { useCallback, useEffect, useRef, useState, type RefObject, type ComponentRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { addRegion, clampLocator, selectPattern, snapTick, songEnd, type BeatDoc, type BeatRegionDoc, type BeatTrackDoc } from '../../lib/beatNative/doc';
import { arrangementBars, laneAt, tickToX, xToTick, type DragValue } from '../../lib/beatNative/arrange';
import { regionLabel, type Apply } from '../../lib/beatNative/regionActions';
import { BeatRegionView } from './BeatRegionView';
import { BeatRegionInspector } from './BeatRegionInspector';
import { BeatRuler, BeatRulerControls, RULER_HEIGHT } from './BeatRuler';

type Props = { manualRun: RefObject<boolean>; doc: BeatDoc; apply: Apply; playing: boolean; step: number | null; announce: (message: string) => void; onHold: (held: boolean) => void };
const MIN_LANE_HEIGHT = 96;
export function BeatArrangement({ doc, apply, playing, step, announce, onHold, manualRun }: Props) {
    const s = useThemedStyles(sheets);
    const [zoom, setZoom] = useState(96);
    const [snap, setSnap] = useState('240');
    const [copy, setCopy] = useState(false);
    const [locator, setLocator] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [trackId, setTrackId] = useState(doc.tracks[0]?.id);
    const [preview, setPreview] = useState<DragValue | null>(null);
    const [held, setHeld] = useState(false);
    const [heights, setHeights] = useState<Record<string, number>>({});
    const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
    const viewport = useRef(0), scroll = useRef(0);
    const lock = useCallback((value: boolean) => { setHeld(value); onHold(value); }, [onHold]);
    const end = songEnd(doc), bars = arrangementBars(doc, locator), width = bars * zoom;
    const selectedTrack = doc.tracks.find(track => track.regions.some(region => region.id === selectedId));
    const selectedRegion = selectedTrack?.regions.find(region => region.id === selectedId);
    const editTrack = doc.tracks.find(track => track.id === trackId) ?? doc.tracks[0];
    const laneHeights = doc.tracks.map(track => heights[track.id] ?? MIN_LANE_HEIGHT);
    const head = tickToX(playing ? (step ?? 0) * 240 : locator, zoom);
    useEffect(() => { if (!selectedRegion) setSelectedId(null); }, [selectedRegion]);
    useEffect(() => { setLocator(value => clampLocator(value, end)); }, [end]);
    useEffect(() => {
        if (!playing || manualRun.current || held || viewport.current <= 0) return;
        if (head < scroll.current || head > scroll.current + viewport.current - 32) {
            const x = Math.max(0, head - viewport.current / 4);
            scroller.current?.scrollTo({ x, animated: false }); scroll.current = x;
        }
    }, [head, playing, held, manualRun]);
    const choose = (region: BeatRegionDoc, track: BeatTrackDoc) => {
        setSelectedId(region.id); setTrackId(track.id);
        if (region.pattern && region.pattern !== doc.currentPattern) apply(d => selectPattern(d, region.pattern!));
        announce(regionLabel(doc, track, region));
    };
    const setPosition = (value: number) => setLocator(clampLocator(value, end));
    return <View style={s.group} testID="beat-arrangement">
        <SegmentedControl accessibilityLabel={t('beat.snap.label')} value={snap} onChange={setSnap} options={[
            { value: '3840', label: t('beat.snap.bar') }, { value: '960', label: t('beat.snap.quarter') },
            { value: '480', label: t('beat.snap.eighth') }, { value: '240', label: t('beat.snap.sixteenth') },
        ]} />
        <View style={s.controls}>
            <Button size="md" variant="secondary" label={t('beat.zoom.out')} disabled={zoom === 32} onPress={() => setZoom(value => Math.max(32, value - 32))} />
            <Button size="md" variant="secondary" label={t('beat.zoom.in')} disabled={zoom === 256} onPress={() => setZoom(value => Math.min(256, value + 32))} />
            <Button size="md" variant="secondary" label={t('beat.region.copy')} accessibilityState={{ selected: copy }} onPress={() => setCopy(value => !value)} />
        </View>
        <Button variant="secondary" label={t('beat.region.add')} disabled={!editTrack || (!!editTrack.kind && editTrack.kind !== 'drums')}
            onPress={() => apply(d => addRegion(d, editTrack.id, snapTick(locator, Number(snap)), d.currentPattern), t('beat.region.changed'))} />
        {editTrack?.kind && editTrack.kind !== 'drums' && <Text variant="footnote">{t('beat.region.drumOnly')}</Text>}
        <BeatRulerControls locator={locator} end={end} setLocator={setPosition} cycle={doc.cycle} apply={apply} />
        <View style={s.timeline}>
            <View style={s.headers}>
                <View style={{ height: RULER_HEIGHT }} />
                {doc.tracks.map((track, index) => <Pressable key={track.id} accessibilityRole="button" accessibilityLabel={track.name}
                    accessibilityState={{ selected: editTrack?.id === track.id }} onPress={() => setTrackId(track.id)}
                    onLayout={event => { const height = Math.max(MIN_LANE_HEIGHT, event.nativeEvent.layout.height); setHeights(values => values[track.id] === height ? values : { ...values, [track.id]: height }); }}
                    style={[s.header, { minHeight: laneHeights[index] }, editTrack?.id === track.id && s.selected]}><Text variant="caption">{track.name}</Text></Pressable>)}
            </View>
            <ScrollView ref={scroller} horizontal testID="arrangement-scroll" scrollEnabled={!held} style={s.scroller}
                onLayout={event => { viewport.current = event.nativeEvent.layout.width; }}
                onScrollBeginDrag={() => { if (playing) manualRun.current = true; }}
                onScroll={event => { scroll.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={16}>
                <View style={{ width }}>
                    <BeatRuler bars={bars} zoom={zoom} snap={Number(snap)} locator={locator} end={end} setLocator={setPosition}
                        cycle={doc.cycle} apply={apply} lock={lock} announce={announce} />
                    {doc.tracks.map((track, index) => <View key={track.id} testID={`track-lane-${track.id}`} style={[s.lane, { height: laneHeights[index] }]}>
                        <Pressable testID={`lane-${track.id}`} accessible={false} style={s.emptyLane}
                            onPress={event => setPosition(snapTick(xToTick(event.nativeEvent.locationX, zoom), Number(snap)))} />
                        {track.regions.map(region => <BeatRegionView key={region.id} doc={doc} track={track} region={region}
                            zoom={zoom} snap={Number(snap)} locator={locator} selected={selectedId === region.id} copy={copy} apply={apply}
                            select={() => choose(region, track)} announce={announce} lock={lock} preview={setPreview}
                            trackAt={(dy, originY) => doc.tracks[laneAt(laneHeights.slice(0, index).reduce((a, b) => a + b, 0) + ds.space.xs + originY + dy, laneHeights)].id} />)}
                        {preview?.trackId === track.id && <View pointerEvents="none" testID="region-preview" style={[s.preview, { left: tickToX(preview.start, zoom), width: tickToX(preview.length, zoom) }]} />}
                    </View>)}
                    <View pointerEvents="none" accessible={false} testID="playhead" style={[s.playhead, { left: head }]} />
                </View>
            </ScrollView>
        </View>
        <View style={s.controls}>
            <Button size="md" variant="secondary" label={t('beat.ruler.left')} onPress={() => setPosition(locator - Number(snap))} />
            <Button size="md" variant="secondary" label={t('beat.ruler.right')} onPress={() => setPosition(locator + Number(snap))} />
        </View>
        {selectedRegion && selectedTrack && <BeatRegionInspector doc={doc} track={selectedTrack} region={selectedRegion} snap={Number(snap)} locator={locator} apply={apply} />}
    </View>;
}
const sheets = themedStyles(p => ({
    group: { gap: ds.space.md },
    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    timeline: { flexDirection: 'row', direction: 'ltr' },
    headers: { width: 80 },
    header: { padding: ds.space.sm, justifyContent: 'center', borderWidth: 1, borderColor: p.borderSubtle },
    selected: { borderColor: p.accent },
    scroller: { flex: 1 },
    lane: { borderBottomWidth: 1, borderColor: p.borderSubtle },
    emptyLane: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0 },
    preview: { position: 'absolute', top: ds.space.xs, height: 88, borderWidth: 2, borderColor: p.accent, backgroundColor: p.surface, opacity: 0.7, borderRadius: ds.radius.xs },
    playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: p.accent },
}));
