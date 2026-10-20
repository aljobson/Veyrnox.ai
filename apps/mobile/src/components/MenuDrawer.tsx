import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../lib/a11y';
import { t } from '../lib/i18n';
import { MENU_SECTIONS } from '../lib/menu';
import { colors } from '../theme';
import { Logo } from './Logo';

const DRAWER_MAX = 320;

// The hamburger in the tab header. It opens a left drawer with the web app's grouped menu. Plain React Native (Modal and
// Animated), so it needs no native module and no rebuild.
export function MenuButton() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Pressable accessibilityRole="button" accessibilityLabel={t('menu.open')} style={styles.hit} onPress={() => setOpen(true)}>
                <View style={styles.bars}>
                    <View style={styles.bar} />
                    <View style={styles.bar} />
                    <View style={styles.bar} />
                </View>
            </Pressable>
            <MenuDrawer open={open} onClose={() => setOpen(false)} />
        </>
    );
}

function MenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const drawerWidth = Math.min(DRAWER_MAX, Math.round(width * 0.84));
    const slide = useRef(new Animated.Value(0)).current;
    const [closed, setClosed] = useState<Record<string, boolean>>({});
    const [mounted, setMounted] = useState(open);
    const [still, setStill] = useState(false);

    useEffect(() => {
        let alive = true;
        AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setStill(on)).catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (open) {
            setMounted(true);
            Animated.timing(slide, { toValue: 1, duration: still ? 0 : 220, useNativeDriver: true }).start();
        } else if (mounted) {
            Animated.timing(slide, { toValue: 0, duration: still ? 0 : 180, useNativeDriver: true }).start(() => setMounted(false));
        }
    }, [open, mounted, slide, still]);

    const go = (href: string) => {
        onClose();
        router.push(href as never);
    };

    return (
        <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.root}>
                <Animated.View style={[styles.scrim, { opacity: slide }]}>
                    <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={t('menu.close')} onPress={onClose} />
                </Animated.View>
                <Animated.View
                    accessibilityViewIsModal
                    style={[styles.drawer, { width: drawerWidth, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] }) }] }]}
                >
                    <SafeAreaView style={styles.flex} edges={['top', 'bottom', 'left']}>
                        <View style={styles.top}>
                            <Logo size={24} />
                            <Pressable accessibilityRole="button" accessibilityLabel={t('menu.close')} style={styles.hit} onPress={onClose}>
                                <Text style={styles.close} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>✕</Text>
                            </Pressable>
                        </View>
                        <ScrollView contentContainerStyle={styles.list}>
                            <Row label={t('menu.home')} onPress={() => go('/')} />
                            {MENU_SECTIONS.map((section) => {
                                const collapsed = closed[section.id] === true;
                                const name = t(section.label);
                                return (
                                    <View key={section.id}>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={t(collapsed ? 'menu.sectionClosed' : 'menu.sectionOpen', { name })}
                                            accessibilityState={{ expanded: !collapsed }}
                                            style={styles.heading}
                                            onPress={() => setClosed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                                        >
                                            <Text style={styles.headingText} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>
                                                {collapsed ? '▸' : '▾'}  {name.toUpperCase()}
                                            </Text>
                                        </Pressable>
                                        {collapsed ? null : section.items.map((item) => <Row key={item.key} label={t(item.label)} onPress={() => go(item.href)} />)}
                                    </View>
                                );
                            })}
                        </ScrollView>
                    </SafeAreaView>
                </Animated.View>
            </View>
        </Modal>
    );
}

function Row({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable accessibilityRole="link" accessibilityLabel={label} style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
            <Text style={styles.rowText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },
    flex: { flex: 1 },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
    drawer: { backgroundColor: colors.background, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4, minHeight: 56 },
    list: { paddingHorizontal: 8, paddingBottom: 24 },
    hit: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    bars: { gap: 4 },
    bar: { width: 20, height: 2, borderRadius: 1, backgroundColor: colors.text },
    close: { color: colors.muted, fontSize: 18 },
    heading: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 12, marginTop: 8 },
    headingText: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
    row: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12 },
    pressed: { backgroundColor: colors.surface },
    rowText: { color: colors.body, fontSize: 16, fontWeight: '600' },
});
