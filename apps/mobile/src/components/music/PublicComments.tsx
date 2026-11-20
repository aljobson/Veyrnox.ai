import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, Text, TextField, useThemedStyles } from '../ui';
import { plural, t } from '../../lib/i18n';
import type { Comments } from '../../lib/music/publicTypes';
import type { createPublicFlow, PublicFlowState } from '../../lib/music/publicFlow';
import { publicSheets } from './PublicShell';
export function PublicComments({ comments, flow, state, slug, position }: { comments: Comments; flow: ReturnType<typeof createPublicFlow>;
    state: PublicFlowState; slug: string; position: number }) {
    const s = useThemedStyles(publicSheets), router = useRouter();
    const [body, setBody] = useState(''), [timestamp, setTimestamp] = useState<number | undefined>(), [invalid, setInvalid] = useState(false);
    const pending = flow.attempts.snapshot();
    useEffect(() => { if (state.notice === 'pending') { setBody(''); setTimestamp(undefined); } }, [state.notice]);
    const locked = state.busy || !!pending;
    return <View style={s.group}>
        <Text variant="title3">{t('musicPublic.comments')}</Text>
        {!comments.comments.length ? <Text>{t('musicPublic.noComments')}</Text> : null}
        {comments.comments.map(c => <View key={c.id} style={s.group}>
            <Text>{c.author}</Text><Text>{c.body}</Text>
            {c.at_seconds !== null ? <Text>{plural('musicPublic.position', c.at_seconds)}</Text> : null}
            {c.parent_id ? <Text>{t('musicPublic.replyComment')}</Text> : null}
            {comments.allow_comments ? <Button variant="tertiary" label={t('musicPublic.reply')} disabled={locked} onPress={() => flow.reply(c)} /> : null}
            {c.own ? <Button variant="tertiary" label={t('comments.withdraw')} disabled={locked} onPress={() => void flow.write({ kind: 'withdraw', comment_id: c.id })} /> : <>
                <Button variant="tertiary" label={t('comments.reportBy', { name: c.author })} onPress={() => router.push({ pathname: '/music/report-comment', params: { slug, commentId: c.id, before: flow.commentCursor(c.id) } } as never)} />
                <Button variant="tertiary" label={t('musicPublic.blockNamed', { name: c.author })} disabled={state.busy} onPress={() => void flow.block(c.author_id, true, c.author)} />
            </>}
        </View>)}
        {comments.own_comments.map(c => <View key={c.id} style={s.group}>
            <Text>{c.body}</Text><Text>{t(c.status === 'pending' ? 'musicPublic.pending' : 'comments.status.rejected')}</Text>
            <Button variant="tertiary" label={t('comments.withdraw')} disabled={locked} onPress={() => void flow.write({ kind: 'withdraw', comment_id: c.id })} />
        </View>)}
        {comments.next_cursor ? <Button variant="secondary" label={t('comments.more')} disabled={state.refreshing} onPress={() => void flow.more()} /> : null}
        {comments.allow_comments ? <>
            <Text>{t('musicPublic.moderated')}</Text>
            {state.reply ? <><Text>{t('musicPublic.replyTo', { name: state.reply.author })}</Text>
                <Button variant="tertiary" label={t('musicPublic.cancelReply')} onPress={() => flow.reply(null)} disabled={locked} /></> : null}
            <TextField label={t('musicPublic.commentBody')} value={pending?.write.kind === 'submit' ? pending.write.body : body} maxLength={1000} multiline editable={!locked}
                error={invalid ? t('musicPublic.bodyInvalid') : undefined} onBlur={() => setInvalid(!body.trim())} onChangeText={v => { setBody(v); setInvalid(false); }} />
            <Text>{t('musicPublic.characterCount', { count: (pending?.write.kind === 'submit' ? pending.write.body : body).length, max: 1000 })}</Text>
            <Button variant="tertiary" label={timestamp === undefined ? t('musicPublic.addTimestamp') : plural('musicPublic.removeTimestamp', timestamp)}
                disabled={locked || (timestamp === undefined && position > 600)} onPress={() => setTimestamp(timestamp === undefined ? Math.round(Math.max(0, position) * 10) / 10 : undefined)} />
            <Button label={t('musicPublic.submit')} disabled={locked} onPress={() => {
                if (!body.trim()) { setInvalid(true); return; }
                void flow.write({ kind: 'submit', slug, body, ...(timestamp === undefined ? {} : { at_seconds: timestamp }), ...(state.reply ? { parent_id: state.reply.id } : {}) });
            }} />
        </> : <Text>{t('musicPublic.commentsClosed')}</Text>}
    </View>;
}
