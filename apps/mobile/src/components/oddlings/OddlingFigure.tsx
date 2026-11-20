import { Canvas, ImageSVG, Skia, type SkSVG } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../../lib/i18n';
import { FIGURE_BACKGROUND, svgForPicks } from '../../lib/oddlingsFigure';
import type { Picks } from '../../lib/oddlingsBuilder';

interface Props { picks: Picks; focus?: string; height?: number }

export function OddlingFigure({ picks, focus = 'body', height = 280 }: Props) {
    const [width, setWidth] = useState(0);
    const [drawing, setDrawing] = useState<{ svg: SkSVG | null; picks: Picks; focus: string } | null>(null);
    useEffect(() => {
        let svg: SkSVG | null = null;
        try { svg = Skia.SVG.MakeFromString(svgForPicks(picks, focus)); }
        catch { /* Keep the background when parsing fails. */ }
        setDrawing({ svg, picks, focus });
        return () => { svg?.dispose(); };
    }, [picks, focus]);
    const svg = drawing?.picks === picks && drawing.focus === focus ? drawing.svg : null;
    return (
        <View style={[styles.box, { height }]} onLayout={event => setWidth(event.nativeEvent.layout.width)}
            accessible accessibilityRole="image" accessibilityLabel={t('oddlings.figure.label')}
            importantForAccessibility="yes" pointerEvents="none">
            <Canvas style={StyleSheet.absoluteFill}>
                {svg && width > 0 ? <ImageSVG svg={svg} x={0} y={0} width={width} height={height} /> : null}
            </Canvas>
        </View>
    );
}
const styles = StyleSheet.create({
    box: { borderRadius: 16, overflow: 'hidden', backgroundColor: FIGURE_BACKGROUND },
});
