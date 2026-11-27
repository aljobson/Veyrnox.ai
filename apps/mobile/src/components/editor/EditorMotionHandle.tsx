import { useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { studioColors as colors } from '../../theme';
import { t, rawText, formatNumber } from '../../lib/i18n';
import { evaluatedAt } from '../../lib/editorMotionEdit';
import { activeEditorMedia } from '../../lib/editorPreview';
import type { Selection, Timeline } from '../../lib/nativeEditorModel';
import { useEditorFrame } from './editorFrameStore';
import type { MotionActions } from './tools/useMotionActions';
export type MotionHandleProps = { selection: Selection | null; actions: MotionActions };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const arrow = (n: number) => Math.max(-2, Math.min(3, Math.round(n * 1000000) / 1000000));
export function EditorMotionHandle({ timeline, selection, actions }: MotionHandleProps & { timeline: Timeline }) {
    const frame = useEditorFrame(actions.frameStore), active = activeEditorMedia(timeline, frame);
    const clip = active?.clip;
    const visible = selection?.track === 'video' && selection.id === clip?.id && !timeline.tracks.some(t => t.id === clip?.trackId && t.locked);
    const value = clip ? evaluatedAt(clip, frame).transform : null;
    const [size, setSize] = useState({ width: 0, height: 0 }), [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
    const current = useRef({ actions, value, visible, size, frame, id: clip?.id });
    useLayoutEffect(() => { current.current = { actions, value, visible, size, frame, id: clip?.id }; }, [actions, value, visible, size, frame, clip?.id]);
    const drag = useRef<{ x: number; y: number; nextX: number; nextY: number; frame: number; id: string | undefined } | null>(null);
    const [responder] = useState(() => PanResponder.create({
        onStartShouldSetPanResponder: () => !!current.current.visible,
        onPanResponderGrant: () => {
            const p = current.current; if (!p.visible || !p.value || !p.size.width || !p.size.height) return;
            drag.current = { x: p.value.x, y: p.value.y, nextX: p.value.x, nextY: p.value.y, frame: p.frame, id: p.id };
        },
        onPanResponderMove: (_, gesture) => {
            const d = drag.current, p = current.current; if (!d) return;
            d.nextX = clamp(d.x + gesture.dx / p.size.width); d.nextY = clamp(d.y + gesture.dy / p.size.height);
            setGhost({ x: d.nextX, y: d.nextY });
        },
        onPanResponderRelease: () => {
            const d = drag.current, p = current.current;
            drag.current = null; setGhost(null);
            if (d && p.visible && p.id === d.id && (d.x !== d.nextX || d.y !== d.nextY)) p.actions.position(d.nextX, d.nextY, d.frame);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => { drag.current = null; setGhost(null); },
    }));
    if (!visible || !value) return null;
    const position = ghost ?? value;
    const labels = { left: t('editorMotion.left'), right: t('editorMotion.right'), up: t('editorMotion.up'), down: t('editorMotion.down') };
    return <View testID="editor-motion-layout" pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layout]}
        onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize({ width, height }); }}>
        <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={rawText(t('editorMotion.position'))}
            accessibilityValue={{ text: rawText(t('editorMotion.positionValue', { x: formatNumber(position.x * 100, 0), y: formatNumber(position.y * 100, 0) })) }}
            accessibilityActions={(['left', 'right', 'up', 'down'] as const).map(name => ({ name, label: rawText(labels[name]) }))}
            onAccessibilityAction={event => {
                const name = event.nativeEvent.actionName;
                if (!['left', 'right', 'up', 'down'].includes(name)) return;
                const x = arrow(value.x + (name === 'left' ? -.01 : name === 'right' ? .01 : 0));
                const y = arrow(value.y + (name === 'up' ? -.01 : name === 'down' ? .01 : 0));
                if (x !== value.x || y !== value.y) actions.position(x, y);
            }} style={[styles.handle, { left: position.x * size.width - 22, top: position.y * size.height - 22 }]} />
    </View>;
}
const styles = StyleSheet.create({ layout: { direction: 'ltr' }, handle: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 2,
    borderColor: colors.accent, backgroundColor: colors.surface } });
