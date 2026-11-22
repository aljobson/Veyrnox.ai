import { EditorMotionHandle, type MotionHandleProps } from './EditorMotionHandle';
import { useCallback, useState, type ComponentProps } from 'react';
import { StyleSheet, Text as NativeText, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { editorPreviewPlan, LEGACY_EDITOR_PREVIEW_CAPABILITIES, type EditorPreviewPlan } from '../../lib/editorPreviewPlan';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import type { Timeline } from '../../lib/nativeEditorModel';
import { Text } from '../ui/Text';
import { EditorMediaPreview } from './EditorMediaPreview';
import { EditorStaticPreviewSurface, type EditorStaticPreviewDisplay } from './EditorStaticPreviewSurface';
import { EditorTimeline } from './EditorTimeline';
import { EditorTransport } from './EditorTransport';
import { useEditorFrame, type FrameStore } from './editorFrameStore';
import { EditorTextOverlay } from './EditorTextOverlay';
import { styles } from './fullEditorStyles';

type Playback = { frameStore: FrameStore };

export function isEditorPreviewApproximate(timeline: Timeline, frame: number) {
    return !editorPreviewPlan(timeline, frame, LEGACY_EDITOR_PREVIEW_CAPABILITIES).capabilities.exact;
}

export function editorPreviewAccessibilityLabel(plan: EditorPreviewPlan) {
    const details = [
        ...plan.visuals.map(layer => layer.media?.name?.trim()).filter((value): value is string => !!value),
        ...plan.texts.map(layer => layer.presentation.text.trim()).filter(Boolean),
    ];
    return details.length ? rawText(t('editor.preview2', { value1: details.join(', ') })) : rawText(t('editor.preview'));
}

export function PlaybackTransport({ frameStore, ...props }: Playback & Omit<ComponentProps<typeof EditorTransport>, 'frame'>) {
    const frame = useEditorFrame(frameStore);
    return <EditorTransport {...props} frame={frame} />;
}
export function PlaybackTimeline({ frameStore, ...props }: Playback & Omit<ComponentProps<typeof EditorTimeline>, 'frame'>) {
    const frame = useEditorFrame(frameStore);
    return <EditorTimeline {...props} frame={frame} />;
}
export function PlaybackPreview({ frameStore, timeline, api, playing, localMediaUris, motionHandle, fontReady, staticPreview = false }: Playback & {
    motionHandle?: MotionHandleProps; timeline: Timeline; api: Pick<ApiClient, 'request'>; playing: boolean; localMediaUris: Record<string, string>; fontReady?(family: string): boolean;
    staticPreview?: boolean;
}) {
    const frame = useEditorFrame(frameStore);
    const plan = editorPreviewPlan(timeline, frame, LEGACY_EDITOR_PREVIEW_CAPABILITIES);
    const [staticDisplay, setStaticDisplay] = useState<EditorStaticPreviewDisplay | null>(null);
    const onStaticDisplayed = useCallback((display: EditorStaticPreviewDisplay | null) => setStaticDisplay(display), []);
    // The legacy surface can show one layer. Use the canonical web order so its fallback shows the uppermost active item.
    const visual = plan.visuals[plan.visuals.length - 1], active = visual?.media ? { clip: visual.clip, media: visual.media } : null;
    const caption = plan.texts[plan.texts.length - 1]?.item;
    const effectiveStatic = staticPreview && !playing ? staticDisplay : null;
    const approximate = effectiveStatic ? !effectiveStatic.exact : !plan.capabilities.exact;
    return <View style={StyleSheet.absoluteFill}>
        {effectiveStatic ? <View pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={editorPreviewAccessibilityLabel(plan)} style={StyleSheet.absoluteFill} /> : null}
        <View pointerEvents="none" accessible={false} accessibilityElementsHidden={Boolean(effectiveStatic)}
            importantForAccessibility={effectiveStatic ? 'no-hide-descendants' : 'auto'}
            style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <View pointerEvents="none" style={{ position: 'absolute', inset: 0, backgroundColor: timeline.background ?? '#000000' }} />
            {active ? <EditorMediaPreview api={api} clip={active.clip} media={active.media} frameStore={frameStore} fps={timeline.fps} playing={playing} localUri={localMediaUris[active.media.id]} /> : null}
            {staticPreview ? <EditorStaticPreviewSurface enabled={!playing} timeline={timeline} frame={frame} api={api} localMediaUris={localMediaUris}
                onDisplayed={onStaticDisplayed} /> : null}
            <View style={styles.safeFrame} />
            {!active && !caption ? <><NativeText style={styles.previewMark}>{t('editor.v')}</NativeText><NativeText style={styles.previewLabel}>{timeline.video.length ? t('editor.movetheplayheadontoavisualclip') : t('editor.previewEmpty')}</NativeText></> : null}
            {caption ? <EditorTextOverlay item={caption} frame={frame} fontReady={fontReady} /> : null}
        </View>
        {motionHandle ? <EditorMotionHandle timeline={timeline} {...motionHandle} /> : null}
        {approximate ? <View pointerEvents="none" style={styles.previewApproximateBadge}>
            <Text variant="footnote" tone="onMedia" accessibilityLiveRegion="polite">{t('editor.previewApproximate')}</Text>
        </View> : null}
    </View>;
}
