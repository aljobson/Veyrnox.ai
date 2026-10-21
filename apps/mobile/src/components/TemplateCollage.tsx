import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewProps } from 'react-native';
import { t } from '../lib/i18n';
import { presetPrice, type Preset } from '../lib/presets';
import { BAND_HEIGHT, STEP, TILE_CURVE, centredIndex, offsetsFor, stackOrder, tileShape } from '../lib/templateCollage';
import { colors } from '../theme';

type Props = {
    presets: readonly Preset[];
    isTall: (p: Preset) => boolean;
    onOpen: (p: Preset) => void;
};

// The Explore templates as a collage: overlapping tiles of mixed sizes in one row you swipe. The tile in the middle is
// full size and facing you; the ones either side shrink, fade and turn away, like a rolodex. Reduce Motion keeps the
// collage and the swipe but drops the turning and scaling.
export function TemplateCollage({ presets, isTall, onOpen }: Props) {
    const { width: screenWidth } = useWindowDimensions();
    // The row's own width, so the middle is the middle of the row wherever the page puts it.
    const [rowWidth, setRowWidth] = useState(0);
    const width = rowWidth || screenWidth;
    const scrollX = useRef(new Animated.Value(0)).current;
    const [centred, setCentred] = useState(0);
    const [still, setStill] = useState(false);
    const pad = Math.max(0, (width - STEP) / 2);

    useEffect(() => {
        let alive = true;
        AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setStill(on)).catch(() => {});
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
        return () => {
            alive = false;
            sub.remove();
        };
    }, []);

    const onScroll = useMemo(
        () =>
            Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
                useNativeDriver: true,
                listener: (e: unknown) => {
                    const x = (e as { nativeEvent?: { contentOffset?: { x?: number } } }).nativeEvent?.contentOffset?.x ?? 0;
                    setCentred((prev) => {
                        const next = centredIndex(x, presets.length);
                        return next === prev ? prev : next;
                    });
                },
            }),
        [scrollX, presets.length],
    );

    // The centred tile has to draw on top of its neighbours, so each cell takes its stacking order from the centre.
    const Cell = useCallback(
        ({ index, style, ...rest }: ViewProps & { index: number }) => <View {...rest} style={[style, { zIndex: stackOrder(index, centred) }]} />,
        [centred],
    );

    return (
        <View style={styles.bleed} onLayout={(e) => setRowWidth(Math.round(e.nativeEvent.layout.width))}>
            <Animated.FlatList
                data={presets as Preset[]}
                keyExtractor={(p) => p.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={STEP}
                snapToAlignment="start"
                contentInsetAdjustmentBehavior="never"
                automaticallyAdjustContentInsets={false}
                contentInset={{ left: 0, right: 0, top: 0, bottom: 0 }}
                contentOffset={{ x: 0, y: 0 }}
                bounces={false}
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={onScroll}
                initialNumToRender={9}
                windowSize={9}
                style={styles.band}
                CellRendererComponent={Cell}
                ListHeaderComponent={<View style={{ width: pad }} />}
                ListFooterComponent={<View style={{ width: pad }} />}
                accessibilityLabel={t('explore.templates')}
                renderItem={({ item, index }) => <Tile preset={item} index={index} tall={isTall(item)} scrollX={scrollX} still={still} onOpen={onOpen} />}
            />
            <Text style={styles.hint}>{t('explore.collageHint')}</Text>
        </View>
    );
}

function Tile({ preset, index, tall, scrollX, still, onOpen }: { preset: Preset; index: number; tall: boolean; scrollX: Animated.Value; still: boolean; onOpen: (p: Preset) => void }) {
    const shape = tileShape(index, tall);
    const at = offsetsFor(index);
    const curve = (output: readonly number[]) => scrollX.interpolate({ inputRange: at, outputRange: [...output], extrapolate: 'clamp' });
    const turn = scrollX.interpolate({ inputRange: at, outputRange: TILE_CURVE.turnDeg.map((d) => `${d}deg`), extrapolate: 'clamp' });
    const motion = still
        ? { opacity: 1 }
        : {
              opacity: curve(TILE_CURVE.opacity),
              transform: [{ perspective: 700 }, { translateY: curve(TILE_CURVE.lift) }, { rotateY: turn }, { scale: curve(TILE_CURVE.scale) }],
          };
    const label = `${preset.title}, ${preset.modelName}, ${presetPrice(preset)}${preset.isNew ? `, ${t('explore.new')}` : ''}`;
    return (
        <View style={styles.slot}>
            <Animated.View style={[styles.tile, { width: shape.width, height: shape.height, top: shape.top, left: (STEP - shape.width) / 2 }, motion]}>
                <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.press} onPress={() => onOpen(preset)}>
                    {preset.posterUrl ? <Image source={{ uri: preset.posterUrl }} style={styles.poster} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={styles.poster} />}
                    {preset.isNew ? (
                        <View style={styles.badge}>
                            <Text style={styles.badgeText}>{t('explore.new')}</Text>
                        </View>
                    ) : null}
                    <View style={styles.info}>
                        <Text style={styles.tileName} numberOfLines={1}>{preset.title}</Text>
                        <Text style={styles.model} numberOfLines={1}>{preset.modelName}</Text>
                        <Text style={styles.price}>{presetPrice(preset)}</Text>
                    </View>
                </Pressable>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    // The page pads its content by 16 on each side; the collage runs edge to edge.
    bleed: { marginHorizontal: -16 },
    band: { height: BAND_HEIGHT, overflow: 'visible' },
    slot: { width: STEP, height: BAND_HEIGHT },
    tile: {
        position: 'absolute',
        borderRadius: 16,
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
    },
    press: { flex: 1, borderRadius: 15, overflow: 'hidden' },
    poster: { flex: 1, backgroundColor: colors.border },
    badge: { position: 'absolute', top: 8, left: 8, backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    badgeText: { color: colors.accentInk, fontSize: 11, fontWeight: '700' },
    info: { padding: 10, gap: 2, backgroundColor: colors.surface },
    tileName: { color: colors.text, fontWeight: '600', fontSize: 14 },
    model: { color: colors.muted, fontSize: 12 },
    price: { color: colors.money, fontSize: 12 },
    hint: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 4 },
});
