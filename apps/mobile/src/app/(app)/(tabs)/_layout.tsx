import { Tabs } from 'expo-router';
import { StyleSheet, useWindowDimensions, View, type ColorValue } from 'react-native';
import { useMenuOpen } from '../../../lib/menuOpen';
import { HeaderRight } from '../../../components/HeaderChips';
import { Logo } from '../../../components/Logo';
import { MenuButton } from '../../../components/MenuDrawer';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { type MenuIcon } from '../../../lib/menuIcons';
import { paletteForScheme, vividHue, type VividHue } from '../../../theme';
import { Text, Icon, useAppearance } from '../../../components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabHeaderShowsWordmark } from '../../../lib/headerLayout';

// The tab bar has a fixed height, so its labels stop growing at the same limit as the header; everything else follows the system text size.
function tabLabel(key: string) {
    return function TabLabel({ color }: { color: ColorValue }) {
        return (
            <Text variant="caption" style={{ color }} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} numberOfLines={1}>
                {t(key)}
            </Text>
        );
    };
}

// One icon per tab, tinted by the tab bar (accent when selected, muted otherwise); the label stays for screen readers.
function tabIcon(name: MenuIcon) {
    return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
        return <Icon name={focused && name === 'house' ? 'houseFill' : focused && name === 'sparkle' ? 'sparkleFill' : name} size={24} tint={color} />;
    };
}

// Five bottom tabs. Editor is a top-level destination at the stable /editor route; Cinema remains available from the main menu without
// crowding the bar with a sixth item. The (tabs) folder is a group, so each tab keeps its short public URL.
const TAB_HUES: Record<string, VividHue> = { index: 'blue', create: 'purple', editor: 'orange', library: 'green', publish: 'pink' };

export default function TabsLayout() {
    const { settings, scheme } = useAppearance();
    const palette = paletteForScheme(scheme, settings);
    const insets = useSafeAreaInsets();
    const { width, fontScale } = useWindowDimensions();
    // While the side menu is open the screens behind it are hidden from screen readers (QA-A1).
    const menuOpen = useMenuOpen();
    return (
        <View style={styles.fill} importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={menuOpen}>
        <Tabs
            screenOptions={({ route }) => {
                const tabTone = vividHue(TAB_HUES[route.name] ?? 'teal', scheme);
                return {
                    headerStyle: { backgroundColor: palette.background },
                    headerTintColor: palette.text,
                    // The action group is much wider than the menu button. Leading alignment keeps the complete
                    // VEYRNOX.ai wordmark clear of credits, theme and account on compact phones.
                    headerTitleAlign: 'left',
                    headerTitle: () => <Logo size={20} wordmark={tabHeaderShowsWordmark(width, fontScale)} palette={palette} />,
                    headerLeft: () => <MenuButton palette={palette} />,
                    headerRight: () => <HeaderRight palette={palette} />,
                    sceneStyle: { backgroundColor: palette.background, paddingLeft: insets.left, paddingRight: insets.right },
                    tabBarStyle: { backgroundColor: palette.background, borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth },
                    tabBarActiveTintColor: scheme === 'dark' ? tabTone.glow : tabTone.fill,
                    tabBarInactiveTintColor: palette.muted,
                    tabBarItemStyle: { minHeight: MIN_TARGET, justifyContent: 'center' },
                };
            }}
        >
            <Tabs.Screen
                name="index"
                options={{ tabBarIcon: tabIcon('house'), title: t('tabs.explore'), tabBarLabel: tabLabel('tabs.explore'), tabBarAccessibilityLabel: t('tabs.explore') }}
            />
            <Tabs.Screen
                name="create"
                options={{ tabBarIcon: tabIcon('sparkle'), title: t('tabs.create'), tabBarLabel: tabLabel('tabs.create'), tabBarAccessibilityLabel: t('tabs.create') }}
            />
            <Tabs.Screen
                name="editor"
                options={{ tabBarIcon: tabIcon('scissors'), title: t('editor.title'), tabBarLabel: tabLabel('editor.title'), tabBarAccessibilityLabel: t('editor.title') }}
            />
            <Tabs.Screen
                name="library"
                options={{ tabBarIcon: tabIcon('image'), title: t('tabs.library'), tabBarLabel: tabLabel('tabs.library'), tabBarAccessibilityLabel: t('tabs.library') }}
            />
            <Tabs.Screen
                name="publish"
                options={{ tabBarIcon: tabIcon('send'), title: t('tabs.publish'), tabBarLabel: tabLabel('tabs.publish'), tabBarAccessibilityLabel: t('tabs.publish') }}
            />
        </Tabs>
        </View>
    );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

export const unstable_settings = { anchor: 'index' };
