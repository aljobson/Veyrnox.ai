import { editorTrackLabel } from '../../lib/editorTrackLabel';
import { rawText } from '../../lib/i18n/translate';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { t } from '../../lib/i18n';
import { playSelection } from '../../lib/haptics';
import { canTrim, formatTimecode, frameAtX, moveItems, movingSelections, snapTo, trimItem } from '../../lib/editorTimeline';
import { clipAt, type Clip, type Selection, type TextClip, type Timeline } from '../../lib/nativeEditorModel';
import { colors } from '../../theme';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/useReducedMotion';
import { styles } from './fullEditorStyles';

type Props = {
    timeline: Timeline; selections: readonly Selection[]; ppf: number; total: number; frame: number; playing: boolean; snap: boolean;
    onSeek(frame: number): void; onSelect(selection: Selection): void; onApply(timeline: Timeline): void; onViewport(width: number): void;
};
type Gesture = {
    selection: Selection; timeline: Timeline; selections: readonly Selection[]; edge?: 'in' | 'out';
    x: number; y: number; offset: number; row: number; active: boolean; abandoned: boolean; snapped: boolean;
    timer?: ReturnType<typeof setTimeout>; preview?: Timeline | null;
};
const ROW = 56;
const position = (item: Clip | TextClip, ppf: number) => ({ position: 'absolute' as const, left: item.start * ppf, top: 6, width: Math.max(8, item.len * ppf - 2), height: 44 });

export function EditorTimeline({ timeline, selections, ppf, total, frame, playing, snap, onSeek, onSelect, onApply, onViewport }: Props) {
    const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
    const gesture = useRef<Gesture | null>(null);
    const scrub = useRef<{ x: number; page: number } | null>(null);
    const emptyTap = useRef<{ x: number; page: number; y: number } | null>(null);
    const scrollX = useRef(0);
    const [viewport, setViewport] = useState(0);
    const [scrollEnabled, setScrollEnabled] = useState(true);
    const [ghost, setGhost] = useState<Timeline | null>(null);
    const reducedMotion = useReducedMotion();
    const width = Math.max(viewport, (total + 150) * ppf);
    useEffect(() => () => { if (gesture.current?.timer) clearTimeout(gesture.current.timer); }, []);
    useEffect(() => {
        const x = frame * ppf;
        if (playing && viewport > 0 && (x < scrollX.current + viewport * 0.15 || x > scrollX.current + viewport * 0.85)) {
            scroller.current?.scrollTo({ x: Math.max(0, x - 0.35 * viewport), animated: !reducedMotion });
        }
    }, [frame, playing, ppf, reducedMotion, viewport]);
    const cancel = () => {
        if (gesture.current?.timer) clearTimeout(gesture.current.timer);
        gesture.current = null; setGhost(null); setScrollEnabled(true);
    };
    const begin = (event: GestureResponderEvent, selection: Selection, row: number, edge?: 'in' | 'out') => {
        cancel();
        const { pageX, pageY, locationY } = event.nativeEvent;
        const g: Gesture = { selection, timeline, selections, edge, x: pageX, y: pageY, offset: locationY + 6, row, active: !!edge, abandoned: false, snapped: false };
        gesture.current = g;
        if (edge) { setScrollEnabled(false); return; }
        if (timeline.tracks[row].locked) return;
        g.timer = setTimeout(() => {
            if (gesture.current !== g || g.abandoned) return;
            g.active = true; setScrollEnabled(false); void playSelection();
            if (!selections.some(s => s.track === selection.track && s.id === selection.id)) onSelect(selection);
        }, 300);
    };
    const move = (event: GestureResponderEvent) => {
        const g = gesture.current;
        if (!g) return;
        const dx = event.nativeEvent.pageX - g.x, dy = event.nativeEvent.pageY - g.y;
        if (!g.active) {
            if (Math.hypot(dx, dy) > 8) { g.abandoned = true; if (g.timer) clearTimeout(g.timer); }
            return;
        }
        const delta = Math.round(dx / ppf);
        const item = clipAt(g.timeline, g.selection)!;
        if (g.edge) g.preview = trimItem(g.timeline, g.selection, g.edge, delta, snap, frame);
        else {
            const row = Math.floor((g.row * ROW + g.offset + dy) / ROW);
            const target = g.timeline.tracks[row];
            const trackId = target?.kind === g.selection.track && !target.locked ? target.id : item.trackId;
            g.preview = moveItems(g.timeline, g.selections, g.selection, delta, trackId, snap, frame);
        }
        const excluded = g.edge ? [item.id] : movingSelections(g.selections, g.selection).map(s => s.id);
        const at = g.edge === 'out' ? item.start + item.len + delta : item.start + delta;
        const candidate = snapTo(g.timeline, excluded, at, g.edge ? 0 : item.len, frame);
        const result = g.preview && clipAt(g.preview, g.selection);
        const appliedEdge = result ? result.start + (g.edge === 'out' ? result.len : 0) : null;
        const snapped = snap && candidate.snapped && appliedEdge === candidate.at;
        if (snapped && !g.snapped) void playSelection();
        g.snapped = snapped;
        setGhost(g.preview ?? null);
    };
    const release = (event: GestureResponderEvent) => {
        move(event);
        const g = gesture.current;
        if (g?.active && g.preview) onApply(g.preview);
        else if (g && !g.abandoned && Math.hypot(event.nativeEvent.pageX - g.x, event.nativeEvent.pageY - g.y) < 8) onSelect(g.selection);
        cancel();
    };
    const commit = (next: Timeline | null) => { if (next) onApply(next); };
    const seek = (value: number) => onSeek(Math.max(0, Math.min(Math.max(0, total - 1), value)));
    const tickSeconds = ppf < 1 ? 5 : 1;
    const ticks = Math.floor(width / (timeline.fps * ppf * tickSeconds));
    return <View style={local.container}>
        <View style={local.headers}>
            <View style={local.ruler} />
            {timeline.tracks.map(track => <View key={track.id} style={local.header}>
                <Icon name={track.kind === 'video' ? 'video' : track.kind === 'audio' ? 'audio' : 'textSize'} size={16} />
                <View style={local.headerCopy}><Text style={styles.trackLabel} numberOfLines={1}>{editorTrackLabel(track)}</Text><Text style={styles.trackState}>{track.locked ? t('editor.lOCK') : ''}{track.muted ? t('editor.mUTE') : ''}{track.hidden ? t('editor.hIDE') : ''}</Text></View>
            </View>)}
        </View>
        <ScrollView ref={scroller} horizontal scrollEnabled={scrollEnabled} style={local.scroller} contentContainerStyle={{ width, direction: 'ltr' }}
            onLayout={event => { const size = event.nativeEvent.layout.width; setViewport(size); onViewport(size); }}
            onScroll={event => { scrollX.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={16}>
            <View style={{ width, direction: 'ltr' }}>
                <View testID="timeline-ruler" style={local.ruler} accessibilityRole="adjustable" accessibilityLabel={t('editor.playheadtimecode')}
                    accessibilityValue={{ text: formatTimecode(frame, timeline.fps) }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                    onAccessibilityAction={event => seek(frame + (event.nativeEvent.actionName === 'increment' ? 1 : -1))}
                    onStartShouldSetResponder={() => true} onResponderGrant={event => {
                        scrub.current = { x: event.nativeEvent.locationX, page: event.nativeEvent.pageX }; setScrollEnabled(false);
                        seek(frameAtX(scrub.current.x, ppf, total));
                    }} onResponderMove={event => { if (scrub.current) seek(frameAtX(scrub.current.x + event.nativeEvent.pageX - scrub.current.page, ppf, total)); }}
                    onResponderTerminationRequest={() => false} onResponderRelease={() => { scrub.current = null; setScrollEnabled(true); }} onResponderTerminate={() => { scrub.current = null; setScrollEnabled(true); }}>
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                        {Array.from({ length: ticks + 1 }, (_, index) => {
                            const seconds = index * tickSeconds;
                            return <View key={index} style={[local.tick, { left: seconds * timeline.fps * ppf }]}>{seconds % 5 === 0 ? <Text style={styles.rulerText}>{t('editorCore.rulerSeconds', { value1: seconds })}</Text> : null}</View>;
                        })}
                    </View>
                    {timeline.markers.map(marker => <View key={marker.id} accessibilityRole="button" accessibilityLabel={rawText(t('editor.goto', { value1: marker.label }))}
                        onAccessibilityTap={() => seek(marker.frame)} onStartShouldSetResponder={() => true} onResponderRelease={() => seek(marker.frame)}
                        style={[local.marker, { left: marker.frame * ppf }]} hitSlop={18} />)}
                </View>
                {timeline.tracks.map((track, row) => {
                    const items = timeline[track.kind].filter(item => item.trackId === track.id);
                    return <View key={track.id} testID={`lane-${track.id}`} style={local.row}
                        onStartShouldSetResponder={() => true} onResponderGrant={event => { emptyTap.current = { x: event.nativeEvent.locationX, page: event.nativeEvent.pageX, y: event.nativeEvent.pageY }; }}
                        onResponderTerminationRequest={() => true} onResponderTerminate={() => { emptyTap.current = null; }}
                        onResponderRelease={event => { const touch = emptyTap.current; if (touch && Math.hypot(event.nativeEvent.pageX - touch.page, event.nativeEvent.pageY - touch.y) < 8) seek(frameAtX(touch.x, ppf, total)); emptyTap.current = null; }}>
                        {!items.length ? <View pointerEvents="none" style={styles.emptyTrack}><View style={styles.emptyTrackLine} /><Text style={styles.trackEmpty}>{t('editor.empty2')}</Text></View> : null}
                        {items.map(item => {
                            const selection: Selection = { track: track.kind, id: item.id };
                            const active = selections.some(s => s.track === track.kind && s.id === item.id);
                            const name = track.kind === 'text' ? (item as TextClip).text : timeline.media[(item as Clip).mediaId ?? '']?.name || item.id;
                            const size = Math.max(8, item.len * ppf - 2);
                            return <View key={item.id} testID={`clip-${item.id}`} style={[styles.clip, styles[`${track.kind}Clip`], position(item, ppf), active && styles.clipSelected]}
                                hitSlop={{ left: Math.max(0, (44 - size) / 2), right: Math.max(0, (44 - size) / 2) }} accessibilityRole="button"
                                accessibilityLabel={rawText(t('editorCore.clipLabel', { name, track: editorTrackLabel(track), start: formatTimecode(item.start, timeline.fps), duration: formatTimecode(item.len, timeline.fps) }))}
                                accessibilityState={{ selected: active }} onAccessibilityTap={() => onSelect(selection)}
                                accessibilityActions={track.locked ? [] : [{ name: 'moveEarlier', label: t('editorCore.moveEarlier') }, { name: 'moveLater', label: t('editorCore.moveLater') }]}
                                onAccessibilityAction={event => { if (['moveEarlier', 'moveLater'].includes(event.nativeEvent.actionName)) commit(moveItems(timeline, selections, selection, (event.nativeEvent.actionName === 'moveLater' ? 1 : -1) * timeline.fps, undefined, snap, frame)); }}
                                onStartShouldSetResponder={() => true} onResponderGrant={event => begin(event, selection, row)} onResponderMove={move} onResponderRelease={release}
                                onResponderTerminationRequest={() => !gesture.current?.active} onResponderTerminate={cancel}>
                                <View pointerEvents="none"><Text style={styles.clipTitle} numberOfLines={1}>{name}</Text><Text style={styles.clipMeta} numberOfLines={1}>{formatTimecode(item.len, timeline.fps)}</Text></View>
                                {active && !track.locked && canTrim(item) ? (['in', 'out'] as const).map(edge => <View key={edge} testID={`trim-${item.id}-${edge}`} style={[local.handle, edge === 'in' ? { left: 0 } : { right: 0 }]} hitSlop={{ top: 0, bottom: 0, left: 14, right: 14 }}
                                    accessibilityRole="adjustable" accessibilityLabel={rawText(edge === 'in' ? t('editorCore.trimStart', { name }) : t('editorCore.trimEnd', { name }))}
                                    accessibilityValue={{ text: formatTimecode(edge === 'in' ? item.start : item.start + item.len, timeline.fps) }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                                    onAccessibilityAction={event => commit(trimItem(timeline, selection, edge, event.nativeEvent.actionName === 'increment' ? 1 : -1, false, frame))}
                                    onStartShouldSetResponder={() => true} onResponderGrant={event => begin(event, selection, row, edge)} onResponderMove={move} onResponderRelease={release}
                                    onResponderTerminationRequest={() => false} onResponderTerminate={cancel}><View pointerEvents="none" style={local.handleLine} /></View>) : null}
                            </View>;
                        })}
                    </View>;
                })}
                {ghost ? <View pointerEvents="none" testID="timeline-ghost" style={StyleSheet.absoluteFill}>{ghost.tracks.flatMap((track, row) => ghost[track.kind].filter(item => item.trackId === track.id && item !== clipAt(timeline, { track: track.kind, id: item.id })).map(item => <View key={`${track.id}-${item.id}`} style={[styles.clip, styles[`${track.kind}Clip`], position(item, ppf), local.ghost, { top: 32 + row * ROW + 6 }]} />))}</View> : null}
                <View pointerEvents="none" testID="timeline-playhead" style={[local.playhead, { left: frame * ppf, height: 32 + timeline.tracks.length * ROW }]} />
            </View>
        </ScrollView>
    </View>;
}
const local = StyleSheet.create({
    container: { flexDirection: 'row', direction: 'ltr' }, headers: { width: 92 }, header: { height: ROW, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 4 }, headerCopy: { flex: 1 },
    scroller: { flex: 1 }, ruler: { height: 32 }, row: { height: ROW, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    tick: { position: 'absolute', top: 0, height: 32, borderLeftWidth: 1, borderColor: colors.border, paddingLeft: 3 },
    marker: { position: 'absolute', top: 22, width: 8, height: 8, backgroundColor: colors.accent, transform: [{ rotate: '45deg' }] },
    playhead: { position: 'absolute', top: 0, width: 2, backgroundColor: colors.accent }, ghost: { opacity: 0.6, borderColor: colors.accent, borderWidth: 2 },
    handle: { position: 'absolute', width: 16, height: 44, top: -1, alignItems: 'center', justifyContent: 'center' }, handleLine: { width: 3, height: 24, borderRadius: 2, backgroundColor: colors.accent },
});
