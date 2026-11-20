import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Button, Text, TextField } from '../ui';
import { PublicShell } from './PublicShell';
import { PublicBlocked } from './PublicBlocked';
import { usePublicMusic } from '../../lib/music/usePublicMusic';
import { creatorName, REPORT_CATEGORIES, type ReportCategory } from '../../lib/music/publicTypes';
import { t } from '../../lib/i18n';
export function PublicReportForm({ kind }: { kind: 'report' | 'report_song' }) {
    const params = useLocalSearchParams<{ slug: string; commentId?: string; before?: string }>();
    const slug = typeof params.slug === 'string' ? params.slug : '';
    const context = usePublicMusic({ kind: 'track', slug, before: kind === 'report' && typeof params.before === 'string' ? params.before : undefined });
    return <ReportBody key={`${slug}:${params.commentId ?? ''}:${context.session.snapshot().account}`} kind={kind} commentId={params.commentId} slug={slug} {...context} />;
}
function ReportBody({ kind, commentId, slug, flow, state }: ReturnType<typeof usePublicMusic> & { kind: 'report' | 'report_song'; commentId?: string; slug: string }) {
    const [category, setCategory] = useState<ReportCategory>('other'), [details, setDetails] = useState('');
    const [invalid, setInvalid] = useState(false), [done, setDone] = useState<{ id: string; name: string } | null>(null);
    const data = state.data && 'track' in state.data ? state.data : null;
    const blocked = state.data && 'blocked' in state.data ? state.data.blocked : null;
    const comment = data?.comments?.comments.find(c => c.id === commentId);
    const target = kind === 'report_song' ? data && state.social && !state.social.is_own && data.reports
        ? { id: data.track.creator_id, name: creatorName(data.track) } : null : comment && !comment.own ? { id: comment.author_id, name: comment.author } : null;
    const pending = flow.attempts.snapshot(), locked = state.busy || !!pending;
    async function send() {
        if (!target || state.busy) return;
        if (details.trim().length < 3) { setInvalid(true); return; }
        const write = pending?.write ?? (kind === 'report_song' ? { kind, slug, category, details } : { kind, comment_id: commentId!, category, details });
        if (await flow.write(write)) setDone(target);
    }
    return <PublicShell title={t(kind === 'report_song' ? 'musicPublic.reportTrack' : 'comments.reportTitle')} {...state} refresh={() => void flow.load()}>
        {blocked ? <PublicBlocked blocked={blocked} busy={state.busy} unblock={() => void flow.block(blocked.creator_id, false)} /> : done ? <>
            <Text accessibilityRole="alert">{t('comments.reported')}</Text>
            <Button label={flow.session.blocked(done.id) ? t('musicPublic.unblock') : t('musicPublic.blockNamed', { name: done.name })} disabled={state.busy} onPress={() => void flow.block(done.id, !flow.session.blocked(done.id), done.name)} />
        </> : target ? <>
            <Text>{t('musicPublic.reportIntro')}</Text>
            {REPORT_CATEGORIES.map(c => <Button key={c} variant={category === c ? 'secondary' : 'tertiary'} label={t(`comments.cat.${c}`)} disabled={locked}
                accessibilityState={{ selected: category === c }} onPress={() => setCategory(c)} />)}
            <TextField label={t('comments.reportDetails')} value={details} maxLength={500} multiline editable={!locked} onChangeText={v => { setDetails(v); setInvalid(false); }}
                onBlur={() => setInvalid(details.trim().length < 3)} error={invalid ? t('musicPublic.detailsInvalid') : undefined} />
            <Text>{t('comments.reportCount', { min: 3, left: 500 - details.length })}</Text>
            {pending ? <Text>{t('musicPlaylists.pending')}</Text> : null}
            <Button label={t(pending ? 'music.retry' : 'comments.send')} disabled={state.busy} onPress={() => void send()} />
        </> : state.status === 'on' ? <Text>{t('musicPublic.reportUnavailable')}</Text> : null}
    </PublicShell>;
}
