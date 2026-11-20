import { isRecord } from '../responseShapes';
import { exact, publicDate, publicHandle, publicKey, publicSlug, publicUuid } from './validatePublic';
export interface Publication {
    slug: string; status: 'published' | 'unpublished' | 'blocked'; allow_comments: boolean; allow_remixes: boolean;
    commercial_status: 'personal_use_only' | 'plan_eligible_terms_apply'; handle: string; display_name: string; published_at: string;
}
export interface PublishInput {
    version_id: string; handle: string; display_name: string; allow_comments: boolean; allow_remixes: boolean; rights_confirmed: true;
}
export const publicationName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 80 && !/[\u0000-\u001f\u007f]/.test(v);
const fields = ['slug', 'status', 'allow_comments', 'allow_remixes', 'commercial_status', 'handle', 'display_name'];
function base(v: unknown): boolean {
    return isRecord(v) && publicSlug(v.slug) && ['published', 'unpublished', 'blocked'].includes(v.status as string)
        && typeof v.allow_comments === 'boolean' && typeof v.allow_remixes === 'boolean'
        && ['personal_use_only', 'plan_eligible_terms_apply'].includes(v.commercial_status as string)
        && publicHandle(v.handle) && publicationName(v.display_name);
}
export function isPublicationRead(v: unknown): v is { publication: Publication | null } {
    return isRecord(v) && exact(v, ['publication']) && (v.publication === null || isRecord(v.publication)
        && exact(v.publication, [...fields, 'published_at']) && base(v.publication) && publicDate(v.publication.published_at));
}
// The publish RPC receipt deliberately has no published_at. Only GET supplies current state.
export function isPublishReceipt(v: unknown): boolean {
    if (!isRecord(v) || !exact(v, ['publication']) || !isRecord(v.publication)) return false;
    const p = v.publication;
    return exact(p, [...fields, 'url', 'profile_url']) && base(p)
        && p.url === `/music/tracks/${p.slug}` && p.profile_url === `/music/creators/${p.handle}`;
}
export function isUnpublishReceipt(v: unknown): boolean {
    return isRecord(v) && exact(v, ['ok', 'idempotent']) && v.ok === true && typeof v.idempotent === 'boolean';
}
export function isPublishInput(v: unknown): v is PublishInput {
    return isRecord(v) && exact(v, ['version_id', 'handle', 'display_name', 'allow_comments', 'allow_remixes', 'rights_confirmed'])
        && publicUuid(v.version_id) && publicHandle(v.handle) && publicationName(v.display_name)
        && typeof v.allow_comments === 'boolean' && typeof v.allow_remixes === 'boolean' && v.rights_confirmed === true;
}
export const publicationRequestValid = (song: string, key: string) => publicUuid(song) && publicKey(key);
