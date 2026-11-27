import { adminGate, IDEMPOTENCY_RE } from '../../../../../../../lib/adminGate.js';
import {
    freshAdminMfa, panelAccess, panelFailure, panelGateResponse, panelReply,
} from '../../../../../../../lib/adminPanelApi.js';
import { readMusicJson } from '../../../../../../../lib/musicBackend.js';
import {
    MUSIC_VOICE_POLICY_VERSION, MUSIC_VOICE_REVIEW_PERMISSION, musicVoiceRequestDigest, musicVoicesReady,
    openMusicVoiceChallenge, parseMusicVoiceEvidence, parseMusicVoiceReview, publicMusicVoiceProfile,
    validMusicVoiceId,
} from '../../../../../../../lib/musicVoices.js';
import { envConfig as r2Config, isConfigured, presignGetUrl } from '../../../../../../../packages/adapters/r2.js';
import { rpc } from '../../../../../../../packages/db/supabase-client.js';

const routePath = async ({ params }) => {
    const value = (await params)?.voicePath;
    return Array.isArray(value) ? value : [];
};
const notFound = () => panelReply({ error: 'not_found' }, 404);

async function adminContext(req, { requireMfa = false } = {}) {
    const g = await adminGate(req); if (g.response) return { response: panelGateResponse(g) };
    if (!musicVoicesReady()) return { response: notFound() };
    const mfa = requireMfa ? freshAdminMfa(req) : null;
    if (requireMfa && !mfa) return { response: panelReply({ error: 'mfa_required' }, 403) };
    try { await panelAccess(g, MUSIC_VOICE_REVIEW_PERMISSION); }
    catch (error) { return { response: panelFailure(error) }; }
    return { g, mfa };
}

async function listVoices(req) {
    const ctx = await adminContext(req); if (ctx.response) return ctx.response;
    try {
        const result = await rpc('music_voice_admin_list', { p_auth_id: ctx.g.authId }, ctx.g.cfg);
        return result?.ok && Array.isArray(result.profiles)
            ? panelReply({ profiles: result.profiles }) : panelReply({ error: 'voice_review_unavailable' }, 503);
    } catch (error) { return panelFailure(error); }
}

async function evidence(req, id) {
    const ctx = await adminContext(req, { requireMfa: true }); if (ctx.response) return ctx.response;
    if (!validMusicVoiceId(id)) return panelReply({ error: 'voice_id_invalid' }, 400);
    const decoded = await readMusicJson(req, 1024); if (!decoded.ok) return panelReply({ error: decoded.error }, 400);
    const input = parseMusicVoiceEvidence(decoded.value); if (!input.ok) return panelReply({ error: input.error }, 400);
    const r2cfg = r2Config(); if (!isConfigured(r2cfg)) return panelReply({ error: 'storage_not_configured' }, 503);
    try {
        const result = await rpc('music_voice_admin_evidence', { p_auth_id: ctx.g.authId, p_profile_id: id,
            p_revision: input.revision, ...ctx.mfa }, ctx.g.cfg);
        if (!result?.ok) {
            const code = String(result?.code || 'voice_review_unavailable').toLowerCase();
            return panelReply({ error: code }, code === 'not_found' ? 404
                : ['mfa_required','self_review_forbidden'].includes(code) ? 403
                    : code === 'evidence_rate_limit' ? 429 : 409);
        }
        const phrase = await openMusicVoiceChallenge({ profileId: id, sealed: result.challenge_ciphertext },
            process.env.MUSIC_VOICE_CHALLENGE_SECRET);
        if (!phrase || typeof result.reference_source_key !== 'string' || typeof result.challenge_source_key !== 'string') {
            return panelReply({ error: 'voice_evidence_unavailable' }, 503);
        }
        const [reference, challenge] = await Promise.all([
            presignGetUrl(result.reference_source_key, 300, r2cfg),
            presignGetUrl(result.challenge_source_key, 300, r2cfg),
        ]);
        return panelReply({ profile_id: id, submission_revision: input.revision, phrase,
            reference_url: reference.url, challenge_url: challenge.url, expires_in: 300,
            revocation_tail: 'A URL already issued may remain readable for up to five minutes after revocation.' });
    } catch (error) { return panelFailure(error); }
}

async function acknowledgeEvidence(req, id) {
    const ctx = await adminContext(req, { requireMfa: true }); if (ctx.response) return ctx.response;
    if (!validMusicVoiceId(id)) return panelReply({ error: 'voice_id_invalid' }, 400);
    const decoded = await readMusicJson(req, 1024); if (!decoded.ok) return panelReply({ error: decoded.error }, 400);
    const input = parseMusicVoiceEvidence(decoded.value); if (!input.ok) return panelReply({ error: input.error }, 400);
    try {
        const result = await rpc('music_voice_admin_evidence_delivered', { p_auth_id: ctx.g.authId,
            p_profile_id: id, p_revision: input.revision, ...ctx.mfa }, ctx.g.cfg);
        if (!result?.ok) {
            const code = String(result?.code || 'voice_review_unavailable').toLowerCase();
            return panelReply({ error: code }, code === 'not_found' ? 404
                : ['mfa_required','self_review_forbidden'].includes(code) ? 403 : 409);
        }
        return panelReply({ profile_id: id, submission_revision: input.revision, delivered: true });
    } catch (error) { return panelFailure(error); }
}

async function review(req, id) {
    const ctx = await adminContext(req, { requireMfa: true }); if (ctx.response) return ctx.response;
    if (!validMusicVoiceId(id)) return panelReply({ error: 'voice_id_invalid' }, 400);
    const key = req.headers.get('idempotency-key');
    if (!IDEMPOTENCY_RE.test(key || '') || key.length > 120) return panelReply({ error: 'idempotency_key_invalid' }, 400);
    const decoded = await readMusicJson(req, 4096);
    if (!decoded.ok) return panelReply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicVoiceReview(decoded.value); if (!input.ok) return panelReply({ error: input.error }, 400);
    const digest = await musicVoiceRequestDigest({ operation: 'review', profile_id: id, revision: input.revision,
        decision: input.decision, reason_code: input.reasonCode, checklist: input.checklist,
        policy_version: MUSIC_VOICE_POLICY_VERSION });
    try {
        const result = await rpc('music_voice_admin_review', { p_auth_id: ctx.g.authId, p_profile_id: id,
            p_revision: input.revision, p_decision: input.decision, p_reason_code: input.reasonCode,
            p_checklist: input.checklist, p_idem_key: key, p_request_digest: digest,
            ...ctx.mfa, p_policy_version: MUSIC_VOICE_POLICY_VERSION }, ctx.g.cfg);
        if (!result?.ok) {
            const code = String(result?.code || 'voice_review_unavailable').toLowerCase();
            return panelReply({ error: code }, code === 'not_found' ? 404
                : ['mfa_required','self_review_forbidden'].includes(code) ? 403
                    : ['state_conflict','evidence_not_delivered','idempotency_conflict'].includes(code) ? 409 : 400);
        }
        const profile = publicMusicVoiceProfile(result.profile);
        return profile ? panelReply({ profile, idempotent: result.idempotent === true })
            : panelReply({ error: 'voice_review_unavailable' }, 503);
    } catch (error) { return panelFailure(error); }
}

export async function GET(req, context) {
    return (await routePath(context)).length === 0 ? listVoices(req) : notFound();
}

export async function POST(req, context) {
    const path = await routePath(context);
    if (path.length === 2 && path[1] === 'evidence') return evidence(req, path[0]);
    if (path.length === 3 && path[1] === 'evidence' && path[2] === 'ack') return acknowledgeEvidence(req, path[0]);
    if (path.length === 2 && path[1] === 'review') return review(req, path[0]);
    return notFound();
}
