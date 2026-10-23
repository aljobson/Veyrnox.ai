import { useEffect, useMemo, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { appStorage, getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { claimCheckin, checkinErrorKey, type CheckinStatus } from '../lib/checkin';
import { checkinStatusReader } from '../lib/checkinStatus';
import { ApiError, type ApiClient } from '../lib/api';
import { touchTarget } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { colors } from '../theme';

const today = () => new Date().toISOString().slice(0, 10);
const dismissed = new Map<string, string>();
export function CheckInModal() {
    const { api, status: authStatus } = useAuth();
    const [owner, setOwner] = useState(getCacheUser());
    useEffect(() => subscribeCacheUser(() => setOwner(getCacheUser())), []);
    if (!owner || authStatus !== 'signedIn') return null;
    return <CheckInForUser key={owner} owner={owner} api={api} />;
}

function CheckInForUser({ owner, api }: { owner: string; api: ApiClient }) {
    const reader = useMemo(() => checkinStatusReader(api, owner), [api, owner]);
    const [status, setStatus] = useState<CheckinStatus | null>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [earned, setEarned] = useState<number | null>(null);
    useEffect(() => {
        let live = true;
        async function load() {
            try {
                const next = await reader.read();
                const saved = await appStorage.get(`checkin.${owner}`).catch(() => null);
                if (!live || owner !== getCacheUser()) return;
                setStatus(next); setError(null); setEarned(null);
                setOpen(!!next && !next.claimed_today && saved !== today() && dismissed.get(owner) !== today());
            } catch { /* A display-storage failure does not trigger another API read. */ }
        }
        void load();
        const poll = () => { if (reader.due()) void load(); };
        const sub = AppState.addEventListener('change', state => { if (state === 'active') poll(); });
        const timer = setInterval(poll, 60_000);
        return () => { live = false; sub.remove(); clearInterval(timer); };
    }, [reader, owner]);
    function remember() {
        if (!owner) return;
        dismissed.set(owner, today());
        void appStorage.set(`checkin.${owner}`, today()).catch(() => {});
    }
    function close() { remember(); setOpen(false); }
    async function claim() {
        if (busy) return;
        setBusy(true); setError(null);
        try {
            const result = await claimCheckin(api);
            if (owner !== getCacheUser()) return;
            if (!result) { reader.stop(); setOpen(false); setStatus(null); return; }
            remember(); setEarned(result.credits);
            if (status) {
                const next = { ...status, claimed_today: true, streak: result.streak };
                reader.update(next); setStatus(next);
            }
        } catch (err) {
            if (owner !== getCacheUser()) return;
            if (err instanceof ApiError && err.status === 403 && err.code === 'account_unavailable') {
                reader.stop(); setOpen(false); setStatus(null);
            } else setError(checkinErrorKey(err));
        }
        finally { setBusy(false); }
    }
    if (!status) return null;
    const day = status.claimed_today ? Math.min(status.streak, 6) : status.next_day;
    return <Modal visible={open} transparent animationType="fade" onRequestClose={close} accessibilityViewIsModal>
        <View style={styles.backdrop}><ScrollView style={styles.scroll} contentContainerStyle={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>{t('checkin.title')}</Text>
            <Text style={styles.body}>{t('checkin.copy')}</Text>
            <View style={styles.grid}>
                {status.rewards.map((credits, i) => <View key={i} accessibilityState={{ selected: day === i + 1 }}
                    style={[styles.tile, day === i + 1 && styles.current, i + 1 < day && styles.past]}>
                    <Text style={styles.body}>{i === 5 ? t('checkin.lastDay') : t('checkin.day', { day: i + 1 })}</Text>
                    <Text style={styles.amount}>{plural('checkin.credits', credits, { credits })}</Text>
                    <Text style={styles.tick} accessibilityLabel={status.claimed_today && day === i + 1 ? t('checkin.claimed') : undefined}>
                        {status.claimed_today && day === i + 1 ? '✓' : ''}
                    </Text>
                </View>)}
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.message}>{error ? t(error) : earned && earned > 0 ? plural('checkin.earned', earned, { credits: earned }) : status.claimed_today ? t('checkin.claimed') : ''}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('checkin.claim')} accessibilityState={{ disabled: busy || status.claimed_today }} disabled={busy || status.claimed_today} onPress={claim} style={styles.primary}>
                <Text style={styles.primaryText}>{t(busy ? 'checkin.claiming' : status.claimed_today ? 'checkin.claimed' : 'checkin.claim')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('checkin.close')} onPress={close} style={styles.close}><Text style={styles.body}>{t('checkin.close')}</Text></Pressable>
        </ScrollView></View>
    </Modal>;
}
const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
    scroll: { flexGrow: 0 },
    card: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, gap: 14, borderWidth: 1, borderColor: colors.border },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    body: { color: colors.body, fontSize: 14 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tile: { width: '30%', flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 8, alignItems: 'center' },
    current: { borderColor: colors.accent }, past: { opacity: 0.5 },
    amount: { color: colors.text, fontWeight: '700', marginTop: 8 },
    tick: { color: colors.accent, minHeight: 22 },
    message: { color: colors.body, minHeight: 44 },
    primary: { ...touchTarget, backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center' },
    primaryText: { color: colors.accentInk, fontWeight: '700' },
    close: { ...touchTarget, alignItems: 'center' },
});
