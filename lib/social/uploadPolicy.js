import { checkDeclared } from '../uploadSource.js';

export const SOCIAL_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
export function checkSocialUpload(type, size) {
    if (!SOCIAL_UPLOAD_TYPES.includes(type)) return { ok: false, error: 'upload_type_not_allowed' };
    return checkDeclared(type, size);
}
export function socialUploadsEnabled(env = process.env) {
    return env.PUBLISH_ENABLED === 'true' && env.PUBLISH_UPLOADS_ENABLED === 'true';
}
