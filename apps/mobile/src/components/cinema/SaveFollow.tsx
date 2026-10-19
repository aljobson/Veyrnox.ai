import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { fetchRetentionState, readOf, setRetention, socialErrorKey, type FollowKind, type RetentionState } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Save this title, follow its creator, follow its series. Hidden while the retention switch is off (the Saved and
// Following tabs already say so); a failed change puts the button back and says why.
export function SaveFollow({ contentId }: { readonly contentId: string }) {
    const { api } = useAuth();
    const [state, setState] = useState<RetentionState | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState<FollowKind | null>(null);

    useEffect(() => {
        let live = true;
        readOf(() => fetchRetentionState(api, contentId)).then((r) => { if (live && r.kind === 'ok') setState(r.value); });
        return () => { live = false; };
    }, [api, contentId]);

    if (!state) return null;

    async function toggle(kind: FollowKind, targetId: string | null, current: boolean) {
        if (!targetId || busy) return;
        setBusy(kind);
        setNote(null);
        try {
            const active = await setRetention(api, kind, targetId, !current, Crypto.randomUUID());
            setState((s) => (s ? { ...s, ...(kind === 'saved' ? { saved: active } : kind === 'creator' ? { followingCreator: active } : { followingSeries: active }) } : s));
        } catch (err) {
            setNote(t(socialErrorKey(err)));
        } finally {
            setBusy(null);
        }
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
                        accessibilityState={{ selected: b.on, busy: busy === b.kind, disabled: busy !== null }}
                        disabled={busy !== null}
                        style={[styles.btn, b.on && styles.btnOn]}
                        onPress={() => toggle(b.kind, b.target, b.on)}
                    >
                        <Text style={[styles.text, b.on && styles.textOn]}>{t(b.on ? b.on_label : b.off_label)}</Text>
                    </Pressable>
                ))}
            </View>
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
});
