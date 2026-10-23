import { Image } from 'expo-image';
import { Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';
import { HeaderRight } from '../../../components/HeaderChips';
import { Logo } from '../../../components/Logo';
import { MenuButton } from '../../../components/MenuDrawer';
import { VeyMascot } from '../../../components/VeyMascot';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { MENU_ICONS, type MenuIcon } from '../../../lib/menuIcons';
import { colors } from '../../../theme';

// The tab bar has a fixed height, so its labels stop growing at the same limit as the header; everything else follows the system text size.
function tabLabel(key: string) {
    return function TabLabel({ color }: { color: ColorValue }) {
        return (
            <Text style={{ color, fontSize: 12, fontWeight: '600' }} maxFontSizeMultiplier={HEADER_MAX_FONT_SCALE} numberOfLines={1}>
                {t(key)}
            </Text>
        );
    };
}

// One icon per tab, tinted by the tab bar (accent when selected, muted otherwise); the label stays for screen readers.
function tabIcon(name: MenuIcon) {
    return function TabIcon({ color }: { color: ColorValue }) {
        return <Image source={MENU_ICONS[name]} style={{ width: 24, height: 24 }} tintColor={typeof color === 'string' ? color : colors.muted} contentFit="contain" accessibilityElementsHidden />;
    };
}

// Five bottom tabs. Every URL is unchanged: the (tabs) folder is a group, so /create, /cinema, /library and /publish
// still open the same screens, and every other screen opens above the tabs as before.
export default function TabsLayout() {
    return (
        <Tabs
            // Vey sits inside each tab's scene, so it is always above the tab bar. The Cinema feed keeps its actions at the
            // bottom, so Vey stays off it.
            screenLayout={({ children, route }) => (
                <View style={{ flex: 1 }}>
                    {children}
                    {route.name === 'cinema' || route.name === 'publish' ? null : <VeyMascot />}
                </View>
            )}
            screenOptions={({ route }) => {
                const palette = colors;
                return {
                    headerStyle: { backgroundColor: palette.background },
                    headerTintColor: palette.text,
                    // Keep the complete VEYRNOX.ai wordmark clear of the three fixed-width actions on compact phones.
                    headerTitle: () => <Logo size={20} palette={palette} />,
                    headerLeft: () => <MenuButton palette={palette} />,
                    headerRight: () => <HeaderRight palette={palette} />,
                    sceneStyle: { backgroundColor: palette.background },
                    tabBarStyle: { backgroundColor: palette.background, borderTopColor: palette.border },
                    tabBarActiveTintColor: palette.accent,
                    tabBarInactiveTintColor: palette.muted,
                    tabBarItemStyle: { minHeight: MIN_TARGET, justifyContent: 'center' },
                };
            }}
        >
            <Tabs.Screen name="index" options={{ tabBarIcon: tabIcon('house'), title: t('tabs.explore'), tabBarLabel: tabLabel('tabs.explore'), tabBarAccessibilityLabel: t('tabs.explore') }} />
            <Tabs.Screen name="create" options={{ tabBarIcon: tabIcon('sparkle'), title: t('tabs.create'), tabBarLabel: tabLabel('tabs.create'), tabBarAccessibilityLabel: t('tabs.create') }} />
            <Tabs.Screen name="cinema" options={{ tabBarIcon: tabIcon('film'), title: t('tabs.cinema'), tabBarLabel: tabLabel('tabs.cinema'), tabBarAccessibilityLabel: t('tabs.cinema') }} />
            <Tabs.Screen name="library" options={{ tabBarIcon: tabIcon('image'), title: t('tabs.library'), tabBarLabel: tabLabel('tabs.library'), tabBarAccessibilityLabel: t('tabs.library') }} />
            <Tabs.Screen name="publish" options={{ tabBarIcon: tabIcon('send'), title: t('tabs.publish'), tabBarLabel: tabLabel('tabs.publish'), tabBarAccessibilityLabel: t('tabs.publish') }} />
        </Tabs>
    );
}

export const unstable_settings = { anchor: 'index' };
