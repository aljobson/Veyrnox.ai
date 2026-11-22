import type { ComponentRef, Ref } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, SegmentedControl, Text, themedStyles, useAppearance, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { beatEditorLayout } from '../../lib/beatNative/editorLayout';
import { ds, TEXT_SCALE } from '../../theme';
import type { PatternSlot } from '../../lib/beatNative/doc';

const PATTERNS: readonly PatternSlot[] = ['A', 'B', 'C', 'D'];

export function BeatEditorTransport({ playing, starting, locked, pattern, patternDisabled, canUndo, canRedo, patternControlsRef, onPattern, onPatternControls, onUndo, onRedo, onPlay, onMixer }: {
    playing: boolean;
    starting: boolean;
    locked: boolean;
    pattern: PatternSlot;
    patternDisabled: boolean;
    canUndo: boolean;
    canRedo: boolean;
    patternControlsRef?: Ref<ComponentRef<typeof Pressable>>;
    onPattern(pattern: PatternSlot): void;
    onPatternControls(): void;
    onUndo(): void;
    onRedo(): void;
    onPlay(): void;
    onMixer(): void;
}) {
    const s = useThemedStyles(sheets);
    const { width, fontScale } = useWindowDimensions();
    const { settings } = useAppearance();
    const layout = beatEditorLayout(width, fontScale, TEXT_SCALE[settings.textSize]);
    const active = playing || starting;
    const scrollActions = layout === 'accessible';
    const compactIcons = layout === 'compact';
    const patternAction = <View style={[s.patternAction, scrollActions && s.groupAccessible]} testID="beat-editor-pattern-action">
        <Button ref={patternControlsRef} testID="beat-editor-pattern-controls" size="md" variant="secondary" icon="squares" iconOnly={compactIcons}
            label={t('beat.pattern.controls')} accessibilityLabel={t('beat.pattern.controlsNamed', { pattern })}
            disabled={patternDisabled} onPress={onPatternControls}
            containerStyle={[s.control, scrollActions && s.patternActionAccessible]} />
    </View>;
    const history = <View style={[s.group, scrollActions && s.groupAccessible]} testID="beat-editor-history-controls">
        <Button testID="beat-editor-undo" size="md" variant="secondary" icon="seekBack" iconOnly={compactIcons} label={t('beat.undo')} disabled={!canUndo} onPress={onUndo} containerStyle={[s.control, scrollActions && s.controlAccessible]} />
        <Button testID="beat-editor-redo" size="md" variant="secondary" icon="seekForward" iconOnly={compactIcons} label={t('beat.redo')} disabled={!canRedo} onPress={onRedo} containerStyle={[s.control, scrollActions && s.controlAccessible]} />
    </View>;
    const playback = <View style={[s.group, scrollActions && s.groupAccessible]} testID="beat-editor-playback-controls">
        <Button testID="beat-editor-play" size="md" variant="primary" icon={active ? 'pauseCircle' : 'play'} iconOnly={compactIcons} label={t(active ? 'beat.stop' : 'beat.play')} disabled={locked} onPress={onPlay} containerStyle={[s.play, scrollActions && s.playAccessible]} />
        <Button testID="beat-editor-mixer" size="md" variant="secondary" icon="sliders" iconOnly={compactIcons} label={t('beatMix.title')} onPress={onMixer} containerStyle={[s.control, scrollActions && s.controlAccessible]} />
    </View>;
    return <SafeAreaView edges={['bottom']} testID="beat-editor-transport" accessible={false} accessibilityRole="toolbar" accessibilityLabel={t('beat.transport')} style={s.safeArea}>
        <View style={[s.bar, layout === 'regular' && s.regular, layout === 'accessible' && s.accessible]}>
            <View testID="beat-editor-pattern-selector" style={s.patternRow}>
                <SegmentedControl value={pattern} disabled={patternDisabled} accessibilityLabel={t('beat.patterns')}
                    options={PATTERNS.map(value => ({ value, label: value, accessibilityLabel: t('beat.pattern.named', { pattern: value }) }))}
                    onChange={onPattern} style={s.patternTabs} />
            </View>
            {layout !== 'accessible' ? <Text testID="beat-editor-transport-status" variant="caption" tone="secondary" style={s.status}>
                {t(active ? 'beat.playing' : 'beat.stopped')}
            </Text> : null}
            {scrollActions ? <ScrollView horizontal showsHorizontalScrollIndicator
                testID={`beat-editor-transport-controls-${layout}`} style={s.accessibleScroller} contentContainerStyle={s.controlsAccessible}>
                {patternAction}{history}{playback}
            </ScrollView> : <View testID={`beat-editor-transport-controls-${layout}`} style={s.controls}>
                {patternAction}{history}{playback}
            </View>}
        </View>
    </SafeAreaView>;
}

const sheets = themedStyles(p => ({
    safeArea: { flexShrink: 0, backgroundColor: p.bgElevated1, borderTopWidth: 1, borderTopColor: p.borderStrong },
    bar: { gap: ds.space.xs, paddingHorizontal: ds.space.gutter, paddingTop: ds.space.sm, paddingBottom: ds.space.lg },
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
    playAccessible: { flex: 0, minWidth: 170 },
}));
