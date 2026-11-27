import { useCallback, useEffect, useRef, useState, type RefObject, type ComponentRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Icon, SegmentedControl, Text, TextField, themedStyles, useAppearance, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { addRegion, barTicks, BeatRefusal, clampLocator, renameTrack, snapTick, songEnd, type BeatDoc, type BeatRegionDoc, type BeatTrackDoc, type PatternSlot } from '../../lib/beatNative/doc';
import { arrangementBars, guardedRippleInsert, laneAt, tickToX, xToTick, type DragValue } from '../../lib/beatNative/arrange';
import { position, regionLabel, type Apply } from '../../lib/beatNative/regionActions';
import { BeatRegionView } from './BeatRegionView';
import { BeatRegionInspector } from './BeatRegionInspector';
import { BeatRuler, BeatRulerControls, RULER_HEIGHT } from './BeatRuler';
import { BeatClipSearch } from './BeatClipSearch';
import { type ClipSearchResult } from '../../lib/beatNative/clipSearch';
import type { BeatEditorLayout } from '../../lib/beatNative/editorLayout';
import { musicTrackIcon } from '../../lib/beatNative/musicTrackGlyph';

type Props = {
    manualRunRef: RefObject<boolean>; doc: BeatDoc; apply: Apply; selectCurrentPattern: (slot: PatternSlot) => void;
    editTrackId: string | undefined; onEditTrackChange: (trackId: string) => void;
    locator: number; onLocatorChange: (tick: number) => void; snap: number; onSnapChange: (snap: number) => void;
    playing: boolean; step: number | null; disabled: boolean; navigationDisabled: boolean;
    announce: (message: string) => void; onHold: (held: boolean) => void;
    onRevealLane: (lane: ComponentRef<typeof View> | null) => void;
    layout: BeatEditorLayout;
    compactHeight?: boolean;
};
const MIN_LANE_HEIGHT = 64;
const COMPACT_LANE_HEIGHT = 56;
export const resolvedLaneHeight = (measuredHeight: number | undefined, compactHeight: boolean) =>
    Math.max(compactHeight ? COMPACT_LANE_HEIGHT : MIN_LANE_HEIGHT, measuredHeight ?? 0);
export function BeatArrangement({ doc, apply, selectCurrentPattern, editTrackId, onEditTrackChange, locator, onLocatorChange, snap, onSnapChange, playing, step, disabled, navigationDisabled, announce, onHold, onRevealLane, manualRunRef, layout, compactHeight = false }: Props) {
    const s = useThemedStyles(sheets);
    const { increasedContrast } = useAppearance();
    const [zoom, setZoom] = useState(96);
    const [copy, setCopy] = useState(false);
    const [ripple, setRipple] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [preview, setPreview] = useState<DragValue | null>(null);
    const [held, setHeld] = useState(false);
    const [heights, setHeights] = useState<Record<string, number>>({});
    const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
    const lanes = useRef<Record<string, ComponentRef<typeof View> | null>>({});
    const pendingRevealTrackId = useRef<string | null>(null);
    const [revealRequest, setRevealRequest] = useState(0);
    const viewport = useRef(0), scroll = useRef(0);
    const lock = useCallback((value: boolean) => { setHeld(value); onHold(value); }, [onHold]);
    const end = songEnd(doc), bars = arrangementBars(doc, locator), width = bars * zoom;
    const selectedTrack = doc.tracks.find(track => track.regions.some(region => region.id === selectedId));
    const selectedRegion = selectedTrack?.regions.find(region => region.id === selectedId);
    const editTrack = doc.tracks.find(track => track.id === editTrackId);
    const [trackName, setTrackName] = useState(editTrack?.name ?? '');
    const laneHeights = doc.tracks.map(track => resolvedLaneHeight(heights[track.id], compactHeight));
    const head = tickToX(playing ? (step ?? 0) * 240 : locator, zoom);
    const searchContext = useRef({ doc, disabled, navigationDisabled, zoom, end, onEditTrackChange, selectCurrentPattern, announce });
    searchContext.current = { doc, disabled, navigationDisabled, zoom, end, onEditTrackChange, selectCurrentPattern, announce };
    useEffect(() => { if (!selectedRegion) setSelectedId(null); }, [selectedRegion]);
    useEffect(() => { setTrackName(editTrack?.name ?? ''); }, [editTrack?.id, editTrack?.name]);
    useEffect(() => {
        if (!playing || manualRunRef.current || held || viewport.current <= 0) return;
        if (head < scroll.current || head > scroll.current + viewport.current - 32) {
            const x = Math.max(0, head - viewport.current / 4);
            scroller.current?.scrollTo({ x, animated: false }); scroll.current = x;
        }
    }, [head, playing, held, manualRunRef]);
    useEffect(() => {
        const trackId = pendingRevealTrackId.current;
        if (!trackId) return;
        const lane = lanes.current[trackId];
        if (!lane) return;
        pendingRevealTrackId.current = null;
        onRevealLane(lane);
    }, [revealRequest, doc, onRevealLane]);
    useEffect(() => () => {
        pendingRevealTrackId.current = null;
        onRevealLane(null);
    }, [onRevealLane]);
    const choose = (region: BeatRegionDoc, track: BeatTrackDoc) => {
        if (navigationDisabled) return;
        setSelectedId(region.id); onEditTrackChange(track.id);
        if (!disabled && region.pattern && region.pattern !== doc.currentPattern) selectCurrentPattern(region.pattern);
        announce(regionLabel(doc, track, region));
    };
    const setPosition = (value: number) => { if (!navigationDisabled) onLocatorChange(clampLocator(value, end)); };
    const chooseSearchResult = useCallback((result: ClipSearchResult) => {
        const current = searchContext.current;
        if (current.navigationDisabled) return;
        const track = current.doc.tracks.find(item => item.id === result.trackId);
        const region = track?.regions.find(item => item.id === result.regionId);
        if (!track || !region) return;
        setSelectedId(region.id);
        current.onEditTrackChange(track.id);
        if (!current.disabled && region.pattern && region.pattern !== current.doc.currentPattern) {
            current.selectCurrentPattern(region.pattern);
        }
        current.announce(regionLabel(current.doc, track, region));
        onLocatorChange(clampLocator(region.start, current.end));
        const x = Math.max(0, tickToX(region.start, current.zoom) - current.zoom);
        scroller.current?.scrollTo({ x, animated: false }); scroll.current = x;
        pendingRevealTrackId.current = track.id;
        setRevealRequest(value => value + 1);
    }, [onLocatorChange]);
    const commitTrackName = () => {
        if (!editTrack || disabled) return;
        apply(d => {
            if (!trackName.trim()) throw new BeatRefusal(t('beat.track.nameRequired'), 'track_name_required');
            return renameTrack(d, editTrack.id, trackName);
        }, t('beat.track.renamed', { track: trackName.trim() }));
    };
    return <View style={s.group} testID="beat-arrangement">
        {!compactHeight ? <View style={s.heading}>
            <View style={s.headingCopy}><Text variant="caption" tone="secondary">{position(locator)}</Text></View>
            <View style={s.controls}>
                <Button size="md" variant="tertiary" icon="faders" iconOnly label={t('beatLabs.controls')}
                    accessibilityState={{ expanded: advancedOpen }} onPress={() => setAdvancedOpen(value => !value)} />
            </View>
        </View> : null}
        <ScrollView style={[s.advanced, !advancedOpen && s.hidden]} contentContainerStyle={s.advancedContent}
            nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.controls}>
            <Button size="md" variant="secondary" label={t('beat.zoom.out')} disabled={zoom === 32} onPress={() => setZoom(value => Math.max(32, value - 32))} />
            <Button size="md" variant="secondary" label={t('beat.zoom.in')} disabled={zoom === 256} onPress={() => setZoom(value => Math.min(256, value + 32))} />
        </View>
        <SegmentedControl accessibilityLabel={t('beat.snap.label')} value={String(snap)} disabled={disabled} onChange={value => onSnapChange(Number(value))} options={[
            { value: '3840', label: t('beat.snap.bar') }, { value: '960', label: t('beat.snap.quarter') },
            { value: '480', label: t('beat.snap.eighth') }, { value: '240', label: t('beat.snap.sixteenth') },
        ]} />
        <View style={s.controls}>
            <Button size="md" variant="secondary" label={t('beat.region.copy')} accessibilityState={{ selected: copy }} disabled={disabled} onPress={() => setCopy(value => !value)} />
            <Button size="md" variant="secondary" label={t(ripple ? 'beat.ripple.on' : 'beat.ripple.off')}
                accessibilityLabel={t('beat.ripple.label')} accessibilityState={{ selected: ripple }} disabled={disabled}
                onPress={() => { setRipple(value => !value); announce(t('beat.ripple.changed', { state: t(ripple ? 'beat.ripple.off' : 'beat.ripple.on') })); }} />
        </View>
        <Text variant="footnote" tone="secondary">{t('beat.ripple.hint')}</Text>
        <View style={s.controls}>
            <Button variant="secondary" label={t('beat.region.add')} disabled={disabled || !editTrack || (!!editTrack.kind && editTrack.kind !== 'drums')}
            onPress={() => {
                if (!editTrack) return;
                apply(d => addRegion(d, editTrack.id, snapTick(locator, snap), d.currentPattern), t('beat.region.changed'));
            }} />
            <Button variant="secondary" label={t('beat.ripple.insert')} disabled={disabled || !selectedTrack || !selectedRegion}
                onPress={() => {
                    if (!selectedTrack || !selectedRegion) return;
                    apply(d => guardedRippleInsert(d, selectedTrack.id, snapTick(locator, snap), barTicks), t('beat.ripple.inserted'));
                }} />
        </View>
        {editTrack?.kind && editTrack.kind !== 'drums' && <Text variant="footnote">{t('beat.region.drumOnly')}</Text>}
        {editTrack && <View style={s.rename}>
            <TextField label={t('beat.track.name')} value={trackName} maxLength={40} editable={!disabled}
                returnKeyType="done" onChangeText={setTrackName} onSubmitEditing={commitTrackName} />
            <Button size="md" variant="secondary" label={t('beat.track.rename')} disabled={disabled} onPress={commitTrackName} />
        </View>}
        <BeatClipSearch doc={doc} choose={chooseSearchResult} disabled={navigationDisabled} />
        <BeatRulerControls locator={locator} end={end} setLocator={setPosition} cycle={doc.cycle} apply={apply} disabled={disabled} />
        <View style={s.controls}>
            <Button size="md" variant="tertiary" icon="seekBack" iconOnly label={t('beat.ruler.left')}
                disabled={navigationDisabled} onPress={() => setPosition(locator - snap)} />
            <Button size="md" variant="tertiary" icon="seekForward" iconOnly label={t('beat.ruler.right')}
                disabled={navigationDisabled} onPress={() => setPosition(locator + snap)} />
        </View>
        </ScrollView>
        <View style={s.timeline}>
            <View style={[s.headers, layout === 'compact' && s.headersCompact]}>
                <View style={[s.addTrackSlot, { height: RULER_HEIGHT }]} />
                {doc.tracks.map((track, index) => <Pressable key={track.id} accessibilityRole="button" accessibilityLabel={track.name}
                    accessibilityState={{ selected: editTrack?.id === track.id, disabled: navigationDisabled }} disabled={navigationDisabled}
                    onPress={() => { if (!navigationDisabled) onEditTrackChange(track.id); }}
                    style={[s.header, layout === 'compact' && s.headerCompact, { minHeight: laneHeights[index] }, editTrack?.id === track.id && s.selected]}>
                    <View testID={`track-header-content-${track.id}`}
                        onLayout={event => { const height = event.nativeEvent.layout.height; setHeights(values => values[track.id] === height ? values : { ...values, [track.id]: height }); }}
                        style={[s.headerContent, layout === 'compact' && s.headerContentCompact]}>
                        <View style={s.trackBadge}><Icon name={musicTrackIcon(track)} size={20} tint={s.trackIcon.color} /></View>
                        <View style={[s.trackCopy, layout === 'compact' && s.trackCopyCompact]}><Text variant="caption" numberOfLines={1}>{track.name}</Text>{layout !== 'compact' ? <Text variant="footnote" tone="tertiary">{String(index + 1).padStart(2, '0')}</Text> : null}</View>
                    </View>
                </Pressable>)}
            </View>
            <ScrollView ref={scroller} horizontal testID="arrangement-scroll" scrollEnabled={!held} style={s.scroller}
                onLayout={event => { viewport.current = event.nativeEvent.layout.width; }}
                onScrollBeginDrag={() => { if (playing) manualRunRef.current = true; }}
                onScroll={event => { scroll.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={16}>
                <View style={{ width }}>
                    <View pointerEvents="none" accessible={false} testID="arrangement-grid" style={s.grid}>{Array.from({ length: bars * 4 + 1 }, (_, index) =>
                        <View key={index} testID={index % 4 ? 'arrangement-beat-line' : 'arrangement-bar-line'}
                            style={[index % 4 ? s.beatGridLine : s.barGridLine,
                                increasedContrast && (index % 4 ? s.beatGridLineHigh : s.barGridLineHigh), { left: index * zoom / 4 }]} />)}</View>
                    <BeatRuler bars={bars} zoom={zoom} snap={snap} locator={locator} end={end} setLocator={setPosition}
                        cycle={doc.cycle} apply={apply} lock={lock} announce={announce} disabled={disabled} />
                    {doc.tracks.map((track, index) => <View key={track.id} ref={value => { lanes.current[track.id] = value; }}
                        testID={`track-lane-${track.id}`} style={[s.lane, increasedContrast && s.laneHigh, index % 2 === 1 && s.laneAlternate, { height: laneHeights[index] }]}>
                        <Pressable testID={`lane-${track.id}`} accessible={false} accessibilityRole="none" style={s.emptyLane}
                            onPress={event => setPosition(snapTick(xToTick(event.nativeEvent.locationX, zoom), snap))} />
                        {track.regions.map(region => <BeatRegionView key={region.id} doc={doc} track={track} region={region}
                            zoom={zoom} snap={snap} locator={locator} selected={selectedId === region.id} copy={copy} ripple={ripple} disabled={disabled} apply={apply}
                            laneHeight={laneHeights[index]}
                            select={() => choose(region, track)} announce={announce} lock={lock} preview={setPreview}
                            trackAt={(dy, originY) => doc.tracks[laneAt(laneHeights.slice(0, index).reduce((a, b) => a + b, 0) + ds.space.xs + originY + dy, laneHeights)].id} />)}
                        {preview?.trackId === track.id && <View pointerEvents="none" testID="region-preview" style={[s.preview, {
                            left: tickToX(preview.start, zoom), width: tickToX(preview.length, zoom),
                            height: Math.max(44, laneHeights[index] - 2 * ds.space.xs),
                        }]} />}
                    </View>)}
                    <View pointerEvents="none" accessible={false} testID="playhead" style={[s.playhead, { left: head }]} />
                </View>
            </ScrollView>
        </View>
        {selectedRegion && selectedTrack && <BeatRegionInspector doc={doc} track={selectedTrack} region={selectedRegion} snap={snap} locator={locator} ripple={ripple} disabled={disabled} apply={apply} />}
    </View>;
}
const sheets = themedStyles(p => ({
    group: { flexGrow: 1, gap: 0, overflow: 'hidden', backgroundColor: p.bg },
    heading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.sm, paddingHorizontal: ds.space.sm, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    headingCopy: { flex: 1, gap: ds.space.xs },
    hidden: { display: 'none' },
    advanced: { maxHeight: 168, flexGrow: 0, borderBottomWidth: 1, borderBottomColor: p.borderSubtle },
    advancedContent: { gap: ds.space.md, padding: ds.space.md },
    controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.sm },
    rename: { gap: ds.space.sm },
    timeline: { flexDirection: 'row', direction: 'ltr', overflow: 'hidden', backgroundColor: p.bg },
    headers: { width: 98, borderRightWidth: 1, borderRightColor: p.borderStrong },
    headersCompact: { width: 64 },
    addTrackSlot: { alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: p.borderStrong, backgroundColor: p.bgElevated1 },
    header: { paddingHorizontal: ds.space.sm, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    headerCompact: { paddingHorizontal: ds.space.xs },
    headerContent: { width: '100%', flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: ds.space.sm },
    headerContentCompact: { flexDirection: 'column', justifyContent: 'center', gap: 1 },
    trackBadge: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: ds.radius.md, backgroundColor: p.surface },
    trackIcon: { color: p.textSecondary },
    trackCopy: { flex: 1, minWidth: 0, gap: 1 },
    trackCopyCompact: { flex: 0, alignItems: 'center' },
    selected: { borderLeftWidth: 3, borderLeftColor: p.accent, backgroundColor: p.surface },
    scroller: { flex: 1 },
    grid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    beatGridLine: { position: 'absolute', top: RULER_HEIGHT, bottom: 0, width: 1, backgroundColor: p.borderStrong, opacity: 0.72 },
    barGridLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: p.textTertiary, opacity: 0.9 },
    beatGridLineHigh: { width: 2, backgroundColor: p.textSecondary, opacity: 1 },
    barGridLineHigh: { width: 3, backgroundColor: p.textPrimary, opacity: 1 },
    lane: { borderBottomWidth: 1, borderColor: p.borderStrong, backgroundColor: p.bg },
    laneHigh: { borderBottomWidth: 2, borderColor: p.textSecondary },
    laneAlternate: { backgroundColor: p.bgElevated1 },
    emptyLane: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0 },
    preview: { position: 'absolute', top: ds.space.xs, borderWidth: 2, borderColor: p.accent, backgroundColor: p.surface, opacity: 0.7, borderRadius: ds.radius.xs },
    playhead: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: p.accent, shadowColor: p.accent,
        shadowOpacity: 0.65, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
}));
