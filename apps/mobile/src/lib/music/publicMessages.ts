import { ApiError } from '../api';
import { plural, t } from '../i18n';
export function publicMessage(error: unknown) {
    if (!(error instanceof ApiError)) return t('music.offline');
    if (error.code === 'public_social_unavailable') return t('musicPublic.socialUnavailable');
    if (error.code === 'public_comment_gone') return t('musicPublic.commentGone');
    if (error.code === 'public_reporting_unavailable' || error.code === 'music_song_reports_unavailable') return t('musicPublic.reportUnavailable');
    if (error.status === 429) return plural('musicPublic.rate', error.retryAfterSeconds ?? 60);
    if (error.code === 'cannot_block_self' || error.code === 'own_song' || error.code === 'self_review') return t('musicPublic.ownError');
    if (error.code === 'block_limit') return t('musicPublic.blockLimit');
    if (error.code === 'pending_result') return t('musicPlaylists.pending');
    if (error.code === 'network') return t('music.offline');
    if (error.status === 401) return t('musicPlaylists.signIn');
    if (error.status === 403) return t('musicPublic.denied');
    if (error.code === 'comments_closed') return t('musicPublic.commentsClosed');
    if (error.code === 'not_found' || error.code.endsWith('_unavailable')) return t('music.off');
    return t('music.loadError');
}
