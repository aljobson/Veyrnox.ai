import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { fetchProfile, type Profile } from '../lib/auth/accountCalls';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../lib/a11y';
import { t } from '../lib/i18n';
import { HOME_ICON, MENU_SECTIONS, activeItemKey } from '../lib/menu';
import { MENU_ICONS, type MenuIcon } from '../lib/menuIcons';
import { colors, type Palette } from '../theme';
import { Logo } from './Logo';

const DRAWER_MAX = 320;

// The hamburger in the tab header. It opens a left drawer shaped like the web app's sidebar: your account on top, then
// the grouped menu with an icon on every row and the current screen lit. Plain React Native (Modal and Animated) and
// image assets, so it needs no native module and no rebuild.
export function MenuButton({ palette = colors }: { palette?: Palette }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Pressable accessibilityRole="button" accessibilityLabel={t('menu.open')} style={styles.hit} onPress={() => setOpen(true)}>
                <View style={styles.bars}>
                    <View style={[styles.bar, { backgroundColor: palette.text }]} />
                    <View style={[styles.bar, { backgroundColor: palette.text }]} />
                    <View style={[styles.bar, { backgroundColor: palette.text }]} />
                </View>
            </Pressable>
            <MenuDrawer open={open} onClose={() => setOpen(false)} />
        </>
    );
}

function Icon({ name, color, size = 22 }: { name: MenuIcon; color: string; size?: number }) {
    return <Image source={MENU_ICONS[name]} style={{ width: size, height: size }} tintColor={color} contentFit="contain" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

function MenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const { getAccessToken } = useAuth();
    const { width } = useWindowDimensions();
    const drawerWidth = Math.min(DRAWER_MAX, Math.round(width * 0.84));
    const slide = useRef(new Animated.Value(0)).current;
    const [closed, setClosed] = useState<Record<string, boolean>>({});
    const [mounted, setMounted] = useState(open);
    const [still, setStill] = useState(false);
    const [profile, setProfile] = useState<Profile | null>(null);
    const active = activeItemKey(pathname);

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

    // Your name on the account pill; it is read when the drawer opens and falls back to "Account" until it arrives.
    useEffect(() => {
        if (!open || profile) return;
        let live = true;
        fetchProfile(getAccessToken, 'menu-drawer').then((p) => live && setProfile(p), () => undefined);
        return () => {
            live = false;
        };
    }, [open, profile, getAccessToken]);

    const go = (href: string) => {
        onClose();
        router.push(href as never);
    };

    const who = profile?.email ?? t('menu.account');

    return (
        <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.root}>
                <Animated.View style={[styles.scrim, { opacity: slide }]}>
                    <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={t('menu.close')} onPress={onClose} />
                </Animated.View>
                <Animated.View
                    accessibilityViewIsModal
                    style={[
                        styles.drawer,
                        { width: drawerWidth, paddingTop: insets.top + 8, paddingBottom: insets.bottom, paddingLeft: insets.left, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] }) }] },
                    ]}
                >
                    <View style={styles.top}>
                        <Logo size={24} />
                        <Pressable accessibilityRole="button" accessibilityLabel={t('menu.close')} style={styles.hit} onPress={onClose}>
                            <Icon name="close" color={colors.muted} size={20} />
                        </Pressable>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={who} accessibilityHint={t('menu.account')} style={({ pressed }) => [styles.pill, pressed && styles.pressed]} onPress={() => go('/account')}>
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText} maxFontSizeMultiplier={1.2}>{who.charAt(0).toUpperCase()}</Text>
                        </View>
                        <Text style={styles.pillText} numberOfLines={1}>{who}</Text>
                        <Icon name="caretRight" color={colors.muted} size={16} />
                    </Pressable>
                    <ScrollView contentContainerStyle={styles.list}>
                        <Row label={t('menu.home')} icon={HOME_ICON} active={active === 'home'} onPress={() => go('/')} />
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
                                        <Icon name={collapsed ? 'caretRight' : 'caretDown'} color={colors.muted} size={12} />
                                        <Text style={styles.headingText} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>{name.toUpperCase()}</Text>
                                    </Pressable>
                                    {collapsed ? null : (
                                        <View style={section.id === 'tools' ? styles.grid : undefined}>
                                            {section.items.map((item) => (
                                                <Row key={item.key} label={t(item.label)} icon={item.icon} active={active === item.key} half={section.id === 'tools'} onPress={() => go(item.href)} />
                                            ))}
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
}

function Row({ label, icon, active, half, onPress }: { label: string; icon: MenuIcon; active: boolean; half?: boolean; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="link"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.row, half && styles.half, active && styles.rowActive, pressed && !active && styles.pressed]}
            onPress={onPress}
        >
            <Icon name={icon} color={active ? colors.accent : colors.muted} />
            <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
    drawer: { backgroundColor: colors.background, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4, minHeight: 52 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 12, marginTop: 8, marginBottom: 4, minHeight: 56, paddingVertical: 8, paddingLeft: 10, paddingRight: 14, borderRadius: 999, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
    pillText: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600' },
    list: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 24 },
    hit: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    bars: { gap: 4 },
    bar: { width: 20, height: 2, borderRadius: 1 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TARGET, paddingHorizontal: 12, marginTop: 8 },
    headingText: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TARGET, paddingHorizontal: 12, borderRadius: 14 },
    half: { width: '50%' },
    rowActive: { backgroundColor: colors.accentSoft },
    pressed: { backgroundColor: colors.surface },
    rowText: { flexShrink: 1, color: colors.body, fontSize: 16, fontWeight: '600' },
    rowTextActive: { color: colors.accent },
});
