import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../../ui/Text';
import { t, rawText, formatNumber } from '../../../lib/i18n';
import { colors, ds, type } from '../../../theme';
import { touchTarget } from '../../../lib/a11y';
import { styles } from '../fullEditorStyles';
import { EmptyPanel, PanelHeading } from '../EditorControls';
import { createFrameStore } from '../editorFrameStore';
import { SegmentedChoice } from './SegmentedChoice';
import { useLookActions, type LookActions } from './useLookActions';
import { FiltersPanel as Filters } from './FiltersPanel';
import { EffectsPanel as Effects } from './EffectsPanel';
import { TransitionsPanel as Transitions } from './TransitionsPanel';
import type { ToolPanelProps } from './types';
import type { Clip, Timeline } from '../../../lib/nativeEditorModel';
export type LookContentProps = { timeline: Timeline; clip: Clip; actions: LookActions; disabled: boolean };
export const percent = (v: number) => t('editorTools.positionValue', { value: formatNumber(v * 100, 1) });
export const number = (v: number) => formatNumber(v, 2);
export const degrees = (v: number) => t('editorLook.degrees', { value: formatNumber(v, 0) });
export function LookHeading({ children }: { children: ReactNode }) {
    return <Text variant="inherit" accessibilityRole="header" style={{ ...type.label, color: colors.text }}>{children}</Text>;
}
export function LookMessage({ children }: { children: ReactNode }) {
    return <Text variant="inherit" style={{ ...type.body, color: colors.text }}>{children}</Text>;
}
// S2's choice has no disabled prop. Keep its enabled UI; locked choices expose a true disabled state.
export function LookChoice(props: Parameters<typeof SegmentedChoice>[0] & { disabled?: boolean }) {
    if (!props.disabled) return <SegmentedChoice {...props} onChange={value => { if (value !== props.value) props.onChange(value); }} />;
    return <View><LookHeading>{props.label}</LookHeading><View style={styles.choices}>
        {props.options.map(option => <Pressable key={option.value} disabled accessibilityRole="button"
            accessibilityLabel={rawText(option.label)} accessibilityState={{ disabled: true, selected: props.value === option.value }}
            style={[styles.choice, touchTarget, styles.disabled]}><Text variant="inherit" style={styles.choiceText}>{option.label}</Text></Pressable>)}
    </View></View>;
}
const idleFrame = createFrameStore();
function LookPanel({ props, kind }: { props: ToolPanelProps; kind: 'filters' | 'effects' | 'transitions' }) {
    const fallback = useLookActions({ timeline: props.timeline, selection: props.selection, applyTimeline: props.applyTimeline,
        setProblem: () => {}, frameStore: idleFrame });
    const actions = props.lookActions ?? fallback;
    const clip = props.selection?.track === 'video' ? props.timeline.video.find(c => c.id === props.selection?.id) : undefined;
    const disabled = !!props.timeline.tracks.find(track => track.id === clip?.trackId)?.locked;
    const Content = kind === 'filters' ? Filters : kind === 'effects' ? Effects : Transitions;
    return <View style={{ gap: ds.space.md }}>
        <PanelHeading title={t(`editor.${kind}`)} detail={t(clip ? 'editor.videoclipselected' : 'editor.selectavideoclip')} />
        {clip ? <><LookMessage>{t('editorLook.preview')}</LookMessage>
            {disabled ? <LookMessage>{t('editorLook.locked')}</LookMessage> : null}
            <Content timeline={props.timeline} clip={clip} actions={actions} disabled={disabled} />
        </> : <EmptyPanel title={t('editor.chooseavideoclip')} body={t('editor.selectavideoclip')} />}
    </View>;
}
export const FiltersPanel = (props: ToolPanelProps) => <LookPanel props={props} kind="filters" />;
export const EffectsPanel = (props: ToolPanelProps) => <LookPanel props={props} kind="effects" />;
export const TransitionsPanel = (props: ToolPanelProps) => <LookPanel props={props} kind="transitions" />;
