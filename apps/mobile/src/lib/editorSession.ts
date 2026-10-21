import { documentIdentity, PROTOCOL, type ProjectDocument } from './editorBridge';

export type SessionStatus = 'connecting' | 'loading' | 'ready' | 'dirty' | 'saving' | 'conflict' | 'paused' | 'offline' | 'killed' | 'stopped' | 'unavailable' | 'protocol_mismatch' | 'rejected' | 'start_failed';
export interface Snapshot { document: ProjectDocument; key: string; revision: number }
export interface EditorSession {
    status: SessionStatus;
    document: ProjectDocument | null;
    revision: number;
    dirty: boolean;
    key: string;
    changedAt: number;
    pending: Snapshot | null;
    inFlight: boolean;
    localCopy: 'kept' | 'failed';
    rateLimitedUntil: number;
    nextRetryAt: number;
    offlineAttempts: number;
    kills: number[];
    // Engine recovery is independent of saving the document held by native.
    engineStopped: boolean;
    reloadKey: number;
    protocol: number | null;
}
export const initialSession = (): EditorSession => ({ status: 'connecting', document: null, revision: 0, dirty: false,
    key: '', changedAt: 0, pending: null, inFlight: false, localCopy: 'failed', rateLimitedUntil: 0,
    nextRetryAt: 0, offlineAttempts: 0, kills: [], engineStopped: false, reloadKey: 0, protocol: null });
export type SessionEvent =
    | { type: 'hello'; protocol: number }
    | { type: 'loaded'; document: ProjectDocument; revision: number }
    | { type: 'ready' }
    | { type: 'changed'; document: ProjectDocument; key: string; now: number }
    | { type: 'local'; document: ProjectDocument; kept: boolean }
    | { type: 'save'; now: number }
    | { type: 'saved'; revision: number }
    | { type: 'failed'; status: number; retryAfterSeconds?: number; now: number }
    | { type: 'retry'; now: number }
    | { type: 'kill'; now: number }
    | { type: 'reopen' }
    | { type: 'timeout' };
const equal = (a: unknown, b: unknown) => documentIdentity(a) === documentIdentity(b);
const blocked = (s: EditorSession) => ['conflict', 'unavailable', 'protocol_mismatch', 'rejected', 'start_failed'].includes(s.status);
export function editorReducer(s: EditorSession, event: SessionEvent): EditorSession {
    switch (event.type) {
        case 'loaded': return { ...s, document: event.document, revision: event.revision, dirty: false, pending: null, inFlight: false, status: s.protocol === PROTOCOL ? 'loading' : 'connecting', localCopy: 'failed' };
        case 'hello': return { ...s, protocol: event.protocol, status: event.protocol !== PROTOCOL ? 'protocol_mismatch' : s.dirty ? s.status === 'connecting' ? 'dirty' : s.status : 'loading' };
        case 'ready': return { ...s, status: s.dirty || s.inFlight || blocked(s) ? s.status : 'ready' };
        case 'changed':
            if (equal(s.document, event.document)) return s;
            return { ...s, document: event.document, key: event.key, dirty: true, changedAt: event.now, localCopy: 'failed', pending: s.status === 'rejected' ? null : s.pending,
                status: s.status === 'rejected' ? 'dirty' : s.inFlight ? 'saving' : blocked(s) || ['paused', 'offline'].includes(s.status) ? s.status : 'dirty' };
        case 'local': return equal(s.document, event.document) ? { ...s, localCopy: event.kept ? 'kept' : 'failed' } : s;
        case 'save': {
            const action = nextAction(s, event.now);
            if (action?.type !== 'save' || action.at > event.now || !s.document) return s;
            return { ...s, inFlight: true, status: 'saving', pending: s.pending ?? { document: s.document, key: s.key, revision: s.revision } };
        }
        case 'saved': {
            if (!s.pending) return s;
            const dirty = !equal(s.document, s.pending.document);
            return { ...s, pending: null, inFlight: false, revision: event.revision, dirty, status: ['stopped', 'protocol_mismatch', 'start_failed'].includes(s.status) ? s.status : dirty ? 'dirty' : 'ready', offlineAttempts: 0, nextRetryAt: 0, rateLimitedUntil: 0 };
        }
        case 'failed': {
            const status: SessionStatus = event.status === 0 ? 'offline' : event.status === 409 ? 'conflict' : event.status === 429 ? 'paused'
                : [401, 403, 404, 503].includes(event.status) ? 'unavailable' : event.status === 400 ? 'rejected' : 'dirty';
            const wait = Math.min(600, Math.max(1, Number.isFinite(event.retryAfterSeconds) ? event.retryAfterSeconds! : 60)) * 1000;
            return { ...s, inFlight: false, status: ['protocol_mismatch', 'start_failed'].includes(s.status) ? s.status : status,
                rateLimitedUntil: event.status === 429 ? event.now + wait : s.rateLimitedUntil,
                offlineAttempts: event.status === 0 ? s.offlineAttempts + 1 : s.offlineAttempts,
                nextRetryAt: event.status === 0 ? event.now + Math.min(60, 5 * 2 ** s.offlineAttempts) * 1000
                    : event.status === 429 ? s.nextRetryAt : event.now + 5000 };
        }
        case 'retry': return { ...s, nextRetryAt: event.now, changedAt: event.now - 3000 };
        case 'kill': {
            const kills = [...s.kills.filter(at => event.now - at <= 120000), event.now];
            return { ...s, kills, engineStopped: kills.length >= 2, status: kills.length >= 2 ? 'stopped' : 'killed', protocol: null };
        }
        case 'reopen': return { ...s, engineStopped: false, reloadKey: s.reloadKey + 1, protocol: null, status: s.dirty ? 'dirty' : 'connecting' };
        case 'timeout': return { ...s, status: 'start_failed' };
    }
}
export type SessionAction = { type: 'save'; at: number; reason: 'quiet' | 'rate_limit' | 'connectivity'; snapshot: Snapshot } | { type: 'reopen'; at: number };
export function nextAction(s: EditorSession, now: number): SessionAction | null {
    if (s.status === 'killed') return { type: 'reopen', at: now };
    if (!s.dirty || !s.document || s.inFlight || blocked(s)) return null;
    const quiet = s.pending ? 0 : s.changedAt + 3000;
    const at = Math.max(quiet, s.rateLimitedUntil, s.nextRetryAt);
    const reason = s.rateLimitedUntil > 0 && s.rateLimitedUntil >= Math.max(quiet, s.nextRetryAt) ? 'rate_limit' : s.nextRetryAt > quiet ? 'connectivity' : 'quiet';
    return { type: 'save', at, reason, snapshot: s.pending ?? { document: s.document, key: s.key, revision: s.revision } };
}
