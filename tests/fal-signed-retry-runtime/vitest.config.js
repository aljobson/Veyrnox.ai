import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
export default defineConfig({ plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { FAL_SIGNED_RETRY_ENABLED: 'true',
        FAL_SIGNED_RETRY_JOB_ID: '11111111-1111-4111-8111-111111111111',
        FAL_SIGNED_RETRY_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString() } },
})], test: { include: ['./*.spec.js'] } });
