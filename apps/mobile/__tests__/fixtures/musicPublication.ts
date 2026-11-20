import type { Publication, PublishInput } from '../../src/lib/music/validatePublication';
import { song } from './music';
export const songId = '11111111-1111-4111-8111-111111111111';
export const versionId = '22222222-2222-4222-8222-222222222222';
export const slug = 'abcdef0123456789abcdef01';
export const token = 'Ab0_-'.repeat(8) + 'xyz';
export const publication: Publication = { slug, status: 'published', allow_comments: true, allow_remixes: false,
    commercial_status: 'personal_use_only', handle: 'artist_one', display_name: 'Artist One', published_at: '2026-11-20T10:00:00Z' };
export const input: PublishInput = { version_id: versionId, handle: publication.handle, display_name: publication.display_name,
    allow_comments: true, allow_remixes: false, rights_confirmed: true };
const base = { slug, status: publication.status, allow_comments: publication.allow_comments, allow_remixes: publication.allow_remixes,
    commercial_status: publication.commercial_status, handle: publication.handle, display_name: publication.display_name };
export const receipt = { publication: { ...base, url: `/music/tracks/${slug}`, profile_url: '/music/creators/artist_one' } };
export const shared = { song: { title: 'Shared song', version_number: 1, created_at: publication.published_at, audio_url: `/api/music/shared/${token}/asset` } };
export const detail = { ...song, id: songId, version_id: versionId, current_version: { ...song.current_version, id: versionId },
    versions: [{ ...song.versions[0], id: versionId }] };
export function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
export const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
