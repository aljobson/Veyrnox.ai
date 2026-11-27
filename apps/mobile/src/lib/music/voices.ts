import type { ApiClient } from '../api';
import { ApiError } from '../api';
import { isRecord } from '../responseShapes';

export type MusicVoiceStatus = 'challenge_issued' | 'pending_review' | 'verified' | 'rejected' | 'revoked' | 'expired';
export type MusicVoiceProfile = {
    readonly id: string; readonly name: string; readonly status: MusicVoiceStatus; readonly submission_revision: number;
    readonly challenge_expires_at: string | null; readonly review_expires_at: string | null;
    readonly verified_at: string | null; readonly verification_expires_at: string | null;
    readonly reason_code: string | null; readonly created_at: string | null; readonly updated_at: string | null;
};
export type MusicVoiceChallenge = { readonly phrase: string; readonly expires_at: string | null };

const BASE = '/api/v1/music/voices';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set<MusicVoiceStatus>(['challenge_issued', 'pending_review', 'verified', 'rejected', 'revoked', 'expired']);
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const bad = () => new ApiError(200, 'bad_response');

function profile(value: unknown): value is MusicVoiceProfile {
    if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.name !== 'string'
        || typeof value.status !== 'string' || !statuses.has(value.status as MusicVoiceStatus)
        || !Number.isSafeInteger(value.submission_revision)) return false;
    return ['challenge_expires_at', 'review_expires_at', 'verified_at', 'verification_expires_at', 'reason_code', 'created_at', 'updated_at']
        .every(key => value[key] === null || typeof value[key] === 'string');
}
function challenge(value: unknown): value is MusicVoiceChallenge {
    return isRecord(value) && typeof value.phrase === 'string' && value.phrase.length > 0
        && (value.expires_at === null || typeof value.expires_at === 'string');
}
function readProfile(value: unknown): MusicVoiceProfile {
    if (!isRecord(value) || !profile(value.profile)) throw bad();
    return value.profile;
}

export async function listMusicVoices(api: ApiClient): Promise<{ profiles: readonly MusicVoiceProfile[]; enrollmentAvailable: boolean }> {
    const value = await api.request<unknown>(BASE);
    if (!isRecord(value) || !Array.isArray(value.profiles) || !value.profiles.every(profile) || !isRecord(value.policy)
        || typeof value.policy.enrollment_available !== 'boolean') throw bad();
    return { profiles: value.profiles, enrollmentAvailable: value.policy.enrollment_available };
}
export async function enrollMusicVoice(api: ApiClient, input: {
    readonly name: string; readonly referenceKey: string; readonly idempotencyKey: string;
}): Promise<{ profile: MusicVoiceProfile; challenge: MusicVoiceChallenge | null }> {
    const value = await api.request<unknown>(BASE, post({ name: input.name, reference_source_key: input.referenceKey,
        owner_attestation: true, adult_attestation: true, eligible_region_attestation: true,
        consent_version: 'music-own-voice-2026-11-24', idempotency_key: input.idempotencyKey }));
    const saved = readProfile(value);
    return { profile: saved, challenge: isRecord(value) && challenge(value.challenge) ? value.challenge : null };
}
export async function reissueMusicVoiceChallenge(api: ApiClient, id: string, idempotencyKey: string): Promise<MusicVoiceChallenge | null> {
    const value = await api.request<unknown>(`${BASE}/${encodeURIComponent(id)}/challenge`, post({ idempotency_key: idempotencyKey }));
    if (!isRecord(value) || !profile(value.profile)) throw bad();
    if (challenge(value.challenge)) return value.challenge;
    if (value.challenge_reissue_required === true && value.idempotent === true) return null;
    throw bad();
}
export async function submitMusicVoiceChallenge(api: ApiClient, id: string, input: {
    readonly challengeKey: string; readonly phrase: string; readonly idempotencyKey: string;
}): Promise<MusicVoiceProfile> {
    return readProfile(await api.request<unknown>(`${BASE}/${encodeURIComponent(id)}/verify`, post({
        challenge_source_key: input.challengeKey, phrase: input.phrase,
        live_recording_attestation: true, idempotency_key: input.idempotencyKey,
    })));
}
export async function revokeMusicVoice(api: ApiClient, id: string, idempotencyKey: string): Promise<MusicVoiceProfile> {
    return readProfile(await api.request<unknown>(`${BASE}/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'Idempotency-Key': idempotencyKey },
    }));
}
