import { createContext, useContext, useEffect, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, SegmentedControl, Text, themedStyles, useAppearance, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { beatEditorLayout, MUSIC_EDITOR_SUBMENU_HEADING_HEIGHT, musicTransportLayout } from '../../lib/beatNative/editorLayout';
import { ds, TEXT_SCALE } from '../../theme';
import type { PatternSlot } from '../../lib/beatNative/doc';
import type { BeatMidiRecordPhase } from './BeatMidiRecordPanel';

const PATTERNS: readonly PatternSlot[] = ['A', 'B', 'C', 'D'];
const ZERO_SAFE_AREA = createContext({ top: 0, right: 0, bottom: 0, left: 0 });

export function BeatEditorTransport({ playing, starting, locked, availableHeight, compactViewport: routeCompactViewport, showPatterns = true, showHistory = true, pattern, patternDisabled, canUndo, canRedo, patternControlsRef, midiRecordControlRef, addControlRef, aiControlRef, mixerControlRef, libraryControlRef, subMenuFocusRef, subMenuLabel, subMenuFillsBudget = false, subMenuEditing = false, compactStatus, midiRecordPhase, midiRecordDisabled = false, midiRecordHint, addDisabled = false, addOpen = false, aiOpen = false, aiDisabled = false, aiHint, mixerOpen = false, mixerDisabled = false, libraryOpen = false, libraryDisabled = false, subMenu, onPattern, onPatternControls, onUndo, onRedo, onPlay, onAdd, onAi, onExport, onMixer, onLibrary, onMidiRecord, onKeyboardEditingChange }: {
    playing: boolean;
    starting: boolean;
    locked: boolean;
    availableHeight?: number;
    compactViewport?: boolean;
    showPatterns?: boolean;
    showHistory?: boolean;
    pattern: PatternSlot;
    patternDisabled: boolean;
    canUndo: boolean;
    canRedo: boolean;
    patternControlsRef?: Ref<ComponentRef<typeof Pressable>>;
    midiRecordControlRef?: Ref<ComponentRef<typeof Pressable>>;
    addControlRef?: Ref<ComponentRef<typeof Pressable>>;
    aiControlRef?: Ref<ComponentRef<typeof Pressable>>;
    mixerControlRef?: Ref<ComponentRef<typeof Pressable>>;
    libraryControlRef?: Ref<ComponentRef<typeof Pressable>>;
    subMenuFocusRef?: Ref<ComponentRef<typeof View>>;
    subMenuLabel?: string;
    subMenuFillsBudget?: boolean;
    subMenuEditing?: boolean;
    compactStatus?: ReactNode;
    midiRecordPhase?: BeatMidiRecordPhase;
    midiRecordDisabled?: boolean;
    midiRecordHint?: string;
    addDisabled?: boolean;
    addOpen?: boolean;
    aiOpen?: boolean;
    aiDisabled?: boolean;
    aiHint?: string;
    mixerOpen?: boolean;
    mixerDisabled?: boolean;
    libraryOpen?: boolean;
    libraryDisabled?: boolean;
    subMenu?: ReactNode;
    onPattern(pattern: PatternSlot): void;
    onPatternControls(): void;
    onUndo(): void;
    onRedo(): void;
    onPlay(): void;
    onAdd?(): void;
    onAi?(): void;
    onExport?(): void;
    onMixer(): void;
    onLibrary?(): void;
    onMidiRecord?(): void;
    onKeyboardEditingChange?(editing: boolean): void;
}) {
    const s = useThemedStyles(sheets);
    const { width, height, fontScale } = useWindowDimensions();
    // SafeAreaInsetsContext is live in the app; the fallback keeps isolated unit
    // renders deterministic without inventing a device inset.
    const insets = useContext(SafeAreaInsetsContext ?? ZERO_SAFE_AREA);
    const { settings } = useAppearance();
    const layout = beatEditorLayout(width, height, fontScale, TEXT_SCALE[settings.textSize]);
    const shortLandscape = width > height && height < 500;
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    useEffect(() => {
        const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height));
        const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
        return () => { show.remove(); hide.remove(); };
    }, []);
    useEffect(() => { onKeyboardEditingChange?.(keyboardHeight > 0); }, [keyboardHeight, onKeyboardEditingChange]);
    const active = playing || starting;
    const compactIcons = layout === 'compact';
    const focusedDock = !showPatterns && !showHistory;
    const scrollActions = layout === 'accessible' && !focusedDock;
    const keyboardInset = Math.max(0, keyboardHeight);
    const measuredViewport = availableHeight && availableHeight > 0 ? availableHeight : null;
    const transportLayout = musicTransportLayout(width, measuredViewport ?? height, measuredViewport ? 0 : keyboardInset,
        MUSIC_EDITOR_SUBMENU_HEADING_HEIGHT, keyboardHeight > 0 || subMenuEditing, keyboardHeight > 0 ? 0 : (insets?.bottom ?? 0), !!subMenu);
    const { trayMaxHeight } = transportLayout;
    // The route owns compactness because it also controls the arrangement and
    // tray variants. Standalone consumers can still use the measured fallback.
    const compactViewport = routeCompactViewport ?? transportLayout.compactViewport;
    const showDockLabel = focusedDock && layout !== 'accessible' && !compactViewport;
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
        variant={midiActive ? 'destructive' : focusedDock ? 'tertiary' : 'primary'} icon="vinylRecord" iconOnly={compactIcons && !focusedDock} label={midiLabel}
        accessibilityHint={midiRecordHint}
        accessibilityState={{ busy: midiRecordPhase === 'starting' || midiRecordPhase === 'finishing' }}
        disabled={!onMidiRecord || (!midiActive && midiRecordDisabled)}
        onPress={onMidiRecord} containerStyle={focusedDock ? s.dockAction : compactIcons ? s.recordCompact : s.recordControl}
        style={focusedDock ? [s.dockButton, compactViewport && s.dockButtonCompact] : undefined}>
        {focusedDock ? <><Icon name="vinylRecord" size={20} tint={midiActive ? s.onDanger.color : s.inactiveIcon.color} />
            {showDockLabel ? <Text variant="caption" numberOfLines={1} style={midiActive ? s.onDanger : s.dockLabel}>{midiLabel}</Text> : null}</> : undefined}
    </Button> : null;
    const playControl = <Button testID="beat-editor-play" size="md" variant={focusedDock ? 'tertiary' : 'primary'} icon={active ? 'pauseCircle' : 'play'} iconOnly={compactIcons && !focusedDock}
            label={t(active ? 'beat.stop' : 'beat.play')} disabled={locked} onPress={onPlay}
            style={focusedDock ? [s.dockButton, compactViewport && s.dockButtonCompact] : compactIcons ? s.playButtonCompact : undefined}
            containerStyle={[focusedDock ? s.dockAction : compactIcons ? s.playCompact : s.play, scrollActions && s.playAccessible]}>
            {focusedDock ? <><Icon name={active ? 'pauseCircle' : 'play'} size={24} tint={s.playIcon.color} />
                {showDockLabel ? <Text variant="caption" numberOfLines={1} style={s.dockLabel}>{t(active ? 'beat.stop' : 'beat.play')}</Text> : null}</> : undefined}
        </Button>;
    const playback = <View style={[s.group, focusedDock && s.playbackDock, scrollActions && s.groupAccessible]} testID="beat-editor-playback-controls">
        {focusedDock && midiActive ? midiControl : playControl}
        <Button ref={mixerControlRef} testID="beat-editor-mixer" size="md" variant={mixerOpen ? 'secondary' : compactIcons ? 'tertiary' : 'secondary'} icon="sliders" iconOnly={compactIcons && !focusedDock}
            label={t('beatMix.title')} accessibilityState={{ selected: mixerOpen, expanded: mixerOpen }} disabled={mixerDisabled} onPress={onMixer}
            containerStyle={[focusedDock ? s.dockAction : s.control, scrollActions && s.controlAccessible]} style={focusedDock ? [s.dockButton, compactViewport && s.dockButtonCompact] : undefined}>
            {focusedDock ? <><Icon name="sliders" size={20} tint={mixerOpen ? s.activeIcon.color : s.inactiveIcon.color} />
                {showDockLabel ? <Text variant="caption" numberOfLines={1} style={mixerOpen ? s.activeLabel : s.dockLabel}>{t('beatMix.dock.mix')}</Text> : null}</> : undefined}
        </Button>
        {focusedDock && onLibrary ? <Button ref={libraryControlRef} testID="beat-editor-library" size="md" variant={libraryOpen ? 'secondary' : 'tertiary'}
            icon="folder" label={t('beat.track.library')} accessibilityState={{ selected: libraryOpen, expanded: libraryOpen }}
            disabled={libraryDisabled} onPress={onLibrary} containerStyle={s.dockAction} style={[s.dockButton, compactViewport && s.dockButtonCompact]}>
            <Icon name="folder" size={20} tint={libraryOpen ? s.activeIcon.color : s.inactiveIcon.color} />
            {showDockLabel ? <Text variant="caption" numberOfLines={1} style={libraryOpen ? s.activeLabel : s.dockLabel}>{t('beatMix.dock.library')}</Text> : null}
        </Button> : null}
        {compactIcons && !focusedDock ? midiControl : null}
    </View>;
    const projectActions = <View style={[s.group, focusedDock && s.projectDock, scrollActions && s.groupAccessible]} testID="beat-editor-project-actions">
        {onAdd ? <Button ref={addControlRef} testID="beat-editor-add-track" size="md" variant={addOpen ? 'secondary' : 'tertiary'} icon="plus" iconOnly={!focusedDock} label={t('beat.track.add')}
            accessibilityState={{ selected: addOpen, expanded: addOpen }} disabled={addDisabled} onPress={onAdd}
            containerStyle={[focusedDock ? s.dockAction : s.control, scrollActions && s.controlAccessible]} style={focusedDock ? [s.dockButton, compactViewport && s.dockButtonCompact] : undefined}>
            {focusedDock ? <><Icon name="plus" size={20} tint={addOpen ? s.activeIcon.color : s.inactiveIcon.color} />
                {showDockLabel ? <Text variant="caption" numberOfLines={1} style={addOpen ? s.activeLabel : s.dockLabel}>{t('beatMix.dock.tracks')}</Text> : null}</> : undefined}
        </Button> : null}
        {onAi ? <Button ref={aiControlRef} testID="beat-editor-ai" size="md" variant={aiOpen ? 'secondary' : 'tertiary'} tone="accent" label={t('beatAi.title')}
            accessibilityHint={locked || aiDisabled ? aiHint : undefined}
            accessibilityState={{ selected: aiOpen, expanded: aiOpen }} disabled={locked || aiDisabled} onPress={onAi} style={focusedDock ? [s.dockButton, compactViewport && s.dockButtonCompact] : s.aiControl}
            containerStyle={[focusedDock ? s.dockAction : s.control, scrollActions && s.controlAccessible]}>
            <Icon name="sparkleFill" size={20} tint={aiOpen ? s.activeIcon.color : s.aiIcon.color} />
            {showDockLabel ? <Text variant="caption" numberOfLines={1} style={aiOpen ? s.activeLabel : s.dockLabel}>{t('beatMix.dock.ai')}</Text> : null}
        </Button> : null}
        {onExport ? <Button testID="beat-editor-export" size="md" variant="tertiary" icon="arrowUp" iconOnly label={t('beatExport.title')}
            onPress={onExport} containerStyle={[s.control, scrollActions && s.controlAccessible]} /> : null}
    </View>;
    return <View testID="beat-editor-keyboard-origin" style={s.keyboard}>
    <SafeAreaView edges={keyboardHeight > 0 || compactViewport ? ['left', 'right'] : ['left', 'right', 'bottom']} testID="beat-editor-transport" accessible={false} accessibilityRole="toolbar" accessibilityLabel={t('beat.transport')} style={s.safeArea}>
        <View testID={compactViewport ? 'beat-editor-transport-compact-viewport' : undefined} style={[s.bar, shortLandscape && s.shortLandscape, compactViewport && s.constrained, layout === 'regular' && s.regular, layout === 'accessible' && s.accessible]}>
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
            </ScrollView> : <View testID={`beat-editor-transport-controls-${layout}`} style={[s.controls, focusedDock && s.focusedControls]}>
                {showPatterns ? patternAction : null}{projectActions}{showHistory ? history : null}{playback}
            </View>}
            {midiRecordPhase !== undefined && !compactIcons && !focusedDock ? <View testID="beat-midi-record-row" style={s.recordRow}>
                {midiControl}
            </View> : null}
            {subMenu || compactStatus ? <View testID="beat-editor-submenu" style={s.subMenu}>
                {subMenuLabel && compactViewport ? <View ref={subMenuFocusRef} accessible accessibilityRole="header"
                    accessibilityLabel={subMenuLabel} style={s.compactFocusTarget} /> : null}
                {subMenuLabel && !compactViewport ? <View ref={subMenuFocusRef} accessible accessibilityRole="header" accessibilityLabel={subMenuLabel} style={s.subMenuHeading}>
                    <Text accessible={false} variant="footnote" tone="secondary">{subMenuLabel}</Text>
                </View> : null}
                <View testID="beat-editor-submenu-viewport" style={[s.subMenuViewport, compactViewport && s.subMenuViewportCompact,
                    { maxHeight: trayMaxHeight }, (compactViewport || subMenuFillsBudget) && { height: trayMaxHeight }]}>
                    {compactStatus ? <View testID="beat-editor-compact-status-slot" style={s.compactStatusSlot}>{compactStatus}</View> : null}
                    {subMenu ? <View testID="beat-editor-submenu-content" style={[s.subMenuContent,
                        (compactViewport || subMenuFillsBudget) && s.subMenuContentFill,
                        compactViewport && s.compactSubMenuContent]}>{subMenu}</View> : null}
                </View>
            </View> : null}
        </View>
    </SafeAreaView></View>;
}

const sheets = themedStyles(p => ({
    keyboard: { flexShrink: 0 },
    safeArea: { flexShrink: 0, backgroundColor: p.bgElevated1, borderTopWidth: 1, borderTopColor: p.borderStrong },
    bar: { gap: ds.space.xs, paddingHorizontal: ds.space.gutter, paddingTop: ds.space.sm, paddingBottom: ds.space.lg },
    shortLandscape: { paddingTop: ds.space.xs, paddingBottom: ds.space.xs },
    constrained: { gap: 0, paddingTop: 0, paddingBottom: 0 },
    regular: { paddingHorizontal: ds.space.xxxl },
    accessible: { gap: ds.space.sm },
    patternRow: { width: '100%', maxWidth: 820, alignSelf: 'center' },
    patternTabs: { width: '100%' },
    status: { textAlign: 'center' },
    controls: { width: '100%', maxWidth: 820, alignSelf: 'center', flexDirection: 'row', gap: ds.space.sm },
    focusedControls: { gap: 2 },
    accessibleScroller: { width: '100%', flexGrow: 0 },
    controlsAccessible: { flexDirection: 'row', gap: ds.space.sm, paddingRight: ds.space.gutter },
    group: { flex: 1, flexDirection: 'row', gap: ds.space.sm },
    projectDock: { flex: 2, gap: 2 },
    playbackDock: { flex: 3, gap: 2 },
    patternAction: { flex: 0.8 },
    groupAccessible: { flex: 0, width: 'auto', alignSelf: 'stretch' },
    control: { flex: 1 },
    dockAction: { flex: 1, minWidth: 0 },
    dockButton: { minWidth: 44, minHeight: 52, flexDirection: 'column', gap: 2, paddingHorizontal: ds.space.xs, borderRadius: ds.radius.md },
    dockButtonCompact: { height: 44, minHeight: 44, paddingVertical: 0 },
    dockLabel: { color: p.textSecondary, textAlign: 'center' },
    activeLabel: { color: p.textPrimary, textAlign: 'center' },
    activeIcon: { color: p.accent },
    inactiveIcon: { color: p.textSecondary },
    playIcon: { color: p.accent },
    onDanger: { color: p.bg, textAlign: 'center' },
    aiControl: { borderWidth: 1, borderColor: p.accent },
    aiIcon: { color: p.accent },
    controlAccessible: { flex: 0, minWidth: 150 },
    patternActionAccessible: { flex: 0, minWidth: 190 },
    play: { flex: 1.2 },
    playCompact: { width: 56, flexGrow: 0 },
    playButtonCompact: { width: 56, borderRadius: ds.radius.pill, paddingHorizontal: 0 },
    playAccessible: { flex: 0, minWidth: 170 },
    recordRow: { width: '100%', maxWidth: 820, alignSelf: 'center' },
    recordControl: { width: '100%', minHeight: 44 },
    recordCompact: { width: 56, flexGrow: 0 },
    subMenu: { width: '100%', maxWidth: 820, minHeight: 0, alignSelf: 'center' },
    subMenuViewport: { minHeight: 0, overflow: 'hidden' },
    subMenuViewportCompact: { flexDirection: 'row', alignItems: 'stretch' },
    compactStatusSlot: { maxWidth: '100%', minWidth: 0, flexShrink: 0 },
    subMenuContent: { flexShrink: 1, minHeight: 0 },
    subMenuContentFill: { flex: 1 },
    compactSubMenuContent: { flex: 1, minWidth: 0, minHeight: 0 },
    compactFocusTarget: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 },
    subMenuHeading: { minHeight: 24, justifyContent: 'center', paddingHorizontal: ds.space.xs },
}));
