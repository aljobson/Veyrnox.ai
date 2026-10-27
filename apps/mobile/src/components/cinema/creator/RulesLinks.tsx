import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link, router } from 'expo-router';
import { Button } from '../../ui/Button';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { ComingToApp } from '../../ComingToApp';
import { cinemaUploadStore } from '../../../lib/cinemaUploadStore';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

export function Action({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.button, disabled && { opacity: 0.5 }]}><Text style={ui.link}>{label}</Text></Pressable>;
}
export function Check({ label, checked, onPress, disabled = false, english = false }: { label: string; checked: boolean; onPress(): void; disabled?: boolean; english?: boolean }) {
    return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityLanguage={english ? 'en' : undefined} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={ui.button}><Text style={ui.text}>{checked ? '☑ ' : '☐ '}{label}</Text></Pressable>;
}
export function CreatorClosed({ message = 'cinemaUpload.closed' }: { message?: string }) {
    return <View style={ui.page}><Text style={ui.text}>{t(message === 'cinemaUpload.role' ? 'cinemaCreator.upload.body' : message)}</Text><ComingToApp /></View>;
}
export const useCreatorOwner = () => useSyncExternalStore(subscribeCacheUser, getCacheUser, () => undefined);
export function useCreatorScope() {
    const mounted = useRef(true), ticket = useRef(cinemaUploadStore.ticket()).current;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    return { ticket, live: () => mounted.current && cinemaUploadStore.live(ticket) };
}
export function RulesLinks() {
    return <View style={ui.card}>
        <Text accessibilityRole="header" style={ui.heading}>{t('cinemaUpload.rules')}</Text>
        <Button variant="tertiary" accessibilityRole="link" label={t('cinemaUpload.policy')} onPress={() => router.push('/legal/cinema-content')} />
        <Button variant="tertiary" accessibilityRole="link" label={t('cinemaUpload.terms')} onPress={() => router.push('/legal/terms')} />
        <Link href="/report" accessibilityRole="link" style={ui.button}><Text style={ui.link}>{t('cinemaUpload.report')}</Text></Link>
        <Link href="/blocked" accessibilityRole="link" style={ui.button}><Text style={ui.link}>{t('cinemaUpload.blocked')}</Text></Link>
    </View>;
}
export const ui = StyleSheet.create({
    page: { padding: 20, gap: 14, backgroundColor: colors.background },
    card: { padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
    heading: { color: colors.text, fontSize: 20, fontWeight: '700' }, text: { color: colors.text, fontSize: 16 },
    link: { color: colors.accent, fontSize: 16 }, button: { ...touchTarget, padding: 10 },
    input: { ...touchTarget, borderColor: colors.border, borderWidth: 1, padding: 12, color: colors.text, borderRadius: 8 },
});
