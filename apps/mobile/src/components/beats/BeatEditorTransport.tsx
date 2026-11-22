import { ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, themedStyles, useAppearance, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { beatEditorLayout } from '../../lib/beatNative/editorLayout';
import { ds, TEXT_SCALE } from '../../theme';

export function BeatEditorTransport({ playing, starting, locked, canUndo, canRedo, onUndo, onRedo, onPlay, onMixer }: {
    playing: boolean;
    starting: boolean;
    locked: boolean;
    canUndo: boolean;
    canRedo: boolean;
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
    const history = <View style={[s.group, layout === 'accessible' && s.groupAccessible]} testID="beat-editor-history-controls">
        <Button testID="beat-editor-undo" size="md" variant="secondary" icon="seekBack" label={t('beat.undo')} disabled={!canUndo} onPress={onUndo} containerStyle={[s.control, layout === 'accessible' && s.controlAccessible]} />
        <Button testID="beat-editor-redo" size="md" variant="secondary" icon="seekForward" label={t('beat.redo')} disabled={!canRedo} onPress={onRedo} containerStyle={[s.control, layout === 'accessible' && s.controlAccessible]} />
    </View>;
    const playback = <View style={[s.group, layout === 'accessible' && s.groupAccessible]} testID="beat-editor-playback-controls">
        <Button testID="beat-editor-play" size="md" variant="primary" icon={active ? 'pauseCircle' : 'play'} label={t(active ? 'beat.stop' : 'beat.play')} disabled={locked} onPress={onPlay} containerStyle={[s.play, layout === 'accessible' && s.playAccessible]} />
        <Button testID="beat-editor-mixer" size="md" variant="secondary" icon="sliders" label={t('beatMix.title')} onPress={onMixer} containerStyle={[s.control, layout === 'accessible' && s.controlAccessible]} />
    </View>;
    return <SafeAreaView edges={['bottom']} testID="beat-editor-transport" accessible={false} accessibilityRole="toolbar" accessibilityLabel={t('beat.transport')} style={s.safeArea}>
        <View style={[s.bar, layout === 'regular' && s.regular, layout === 'accessible' && s.accessible]}>
            {layout !== 'accessible' ? <Text testID="beat-editor-transport-status" variant="caption" tone="secondary" style={s.status}>
                {t(active ? 'beat.playing' : 'beat.stopped')}
            </Text> : null}
            {layout === 'accessible' ? <ScrollView horizontal showsHorizontalScrollIndicator
                testID="beat-editor-transport-controls-accessible" style={s.accessibleScroller} contentContainerStyle={s.controlsAccessible}>
                {playback}{history}
            </ScrollView> : <View testID={`beat-editor-transport-controls-${layout}`} style={s.controls}>
                {history}{playback}
            </View>}
        </View>
    </SafeAreaView>;
}

const sheets = themedStyles(p => ({
    safeArea: { flexShrink: 0, backgroundColor: p.bgElevated1, borderTopWidth: 1, borderTopColor: p.borderStrong },
    bar: { gap: ds.space.xs, paddingHorizontal: ds.space.gutter, paddingTop: ds.space.sm, paddingBottom: ds.space.lg },
    regular: { paddingHorizontal: ds.space.xxxl },
    accessible: { gap: ds.space.sm },
    status: { textAlign: 'center' },
    controls: { width: '100%', maxWidth: 820, alignSelf: 'center', flexDirection: 'row', gap: ds.space.sm },
    accessibleScroller: { width: '100%', flexGrow: 0 },
    controlsAccessible: { flexDirection: 'row', gap: ds.space.sm, paddingRight: ds.space.gutter },
    group: { flex: 1, flexDirection: 'row', gap: ds.space.sm },
    groupAccessible: { flex: 0, width: 'auto', alignSelf: 'stretch' },
    control: { flex: 1 },
    controlAccessible: { flex: 0, minWidth: 150 },
    play: { flex: 1.2 },
    playAccessible: { flex: 0, minWidth: 170 },
}));
