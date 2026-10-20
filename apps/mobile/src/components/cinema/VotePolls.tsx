import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { castChoice, castVote, competitionOpen, fetchStoryPolls, fetchVoting, readOf, socialErrorKey, type StoryPoll, type VoteCompetition } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

const day = (iso: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString() : '');

// Open competitions and story polls for one title. Each hides itself while its switch is off (VOTING_ENABLED and
// STORY_POLLS_ENABLED are off in production); a failed read says so and offers a retry.
export function VotePolls({ contentId }: { readonly contentId: string }) {
    return (
        <>
            <Voting contentId={contentId} />
            <Polls contentId={contentId} />
        </>
    );
}

type Load<T> = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'error'; key: string } | { kind: 'ok'; value: T };

function useRead<T>(run: () => Promise<T>): [Load<T>, () => void] {
    const [state, setState] = useState<Load<T>>({ kind: 'loading' });
    const [n, setN] = useState(0);
    useEffect(() => {
        let live = true;
        readOf(run).then((r) => {
            if (!live) return;
            setState(r.kind === 'ok' ? { kind: 'ok', value: r.value } : r.kind === 'closed' ? { kind: 'hidden' } : { kind: 'error', key: r.key });
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when asked
    }, [n]);
    return [state, () => setN((x) => x + 1)];
}

function Voting({ contentId }: { contentId: string }) {
    const { api } = useAuth();
    const [state, reload] = useRead(() => fetchVoting(api, contentId));
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const vote = useCallback(async (c: VoteCompetition) => {
        setBusy(c.id);
        setNote(null);
        try {
            await castVote(api, contentId, c.id, Crypto.randomUUID());
            reload();
        } catch (err) {
            setNote(t(socialErrorKey(err)));
        } finally {
            setBusy(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, contentId]);
    if (state.kind === 'loading') return <ActivityIndicator color={colors.accent} />;
    if (state.kind === 'hidden' || (state.kind === 'ok' && state.value.length === 0)) return null;
    if (state.kind === 'error') return <Pressable accessibilityRole="button" style={styles.retry} onPress={reload}><Text style={styles.error}>{t(state.key)} {t('cinemaSocial.tapRetry')}</Text></Pressable>;
    return (
        <View style={styles.box}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinemaSocial.voting')}</Text>
            {state.value.map((c) => {
                const open = competitionOpen(c);
                return (
                    <View key={c.id} style={styles.card}>
                        <Text style={styles.name}>{c.name}</Text>
                        <Text style={styles.muted}>{t('cinemaSocial.voteCount', { count: c.qualifiedVotes })}{open ? ` · ${t('cinemaSocial.endsOn', { date: day(c.endsAt) })}` : ` · ${t('cinemaSocial.ended')}`}</Text>
                        {c.myVote ? <Text style={styles.mine}>{t(`cinemaSocial.myVote.${c.myVote}`)}</Text> : open ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={t('cinemaSocial.voteFor', { name: c.name })} accessibilityState={{ busy: busy === c.id, disabled: busy !== null }} disabled={busy !== null} style={styles.btn} onPress={() => vote(c)}>
                                <Text style={styles.btnText}>{t('cinemaSocial.vote')}</Text>
                            </Pressable>
                        ) : null}
                    </View>
                );
            })}
            {note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : null}
        </View>
    );
}

function Polls({ contentId }: { contentId: string }) {
    const { api } = useAuth();
    const [state, reload] = useRead(() => fetchStoryPolls(api, contentId));
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    async function choose(p: StoryPoll, optionId: string) {
        setBusy(p.id);
        setNote(null);
        try {
            await castChoice(api, p.id, optionId, Crypto.randomUUID());
            reload();
        } catch (err) {
            setNote(t(socialErrorKey(err)));
        } finally {
            setBusy(null);
        }
    }
    if (state.kind === 'loading') return null;
    if (state.kind === 'hidden' || (state.kind === 'ok' && state.value.length === 0)) return null;
    if (state.kind === 'error') return <Pressable accessibilityRole="button" style={styles.retry} onPress={reload}><Text style={styles.error}>{t(state.key)} {t('cinemaSocial.tapRetry')}</Text></Pressable>;
    return (
        <View style={styles.box}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinemaSocial.polls')}</Text>
            {state.value.map((p) => {
                const canChoose = p.isOpen && !p.myOptionId;
                return (
                    <View key={p.id} style={styles.card}>
                        <Text style={styles.name}>{p.question}</Text>
                        {canChoose ? <Text style={styles.muted}>{t('cinemaSocial.choiceFinal')}</Text> : <Text style={styles.muted}>{p.isOpen ? t('cinemaSocial.choiceMade') : t('cinemaSocial.pollClosed')}</Text>}
                        {p.options.map((o) => (
                            <Pressable
                                key={o.id}
                                accessibilityRole="button"
                                accessibilityState={{ selected: p.myOptionId === o.id, disabled: !canChoose || busy !== null }}
                                disabled={!canChoose || busy !== null}
                                style={[styles.option, p.myOptionId === o.id && styles.optionOn]}
                                onPress={() => choose(p, o.id)}
                            >
                                <Text style={styles.optionText}>{o.label}</Text>
                                <Text style={styles.muted}>{o.votes}</Text>
                            </Pressable>
                        ))}
                    </View>
                );
            })}
            {note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 8 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted },
    mine: { color: colors.accent, fontWeight: '600' },
    btn: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 10 },
    btnText: { color: colors.accentInk, fontWeight: '700' },
    option: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
    optionOn: { borderColor: colors.accent },
    optionText: { color: colors.text, flex: 1 },
    error: { color: colors.danger },
    retry: { minHeight: MIN_TARGET, justifyContent: 'center' },
});
