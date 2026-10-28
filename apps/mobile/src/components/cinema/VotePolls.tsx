import { bodyKeys } from '../../lib/cinemaDrafts';
import { Button } from '../ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { castChoice, castVote, competitionOpen, fetchStoryPolls, fetchVoting, readOf, socialErrorKey, type StoryPoll, type VoteCompetition } from '../../lib/cinemaSocial';
import { formatLocale, t } from '../../lib/i18n';
import { colors } from '../../theme';

const day = (iso: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString(formatLocale()) : '');

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
        setState({ kind: 'loading' });
        readOf(run).then((r) => {
            if (!live) return;
            setState(r.kind === 'ok' ? { kind: 'ok', value: r.value } : r.kind === 'closed' ? { kind: 'hidden' } : { kind: 'error', key: r.key });
        });
        return () => { live = false; };
    }, [n, run]);
    const reload = useCallback(() => setN(x => x + 1), []);
    return [state, reload];
}

function Voting({ contentId }: { contentId: string }) {
    const { api } = useAuth();
    const [state, reload] = useRead(useCallback(() => fetchVoting(api, contentId), [api, contentId]));
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const keys = useRef(bodyKeys());
    const submitting = useRef(false);
    const vote = useCallback(async (c: VoteCompetition) => {
        if (submitting.current) return;
        submitting.current = true;
        const body = { content_id: contentId, competition_id: c.id };
        setBusy(c.id);
        setNote(null);
        try {
            await castVote(api, contentId, c.id, keys.current.for(body));
            keys.current.finish(body);
            reload();
        } catch (err) {
            keys.current.finish(body, err);
            setNote(t(socialErrorKey(err)));
        } finally {
            submitting.current = false;
            setBusy(null);
        }
    }, [api, contentId, reload]);
    if (state.kind === 'loading') return null;
    if (state.kind === 'hidden') return null;
    if (state.kind === 'error') return <Pressable accessibilityRole="button" style={styles.retry} onPress={reload}><Text style={styles.error}>{t(state.key)} {t('cinemaSocial.tapRetry')}</Text></Pressable>;
    return (
        <View style={styles.box}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinemaSocial.voting')}</Text>
            <Text style={styles.muted}>{t('cinema.voting.oneVotePerTitleInEach')}</Text>
            {!state.value.length ? <Text style={styles.muted}>{t('cinema.voting.noOpenCompetitionForThisTitle')}</Text> : null}
            {state.value.map((c) => {
                const open = competitionOpen(c);
                return (
                    <View key={c.id} style={styles.card}>
                        <Text style={styles.name}>{c.name}</Text>
                        <Text style={styles.muted}>{t('cinemaSocial.voteCount', { count: c.qualifiedVotes })}</Text>
                        <Text style={styles.muted}>{open ? t('cinemaSocial.endsOn', { date: day(c.endsAt) }) : t('cinemaSocial.ended')}</Text>
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
    const [state, reload] = useRead(useCallback(() => fetchStoryPolls(api, contentId), [api, contentId]));
    const [note, setNote] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const keys = useRef(bodyKeys());
    const submitting = useRef(false);
    const [selected, setSelected] = useState<Record<string, string>>({});
    async function choose(p: StoryPoll, optionId: string) {
        if (submitting.current) return;
        submitting.current = true;
        const body = { poll_id: p.id, option_id: optionId };
        setBusy(p.id);
        setNote(null);
        try {
            await castChoice(api, p.id, optionId, keys.current.for(body));
            keys.current.finish(body);
            reload();
        } catch (err) {
            keys.current.finish(body, err);
            setNote(t(socialErrorKey(err)));
        } finally {
            submitting.current = false;
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
                        {Number.isFinite(Date.parse(p.closesAt)) ? <Text style={styles.muted}>{p.isOpen ? t('cinemaViewer.pollClosesAt', { date: new Date(p.closesAt).toLocaleString(formatLocale()) }) : t('cinemaViewer.pollClosedAt', { date: new Date(p.closesAt).toLocaleString(formatLocale()) })}</Text> : null}
                        {p.myChoiceStatus ? <Text style={styles.mine}>{p.myChoiceStatus === 'qualified' ? t('cinema.storyPolls.yourChoiceIsCounted') : p.myChoiceStatus === 'under_review' ? t('cinema.storyPolls.yourChoiceIsAwaitingReview') : t('cinema.storyPolls.yourChoiceWasExcludedByModeration')}</Text> : null}
                        {p.options.map((o) => (
                            <Pressable
                                key={o.id}
                                accessibilityRole="radio"
                                accessibilityLabel={o.label}
                                accessibilityState={{ checked: (p.myOptionId ?? selected[p.id]) === o.id, disabled: !canChoose || busy !== null }}
                                disabled={!canChoose || busy !== null}
                                style={[styles.option, (p.myOptionId ?? selected[p.id]) === o.id && styles.optionOn]}
                                onPress={() => setSelected(prev => ({ ...prev, [p.id]: o.id }))}
                            >
                                <Text style={styles.optionText}>{o.label}</Text>
                                <Text style={styles.muted}>{o.votes}</Text>
                            </Pressable>
                        ))}
                        {canChoose ? <Button label={t('cinema.storyPolls.submitStoryChoice')} disabled={!selected[p.id] || busy !== null} onPress={() => choose(p, selected[p.id])} /> : null}
                        <Text style={styles.muted}>{t('cinema.storyPolls.answersHeldForReviewAreExcluded')}</Text>
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
