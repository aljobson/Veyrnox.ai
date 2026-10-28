import { rawText } from '../../lib/i18n/translate';
import { FontStatus } from '../../components/ui/FontStatus';
import { useContext, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { useFonts } from 'expo-font';
import { ACCENTS, TYPEFACES, TEXT_SIZES, THEME_PREFERENCES, applyAppearance, getAppearance, ds, type ThemePreference, type AppearanceSettings, type Accent, type Typeface } from '../../theme';
import { AppearanceContext, Button, Card, Chip, Icon, SegmentedControl, Swatch, Text, themedStyles, useThemedStyles, useAppearance } from '../../components/ui';
import { previewFonts } from '../../components/ui/FontCatalog';
import { t } from '../../lib/i18n';

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
                </ScrollView>
                <View style={styles.footer}><ApplyButton draft={draft} /></View>
            </View>
        </FontStatus.Provider>
    );
}
function ThemeOption({ theme, draft }: { theme: ThemePreference; draft: Draft }) {
    const selected = useDraft(draft, (s) => s.theme === theme);
    const styles = useThemedStyles(sheets);
    const { settings } = useAppearance();
    const sample = useMemo(() => ({ ...settings, theme }), [settings, theme]);
    return (
        <Pressable style={styles.themeOption} accessibilityRole="radio" accessibilityLabel={rawText(themeName(theme))}
            accessibilityState={{ checked: selected, selected }} onPress={() => draft.change({ theme })}>
            <AppearanceContext.Provider value={sample}><ThemeSample selected={selected} /></AppearanceContext.Provider>
            <Text variant="caption">{themeName(theme)}</Text>
        </Pressable>
    );
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
    return (
        <Pressable accessibilityRole="radio" accessibilityLabel={t(`appearance.${typeface}`)}
            accessibilityState={{ checked: selected, selected }} onPress={() => draft.change({ typeface })}>
            <Card selected={selected}>
                <AppearanceContext.Provider value={sample}>
                    <Text variant="display">{t('appearance.letters')}</Text>
                    <Text variant="title3">{t(`appearance.${typeface}`)}</Text>
                    <Text tone="secondary">{t('appearance.sample')}</Text>
                </AppearanceContext.Provider>
            </Card>
        </Pressable>
    );
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
function ThemeSample({ selected }: { selected: boolean }) {
    const styles = useThemedStyles(sheets);
    return (
        <View style={[styles.mini, selected && styles.selected]} accessibilityElementsHidden>
            <View style={styles.miniLine} />
            <View style={styles.miniBody} />
            <View style={styles.miniButton}>{selected ? <Icon name="check" size={16} tint={styles.miniInk.color} /> : null}</View>
        </View>
    );
}
const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: ds.space.gutter, gap: ds.space.lg },
    footer: { padding: ds.space.gutter },
    preview: { gap: ds.space.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.md },
    themeOption: { minWidth: 64, flex: 1, gap: ds.space.sm },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: ds.space.sm },
    mini: { height: 92, minWidth: 64, padding: ds.space.sm, gap: ds.space.sm, borderRadius: ds.radius.sm, borderWidth: 2, borderColor: p.borderSubtle, backgroundColor: p.bg },
    selected: { borderColor: p.accent },
    miniLine: { width: '60%', height: 5, borderRadius: ds.radius.xs, backgroundColor: p.textPrimary },
    miniBody: { width: '90%', height: 4, backgroundColor: p.textSecondary },
    miniButton: { height: 24, borderRadius: ds.radius.xs, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    miniInk: { color: p.onAccent },
}));
