import { useRouter } from 'expo-router';
import { saveAccountLanguage, saveLanguage } from '../lib/languageStore';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Text, themedStyles, useThemedStyles } from './ui';
import { useAuth } from '../auth/AuthProvider';
import { ACTIVE_LOCALES, getLocale, t, type LocaleCode } from '../lib/i18n';
import { activeLanguages, changeLanguage } from '../lib/languageTransition';
import { ds } from '../theme';

export function LanguageChoice({ returnPath, active = ACTIVE_LOCALES, onComplete }: { returnPath: string; active?: readonly LocaleCode[]; onComplete?(): void }) {
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
        const ok = unchanged
            ? (onComplete ? await saveLanguage(picked, true) : true)
            : await changeLanguage(picked, returnPath, { signedIn: status === 'signedIn', canReloadSession }, {
                active, onChosen: code => status === 'signedIn' ? saveAccountLanguage(api, code) : Promise.resolve(),
            });
        if (ok && unchanged) { if (onComplete) onComplete(); else router.back(); }
        if (!ok) setFailed(true);
        setBusy(false);
        running.current = false;
    }
    return <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text variant="title1" accessibilityRole="header">{t('vibe.language.title')}</Text>
            <Text tone="secondary">{t('vibe.language.hint')}</Text>
            {activeLanguages(active).map(l => <Chip key={l.code} label={l.name} accessibilityLanguage={l.tag} selected={picked === l.code} disabled={busy} fullWidth onPress={() => setPicked(l.code)} />)}
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
