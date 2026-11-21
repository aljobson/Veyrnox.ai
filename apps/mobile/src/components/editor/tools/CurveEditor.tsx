import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, View, StyleSheet } from 'react-native';
import { colourDefaults } from '../../../../../../app/veyrnox/_lib/editorColour.mjs';
import { colors, ds, type } from '../../../theme';
import { t, plural, rawText, formatNumber } from '../../../lib/i18n';
import { movePoint, addPoint, removePoint, nearestPoint, fromView, toView, segment, type CurvePoint } from '../../../lib/editorCurvePoints';
import { Action } from '../EditorControls';
import { LookMessage } from './LookPanels';
import { Text } from '../../ui/Text';
import { touchTarget } from '../../../lib/a11y';
function Stepper({ label, value, min, max, onChange }: {
    label: string; value: number; min: number; max: number; step: number; suffix: string; onChange(value: number): void;
}) {
    return <View style={styles.stepper}>
        <Text variant="inherit" style={styles.label}>{label}: {formatNumber(value, 1)}%</Text>
        <View style={styles.buttons}>{([-1, 1] as const).map(direction => {
            const disabled = direction < 0 ? value <= min : value >= max;
            const name = direction < 0 ? t('editor.decrease', { value1: label }) : t('editor.increase', { value1: label });
            return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={rawText(name)} disabled={disabled}
                accessibilityState={{ disabled }} onPress={() => onChange(Math.max(min, Math.min(max, value + direction)))}
                style={[touchTarget, styles.button]}><Text variant="inherit" style={styles.label}>{direction < 0 ? '−' : '+'}</Text></Pressable>;
        })}</View>
    </View>;
}
export function CurveEditor({ points, channelLabel, disabled = false, onChange }: {
    points: readonly CurvePoint[]; channelLabel: string; disabled?: boolean; onChange(points: CurvePoint[]): void;
}) {
    const [width, setWidth] = useState(160), [live, setLive] = useState(points);
    const height = Math.max(160, Math.min(width, 220));
    const current = useRef({ points, disabled, onChange, width, height });
    useLayoutEffect(() => { current.current = { points, disabled, onChange, width, height }; }, [points, disabled, onChange, width, height]);
    const drag = useRef<{ index: number; x: number; y: number; points: readonly CurvePoint[] } | null>(null);
    const moved = useRef<CurvePoint[] | null>(null);
    useEffect(() => { if (!drag.current) setLive(points); }, [points]);
    // PanResponder stores these callbacks; it never invokes them during creation.
    // eslint-disable-next-line react-hooks/refs
    const [responder] = useState(() => PanResponder.create({
        onStartShouldSetPanResponder: event => {
            const p = current.current;
            return !p.disabled && nearestPoint(p.points, event.nativeEvent.locationX, event.nativeEvent.locationY, p.width, p.height) >= 0;
        },
        onMoveShouldSetPanResponder: () => false,
        onPanResponderGrant: event => {
            const p = current.current, x = event.nativeEvent.locationX, y = event.nativeEvent.locationY;
            const index = nearestPoint(p.points, x, y, p.width, p.height);
            if (p.disabled || index < 0) return;
            const origin = toView(p.points[index], p.width, p.height);
            drag.current = { index, x: origin.x, y: origin.y, points: p.points }; moved.current = null;
        },
        onPanResponderMove: (_, gesture) => {
            const d = drag.current, p = current.current; if (!d || p.disabled) return;
            const point = fromView({ x: d.x + gesture.dx, y: d.y + gesture.dy }, p.width, p.height);
            moved.current = movePoint(d.points, d.index, point.x, point.y); setLive(moved.current);
        },
        onPanResponderTerminationRequest: () => !drag.current,
        onPanResponderRelease: () => {
            if (drag.current && moved.current && !current.current.disabled) current.current.onChange(moved.current);
            drag.current = null; moved.current = null; setLive(current.current.points);
        },
        onPanResponderTerminate: () => { drag.current = null; moved.current = null; setLive(current.current.points); },
    }));
    const line = (a: CurvePoint, b: CurvePoint, reference = false) => {
        const s = segment(a, b, width, height);
        return <View pointerEvents="none" style={[styles.line, { left: s.left, top: s.top, width: s.width,
            backgroundColor: reference ? colors.border : colors.accent, transform: [{ rotate: `${s.angle}deg` }] }]} />;
    };
    return <View style={{ gap: ds.space.md }}>
        <View {...responder.panHandlers} hitSlop={22} accessible accessibilityRole="image"
            accessibilityLabel={rawText(plural('editorLook.curveLabel', live.length, { channel: channelLabel }))}
            accessibilityState={{ disabled }} onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))}
            style={[styles.plot, { height }]}>
            {line({ x: 0, y: 0 }, { x: 1, y: 1 }, true)}
            {live.slice(1).map((p, i) => <View key={`line-${i}`} pointerEvents="none">{line(live[i], p)}</View>)}
            {live.map((p, i) => { const v = toView(p, width, height);
                return <View key={i} pointerEvents="none" style={[styles.hit, { left: v.x - 22, top: v.y - 22 }]}><View style={styles.dot} /></View>; })}
        </View>
        {points.map((p, i) => {
            const input = t('editorLook.pointInput', { n: i + 1 }), output = t('editorLook.pointOutput', { n: i + 1 });
            const interior = i > 0 && i < points.length - 1;
            const low = interior ? (points[i - 1].x + .001) * 100 : p.x * 100;
            const high = interior ? (points[i + 1].x - .001) * 100 : p.x * 100;
            return <View key={i} style={{ gap: ds.space.sm }}>
                {interior ? <Stepper label={input} value={p.x * 100} min={disabled || low > high ? p.x * 100 : low}
                    max={disabled || low > high ? p.x * 100 : high} step={1} suffix="%" onChange={x => onChange(movePoint(points, i, x / 100, p.y))} />
                    : <LookMessage>{t('editorLook.fixedInput', { label: input, value: formatNumber(p.x * 100, 0) })}</LookMessage>}
                <Stepper label={output} value={p.y * 100} min={disabled ? p.y * 100 : 0} max={disabled ? p.y * 100 : 100}
                    step={1} suffix="%" onChange={y => onChange(movePoint(points, i, p.x, y / 100))} />
                {interior ? <Action label={t('editorLook.removePoint', { n: i + 1 })} disabled={disabled} onPress={() => onChange(removePoint(points, i))} /> : null}
            </View>;
        })}
        <Action label={t('editorLook.addPoint')} disabled={disabled || points.length >= 8} onPress={() => onChange(addPoint(points))} />
        <Action label={t('editorLook.resetCurve', { channel: channelLabel })} disabled={disabled} onPress={() => onChange(colourDefaults().curves.master)} />
    </View>;
}
const styles = StyleSheet.create({
    stepper: { gap: ds.space.sm }, buttons: { flexDirection: 'row', gap: ds.space.sm },
    label: { ...type.body, color: colors.text }, button: { alignItems: 'center', justifyContent: 'center', borderRadius: ds.space.xs,
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    plot: { width: '100%', maxWidth: 220, alignSelf: 'center', borderColor: colors.border, borderWidth: 1, marginVertical: ds.space.md },
    line: { position: 'absolute', height: 1 }, hit: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
});
