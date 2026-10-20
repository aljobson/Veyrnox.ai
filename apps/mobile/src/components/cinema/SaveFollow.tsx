import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { createRetentionLifecycle, observeRetentionState, retentionDisabled, setRetention, socialErrorKey, type FollowKind, type RetentionState } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Save this title, follow its creator, follow its series. A closed switch disables all retention controls until
// the next app session; a transient write failure leaves the controls retryable.
export function SaveFollow({ contentId }: { readonly contentId: string }) {
    const { api, status } = useAuth();
    const router = useRouter();
    const [state, setState] = useState<RetentionState | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState<FollowKind | null>(null);

    const [closed, setClosed] = useState(false);
    const lifecycle = useRef<ReturnType<typeof createRetentionLifecycle> | null>(null);

    useEffect(() => {
        const scope = createRetentionLifecycle(api, status);
        lifecycle.current = scope;
        setState(null);
        setNote(null);
        setBusy(null);
        setClosed(false);
        const off = scope.start(() => observeRetentionState(api, contentId, (result) => {
            if (result.kind === 'ok') { setState(result.value); setNote(null); }
            else if (result.kind === 'closed') { setClosed(true); setNote(null); }
            else setNote(t(result.key));
        }));
        return () => { scope.dispose(); off?.(); lifecycle.current = null; };
    }, [api, contentId, status]);

    // Retention was hidden on main until a title state loaded. Initial closure keeps that behaviour.
    if (status !== 'signedIn' || !state) return null;

    async function toggle(kind: FollowKind, targetId: string | null, current: boolean) {
        if (!targetId) return;
        await lifecycle.current?.write(
            () => setRetention(api, kind, targetId, !current, Crypto.randomUUID()),
            {
                busy: (active) => { setBusy(active ? kind : null); if (active) setNote(null); },
                success: (active) => {
                    if (!retentionDisabled(api)) setState((s) => (s ? { ...s, ...(kind === 'saved' ? { saved: active } : kind === 'creator' ? { followingCreator: active } : { followingSeries: active }) } : s));
                },
                error: (err) => { if (!retentionDisabled(api)) setNote(t(socialErrorKey(err))); },
            },
        );
    }

    const buttons: { kind: FollowKind; target: string | null; on: boolean; on_label: string; off_label: string }[] = [
        { kind: 'saved', target: contentId, on: state.saved, on_label: 'cinemaSocial.saved', off_label: 'cinemaSocial.save' },
    ];
    if (!state.ownCreator) buttons.push({ kind: 'creator', target: state.creatorId, on: state.followingCreator, on_label: 'cinemaSocial.followingCreator', off_label: 'cinemaSocial.followCreator' });
    if (state.seriesId) buttons.push({ kind: 'series', target: state.seriesId, on: state.followingSeries, on_label: 'cinemaSocial.followingSeries', off_label: 'cinemaSocial.followSeries' });
    return (
        <View style={styles.wrap}>
            <View style={styles.row}>
                {buttons.map((b) => (
                    <Pressable
                        key={b.kind}
                        accessibilityRole="button"
                        accessibilityState={{ selected: b.on, busy: busy === b.kind, disabled: closed || busy !== null }}
                        disabled={closed || busy !== null}
                        style={[styles.btn, b.on && styles.btnOn]}
                        onPress={() => toggle(b.kind, b.target, b.on)}
                    >
                        <Text style={[styles.text, b.on && styles.textOn]}>{t(b.on ? b.on_label : b.off_label)}</Text>
                    </Pressable>
                ))}
            </View>
            {state.ownCreator ? (
                <Pressable accessibilityRole="button" style={styles.btn} onPress={() => router.push({ pathname: '/cinema/analytics', params: { id: contentId } })}>
                    <Text style={styles.text}>{t('cinemaCreator.analytics.open')}</Text>
                </Pressable>
            ) : null}
            {closed ? <Text style={styles.muted}>{t('cinema.retention.unavailable')}</Text> : null}
            {note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 6 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    btn: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong },
    btnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    text: { color: colors.text, fontWeight: '600' },
    textOn: { color: colors.accentInk },
    error: { color: colors.danger },
    muted: { color: colors.muted },
});
