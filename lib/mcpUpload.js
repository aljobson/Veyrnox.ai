// The upload path of the Veyrnox MCP connector (ADR-0100 amendment 6): an assistant reserves a presigned PUT for the user's own file, sends
// the bytes to it, and names the returned key as a source of generate_video or generate_image. Nothing here touches R2 or the database:
// the reservation is the web app's own POST /api/v1/uploads (ADR-0028: random UUID key scoped to the account, 15-minute presigned PUT,
// allowlisted type and size, reservation budget, 24-hour sweep), and the generation route checks ownership, bytes and size at submit.
import { ALLOWED_UPLOAD_TYPES, UPLOAD_URL_TTL_SECONDS, isUploadKey, typeForKey } from './uploadSource.js';

export const MCP_UPLOAD_TYPES = Object.freeze(Object.keys(ALLOWED_UPLOAD_TYPES));
export const MCP_UPLOAD_MAX_BYTES = Math.max(...Object.values(ALLOWED_UPLOAD_TYPES).map((rule) => rule.maxBytes));
// Shape of a key /api/v1/uploads mints: uploads/<account uuid>/<file uuid>.<ext>. Ownership is checked by the route, not here.
export const MCP_UPLOAD_KEY_RE = /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{3,4}$/i;

/** What the connector accepts: one entry per allowlisted media type with its byte ceiling. */
export function acceptedUploadTypes() {
    return Object.entries(ALLOWED_UPLOAD_TYPES).map(([content_type, rule]) => ({ content_type, max_bytes: rule.maxBytes }));
}

const refuse = (status, body) => ({ ok: false, status, body });

/**
 * Reserve one upload. Every refusal of the uploads route (type, size, balance, rate limit, pending cap, reservation budget) passes through.
 * @param args { content_type, size_bytes }, already schema-checked
 * @param deps { reserveUpload(body) } -> { response, data } from POST /api/v1/uploads with the request's verified identity
 */
export async function reserveMcpUpload(args, deps) {
    const { response, data } = await deps.reserveUpload({ content_type: args.content_type, size_bytes: args.size_bytes });
    if (!response.ok) return refuse(response.status, data);
    const expiresIn = Number.isInteger(data.expires_in) ? data.expires_in : UPLOAD_URL_TTL_SECONDS;
    return {
        ok: true,
        data: {
            key: data.key,
            upload_url: data.upload_url,
            method: 'PUT',
            content_type: data.content_type,
            headers: data.headers || { 'Content-Type': data.content_type },
            max_bytes: data.max_bytes,
            expires_in: expiresIn,
            ...(data.reserved_until ? { reserved_until: data.reserved_until } : {}),
            accepted_content_types: acceptedUploadTypes(),
            instruction: `Send the file bytes as the body of an HTTP PUT to upload_url within ${expiresIn} seconds, with exactly the headers listed (the Content-Type is part of the signature) and no more than max_bytes bytes. A 200 from the PUT means the file is stored. Then pass key in source_uploads of generate_video or generate_image, with consent: true once the user has confirmed their rights to the file. An unused upload is removed after 24 hours.`,
        },
    };
}

const KIND_FOR_FIELD = { image_url: 'image', video_url: 'video', audio_url: 'audio' };
const UPLOAD_INSTRUCTION = 'Reserve each file with reserve_source_upload, PUT the bytes to its upload_url, and pass the returned key with a slot of the same media kind.';
const kindForSlot = (slot) => (slot === 'endImage' ? 'image' : slot);

/**
 * Check that every upload reference names a key this connector could have reserved and that the file's media kind
 * (recorded in the key's extension at reservation time) fits the slot. Ownership and bytes are the route's checks.
 * @returns {{ok:true}|{ok:false, body:{error:string}}}
 */
export function checkSourceUploads(uploads) {
    for (const ref of uploads || []) {
        if (!ref || typeof ref.key !== 'string' || !isUploadKey(ref.key)) return { ok: false, body: { error: 'source_upload_invalid', key: ref?.key, instruction: UPLOAD_INSTRUCTION } };
        const kind = KIND_FOR_FIELD[typeForKey(ref.key)?.field];
        if (kind !== kindForSlot(ref.slot)) return { ok: false, body: { error: 'source_upload_kind_mismatch', key: ref.key, slot: ref.slot, file_kind: kind, instruction: UPLOAD_INSTRUCTION } };
    }
    return { ok: true };
}
