import { Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';
import { HeaderRight } from '../../../components/HeaderChips';
import { Logo } from '../../../components/Logo';
import { MenuButton } from '../../../components/MenuDrawer';
import { VeyMascot } from '../../../components/VeyMascot';
import { HEADER_MAX_FONT_SCALE, MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
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
                    {route.name === 'cinema' ? null : <VeyMascot />}
                </View>
            )}
            screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                headerTitle: () => <Logo size={24} />,
                headerLeft: () => <MenuButton />,
                headerRight: () => <HeaderRight />,
                sceneStyle: { backgroundColor: colors.background },
                tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
                tabBarActiveTintColor: colors.accent,
                tabBarInactiveTintColor: colors.muted,
                tabBarIcon: () => null,
                tabBarItemStyle: { minHeight: MIN_TARGET, justifyContent: 'center' },
            }}
        >
            <Tabs.Screen name="index" options={{ title: t('tabs.explore'), tabBarLabel: tabLabel('tabs.explore'), tabBarAccessibilityLabel: t('tabs.explore') }} />
            <Tabs.Screen name="create" options={{ title: t('tabs.create'), tabBarLabel: tabLabel('tabs.create'), tabBarAccessibilityLabel: t('tabs.create') }} />
            <Tabs.Screen name="cinema" options={{ title: t('tabs.cinema'), tabBarLabel: tabLabel('tabs.cinema'), tabBarAccessibilityLabel: t('tabs.cinema') }} />
            <Tabs.Screen name="library" options={{ title: t('tabs.library'), tabBarLabel: tabLabel('tabs.library'), tabBarAccessibilityLabel: t('tabs.library') }} />
            <Tabs.Screen name="publish" options={{ title: t('tabs.publish'), tabBarLabel: tabLabel('tabs.publish'), tabBarAccessibilityLabel: t('tabs.publish') }} />
        </Tabs>
    );
}

export const unstable_settings = { anchor: 'index' };
