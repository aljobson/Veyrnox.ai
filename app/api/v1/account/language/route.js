import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { isAccountLocale } from '../../../../../lib/accountLanguage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function language(req, write) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID.test(authId || '')) return reply({ error: 'not_authenticated' }, 401);
    const origin = req.headers.get('origin');
    if ((origin && origin !== new URL(req.url).origin)
        || ['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site'))) return reply({ error: 'origin_forbidden' }, 403);
    let locale;
    if (write) {
        let body;
        try { body = await req.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'locale')) {
            return reply({ error: 'invalid_body' }, 400);
        }
        locale = body.locale === 'en' ? null : body.locale;
        if (locale !== null && !isAccountLocale(locale)) return reply({ error: 'invalid_locale' }, 400);
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'language_unavailable' }, 503);
    try {
        const result = await rpc(write ? 'set_user_language' : 'get_user_language', {
            p_auth_id: authId, ...(write ? { p_locale: locale } : {}),
        }, cfg);
        if (result?.ok === true && (result.locale === null || isAccountLocale(result.locale))) return reply({ locale: result.locale });
        if (result?.code === 'ACCOUNT_DELETED') return reply({ error: 'account_deleted' }, 409);
        if (result?.code === 'NOT_FOUND') return reply({ error: 'account_not_found' }, 404);
        if (result?.code === 'INVALID_LOCALE') return reply({ error: 'invalid_locale' }, 400);
    } catch { /* Includes PGRST202: deployment may precede the migration. No upstream details escape. */ }
    return reply({ error: 'language_unavailable' }, 503);
}
export const GET = req => language(req, false);
export const PUT = req => language(req, true);
