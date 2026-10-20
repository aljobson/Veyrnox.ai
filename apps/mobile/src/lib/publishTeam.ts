import { ApiError, type ApiClient } from './api';
import { brandStore } from './publishBrand';

// ADR-0163: team members and the activity log, read-only. Both routes answer 404 `teams_not_open` while the server flag
// is off, and 403 unless the person is an owner or manager of the brand. Invitation links are never read or shown.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface Member {
    readonly userId: string;
    readonly email: string;
    readonly role: string;
    readonly joinedAt: string | null;
}
export interface Invitation {
    readonly id: string;
    readonly email: string;
    readonly role: string;
    readonly status: string;
    readonly expiresAt: string | null;
}
export interface Team {
    readonly brandId: string;
    readonly brandName: string;
    readonly actorRole: string;
    readonly members: Member[];
    readonly invitations: Invitation[];
}

export function parseTeam(body: unknown): Team {
    const b = isObject(body) ? body : {};
    const members: Member[] = [];
    for (const m of list(b.members)) {
        if (!isObject(m)) continue;
        const userId = str(m.user_id);
        const email = str(m.email);
        if (userId && email) members.push({ userId, email, role: str(m.role) ?? 'viewer', joinedAt: str(m.joined_at) });
    }
    const invitations: Invitation[] = [];
    for (const i of list(b.invitations)) {
        if (!isObject(i)) continue;
        const id = str(i.id);
        const email = str(i.email);
        if (id && email) invitations.push({ id, email, role: str(i.role) ?? 'viewer', status: str(i.status) ?? 'pending', expiresAt: str(i.expires_at) });
    }
    return { brandId: str(b.brand_id) ?? '', brandName: str(b.brand_name) ?? '', actorRole: str(b.actor_role) ?? '', members, invitations };
}

// The chosen brand's id goes in the query because the team route does not read the brand header.
export async function fetchTeam(api: ApiClient): Promise<Team> {
    const brand = brandStore.get();
    return parseTeam(await api.request(`/api/v1/social/team${brand ? `?brand_id=${encodeURIComponent(brand)}` : ''}`));
}

export interface ActivityEvent {
    readonly id: string;
    readonly source: string;
    readonly action: string;
    readonly actor: string;
    readonly detail: string | null;
    readonly createdAt: string | null;
}
export interface ActivityCursor {
    readonly created_at: string;
    readonly id: string;
    readonly source: string;
}

const DETAIL_MAX = 160;

// Detail is provider and person text, so it is shown as plain bounded text and never as markup.
export function detailText(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const raw = typeof v === 'string' ? v : JSON.stringify(v);
    // eslint-disable-next-line no-control-regex
    const clean = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!clean || clean === '{}' || clean === 'null') return null;
    return clean.length > DETAIL_MAX ? `${clean.slice(0, DETAIL_MAX)}…` : clean;
}

export function parseActivity(body: unknown): { events: ActivityEvent[]; next: ActivityCursor | null; limited: boolean } {
    const b = isObject(body) ? body : {};
    const events: ActivityEvent[] = [];
    for (const e of list(b.events)) {
        if (!isObject(e)) continue;
        const id = str(e.id);
        const action = str(e.action);
        if (!id || !action) continue;
        events.push({ id, source: str(e.source) ?? '', action, actor: str(e.actor_email) ?? 'System', detail: detailText(e.detail), createdAt: str(e.created_at) });
    }
    const n = b.next_cursor;
    const next = isObject(n) && typeof n.created_at === 'string' && typeof n.id === 'string' && typeof n.source === 'string' ? { created_at: n.created_at, id: n.id, source: n.source } : null;
    return { events, next, limited: b.history_limited === true };
}

// The route takes the cursor as base64url of its JSON (lib/social/activityCursor.js).
export function encodeCursor(c: ActivityCursor): string {
    return btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function fetchActivity(api: ApiClient, cursor?: ActivityCursor | null) {
    return parseActivity(await api.request(`/api/v1/social/activity?limit=50${cursor ? `&cursor=${encodeCursor(cursor)}` : ''}`));
}

// "invite_member" -> "Invite member"
export const actionLabel = (a: string): string => {
    const words = a.replace(/[_.-]+/g, ' ').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : a;
};

export function teamErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'team.err.network';
    if (err.status === 402) return 'team.err.plan';
    if (err.status === 403) return 'team.err.role';
    if (err.status === 404) return 'team.err.notOpen';
    if (err.status === 429) return 'team.err.rate';
    return 'team.err.later';
}

// ADR-0187: change a member's role, remove a member, revoke a pending invitation. The route wants the brand id, which
// the team read returns. Only an owner or manager may; a manager cannot touch another manager or make one, and nobody
// changes the owner. The server enforces all of it; these helpers only keep the buttons honest.
export const CHANGEABLE_ROLES = ['manager', 'editor', 'reviewer', 'analyst', 'viewer'] as const;
export type ChangeableRole = (typeof CHANGEABLE_ROLES)[number];

export function canManage(actorRole: string, memberRole: string): boolean {
    if (memberRole === 'owner') return false;
    if (actorRole === 'owner') return true;
    return actorRole === 'manager' && memberRole !== 'manager';
}

// Roles the actor may give: a manager cannot make another manager.
export const rolesFor = (actorRole: string): readonly ChangeableRole[] => (actorRole === 'owner' ? CHANGEABLE_ROLES : CHANGEABLE_ROLES.filter((r) => r !== 'manager'));

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const changeRole = (api: ApiClient, brandId: string, memberUserId: string, role: ChangeableRole) =>
    api.request('/api/v1/social/team', json('PATCH', { brandId, memberUserId, action: 'role', role }));

export const removeMember = (api: ApiClient, brandId: string, memberUserId: string) =>
    api.request('/api/v1/social/team', json('PATCH', { brandId, memberUserId, action: 'remove' }));

export const revokeInvite = (api: ApiClient, brandId: string, inviteId: string) =>
    api.request(`/api/v1/social/team?brand_id=${encodeURIComponent(brandId)}&invite_id=${encodeURIComponent(inviteId)}`, { method: 'DELETE' });

export function teamActionErrorKey(err: unknown): string {
    const code = err instanceof ApiError ? err.code : '';
    if (code === 'MEMBER_NOT_FOUND' || code === 'INVITE_NOT_FOUND') return 'team.err.gone';
    if (err instanceof ApiError && err.status === 403) return 'team.err.cannot';
    if (err instanceof ApiError && err.status === 400) return 'team.err.invalid';
    return teamErrorKey(err);
}

// ADR-0239: invite a person. The route answers with a private invitation link (a bearer link: whoever opens it while
// signed in with the invited email joins). It is shown once, on the form that made it, and handed to the share sheet
// only on a tap; it is not stored or logged, and the team list still never reads links.
const EMAIL_RE = /^[^\s<>@]{1,64}@[^\s<>@]{1,185}\.[^\s<>@]{1,63}$/;
export const validEmail = (e: string): boolean => e.length <= 254 && EMAIL_RE.test(e);

export interface Invitation_ {
    readonly id: string;
    readonly email: string;
    readonly role: string;
    readonly expiresAt: string | null;
    readonly url: string | null;
}

// Only an https link whose path is /social/team/invite/... is kept.
export function isInviteLink(url: unknown): url is string {
    if (typeof url !== 'string' || url.length > 2000) return false;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && u.pathname.startsWith('/social/team/invite/');
    } catch {
        return false;
    }
}

export function parseInvited(body: unknown): { invitation: Invitation_ | null; idempotent: boolean } {
    const b = isObject(body) ? body : {};
    const i = isObject(b.invitation) ? b.invitation : null;
    const id = i ? str(i.id) : null;
    const email = i ? str(i.email) : null;
    if (!i || !id || !email) return { invitation: null, idempotent: false };
    return { invitation: { id, email: email.slice(0, 254), role: str(i.role) ?? 'viewer', expiresAt: str(i.expires_at), url: isInviteLink(i.url) ? i.url : null }, idempotent: b.idempotent === true };
}

export async function inviteMember(api: ApiClient, brandId: string, email: string, role: ChangeableRole) {
    return parseInvited(await api.request('/api/v1/social/team', json('POST', { brandId, email: email.trim().toLowerCase(), role })));
}

export function inviteErrorKey(err: unknown): string {
    if (err instanceof ApiError && err.status === 400) return 'team.err.inviteInvalid';
    if (err instanceof ApiError && err.status === 429) return 'team.err.rate';
    return teamActionErrorKey(err);
}
