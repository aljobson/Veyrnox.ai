import { useFaceFiltersAvailable } from '../lib/useFaceFiltersAvailable';
import { Button, ListRow, Text, Icon, themedStyles, useThemedStyles } from './ui';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { fetchProfile, type Profile } from '../lib/auth/accountCalls';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../lib/a11y';
import { t } from '../lib/i18n';
import { HOME_ICON, MENU_SECTIONS, activeItemKey } from '../lib/menu';
import { type MenuIcon } from '../lib/menuIcons';
import { type Palette } from '../theme';
import { Logo } from './Logo';

const DRAWER_MAX = 320;

// The hamburger in the tab header. It opens a left drawer shaped like the web app's sidebar: your account on top, then
// the grouped menu with an icon on every row and the current screen lit. Plain React Native (Modal and Animated) and
// image assets, so it needs no native module and no rebuild.
export function MenuButton({ palette }: { palette?: Palette }) {
    const styles = useThemedStyles(sheets);
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    useEffect(() => setOpen(false), [pathname]);
    return (
        <>
            <Button label={t('menu.open')} variant="tertiary" accessibilityRole="button" accessibilityLabel={t('menu.open')} style={styles.hit} onPress={() => setOpen(true)}>
                <View style={styles.bars}>
                    <View style={[styles.bar, { backgroundColor: palette?.text ?? styles.ink.color }]} />
                    <View style={[styles.bar, { backgroundColor: palette?.text ?? styles.ink.color }]} />
                    <View style={[styles.bar, { backgroundColor: palette?.text ?? styles.ink.color }]} />
                </View>
            </Button>
            <MenuDrawer open={open} onClose={() => setOpen(false)} />
        </>
    );
}

function MenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const styles = useThemedStyles(sheets);
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
    const faceAvailable = useFaceFiltersAvailable();
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
                        <Button label={t('menu.close')} variant="tertiary" accessibilityRole="button" accessibilityLabel={t('menu.close')} style={styles.hit} onPress={onClose}>
                            <Icon name="close" tint={styles.mutedInk.color} size={20} />
                        </Button>
                    </View>
                    <ListRow accessibilityRole="button" accessibilityLabel={who} accessibilityHint={t('menu.account')} style={styles.pill} title={<Text variant="bodyStrong" numberOfLines={1}>{who}</Text>} icon="user" onPress={() => go('/account')} />
                    <ScrollView contentContainerStyle={styles.list}>
                        <Row label={t('menu.home')} icon={HOME_ICON} active={active === 'home'} onPress={() => go('/')} />
                        {MENU_SECTIONS.map((section) => {
                            const collapsed = closed[section.id] === true;
                            const name = t(section.label);
                            return (
                                <View key={section.id}>
                                    <Button label={name} variant="tertiary"
                                        accessibilityRole="button"
                                        accessibilityLabel={t(collapsed ? 'menu.sectionClosed' : 'menu.sectionOpen', { name })}
                                        accessibilityState={{ expanded: !collapsed }}
                                        style={styles.heading}
                                        onPress={() => setClosed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                                    >
                                        <Icon name={collapsed ? 'caretRight' : 'caretDown'} tint={styles.mutedInk.color} size={16} />
                                        <Text variant="caption" style={styles.headingText} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE}>{name}</Text>
                                    </Button>
                                    {collapsed ? null : (
                                        <View style={section.id === 'tools' ? styles.grid : undefined}>
                                            {section.items.filter(item => item.href !== '/face-filters' || faceAvailable).map((item) => (
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
    const styles = useThemedStyles(sheets);
    return (
        <Button label={label} variant="tertiary"
            accessibilityRole="link"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            containerStyle={half ? styles.half : undefined} style={[styles.row, active && styles.rowActive]}
            onPress={onPress}
        >
            <Icon name={icon} tint={active ? styles.accentInk.color : styles.mutedInk.color} />
            <Text variant="bodyStrong" style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>{label}</Text>
        </Button>
    );
}

const sheets = themedStyles((p) => ({
    mutedInk: { color: p.textSecondary },
    accentInk: { color: p.accent },
    ink: { color: p.textPrimary },
    root: { flex: 1, flexDirection: 'row' },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: p.scrim },
    drawer: { backgroundColor: p.bg, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: p.borderSubtle },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 4, minHeight: 52 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 12, marginTop: 8, marginBottom: 4, minHeight: 56, paddingVertical: 8, paddingLeft: 10, paddingRight: 14, borderRadius: 999, backgroundColor: p.surface, borderColor: p.borderSubtle, borderWidth: 1 },
    list: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 24 },
    hit: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    bars: { gap: 4 },
    bar: { width: 20, height: 2, borderRadius: 1 },
    heading: { justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TARGET, paddingHorizontal: 12, marginTop: 8 },
    headingText: { color: p.textSecondary },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    row: { justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TARGET, paddingHorizontal: 12, borderRadius: 14 },
    half: { width: '50%' },
    rowActive: { backgroundColor: p.accentSubtle },
    rowText: { flexShrink: 1, color: p.textSecondary },
    rowTextActive: { color: p.accent },
}));
