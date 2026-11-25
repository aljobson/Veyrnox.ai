import { FontStatus } from '../../components/ui/FontStatus';
import { useContext, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { useFonts } from 'expo-font';
import { ACCENTS, TYPEFACES, TEXT_SIZES, THEME_PREFERENCES, applyAppearance, getAppearance, ds, type ThemePreference, type AppearanceSettings, type Accent, type Typeface, type VividHue } from '../../theme';
import { AppearanceContext, Button, Card, Chip, SegmentedControl, Swatch, Text, VividCard, themedStyles, useThemedStyles, useAppearance } from '../../components/ui';
import { previewFonts } from '../../components/ui/FontCatalog';
import { t } from '../../lib/i18n';
import { VeyCharacterOptions } from '../../components/VeyCharacterOptions';
import type { MenuIcon } from '../../lib/menuIcons';

// Screen-local draft: only the preview and controls whose selection changed subscribe.
// Applying reads the latest snapshot, without subscribing the footer or page chrome.
function createDraft(initial: AppearanceSettings) {
    let current = initial;
    const listeners = new Set<() => void>();
    return {
        get: () => current,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        change: (value: Partial<AppearanceSettings>) => {
            if (Object.entries(value).every(([key, next]) => current[key as keyof AppearanceSettings] === next)) return;
            current = { ...current, ...value };
            listeners.forEach((listener) => listener());
        },
    };
}
type Draft = ReturnType<typeof createDraft>;
function useDraft<T>(draft: Draft, select: (settings: AppearanceSettings) => T) {
    return useSyncExternalStore(draft.subscribe, () => select(draft.get()), () => select(draft.get()));
}
const themeName = (theme: ThemePreference) => t(theme === 'oled' ? 'appearance.oled' : `acct.appearance.${theme}`);
const THEME_CARD: Record<ThemePreference, { readonly hue: VividHue; readonly icon: MenuIcon }> = {
    system: { hue: 'blue', icon: 'contrast' },
    light: { hue: 'orange', icon: 'sun' },
    dark: { hue: 'purple', icon: 'moon' },
    oled: { hue: 'green', icon: 'moonStars' },
};
const TYPEFACE_HUE: Record<Typeface, VividHue> = { studio: 'pink', editorial: 'purple', technical: 'teal' };

export default function AppearanceScreen() {
    const [draft] = useState(() => createDraft(getAppearance()));
    const styles = useThemedStyles(sheets);
    // Other faces are loaded only on this screen. A failed or pending face renders with the system font.
    const [fontsLoaded] = useFonts(previewFonts);
    const inheritedFonts = useContext(FontStatus);
    const loadedFonts = useMemo(() => (fontsLoaded ? new Set(Object.keys(previewFonts)) : inheritedFonts), [fontsLoaded, inheritedFonts]);
    return (
        <FontStatus.Provider value={loadedFonts}>
            <View style={styles.screen}>
                <Stack.Screen options={{ title: t('acct.appearance') }} />
                <ScrollView contentContainerStyle={styles.body}>
                    <PendingPreview draft={draft} />
                    {/* Every cold launch starts in Light whatever is chosen here (src/theme.ts, pull request 1996); a choice holds until the
                        app is next launched. No existing string says so, and new copy needs all 11 locales, so this
                        screen has no note yet. */}
                    <Text variant="title3">{t('appearance.theme')}</Text>
                    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t('appearance.theme')}>
                        {THEME_PREFERENCES.map((theme) => <ThemeOption key={theme} theme={theme} draft={draft} />)}
                    </View>
                    <Text variant="title3">{t('appearance.accent')}</Text>
                    <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={t('appearance.accent')}>
                        {ACCENTS.map((accent) => <AccentOption key={accent} accent={accent} draft={draft} />)}
                    </View>
                    <Text variant="title3">{t('appearance.typeface')}</Text>
                    {TYPEFACES.map((typeface) => <TypefaceOption key={typeface} typeface={typeface} draft={draft} />)}
                    <Text variant="title3">{t('appearance.textSize')}</Text>
                    <TextSizeOptions draft={draft} />
                    <Text tone="secondary">{t('appearance.previewBody')}</Text>
                    <Text variant="title3">{t('vey.character')}</Text>
                    <VeyCharacterOptions />
                </ScrollView>
                <View style={styles.footer}><ApplyButton draft={draft} /></View>
            </View>
        </FontStatus.Provider>
    );
}
function ThemeOption({ theme, draft }: { theme: ThemePreference; draft: Draft }) {
    const selected = useDraft(draft, (s) => s.theme === theme);
    const card = THEME_CARD[theme];
    return <VividCard hue={card.hue} icon={card.icon} title={themeName(theme)} selected={selected} accessibilityRole="radio"
        style={staticStyles.themeOption} onPress={() => draft.change({ theme })} />;
}
function AccentOption({ accent, draft }: { accent: Accent; draft: Draft }) {
    const selected = useDraft(draft, (s) => s.accent === accent);
    return <Swatch accent={accent} label={t(`appearance.${accent}`)} selected={selected} onPress={() => draft.change({ accent })} />;
}
function TypefaceOption({ typeface, draft }: { typeface: Typeface; draft: Draft }) {
    const selected = useDraft(draft, (s) => s.typeface === typeface);
    const { settings } = useAppearance();
    // Only the font differs from the applied settings, including when a dark theme is pending.
    const sample = useMemo(() => ({ ...settings, typeface }), [settings, typeface]);
    return <AppearanceContext.Provider value={sample}>
        <VividCard hue={TYPEFACE_HUE[typeface]} icon="textSize" title={t(`appearance.${typeface}`)} detail={t('appearance.sample')}
            layout="row" selected={selected} accessibilityRole="radio" accessibilityLabel={t(`appearance.${typeface}`)} onPress={() => draft.change({ typeface })} />
    </AppearanceContext.Provider>;
}
function TextSizeOptions({ draft }: { draft: Draft }) {
    const value = useDraft(draft, (s) => s.textSize);
    return <SegmentedControl value={value} onChange={(textSize) => draft.change({ textSize })}
        options={TEXT_SIZES.map((size) => ({ value: size, label: t(`appearance.${size}`) }))} />;
}
function ApplyButton({ draft }: { draft: Draft }) {
    const [applying, setApplying] = useState(false);
    const pathname = usePathname();
    return <Button label={t('appearance.apply')} loading={applying} onPress={async () => {
        setApplying(true);
        try { await applyAppearance(draft.get(), pathname); }
        finally { setApplying(false); }
    }} />;
}
function PendingPreview({ draft }: { draft: Draft }) {
    const pending = useDraft(draft, (s) => s);
    return <AppearanceContext.Provider value={pending}><Preview /></AppearanceContext.Provider>;
}
function Preview() {
    const styles = useThemedStyles(sheets);
    return (
        <Card style={styles.preview} testID="appearance-preview">
            <Text variant="title1">{t('appearance.preview')}</Text>
            <Text tone="secondary">{t('appearance.previewBody')}</Text>
            <Button label={t('appearance.previewButton')} accessibilityState={{ disabled: true }} onPress={() => {}} />
            <Chip label={t('appearance.previewChip')} selected />
        </Card>
    );
}
const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: ds.space.gutter, gap: ds.space.lg },
    footer: { padding: ds.space.gutter },
    preview: { gap: ds.space.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.md },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: ds.space.sm },
}));
const staticStyles = {
    themeOption: { width: '47.8%' as const, minHeight: 128 },
};
