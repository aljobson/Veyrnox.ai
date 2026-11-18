import test from 'node:test';
import assert from 'node:assert/strict';

const PROJECT = 'https://xdxdzmsztyzbnzeforxx.supabase.co';

test('the public document names the custom auth domain, never the project host', async () => {
    const saved = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = `${PROJECT}/`;
    try {
        const { developerOpenApi } = await import('../lib/developerOpenApi.js?case=configured');
        const flow = developerOpenApi.components.securitySchemes.oauth.flows.authorizationCode;
        assert.equal(flow.authorizationUrl, 'https://auth.veyrnox.ai/auth/v1/oauth/authorize');
        assert.equal(flow.tokenUrl, 'https://auth.veyrnox.ai/auth/v1/oauth/token');
        assert.doesNotMatch(JSON.stringify(developerOpenApi), /supabase\.co/i);
    } finally {
        if (saved === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved;
    }
});

test('the fallback when the var is missing is also the custom domain', async () => {
    const saved = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
        const { developerOpenApi } = await import('../lib/developerOpenApi.js?case=unset');
        assert.doesNotMatch(JSON.stringify(developerOpenApi), /supabase\.co/i);
    } finally {
        if (saved !== undefined) process.env.SUPABASE_URL = saved;
    }
});

test('a project with no custom domain keeps its own address', async () => {
    const { publicAuthOrigin } = await import('../lib/publicAuthHost.js');
    assert.equal(publicAuthOrigin('https://other.supabase.co/'), 'https://other.supabase.co');
    assert.equal(publicAuthOrigin(''), '');
});
