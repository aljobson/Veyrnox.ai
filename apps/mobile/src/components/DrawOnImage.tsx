import { Canvas, Picture, Skia, type SkImage, type SkPicture } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MIN_TARGET, selectedState, touchTarget } from '../lib/a11y';
import { subscribeCacheUser } from '../lib/appCache';
import { MAX_IMAGE_EDGE, type ImageResizer } from '../lib/chatAttach';
import { createResizer } from '../lib/chatResizer';
import { deleteDrawFile, writeDrawing } from '../lib/drawFiles';
import { DRAW_COLORS, POINT_LIMIT, drawReducer, exportSize, fitRect, pointCount, strokeWidthPx, toImagePoint, type Box, type BoxAction, type DrawAction, type DrawOp, type Point } from '../lib/drawOnImage';
import { drawOps, exportDrawing } from '../lib/drawRender';
import { t } from '../lib/i18n';
import type { PickedFile } from '../lib/sources';
import { colors } from '../theme';

export interface DrawOnImageProps {
    readonly uri: string;
    readonly maxPixels?: number;
    readonly onCancel: () => void;
    readonly onDone: (file: PickedFile) => void;
    readonly resizer?: ImageResizer;
}
const defaultResizer = createResizer();
const sizes = { small: 4, medium: 8, large: 16 } as const;
const moves = ['moveLeft', 'moveRight', 'moveUp', 'moveDown'] as const;
function deletePrepared(uri: string) {
    const file = new File(uri);
    if (file.exists) file.delete();
}

export function DrawOnImage({ uri, maxPixels, onCancel, onDone, resizer = defaultResizer }: DrawOnImageProps) {
    const token = useRef(0);
    const working = useRef<SkImage | null>(null);
    const recorded = useRef<SkPicture | null>(null);
    const shown = useRef<SkPicture | null>(null);
    const prepared = useRef<string | null>(null);
    const [image, setImage] = useState<SkImage | null>(null);
    const [picture, setPicture] = useState<SkPicture | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const saving = useRef(false);
    const [reduceMotion, setReduceMotion] = useState(true);
    const [tool, setTool] = useState<'pen' | 'box' | 'erase'>('pen');
    const [color, setColor] = useState<string>(DRAW_COLORS.yellow);
    const [size, setSize] = useState(8);
    const [ops, setOps] = useState<readonly DrawOp[]>([]);
    const currentOps = useRef<readonly DrawOp[]>([]);
    const [draft, setDraft] = useState<Box | null>(null);
    const gesture = useRef<{ start: Point; box: Box | null; drawing: boolean } | null>(null);
    const [view, setView] = useState({ width: 0, height: 0 });
    const [notice, setNotice] = useState<string | null>(null);
    const limitAnnounced = useRef(false);
    const dimensions = image ? { width: image.width(), height: image.height() } : { width: 1, height: 1 };
    const fit = fitRect(view, dimensions);

    function announce(message: string) {
        setNotice(message);
        if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
    }
    function update(action: DrawAction) {
        const next = drawReducer(currentOps.current, action);
        currentOps.current = next;
        setOps(next);
        if (pointCount(next) >= POINT_LIMIT && !limitAnnounced.current) {
            limitAnnounced.current = true;
            announce(t('draw.limit'));
        }
    }
    function invalidate() {
        token.current++;
        if (prepared.current) { deletePrepared(prepared.current); prepared.current = null; }
        gesture.current = null;
    }
    function cancel() { invalidate(); onCancel(); }

    useEffect(() => {
        let live = true;
        void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduceMotion(value); }).catch(() => {});
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
        return () => { live = false; subscription.remove(); };
    }, []);
    useEffect(() => {
        const operation = ++token.current;
        const stale = () => operation !== token.current;
        void (async () => {
            let decoded: SkImage | null = null;
            let preparedUri: string | null = null;
            try {
                const result = await resizer.prepare({ uri, width: 0, height: 0 }, MAX_IMAGE_EDGE);
                if (stale()) { deletePrepared(result.uri); return; }
                preparedUri = result.uri;
                prepared.current = result.uri;
                const data = await Skia.Data.fromURI(result.uri);
                try {
                    if (stale()) return;
                    decoded = Skia.Image.MakeImageFromEncoded(data);
                } finally { data.dispose(); }
                if (!decoded) throw new Error('draw_open_failed');
                const target = exportSize(decoded.width(), decoded.height(), maxPixels);
                if (target.width !== decoded.width() || target.height !== decoded.height()) {
                    const surface = Skia.Surface.Make(target.width, target.height);
                    if (!surface) throw new Error('draw_open_failed');
                    try {
                        const canvas = surface.getCanvas();
                        canvas.scale(target.width / decoded.width(), target.height / decoded.height());
                        canvas.drawImage(decoded, 0, 0);
                        surface.flush();
                        const scaled = surface.makeImageSnapshot();
                        decoded.dispose();
                        decoded = scaled;
                    } finally { surface.dispose(); }
                }
                if (stale()) return;
                working.current = decoded;
                setImage(decoded);
                decoded = null; // ownership transferred to the screen
            } catch {
                if (!stale()) setFailed(true);
            } finally {
                decoded?.dispose();
                if (preparedUri) {
                    deletePrepared(preparedUri);
                    if (prepared.current === preparedUri) prepared.current = null;
                }
            }
        })();
        const unsubscribe = subscribeCacheUser(() => { invalidate(); onCancel(); });
        return () => {
            unsubscribe();
            invalidate();
            working.current?.dispose(); working.current = null;
        };
        // Each editor instance owns one source and one operation lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uri, maxPixels, resizer]);

    useEffect(() => {
        if (!image || !view.width || !view.height) return;
        const recorder = Skia.PictureRecorder();
        let next: SkPicture;
        try {
            const canvas = recorder.beginRecording({ x: 0, y: 0, width: view.width, height: view.height });
            canvas.translate(fit.x, fit.y);
            drawOps(Skia, canvas, image, draft ? [...ops, draft] : ops, fit.scale);
            next = recorder.finishRecordingAsPicture();
        } finally { recorder.dispose(); }
        recorded.current = next;
        setPicture(next);
    }, [image, ops, draft, view.width, view.height, fit.x, fit.y, fit.scale]);
    // Free the previous picture only once <Picture> has committed its replacement.
    useEffect(() => {
        const previous = shown.current;
        shown.current = picture;
        if (previous && previous !== picture) previous.dispose();
    }, [picture]);
    useEffect(() => () => {
        const onScreen = shown.current, last = recorded.current;
        onScreen?.dispose();
        if (last && last !== onScreen) last.dispose();
        shown.current = null; recorded.current = null;
    }, []);

    const point = (event: GestureResponderEvent) => toImagePoint({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, fit);
    const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => !!image && !saving.current && fit.scale > 0,
        onMoveShouldSetPanResponder: () => !!image && !saving.current && fit.scale > 0,
        onPanResponderGrant: event => {
            if (!image || saving.current || fit.scale <= 0) return;
            const start = point(event);
            const width = strokeWidthPx(size, fit.scale);
            if (tool === 'box') {
                if (pointCount(currentOps.current) + 2 > POINT_LIMIT) return;
                const box: Box = { kind: 'box', ...start, width: 0, height: 0, color, strokeWidth: width };
                gesture.current = { start, box, drawing: false };
                setDraft(box);
            } else {
                const before = currentOps.current;
                update({ type: 'addStroke', stroke: { kind: tool, points: [start], color, width } });
                gesture.current = { start, box: null, drawing: before !== currentOps.current };
            }
        },
        onPanResponderMove: event => {
            const active = gesture.current;
            if (!active || saving.current) return;
            const end = point(event);
            if (active.box) {
                active.box = { ...active.box, x: Math.min(active.start.x, end.x), y: Math.min(active.start.y, end.y), width: Math.abs(end.x - active.start.x), height: Math.abs(end.y - active.start.y) };
                setDraft(active.box);
            } else if (active.drawing) update({ type: 'extendStroke', point: end });
        },
        onPanResponderRelease: () => {
            const drawn = gesture.current?.box;
            const minimum = strokeWidthPx(1, fit.scale); // one display point in image pixels
            if (drawn && drawn.width >= minimum && drawn.height >= minimum) update({ type: 'addBox', box: drawn });
            gesture.current = null; setDraft(null);
        },
        onPanResponderTerminate: () => { gesture.current = null; setDraft(null); },
    });

    async function useDrawing() {
        if (!working.current || !currentOps.current.length || saving.current) return;
        const operation = token.current;
        saving.current = true; setBusy(true); setNotice(null);
        try {
            const bytes = await exportDrawing(Skia, working.current, currentOps.current);
            if (operation !== token.current) return;
            const file = await writeDrawing(bytes);
            if (operation !== token.current) { deleteDrawFile(file.uri); return; }
            onDone(file);
        } catch {
            if (operation === token.current) announce(t('draw.exportFailed'));
        } finally {
            if (operation === token.current) { saving.current = false; setBusy(false); }
        }
    }
    const newest = ops.findLastIndex(op => op.kind === 'box');
    const box = newest >= 0 ? ops[newest] as Box : null;
    const button = (label: string, onPress: () => void, disabled = false, selected?: boolean) => (
        <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(selected === undefined ? {} : selectedState(selected)) }} disabled={disabled} onPress={onPress} style={[styles.button, selected && styles.selected, disabled && styles.disabled]}>
            <Text style={styles.text}>{label}</Text>
        </Pressable>
    );
    return (
        <Modal visible presentationStyle="fullScreen" animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={cancel}>
            <SafeAreaView style={styles.screen}>
                <Text accessibilityRole="header" style={styles.title}>{t('draw.title')}</Text>
                {failed ? <><Text style={styles.text}>{t('draw.openFailed')}</Text>{button(t('chat.make.close'), cancel)}</> : <>
                    {!image ? <Text style={styles.text}>{t('draw.preparing')}</Text> : null}
                    <View style={styles.canvas} onLayout={event => setView(event.nativeEvent.layout)} {...responder.panHandlers}>
                        {picture ? <Canvas style={StyleSheet.absoluteFill} pointerEvents="none"><Picture picture={picture} /></Canvas> : null}
                    </View>
                    <ScrollView style={styles.tools} contentContainerStyle={styles.controls}>
                        <Text style={styles.text}>{t('draw.help')}</Text>
                        <View style={styles.row}>{(['pen', 'box', 'erase'] as const).map(value => button(t(`draw.tool.${value}`), () => setTool(value), !image || busy, tool === value))}</View>
                        <View style={styles.row}>{(Object.keys(DRAW_COLORS) as (keyof typeof DRAW_COLORS)[]).map(name => button(t(`draw.color.${name}`), () => setColor(DRAW_COLORS[name]), !image || busy, color === DRAW_COLORS[name]))}</View>
                        <View style={styles.row}>{(Object.keys(sizes) as (keyof typeof sizes)[]).map(name => button(t(`draw.size.${name}`), () => setSize(sizes[name]), !image || busy, size === sizes[name]))}</View>
                        <View style={styles.row}>
                            {button(t('draw.undo'), () => update({ type: 'undo' }), !ops.length || busy)}
                            {button(t('draw.clear'), () => update({ type: 'clear' }), !ops.length || busy)}
                            {button(t('draw.addBox'), () => update({ type: 'addBox', box: { kind: 'box', x: dimensions.width / 4, y: dimensions.height / 4, width: dimensions.width / 2, height: dimensions.height / 2, color, strokeWidth: strokeWidthPx(size, fit.scale || 1) } }), !image || busy || pointCount(ops) + 2 > POINT_LIMIT)}
                        </View>
                        {box ? <View accessible accessibilityRole="adjustable" accessibilityLabel={t('draw.box')} accessibilityState={{ disabled: busy }}
                            accessibilityValue={{ text: t('draw.boxValue', { x: String(Math.round(box.x / dimensions.width * 100)), y: String(Math.round(box.y / dimensions.height * 100)), width: String(Math.round(box.width / dimensions.width * 100)), height: String(Math.round(box.height / dimensions.height * 100)) }) }}
                            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, ...moves.map(name => ({ name, label: t(`draw.${name}`) }))]}
                            onAccessibilityAction={event => { if (!busy) update({ type: 'adjustBox', index: newest, action: event.nativeEvent.actionName as BoxAction, image: dimensions }); }} style={styles.button}>
                            <Text style={styles.text}>{t('draw.box')}</Text>
                        </View> : null}
                        <View accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}>{notice ? <Text style={styles.text}>{notice}</Text> : null}</View>
                    </ScrollView>
                    <View style={styles.row}>{button(t('draw.cancel'), cancel)}{button(t('draw.use'), useDrawing, !image || !ops.length || busy)}</View>
                </>}
            </SafeAreaView>
        </Modal>
    );
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 12, gap: 8 },
    title: { color: colors.text, fontSize: 22, fontWeight: '700' },
    text: { color: colors.text },
    canvas: { flex: 1, minHeight: 120 },
    tools: { maxHeight: 340, flexGrow: 0 },
    controls: { gap: 8 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    button: { ...touchTarget, minWidth: MIN_TARGET, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    selected: { borderColor: colors.accent, backgroundColor: colors.surface },
    disabled: { opacity: 0.4 },
});
