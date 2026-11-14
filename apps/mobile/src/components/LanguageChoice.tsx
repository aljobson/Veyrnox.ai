import { useRouter } from 'expo-router';
import { saveAccountLanguage, saveLanguage } from '../lib/languageStore';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ScrollView, View, type ScrollViewInstance, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Text, themedStyles, useThemedStyles } from './ui';
import { BrandHeader } from './BrandHeader';
import { Reveal } from './Reveal';
import { useAuth } from '../auth/AuthProvider';
import { ACTIVE_LOCALES, getLocale, t, type LocaleCode } from '../lib/i18n';
import { directionReconciler, reconcileLanguageDirection } from '../lib/languageDirection';
import { activeLanguages, changeLanguage } from '../lib/languageTransition';
import { ds } from '../theme';

// `brand` is the first-launch version: a compact brand header and rows that ease in once `reveal` turns true (the splash page
// is dissolving over it). The account language screen uses neither.
export function LanguageChoice({ returnPath, active = ACTIVE_LOCALES, onComplete, brand = false, reveal = true }: { returnPath: string; active?: readonly LocaleCode[]; onComplete?(): void; brand?: boolean; reveal?: boolean }) {
    const router = useRouter();
    const { status, api, canReloadSession } = useAuth();
    const [picked, setPicked] = useState<string>(getLocale());
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const running = useRef(false);
    const insets = useSafeAreaInsets();
    const s = useThemedStyles(sheets);
    const scroll = useRef<ScrollViewInstance>(null);
    const [size, setSize] = useState({ view: 0, content: 0, offset: 0 });
    // Rows below the fold: a fade over the list's bottom edge says it scrolls. It goes once the last row is in view.
    const more = size.content - size.view > 1 && size.offset + size.view < size.content - 1;
    const overflows = size.content - size.view > 1;
    useEffect(() => { if (overflows) scroll.current?.flashScrollIndicators(); }, [overflows]);
    const onLayout = (e: LayoutChangeEvent) => { const view = e.nativeEvent.layout.height; setSize(v => ({ ...v, view })); };
    const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => { const offset = e.nativeEvent.contentOffset.y; setSize(v => ({ ...v, offset })); };
    async function apply() {
        if (running.current) return;
        running.current = true;
        setBusy(true);
        setFailed(false);
        const unchanged = picked === getLocale();
        const ready = await directionReconciler.beforeChoice();
        const ok = ready && (unchanged
            ? ((onComplete ? await saveLanguage(picked, true) : true) && await reconcileLanguageDirection(returnPath, { signedIn: status === 'signedIn', canReloadSession }))
            : await changeLanguage(picked, returnPath, { signedIn: status === 'signedIn', canReloadSession }, {
                active, onChosen: code => status === 'signedIn' ? saveAccountLanguage(api, code) : Promise.resolve(),
            }));
        if (ok && unchanged) { if (onComplete) onComplete(); else router.back(); }
        if (!ok) setFailed(true);
        setBusy(false);
        running.current = false;
    }
    return <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.list}>
            <ScrollView ref={scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" persistentScrollbar scrollEventThrottle={16} onLayout={onLayout} onScroll={onScroll} onContentSizeChange={(_w, content) => setSize(v => ({ ...v, content }))}>
                {brand ? <BrandHeader /> : null}
                <Text variant="title1" accessibilityRole="header">{t('vibe.language.title')}</Text>
                <Text tone="secondary">{t('vibe.language.hint')}</Text>
                <View style={s.options} accessibilityRole="radiogroup" accessibilityLabel={t('vibe.language.title')}>
                    {activeLanguages(active).map((l, i) => {
                        const row = <Chip label={l.name} accessibilityLanguage={l.tag} accessibilityRole="radio" accessibilityState={{ checked: picked === l.code }} selected={picked === l.code} disabled={busy} fullWidth onPress={() => setPicked(l.code)} />;
                        return brand ? <Reveal key={l.code} index={i} active={reveal}>{row}</Reveal> : <Fragment key={l.code}>{row}</Fragment>;
                    })}
                </View>
                {failed ? <Text tone="danger" accessibilityRole="alert">{t('language.failed')}</Text> : null}
            </ScrollView>
            {more ? <View testID="language-more" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.fade}>
                {FADE_STEPS.map(opacity => <View key={opacity} style={[s.fadeStep, { opacity }]} />)}
            </View> : null}
        </View>
        <View style={s.footer}><Button label={t('vibe.language.continue')} disabled={busy || status === 'loading'} onPress={() => void apply()} /></View>
    </View>;
}
// Stepped bands of the screen colour, light to solid, stand in for a gradient (no gradient library in the app).
const FADE_STEPS = [0.2, 0.45, 0.7, 0.9] as const;
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    list: { flex: 1 },
    body: { flexGrow: 1, justifyContent: 'center', padding: ds.space.gutter, gap: ds.space.md },
    options: { gap: ds.space.md },
    fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    fadeStep: { height: ds.space.md, backgroundColor: p.bg },
    footer: { padding: ds.space.gutter },
}));
