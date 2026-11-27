import { useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Button, Icon, SegmentedControl, Text, themedStyles, useThemedStyles } from '../ui';
import { StrengthSlider } from '../StrengthSlider';
import { automationControl, type Lane, type MixDoc, type MixTrack } from '../../lib/beatNative/mix';
import { DRUM_KITS, type BeatDoc, type Edit } from '../../lib/beatNative/doc';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { BeatTakeLanes } from './BeatTakeLanes';
import { BeatChannelStrip } from './BeatChannelStrip';
import { BeatMasterStrip } from './BeatMasterStrip';
import { BeatAutomationLane } from './BeatAutomationLane';
import { MusicNotice } from '../music/MusicNotice';
import { musicTrackIcon } from '../../lib/beatNative/musicTrackGlyph';
import type { BeatAudio } from '../../lib/beatNative/audio';
import type { BeatEditorLayout } from '../../lib/beatNative/editorLayout';

const toPanSlider = (pan: number) => (pan + 1) / 2;
const fromPanSlider = (value: number) => Math.round((value * 2 - 1) * 100) / 100;

export function restoreMixerControlFocus(
    trigger: ComponentRef<typeof Pressable> | null,
    resolve: (target: ComponentRef<typeof Pressable> | null) => number | null | undefined = findNodeHandle,
    focus: (node: number) => void = node => AccessibilityInfo.setAccessibilityFocus(node),
) {
    const node = resolve(trigger);
    if (node) focus(node);
}

export function MusicMixerTray({ doc, selectedTrackId, audio, playing, step, notice, layout, compact = false, mixDisabled, structuralDisabled, lockReason, selectionDisabled = false, apply, onGain, onPan, onMute, onSolo, onKit, onRemove, onExpansionChange }: {
    doc: BeatDoc;
    selectedTrackId?: string;
    audio: BeatAudio | null;
    playing: boolean;
    step: number | null;
    notice?: string | null;
    layout: BeatEditorLayout;
    compact?: boolean;
    mixDisabled: boolean;
    structuralDisabled: boolean;
    lockReason?: string;
    selectionDisabled?: boolean;
    apply(edit: Edit, label?: string, key?: string): boolean;
    onGain(trackId: string, value: number): void;
    onPan(trackId: string, value: number): void;
    onMute(trackId: string, value: boolean): void;
    onSolo(trackId: string, value: boolean): void;
    onKit(trackId: string, kit: string): void;
    onRemove(trackId: string): void;
    onExpansionChange?(expanded: boolean): void;
}) {
    const s = useThemedStyles(sheets);
    const { height, width } = useWindowDimensions();
    const [toolsOpen, setToolsOpen] = useState(false);
    const [compactTrackToolsOpen, setCompactTrackToolsOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [compactSliderActive, setCompactSliderActive] = useState(false);
    const [mixerTrackId, setMixerTrackId] = useState(selectedTrackId);
    const [details, setDetails] = useState<'track' | 'master' | null>(null);
    const [lane, setLane] = useState<Lane | null>(null);
    const trackToolsTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const advancedTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const selectedTrackTrigger = useRef<ComponentRef<typeof Pressable>>(null);
    const restoreFocus = (trigger: RefObject<ComponentRef<typeof Pressable> | null>) => {
        requestAnimationFrame(() => restoreMixerControlFocus(trigger.current));
    };
    useEffect(() => { setMixerTrackId(selectedTrackId); }, [selectedTrackId]);
    const selected = doc.tracks.find(track => track.id === mixerTrackId)
        ?? doc.tracks.find(track => track.id === selectedTrackId)
        ?? doc.tracks[0];
    useEffect(() => {
        setToolsOpen(false);
        setCompactTrackToolsOpen(false);
        setAdvancedOpen(false);
        setDetails(null);
        setLane(null);
        onExpansionChange?.(false);
    }, [selected?.id]);
    useEffect(() => {
        if (mixDisabled || structuralDisabled) {
            setCompactTrackToolsOpen(false);
            setAdvancedOpen(false);
            setDetails(null);
            setLane(null);
            onExpansionChange?.(false);
        }
    }, [mixDisabled, structuralDisabled]);
    if (!selected) return null;
    const mix = doc as MixDoc;
    const gainLock = automationControl(selected, 'gain', mix.view).disabled;
    const panLock = automationControl(selected, 'pan', mix.view).disabled;
    const hasTakes = !!selected.takeGroups?.length;
    const shortLandscape = width > height && height < 500;
    const stacked = layout === 'accessible' || width < 360;
    const panPercent = Math.round(selected.pan * 100);
    const panValue = panPercent === 0
        ? t('beatMix.pan.center')
        : t(panPercent < 0 ? 'beatMix.pan.left' : 'beatMix.pan.right', { percent: Math.abs(panPercent) });
    const selectedMixTrack = selected as MixTrack;
    const mixApply = (edit: Edit, label?: string, key?: string) => apply(edit, label, key);
    const trackChoices = doc.tracks.map(track => <Button key={track.id} testID={`music-mixer-track-${track.id}`} size="sm"
        variant={track.id === selected.id ? 'secondary' : 'tertiary'} label={track.name}
        accessibilityRole="tab" accessibilityState={{ selected: track.id === selected.id, disabled: selectionDisabled }} disabled={selectionDisabled}
        onPress={() => { setToolsOpen(false); setAdvancedOpen(false); onExpansionChange?.(false); setMixerTrackId(track.id); }} style={s.trackChip}>
        <View accessible={false} style={s.trackChipContent}><Icon name={musicTrackIcon(track)} size={20} />
            <Text accessible={false} variant="footnote" numberOfLines={1} style={s.trackName}>{track.name}</Text></View>
    </Button>);
    const gainSlider = <StrengthSlider testID="music-mixer-gain" tone="surface" label={t('beat.gain', { track: selected.name })} value={selected.gain}
        compact={compact || shortLandscape} lockGesture={compact}
        accessibilityHint={gainLock ? t('beatMix.locked.gain') : undefined}
        disabled={mixDisabled || gainLock} onChangeStart={() => setCompactSliderActive(true)} onChangeEnd={() => setCompactSliderActive(false)}
        onChange={value => onGain(selected.id, value)} />;
    const panSlider = <StrengthSlider testID="music-mixer-pan" tone="surface" label={t('beat.pan', { track: selected.name })} value={toPanSlider(selected.pan)}
        compact={compact || shortLandscape} lockGesture={compact} step={0.05}
        valueText={panValue} displayValue={panPercent} valueRange={{ min: -100, max: 100, now: panPercent }}
        accessibilityHint={panLock ? t('beatMix.locked.pan') : undefined}
        disabled={mixDisabled || panLock} onChangeStart={() => setCompactSliderActive(true)} onChangeEnd={() => setCompactSliderActive(false)}
        onChange={value => onPan(selected.id, fromPanSlider(value))} />;
    const trackTools = <>
        {!selected.kind || selected.kind === 'drums' ? <SegmentedControl value={selected.kit ?? DRUM_KITS[0].id} disabled={structuralDisabled}
            onChange={kit => onKit(selected.id, kit)} options={DRUM_KITS.map(kit => ({ value: kit.id, label: t(`beat.kit.${kit.id}`) }))}
            accessibilityLabel={t('beat.kit', { track: selected.name })} /> : null}
        {hasTakes ? <BeatTakeLanes doc={doc} track={selected} apply={apply} locked={structuralDisabled} /> : null}
        {doc.tracks.length > 1 ? <Button testID="music-mixer-remove-track" size="sm" variant="tertiary" tone="danger" icon="close"
            label={t('beat.track.remove', { track: selected.name })} disabled={structuralDisabled}
            onPress={() => { setToolsOpen(false); setCompactTrackToolsOpen(false); onExpansionChange?.(false); onRemove(selected.id); }} /> : null}
    </>;
    return <ScrollView testID="music-mixer-tray" style={s.viewport} contentContainerStyle={s.tray}
        accessibilityLabel={t('beatMix.title')} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {compact && compactTrackToolsOpen ? <ScrollView testID="music-mixer-compact-track-tools-level" style={s.compactAdvanced}
            contentContainerStyle={s.toolsContent} nestedScrollEnabled>
            <Button testID="music-mixer-compact-track-tools-back" size="sm" variant="tertiary" icon="arrowLeft"
                label={t('beat.back')} onPress={() => { setCompactTrackToolsOpen(false); onExpansionChange?.(false); restoreFocus(trackToolsTrigger); }} />
            {trackTools}
        </ScrollView> : compact && advancedOpen ? <ScrollView testID="music-mixer-compact-advanced-level" style={s.compactAdvanced}
            contentContainerStyle={s.toolsContent} nestedScrollEnabled>
            <Button testID="music-mixer-compact-advanced-back" size="sm" variant="tertiary" icon="arrowLeft"
                label={t('beatMix.advanced.back')} onPress={() => { setAdvancedOpen(false); setToolsOpen(true); setDetails(null); setLane(null); onExpansionChange?.(false); restoreFocus(advancedTrigger); }} />
            {notice ? <MusicNotice message={notice} /> : null}
            <BeatChannelStrip doc={mix} track={selectedMixTrack} audio={audio} apply={mixApply} essentials={false}
                detailsTestID="music-mixer-selected-track-details"
                expanded={details === 'track'} onToggle={() => { setLane(null); setDetails(value => value === 'track' ? null : 'track'); }}
                onLane={value => { setDetails('track'); setLane(value); }} />
            <BeatMasterStrip doc={mix} audio={audio} apply={mixApply} expanded={details === 'master'}
                onToggle={() => { setLane(null); setDetails(value => value === 'master' ? null : 'master'); }} />
            {lane ? <BeatAutomationLane key={`${selected.id}:${lane}`} doc={mix} track={selectedMixTrack} lane={lane}
                playing={playing} step={step} apply={mixApply} onHide={() => setLane(null)} /> : null}
        </ScrollView> : compact && toolsOpen ? <View testID="music-mixer-compact-tools-level" style={s.compactEssentials}>
            <Button testID="music-mixer-compact-tools-back" size="md" variant="tertiary" icon="arrowLeft" iconOnly label={t('beat.back')}
                onPress={() => { setToolsOpen(false); restoreFocus(selectedTrackTrigger); }} containerStyle={s.utilityAction} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.trackScroller} contentContainerStyle={s.trackRow}
                accessibilityRole="tablist" accessibilityLabel={t('editor.tracks')}>{trackChoices}</ScrollView>
            <Button ref={advancedTrigger} testID="music-mixer-advanced" size="md" variant="tertiary" icon="faders" iconOnly
                label={t('beatMix.advanced.show')} disabled={mixDisabled || structuralDisabled}
                onPress={() => { setToolsOpen(false); setAdvancedOpen(true); onExpansionChange?.(true); }} containerStyle={s.utilityAction} />
        </View> : compact ? <ScrollView testID="music-mixer-compact-essentials" horizontal nestedScrollEnabled scrollEnabled={!compactSliderActive}
            showsHorizontalScrollIndicator={false} style={s.compactEssentialsViewport}
            contentContainerStyle={s.compactEssentials} accessibilityRole="toolbar">
            <Button ref={selectedTrackTrigger} testID="music-mixer-track-selected" size="sm" variant="tertiary"
                label={selected.name} onPress={() => setToolsOpen(true)} style={s.compactTrackChip}>
                <View accessible={false} style={s.trackChipContent}><Icon name={musicTrackIcon(selected)} size={20} />
                    <Text accessible={false} variant="footnote" numberOfLines={1} style={s.trackName}>{selected.name}</Text></View>
            </Button>
            <View testID="music-mixer-compact-gain" style={s.compactSlider}><Text variant="caption" tone="secondary">{t('beatMix.lane.gain')}</Text><View style={s.compactSliderControl}>{gainSlider}</View></View>
            <View testID="music-mixer-compact-pan" style={s.compactSlider}><Text variant="caption" tone="secondary">{t('beatMix.lane.pan')}</Text><View style={s.compactSliderControl}>{panSlider}</View></View>
            {gainLock || panLock ? <Button testID="music-mixer-compact-automation-lock" size="md" variant="secondary" icon="faders" iconOnly
                label={gainLock ? t('beatMix.locked.gain') : t('beatMix.locked.pan')}
                accessibilityHint={mixDisabled || structuralDisabled ? (lockReason ?? t('beat.local.busy')) : undefined}
                disabled={mixDisabled || structuralDisabled}
                onPress={() => { setToolsOpen(false); setCompactTrackToolsOpen(false); setAdvancedOpen(true); setDetails('track');
                    setLane(gainLock ? 'gain' : 'pan'); onExpansionChange?.(true); }} containerStyle={s.utilityAction} /> : null}
            <Button testID="music-mixer-mute" size="md" variant={selected.mute ? 'primary' : 'tertiary'} icon="speaker" iconOnly
                label={t('beat.mute', { track: selected.name })} accessibilityState={{ selected: selected.mute }} disabled={mixDisabled}
                onPress={() => onMute(selected.id, !selected.mute)} containerStyle={s.utilityAction} />
            <Button testID="music-mixer-solo" size="md" variant={selected.solo ? 'primary' : 'tertiary'} icon="headphones" iconOnly
                label={t('beat.solo', { track: selected.name })} accessibilityState={{ selected: selected.solo }} disabled={mixDisabled}
                onPress={() => onSolo(selected.id, !selected.solo)} containerStyle={s.utilityAction} />
            <Button ref={trackToolsTrigger} testID="music-mixer-track-tools" size="md" variant="tertiary" icon="wrench" iconOnly
                label={t('beat.track.controls')}
                onPress={() => { setToolsOpen(false); setCompactTrackToolsOpen(true); onExpansionChange?.(true); }}
                containerStyle={s.utilityAction} />
        </ScrollView> : <><View testID="music-mixer-top-row" style={s.topRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.trackScroller} contentContainerStyle={s.trackRow}
                testID="music-mixer-tracks" accessibilityRole="tablist" accessibilityLabel={t('editor.tracks')}>
                {trackChoices}
            </ScrollView>
            <View testID="music-mixer-utility-controls" style={s.utilityRow}>
                <Button testID="music-mixer-mute" size="md" variant={selected.mute ? 'primary' : 'tertiary'} icon="speaker" iconOnly
                    label={t('beat.mute', { track: selected.name })} accessibilityState={{ selected: selected.mute }} disabled={mixDisabled}
                    onPress={() => onMute(selected.id, !selected.mute)} containerStyle={s.utilityAction} />
                <Button testID="music-mixer-solo" size="md" variant={selected.solo ? 'primary' : 'tertiary'} icon="headphones" iconOnly
                    label={t('beat.solo', { track: selected.name })} accessibilityState={{ selected: selected.solo }} disabled={mixDisabled}
                    onPress={() => onSolo(selected.id, !selected.solo)} containerStyle={s.utilityAction} />
                <Button ref={trackToolsTrigger} testID="music-mixer-track-tools" size="md" variant={toolsOpen ? 'secondary' : 'tertiary'} icon="wrench" iconOnly
                    label={t('beat.track.controls')} accessibilityState={{ expanded: toolsOpen }} onPress={() => {
                        const next = !toolsOpen;
                        setToolsOpen(next);
                        if (next) { setAdvancedOpen(false); setDetails(null); setLane(null); }
                    }}
                    containerStyle={s.utilityAction} />
                <Button ref={advancedTrigger} testID="music-mixer-advanced" size="md" variant={advancedOpen ? 'secondary' : 'tertiary'} icon="faders" iconOnly
                    label={t('beatMix.advanced.show')} accessibilityState={{ expanded: advancedOpen }}
                    disabled={mixDisabled || structuralDisabled} onPress={() => { setToolsOpen(false); setAdvancedOpen(value => !value); }}
                    containerStyle={s.utilityAction} />
            </View>
        </View>
        <View testID="music-mixer-controls" style={[s.mixRow, stacked && s.mixRowStacked]}>
            <View style={s.sliderCell}>
                <Text accessible={false} variant="caption" tone="secondary">{t('beat.gain', { track: selected.name })}</Text>
                {gainSlider}
            </View>
            <View style={s.sliderCell}>
                <Text accessible={false} variant="caption" tone="secondary">{t('beat.pan', { track: selected.name })}</Text>
                {panSlider}
            </View>
        </View></>}
        {!compact && (gainLock || panLock) ? <View testID="music-mixer-automation-lock" style={s.lockReasons}>
            {gainLock ? <Text variant="caption" tone="secondary">{t('beatMix.locked.gain')}</Text> : null}
            {panLock ? <Text variant="caption" tone="secondary">{t('beatMix.locked.pan')}</Text> : null}
        </View> : null}
        {!compact && toolsOpen ? <ScrollView testID="music-mixer-track-tools-panel" style={[s.toolsScroll, { maxHeight: Math.max(132, Math.round(height * 0.28)) }]}
            contentContainerStyle={s.toolsContent} nestedScrollEnabled>
            {trackTools}
        </ScrollView> : null}
        {!compact && advancedOpen ? <ScrollView testID="music-mixer-advanced-panel" style={[s.toolsScroll, { maxHeight: Math.max(180, Math.round(height * (width > height ? 0.34 : 0.4))) }]}
            contentContainerStyle={s.toolsContent} nestedScrollEnabled>
            <Button testID="music-mixer-advanced-back" size="sm" variant="tertiary" icon="arrowLeft"
                label={t('beatMix.advanced.back')} onPress={() => { setAdvancedOpen(false); setDetails(null); setLane(null); restoreFocus(advancedTrigger); }} />
            {notice ? <MusicNotice message={notice} /> : null}
            <BeatChannelStrip doc={mix} track={selectedMixTrack} audio={audio} apply={mixApply}
                detailsTestID="music-mixer-selected-track-details"
                essentials={false}
                expanded={details === 'track'} onToggle={() => { setLane(null); setDetails(value => value === 'track' ? null : 'track'); }}
                onLane={value => { setDetails('track'); setLane(value); }} />
            <BeatMasterStrip doc={mix} audio={audio} apply={mixApply} expanded={details === 'master'}
                onToggle={() => { setLane(null); setDetails(value => value === 'master' ? null : 'master'); }} />
            {lane ? <BeatAutomationLane key={`${selected.id}:${lane}`} doc={mix} track={selectedMixTrack} lane={lane}
                playing={playing} step={step} apply={mixApply} onHide={() => setLane(null)} /> : null}
        </ScrollView> : null}
    </ScrollView>;
}

const sheets = themedStyles(p => ({
    viewport: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
    tray: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: ds.space.xs, borderTopWidth: 1,
        borderTopColor: p.borderSubtle, paddingTop: ds.space.xs },
    topRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: ds.space.xs },
    compactEssentialsViewport: { flexGrow: 0, minHeight: 44, height: 44 },
    compactEssentials: { minHeight: 44, height: 44, flexDirection: 'row', alignItems: 'center', gap: 2,
        paddingRight: ds.space.xs },
    compactTrackChip: { width: 112, minHeight: 44, paddingHorizontal: ds.space.xs },
    compactSlider: { flex: 1, minWidth: 108, height: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
    compactSliderControl: { flex: 1, minWidth: 0 },
    compactAdvanced: { flex: 1, minHeight: 0, borderTopWidth: 1, borderTopColor: p.borderSubtle },
    trackScroller: { flex: 1, minWidth: 0 },
    trackRow: { alignItems: 'center', gap: ds.space.xs, paddingHorizontal: ds.space.xs },
    trackChip: { minWidth: 94, maxWidth: 150, minHeight: 44, paddingHorizontal: ds.space.sm },
    trackChipContent: { flexDirection: 'row', alignItems: 'center', gap: ds.space.xs },
    trackName: { flexShrink: 1 },
    utilityRow: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: ds.space.xs },
    utilityAction: { width: 44 },
    mixRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 2 },
    mixRowStacked: { flexDirection: 'column', alignItems: 'stretch' },
    sliderCell: { flex: 1, minWidth: 0, alignItems: 'center' },
    lockReasons: { gap: 2, paddingHorizontal: ds.space.sm },
    toolsScroll: { flexGrow: 0, borderTopWidth: 1, borderTopColor: p.borderSubtle },
    toolsContent: { gap: ds.space.sm, padding: ds.space.sm, paddingBottom: ds.space.md },
}));
