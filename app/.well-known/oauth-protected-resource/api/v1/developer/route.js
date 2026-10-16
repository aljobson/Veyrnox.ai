const PUBLIC_ORIGIN = process.env.PUBLIC_HOST || 'https://veyrnox.ai';

export function GET() {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) return Response.json({ error: 'oauth_not_configured' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    return Response.json({
        resource: `${PUBLIC_ORIGIN}/api/v1/developer`,
        authorization_servers: [`${supabaseUrl.replace(/\/$/, '')}/auth/v1`],
        scopes_supported: ['openid', 'email', 'profile'],
        resource_name: 'Veyrnox.ai Developer API',
        resource_documentation: `${PUBLIC_ORIGIN}/developers`,
    }, { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
}
