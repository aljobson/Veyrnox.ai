import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { EASE_OUT } from '../lib/motionCurves';
import { touchTarget } from '../lib/a11y';
import { rawText } from '../lib/i18n/translate';
import type { MenuIcon } from '../lib/menuIcons';
import { ds, featureHue, type FeatureHue } from '../theme';
import { Icon, Text, themedStyles, useThemedStyles } from './ui';
import { useReducedMotionResolved } from './ui/useReducedMotion';

interface Props {
    label: string;
    icon: MenuIcon;
    tone: FeatureHue;
    // 'tile' is a tall square for the picture-led grid; 'row' is a full-width line for text-heavy answers.
    layout: 'tile' | 'row';
    selected?: boolean;
    // A picture for the tile (a real template result); without one the tile shows the icon badge.
    imageUri?: string | null;
    // Position in the list, so the choices rise in one after another.
    index: number;
    onPress: () => void;
}

// One answer in a first-run question, a single-choice radio: an accent-tinted icon badge (or a template picture) and the
// label. It rises in on a short stagger, dips on press, and once chosen shows a filled accent border and a check mark, so
// the choice is not told by colour alone. Reduce Motion shows it at once, with no dip or pop.
export function OnboardingChoice({ label, icon, tone, layout, selected = false, imageUri, index, onPress }: Props) {
    const s = useThemedStyles(sheets);
    const motion = useReducedMotionResolved();
    // Until the system answers, hold the entrance rather than guess; once known, reduced means no movement.
    const reduced = motion !== false;
    const enter = useRef(new Animated.Value(0)).current;
    const press = useRef(new Animated.Value(1)).current;
    const pop = useRef(new Animated.Value(selected ? 1 : 0)).current;
    useEffect(() => {
        if (motion === null) return;
        // Reveal one row at a time. At most two cards move together, so the colour stays lively without visual noise.
        Animated.timing(enter, { toValue: 1, duration: reduced ? 0 : 180, delay: reduced ? 0 : Math.floor(index / 2) * 180, easing: EASE_OUT, useNativeDriver: true }).start();
    }, [enter, index, motion, reduced]);
    useEffect(() => {
        if (reduced) { pop.setValue(selected ? 1 : 0); return; }
        Animated.spring(pop, { toValue: selected ? 1 : 0, speed: 24, bounciness: 8, useNativeDriver: true }).start();
    }, [pop, reduced, selected]);
    const dip = (to: number) => { if (!reduced) Animated.spring(press, { toValue: to, speed: 40, bounciness: 0, useNativeDriver: true }).start(); };
    const lift = enter.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 14, 0] });
    // A picture that fails to load falls back to the icon badge.
    const [failed, setFailed] = useState(false);
    const photo = layout === 'tile' && !!imageUri && !failed;
    const quietSurface = { mint: s.mint, iris: s.iris, sky: s.sky, rose: s.rose, amber: s.amber }[tone];
    const vividSurface = { mint: s.mintVivid, iris: s.irisVivid, sky: s.skyVivid, rose: s.roseVivid, amber: s.amberVivid }[tone];
    const vividAccent = { mint: s.mintAccent, iris: s.irisAccent, sky: s.skyAccent, rose: s.roseAccent, amber: s.amberAccent }[tone];
    const quietInk = { mint: s.mintInk, iris: s.irisInk, sky: s.skyInk, rose: s.roseInk, amber: s.amberInk }[tone].color;
    const ink = layout === 'tile' ? s.vividInk.color : quietInk;
    return (
        <Animated.View style={[layout === 'tile' ? s.tileWrap : s.rowWrap, { opacity: enter, transform: [{ translateY: lift }, { scale: press }] }]}>
            <Pressable
                accessibilityRole="radio"
                accessibilityLabel={rawText(label)}
                accessibilityState={{ checked: selected }}
                onPress={onPress}
                onPressIn={() => dip(ds.motion.pressScale)}
                onPressOut={() => dip(1)}
                testID={`onboarding-choice-${layout}`}
                style={[touchTarget, layout === 'tile' ? s.tile : s.row, layout === 'tile' ? vividSurface : quietSurface, selected && s.on]}
            >
                {photo ? (
                    <>
                        <Image testID="onboarding-choice-photo" source={{ uri: imageUri }} style={s.photo} contentFit="cover" transition={reduced ? 0 : 200} onError={() => setFailed(true)} accessibilityIgnoresInvertColors accessible={false} />
                        <View style={s.scrim} />
                        <View testID="onboarding-choice-icon" style={[s.badge, { borderColor: ink }, s.badgeBig]}>
                            <Icon name={icon} size={36} tint={ink} />
                        </View>
                        <Text testID="onboarding-choice-label" variant="bodyStrong" style={s.photoLabel}>{label}</Text>
                    </>
                ) : (
                    <>
                        {layout === 'tile' ? <View pointerEvents="none" accessible={false} importantForAccessibility="no" style={[s.tileAccent, vividAccent]} /> : null}
                        <View testID="onboarding-choice-icon" style={[s.badge, { borderColor: ink }, layout === 'tile' && s.badgeBig]}>
                            <Icon name={icon} size={layout === 'tile' ? 36 : 24} tint={ink} />
                        </View>
                        <Text testID="onboarding-choice-label" variant="bodyStrong" tone="primary" style={layout === 'tile' ? s.tileLabel : s.rowLabel}>{label}</Text>
                    </>
                )}
                {/* The tick is a second cue beside the border colour. It pops in on choose and is gone when not chosen. */}
                <Animated.View pointerEvents="none" style={[s.tick, layout === 'tile' ? s.tickTile : s.tickRow, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
                    <Icon name="check" size={16} tint={s.tickIcon.color} />
                </Animated.View>
            </Pressable>
        </Animated.View>
    );
}

const sheets = themedStyles((p, _ramp, scheme) => ({
    tileWrap: { width: '48%' },
    rowWrap: { width: '100%' },
    tile: { minHeight: 160, overflow: 'hidden', borderRadius: ds.radius.lg, borderWidth: 2, borderColor: p.borderStrong, backgroundColor: p.bgElevated1, padding: ds.space.lg, justifyContent: 'space-between' },
    row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: ds.space.md, borderRadius: ds.radius.lg, borderWidth: 2, borderColor: p.borderStrong, backgroundColor: p.bgElevated1, paddingHorizontal: ds.space.lg, paddingVertical: ds.space.md },
    on: { borderWidth: 3, borderColor: p.textPrimary },
    badge: { width: 40, height: 40, borderRadius: ds.radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bgElevated2 },
    badgeBig: { width: 58, height: 58, alignSelf: 'flex-end', borderRadius: ds.radius.lg, borderColor: 'rgba(255,255,255,0.72)', backgroundColor: 'rgba(255,255,255,0.14)' },
    tileAccent: { position: 'absolute', width: 150, height: 150, borderRadius: 75, top: -76, left: -46 },
    tileLabel: { marginTop: 'auto', alignSelf: 'flex-start', color: p.onMedia },
    rowLabel: { flex: 1 },
    // Let the assigned card hue remain visible through a real template preview, preserving the colourful journey system.
    photo: { ...StyleSheet.absoluteFill, opacity: 0.38 },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.24)' },
    photoLabel: { color: p.onMedia, position: 'absolute', left: ds.space.md, right: ds.space.xxxl, bottom: ds.space.md },
    tick: { width: 24, height: 24, borderRadius: 12, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    tickTile: { position: 'absolute', top: ds.space.md, start: ds.space.md },
    tickRow: { marginStart: 'auto' },
    tickIcon: { color: p.onAccent },
    mint: { backgroundColor: featureHue('mint', scheme).wash, borderColor: featureHue('mint', scheme).edge },
    iris: { backgroundColor: featureHue('iris', scheme).wash, borderColor: featureHue('iris', scheme).edge },
    sky: { backgroundColor: featureHue('sky', scheme).wash, borderColor: featureHue('sky', scheme).edge },
    rose: { backgroundColor: featureHue('rose', scheme).wash, borderColor: featureHue('rose', scheme).edge },
    amber: { backgroundColor: featureHue('amber', scheme).wash, borderColor: featureHue('amber', scheme).edge },
    mintInk: { color: featureHue('mint', scheme).ink },
    irisInk: { color: featureHue('iris', scheme).ink },
    skyInk: { color: featureHue('sky', scheme).ink },
    roseInk: { color: featureHue('rose', scheme).ink },
    amberInk: { color: featureHue('amber', scheme).ink },
    // Onboarding gets its own richer palette. The values stay dark enough for white text/icons and change in OLED mode;
    // the translucent second tone provides depth without adding a gradient dependency.
    vividInk: { color: p.onMedia },
    mintVivid: { backgroundColor: scheme === 'dark' ? '#064E3B' : '#047857', borderColor: scheme === 'dark' ? '#34D399' : '#065F46' },
    irisVivid: { backgroundColor: scheme === 'dark' ? '#312E81' : '#5B21B6', borderColor: scheme === 'dark' ? '#A78BFA' : '#4C1D95' },
    skyVivid: { backgroundColor: scheme === 'dark' ? '#0C4A6E' : '#0369A1', borderColor: scheme === 'dark' ? '#38BDF8' : '#075985' },
    roseVivid: { backgroundColor: scheme === 'dark' ? '#831843' : '#BE185D', borderColor: scheme === 'dark' ? '#FB7185' : '#9D174D' },
    amberVivid: { backgroundColor: scheme === 'dark' ? '#78350F' : '#92400E', borderColor: scheme === 'dark' ? '#FBBF24' : '#78350F' },
    mintAccent: { backgroundColor: 'rgba(110,231,183,0.32)' },
    irisAccent: { backgroundColor: 'rgba(196,181,253,0.30)' },
    skyAccent: { backgroundColor: 'rgba(125,211,252,0.32)' },
    roseAccent: { backgroundColor: 'rgba(253,164,175,0.30)' },
    amberAccent: { backgroundColor: 'rgba(252,211,77,0.32)' },
}));
