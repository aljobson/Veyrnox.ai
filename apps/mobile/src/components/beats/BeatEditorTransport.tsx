import type { ComponentRef, Ref } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, SegmentedControl, Text, themedStyles, useAppearance, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { beatEditorLayout } from '../../lib/beatNative/editorLayout';
import { ds, TEXT_SCALE } from '../../theme';
import type { PatternSlot } from '../../lib/beatNative/doc';
import type { BeatMidiRecordPhase } from './BeatMidiRecordPanel';

const PATTERNS: readonly PatternSlot[] = ['A', 'B', 'C', 'D'];

export function BeatEditorTransport({ playing, starting, locked, showPatterns = true, showHistory = true, pattern, patternDisabled, canUndo, canRedo, patternControlsRef, midiRecordControlRef, midiRecordPhase, midiRecordDisabled = false, midiRecordHint, addDisabled = false, mixerDisabled = false, onPattern, onPatternControls, onUndo, onRedo, onPlay, onAdd, onAi, onExport, onMixer, onMidiRecord }: {
    playing: boolean;
    starting: boolean;
    locked: boolean;
    showPatterns?: boolean;
    showHistory?: boolean;
    pattern: PatternSlot;
    patternDisabled: boolean;
    canUndo: boolean;
    canRedo: boolean;
    patternControlsRef?: Ref<ComponentRef<typeof Pressable>>;
    midiRecordControlRef?: Ref<ComponentRef<typeof Pressable>>;
    midiRecordPhase?: BeatMidiRecordPhase;
    midiRecordDisabled?: boolean;
    midiRecordHint?: string;
    addDisabled?: boolean;
    mixerDisabled?: boolean;
    onPattern(pattern: PatternSlot): void;
    onPatternControls(): void;
    onUndo(): void;
    onRedo(): void;
    onPlay(): void;
    onAdd?(): void;
    onAi?(): void;
    onExport?(): void;
    onMixer(): void;
    onMidiRecord?(): void;
}) {
    const s = useThemedStyles(sheets);
    const { width, height, fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const layout = beatEditorLayout(width, height, fontScale, TEXT_SCALE[settings.textSize]);
    const shortLandscape = width > height && height < 500;
    const active = playing || starting;
    const scrollActions = layout === 'accessible';
    const compactIcons = layout === 'compact';
    const patternAction = <View style={[s.patternAction, scrollActions && s.groupAccessible]} testID="beat-editor-pattern-action">
        <Button ref={patternControlsRef} testID="beat-editor-pattern-controls" size="md" variant={compactIcons ? 'tertiary' : 'secondary'} icon="squares" iconOnly={compactIcons}
            label={t('beat.pattern.controls')} accessibilityLabel={t('beat.pattern.controlsNamed', { pattern })}
            disabled={patternDisabled} onPress={onPatternControls}
            containerStyle={[s.control, scrollActions && s.patternActionAccessible]} />
    </View>;
    const history = <View style={[s.group, scrollActions && s.groupAccessible]} testID="beat-editor-history-controls">
        <Button testID="beat-editor-undo" size="md" variant={compactIcons ? 'tertiary' : 'secondary'} icon="seekBack" iconOnly={compactIcons} label={t('beat.undo')} disabled={!canUndo} onPress={onUndo} containerStyle={[s.control, scrollActions && s.controlAccessible]} />
        <Button testID="beat-editor-redo" size="md" variant={compactIcons ? 'tertiary' : 'secondary'} icon="seekForward" iconOnly={compactIcons} label={t('beat.redo')} disabled={!canRedo} onPress={onRedo} containerStyle={[s.control, scrollActions && s.controlAccessible]} />
    </View>;
    const midiLabel = midiRecordPhase === 'countIn'
        ? t('beat.midiRecord.cancelCountIn')
        : midiRecordPhase === 'starting'
            ? t('beat.midiRecord.cancelStarting')
            : midiRecordPhase === 'recording' || midiRecordPhase === 'finishing'
                ? t('beat.midiRecord.stop')
                : t('beat.midiRecord.record');
    const midiActive = midiRecordPhase !== undefined && midiRecordPhase !== 'idle';
    const midiControl = midiRecordPhase !== undefined ? <Button ref={midiRecordControlRef} testID="beat-midi-record-control" size="md"
        variant={midiActive ? 'destructive' : 'primary'} icon="vinylRecord" iconOnly={compactIcons} label={midiLabel}
        accessibilityHint={midiRecordHint}
        accessibilityState={{ busy: midiRecordPhase === 'starting' || midiRecordPhase === 'finishing' }}
        disabled={!onMidiRecord || (!midiActive && midiRecordDisabled)}
        onPress={onMidiRecord} containerStyle={compactIcons ? s.recordCompact : s.recordControl} /> : null;
    const playback = <View style={[s.group, scrollActions && s.groupAccessible]} testID="beat-editor-playback-controls">
        <Button testID="beat-editor-play" size="md" variant="primary" icon={active ? 'pauseCircle' : 'play'} iconOnly={compactIcons}
            label={t(active ? 'beat.stop' : 'beat.play')} disabled={locked} onPress={onPlay}
            style={compactIcons ? s.playButtonCompact : undefined}
            containerStyle={[compactIcons ? s.playCompact : s.play, scrollActions && s.playAccessible]} />
        <Button testID="beat-editor-mixer" size="md" variant={compactIcons ? 'tertiary' : 'secondary'} icon="sliders" iconOnly={compactIcons} label={t('beatMix.title')} disabled={mixerDisabled} onPress={onMixer} containerStyle={[s.control, scrollActions && s.controlAccessible]} />
        {compactIcons ? midiControl : null}
    </View>;
    const projectActions = <View style={[s.group, scrollActions && s.groupAccessible]} testID="beat-editor-project-actions">
        {onAdd ? <Button testID="beat-editor-add-track" size="md" variant="tertiary" icon="plus" iconOnly label={t('beat.track.add')}
            disabled={addDisabled} onPress={onAdd} containerStyle={[s.control, scrollActions && s.controlAccessible]} /> : null}
        {onAi ? <Button testID="beat-editor-ai" size="md" variant="tertiary" icon="magicWand" iconOnly label={t('beatAi.title')}
            disabled={locked} onPress={onAi} containerStyle={[s.control, scrollActions && s.controlAccessible]} /> : null}
        {onExport ? <Button testID="beat-editor-export" size="md" variant="tertiary" icon="arrowUp" iconOnly label={t('beatExport.title')}
            onPress={onExport} containerStyle={[s.control, scrollActions && s.controlAccessible]} /> : null}
    </View>;
    return <SafeAreaView edges={['left', 'right', 'bottom']} testID="beat-editor-transport" accessible={false} accessibilityRole="toolbar" accessibilityLabel={t('beat.transport')} style={s.safeArea}>
        <View style={[s.bar, shortLandscape && s.shortLandscape, layout === 'regular' && s.regular, layout === 'accessible' && s.accessible]}>
            {showPatterns ? <View testID="beat-editor-pattern-selector" style={s.patternRow}>
                <SegmentedControl value={pattern} disabled={patternDisabled} accessibilityLabel={t('beat.patterns')}
                    options={PATTERNS.map(value => ({ value, label: value, accessibilityLabel: t('beat.pattern.named', { pattern: value }) }))}
                    onChange={onPattern} style={s.patternTabs} />
            </View> : null}
            {layout !== 'accessible' && !shortLandscape ? <Text testID="beat-editor-transport-status" variant="caption" tone="secondary" style={s.status}>
                {t(active ? 'beat.playing' : 'beat.stopped')}
            </Text> : null}
            {scrollActions ? <ScrollView horizontal showsHorizontalScrollIndicator
                testID={`beat-editor-transport-controls-${layout}`} style={s.accessibleScroller} contentContainerStyle={s.controlsAccessible}>
                {showPatterns ? patternAction : null}{projectActions}{showHistory ? history : null}{playback}
            </ScrollView> : <View testID={`beat-editor-transport-controls-${layout}`} style={s.controls}>
                {showPatterns ? patternAction : null}{projectActions}{showHistory ? history : null}{playback}
            </View>}
            {midiRecordPhase !== undefined && !compactIcons ? <View testID="beat-midi-record-row" style={s.recordRow}>
                {midiControl}
            </View> : null}
        </View>
    </SafeAreaView>;
}

const sheets = themedStyles(p => ({
    safeArea: { flexShrink: 0, backgroundColor: p.bgElevated1, borderTopWidth: 1, borderTopColor: p.borderStrong },
    bar: { gap: ds.space.xs, paddingHorizontal: ds.space.gutter, paddingTop: ds.space.sm, paddingBottom: ds.space.lg },
    shortLandscape: { paddingTop: ds.space.xs, paddingBottom: ds.space.xs },
    regular: { paddingHorizontal: ds.space.xxxl },
    accessible: { gap: ds.space.sm },
    patternRow: { width: '100%', maxWidth: 820, alignSelf: 'center' },
    patternTabs: { width: '100%' },
    status: { textAlign: 'center' },
    controls: { width: '100%', maxWidth: 820, alignSelf: 'center', flexDirection: 'row', gap: ds.space.sm },
    accessibleScroller: { width: '100%', flexGrow: 0 },
    controlsAccessible: { flexDirection: 'row', gap: ds.space.sm, paddingRight: ds.space.gutter },
    group: { flex: 1, flexDirection: 'row', gap: ds.space.sm },
    patternAction: { flex: 0.8 },
    groupAccessible: { flex: 0, width: 'auto', alignSelf: 'stretch' },
    control: { flex: 1 },
    controlAccessible: { flex: 0, minWidth: 150 },
    patternActionAccessible: { flex: 0, minWidth: 190 },
    play: { flex: 1.2 },
    playCompact: { width: 56, flexGrow: 0 },
    playButtonCompact: { width: 56, borderRadius: ds.radius.pill, paddingHorizontal: 0 },
    playAccessible: { flex: 0, minWidth: 170 },
    recordRow: { width: '100%', maxWidth: 820, alignSelf: 'center' },
    recordControl: { width: '100%', minHeight: 44 },
    recordCompact: { width: 56, flexGrow: 0 },
}));
