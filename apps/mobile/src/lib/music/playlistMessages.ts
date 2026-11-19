import { t } from '../i18n';
export function playlistMessage(code: string) {
    const keys: Record<string, string> = { title_invalid: 'titleInvalid', revision_conflict: 'conflict', invalid_songs: 'invalidSongs',
        network: 'offline', scan_stale: 'scanStale', saved: 'saved', noneUnavailable: 'noneUnavailable', pending_result: 'pending',
        not_authenticated: 'signIn', account_changed: 'signIn', account_frozen: 'denied' };
    return t(`musicPlaylists.${keys[code] ?? 'error'}`);
}
