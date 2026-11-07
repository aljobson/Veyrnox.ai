import { useRouter } from 'expo-router';
import { saveAccountLanguage, saveLanguage } from '../lib/languageStore';
import { Fragment, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {brand ? <BrandHeader /> : null}
            <Text variant="title1" accessibilityRole="header">{t('vibe.language.title')}</Text>
            <Text tone="secondary">{t('vibe.language.hint')}</Text>
            {activeLanguages(active).map((l, i) => {
                const row = <Chip label={l.name} accessibilityLanguage={l.tag} selected={picked === l.code} disabled={busy} fullWidth onPress={() => setPicked(l.code)} />;
                return brand ? <Reveal key={l.code} index={i} active={reveal}>{row}</Reveal> : <Fragment key={l.code}>{row}</Fragment>;
            })}
            {failed ? <Text tone="danger" accessibilityRole="alert">{t('language.failed')}</Text> : null}
        </ScrollView>
        <View style={s.footer}><Button label={t('vibe.language.continue')} disabled={busy || status === 'loading'} onPress={() => void apply()} /></View>
    </View>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { flexGrow: 1, justifyContent: 'center', padding: ds.space.gutter, gap: ds.space.md },
    footer: { padding: ds.space.gutter },
}));
