import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/beats/[id].tsx'), 'utf8');
const arrangement = fs.readFileSync(path.join(__dirname, '../src/components/beats/BeatArrangement.tsx'), 'utf8');

test('music editor stays on the timeline, exposes AI editing and has no beat-maker switch', () => {
    expect(source).not.toContain('beat-studio-readout');
    expect(source).toContain('testID="beat-editor-quick-settings"');
    expect(source).not.toContain("label={t(doc.view === 'song' ? 'beat.view.pattern'");
    expect(source).toContain("bottomTool === 'ai' ? <BeatAiPanel doc={doc} apply={apply} disabled={aiLocked} visible");
    expect(source).toContain("if (aiLocked && bottomTool === 'ai')");
    expect(source).toContain('showPatterns={false}');
    expect(source).toContain('showPatterns={false} showHistory={false}');
    expect(source).toContain('onAdd={toggleAddTools} onAi={toggleAiTools}');
    expect(source).toContain("const [bottomTool, setBottomTool] = useState<BottomTool>(null)");
    expect(source).toContain("bottomTool === 'mix' ? <MusicMixerTray");
    expect(source).toContain('subMenuEditing={bottomTool === \'mix\' && mixerDeepOpen}');
    expect(source).toContain('compactHeight={compactViewport || compactTimelineForTool}');
    expect(source).toContain("mixerDisabled={mixLocked && bottomTool !== 'mix'}");
    expect(source).toContain("if (mixLocked && bottomTool === 'mix')");
    expect(source).toContain("bottomTool === 'library' ? <BeatSongLibrarySheet inline");
    expect(source).not.toContain('advancedDisabled={patternLocked}');
    expect(source).not.toContain('<BeatMixerSheet');
    expect(source).not.toContain("layout !== 'regular' ? <Button size=\"md\" variant=\"tertiary\" icon=\"sliders\"");
    expect(source).toContain('headerRight: () => <HeaderAction testID="beat-editor-export"');
});

test('timeline explicitly strengthens subdivisions when Increase Contrast is enabled', () => {
    expect(arrangement).toContain('const { increasedContrast } = useAppearance()');
    expect(arrangement).toContain('increasedContrast && (index % 4 ? s.beatGridLineHigh : s.barGridLineHigh)');
    expect(arrangement).toContain('increasedContrast && s.laneHigh');
});

test('inline trays announce their heading and restore focus to the triggering dock control', () => {
    expect(source).toContain('const restoreBottomToolFocus = useCallback');
    expect(source).toContain('AccessibilityInfo.setAccessibilityFocus(node)');
    expect(source).toContain('requestAnimationFrame(() => restoreBottomToolFocus(closed))');
    expect(source).toContain('bottomToolHeading.current');
    expect(source).toContain('subMenuFocusRef={bottomToolHeading}');
    expect(source).toContain('findNodeHandle(bottomToolHeading.current)');
    expect(source).toContain('if (focusedBottomTool.current === bottomTool) return');
    expect(source).toContain('ref={compactSaveBackTrigger} testID="beat-compact-save-back"');
    expect(source).toContain("if (compactViewport || bottomTool !== 'save') return");
    expect(source).toContain('const backToTrackChoices = useCallback');
    expect(source).toContain('AccessibilityInfo.setAccessibilityFocus(node)');
});

test('track creation trays receive one explicit capacity or editor-lock reason', () => {
    expect(source).toContain("const addTrackDisabledReason =");
    expect(source.match(/reason=\{addTrackDisabledReason\}/g)).toHaveLength(2);
});

test('Library lock copy is independent of track capacity', () => {
    expect(source).toContain('const libraryDisabledReason = replacing');
    expect(source).toContain('disabledReason={patternLocked ? libraryDisabledReason : undefined}');
});

test('AI dock action receives the same precise editor lock reason as inline Library', () => {
    expect(source).toContain('aiHint={libraryDisabledReason}');
});

test('compact editor keeps one replacement, notice, or MIDI recovery status with an action', () => {
    expect(source).toContain('const compactEditorStatus =');
    expect(source).toContain('testID="beat-midi-compact-retry-quantise"');
    expect(source).toContain('testID="beat-midi-compact-discard"');
    expect(source).toContain('const compactTimelineStatus = compactViewport || compactTimelineForTool;');
    expect(source).toContain('const compactTransportStatus = compactTimelineStatus ?');
    expect(source).toContain('compactStatus={compactTransportStatus}');
    expect(source).toContain('testID="beat-editor-compact-status"');
});

test('compact idle editor exposes quick settings without adding a sixth main-dock action', () => {
    expect(source).toContain('testID="beat-editor-compact-quick-settings"');
    expect(source).toContain('testID="beat-editor-compact-history"');
    expect(source.match(/testID="beat-editor-undo"/g)).toHaveLength(2);
    expect(source.match(/testID="beat-editor-redo"/g)).toHaveLength(2);
    expect(source).toContain('onKeyboardEditingChange={setKeyboardEditing}');
    expect(source).toContain('compact={compactViewport}');
    expect(source).toContain('composerFirst={compactViewport && keyboardEditing}');
    expect(source).toContain("type BottomTool = 'tracks' | 'library' | 'instruments' | 'ai' | 'mix' | 'save' | null");
    expect(source).toContain("onPress={() => setBottomTool('save')}");
    expect(source).toContain("bottomTool === 'save' ? <View testID=\"beat-compact-save-tray\"");
    expect(source).not.toContain('compactViewport && saveControlsOpen ? <BeatModal');
});
