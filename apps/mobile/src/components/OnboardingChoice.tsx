import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { EASE_OUT } from '../lib/motionCurves';
import { touchTarget } from '../lib/a11y';
import { rawText } from '../lib/i18n/translate';
import type { MenuIcon } from '../lib/menuIcons';
import { ds } from '../theme';
import { Icon, Text, themedStyles, useThemedStyles } from './ui';
import { useReducedMotionResolved } from './ui/useReducedMotion';

interface Props {
    label: string;
    icon: MenuIcon;
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
export function OnboardingChoice({ label, icon, layout, selected = false, imageUri, index, onPress }: Props) {
    const s = useThemedStyles(sheets);
    const motion = useReducedMotionResolved();
    // Until the system answers, hold the entrance rather than guess; once known, reduced means no movement.
    const reduced = motion !== false;
    const enter = useRef(new Animated.Value(0)).current;
    const press = useRef(new Animated.Value(1)).current;
    const pop = useRef(new Animated.Value(selected ? 1 : 0)).current;
    useEffect(() => {
        if (motion === null) return;
        Animated.timing(enter, { toValue: 1, duration: reduced ? 0 : ds.motion.enter, delay: reduced ? 0 : index * 55, easing: EASE_OUT, useNativeDriver: true }).start();
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
    return (
        <Animated.View style={[layout === 'tile' ? s.tileWrap : s.rowWrap, { opacity: enter, transform: [{ translateY: lift }, { scale: press }] }]}>
            <Pressable
                accessibilityRole="radio"
                accessibilityLabel={rawText(label)}
                accessibilityState={{ checked: selected }}
                onPress={onPress}
                onPressIn={() => dip(ds.motion.pressScale)}
                onPressOut={() => dip(1)}
                style={[touchTarget, layout === 'tile' ? s.tile : s.row, selected && s.on]}
            >
                {photo ? (
                    <>
                        <Image source={{ uri: imageUri }} style={s.photo} contentFit="cover" transition={reduced ? 0 : 200} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
                        <View style={s.scrim} />
                        <Text variant="bodyStrong" style={s.photoLabel}>{label}</Text>
                    </>
                ) : (
                    <>
                        <View style={[s.badge, layout === 'tile' && s.badgeBig]}>
                            <Icon name={icon} size={layout === 'tile' ? 28 : 24} />
                        </View>
                        <Text variant="bodyStrong" tone="primary" style={layout === 'tile' ? s.tileLabel : s.rowLabel}>{label}</Text>
                    </>
                )}
                {/* The tick is a second cue beside the border colour. It pops in on choose and is gone when not chosen. */}
                <Animated.View pointerEvents="none" style={[s.tick, layout === 'tile' ? s.tickTile : s.tickRow, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
                    <Icon name="check" size={16} tint="#ffffff" />
                </Animated.View>
            </Pressable>
        </Animated.View>
    );
}

const sheets = themedStyles((p) => ({
    tileWrap: { width: '48%' },
    rowWrap: { width: '100%' },
    tile: { minHeight: 132, overflow: 'hidden', borderRadius: ds.radius.lg, borderWidth: 2, borderColor: p.borderStrong, backgroundColor: p.bgElevated1, padding: ds.space.lg, justifyContent: 'space-between' },
    row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: ds.space.md, borderRadius: ds.radius.lg, borderWidth: 2, borderColor: p.borderStrong, backgroundColor: p.bgElevated1, paddingHorizontal: ds.space.lg, paddingVertical: ds.space.md },
    on: { borderColor: p.accent, backgroundColor: p.accentSubtle },
    badge: { width: 40, height: 40, borderRadius: ds.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accentSubtle },
    badgeBig: { width: 52, height: 52, borderRadius: ds.radius.lg },
    tileLabel: {},
    rowLabel: { flex: 1 },
    photo: { ...StyleSheet.absoluteFill },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.38)' },
    photoLabel: { color: '#ffffff', position: 'absolute', left: ds.space.md, right: ds.space.xxxl, bottom: ds.space.md },
    tick: { width: 24, height: 24, borderRadius: 12, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    tickTile: { position: 'absolute', top: ds.space.md, right: ds.space.md },
    tickRow: { marginLeft: 'auto' },
}));
