import { signRunnerBody, verifyRunnerBody } from './montageSigning.js';
export { TIMESTAMP_HEADER, SIGNATURE_HEADER } from './montageSigning.js';

export const CALLBACK_PATH = '/api/webhook/editor-render';
const encoder = new TextEncoder();
function scopedBody(path, body) {
    const prefix = encoder.encode(`POST ${path}.`);
    const bytes = typeof body === 'string' ? encoder.encode(body) : body;
    const message = new Uint8Array(prefix.length + bytes.length);
    message.set(prefix); message.set(bytes, prefix.length);
    return message;
}
// Editor-only domain separation: <timestamp>.POST <path>.<raw body>.
export const signEditorRenderBody = (secret, path, body, timestamp) =>
    signRunnerBody(secret, scopedBody(path, body), timestamp);
export const verifyEditorRenderBody = (secret, path, body, timestamp, signature, now) =>
    verifyRunnerBody(secret, scopedBody(path, body), timestamp, signature, now);
